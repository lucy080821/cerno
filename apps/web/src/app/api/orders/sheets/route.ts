import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/account-utils";
import { GoogleAuthError, getAccessToken, isValidSpreadsheetId } from "@/lib/google/api";
import { CHANNELS } from "@/lib/orders/canonical";
import { requireEditor } from "@/lib/orders/request";
import { SheetSyncError, connectOrderSheet } from "@/lib/orders/sheet-sync";
import { createRateLimiter } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const limited = createRateLimiter(10, 10 * 60 * 1000);

/**
 * Nối một tab Google Sheet làm nguồn đơn hàng của MỘT kênh và đồng bộ lần đầu (thay dữ liệu hiện có của kênh đó trong "Đơn hàng đa kênh").
 * Body JSON: {spreadsheetId, sheetName, name?, channel, mapping}.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("host"))) return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 403 });
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn thao tác quá nhanh, thử lại sau ít phút." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { spreadsheetId?: unknown; sheetName?: unknown; name?: unknown; channel?: unknown; mapping?: unknown } | null;
  const sheetName = typeof body?.sheetName === "string" ? body.sheetName.trim() : "";
  const channel = typeof body?.channel === "string" ? body.channel : "";
  if (!isValidSpreadsheetId(body?.spreadsheetId) || !sheetName || sheetName.length > 120) return NextResponse.json({ error: "Thiếu hoặc sai thông tin file/tab" }, { status: 400 });
  if (!(CHANNELS as readonly string[]).includes(channel)) return NextResponse.json({ error: "Chưa chọn kênh bán." }, { status: 400 });
  if (JSON.stringify(body?.mapping ?? null).length > 4000) return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  const name = (typeof body?.name === "string" ? body.name.trim() : "").slice(0, 160) || `${channel} › ${sheetName}`;

  try {
    const token = await getAccessToken(auth.user.id);
    const result = await connectOrderSheet({
      user: auth.supabase,
      userId: auth.user.id,
      workspaceId: auth.workspaceId,
      token,
      spreadsheetId: body.spreadsheetId,
      sheetName,
      name,
      channel,
      mapping: body?.mapping,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GoogleAuthError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof SheetSyncError) return NextResponse.json({ error: e.message }, { status: e.status });
    const status = (e as { status?: number }).status;
    console.error("[api/orders/sheets]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Không nối được Sheet." }, { status: typeof status === "number" ? status : 502 });
  }
}

/** Ngắt kết nối một Sheet đơn hàng: dữ liệu đã nhập của kênh đó vẫn giữ nguyên, chỉ không còn tự cập nhật. ?id=<uuid> */
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("host"))) return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 403 });
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "ID không hợp lệ" }, { status: 400 });
  // RLS: chỉ xoá được Sheet thuộc workspace mình được sửa.
  const { error } = await auth.supabase.from("order_sheets").delete().eq("id", id).eq("workspace_id", auth.workspaceId);
  if (error) return NextResponse.json({ error: "Không ngắt kết nối được, thử lại sau." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
