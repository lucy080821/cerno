import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/account-utils";
import { GoogleAuthError } from "@/lib/google/api";
import { MANUAL_MIN_SECONDS } from "@/lib/google/constants";
import { requireEditor } from "@/lib/orders/request";
import { SheetSyncError, syncOrderSheet } from "@/lib/orders/sheet-sync";
import { createRateLimiter } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const limited = createRateLimiter(30, 10 * 60 * 1000);

/** "Cập nhật ngay": đọc lại một Sheet đơn hàng theo yêu cầu. Production giới hạn 1 lần/phút/Sheet để không lạm dụng hạn mức Google. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("host"))) return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 403 });
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn thao tác quá nhanh, thử lại sau ít phút." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "ID không hợp lệ" }, { status: 400 });

  // RLS: chỉ thấy Sheet thuộc workspace của mình.
  const { data: row } = await auth.supabase.from("order_sheets").select("id, last_synced_at").eq("id", id).eq("workspace_id", auth.workspaceId).maybeSingle();
  if (!row) return NextResponse.json({ error: "Không tìm thấy Sheet đơn hàng." }, { status: 404 });
  if (row.last_synced_at && process.env.NODE_ENV === "production") {
    const waitMs = MANUAL_MIN_SECONDS * 1000 - (Date.now() - new Date(row.last_synced_at as string).getTime());
    if (waitMs > 0) return NextResponse.json({ error: `Vừa cập nhật xong. Thử lại sau ${Math.ceil(waitMs / 1000)} giây.` }, { status: 429 });
  }

  try {
    return NextResponse.json(await syncOrderSheet(id, auth.user.id));
  } catch (e) {
    if (e instanceof GoogleAuthError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof SheetSyncError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Không cập nhật được." }, { status: 502 });
  }
}
