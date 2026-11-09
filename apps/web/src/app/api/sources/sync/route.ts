import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleAuthError } from "@/lib/google/api";
import { syncSource } from "@/lib/google/sync";
import { MANUAL_MIN_SECONDS } from "@/lib/google/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Cập nhật ngay": đồng bộ lại một nguồn theo yêu cầu. Production giới hạn 1 lần/phút/nguồn để không lạm dụng hạn mức Google. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { sourceId?: unknown } | null;
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId : "";
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) return NextResponse.json({ error: "ID không hợp lệ" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  // RLS: chỉ thấy nguồn thuộc workspace của mình.
  const { data: src } = await supabase
    .from("data_sources")
    .select("id, workspace_id, last_synced_at")
    .eq("id", sourceId)
    .maybeSingle();
  if (!src) return NextResponse.json({ error: "Không tìm thấy nguồn" }, { status: 404 });

  const { data: canEdit } = await supabase.rpc("can_edit", { ws: src.workspace_id });
  if (!canEdit) return NextResponse.json({ error: "Bạn không có quyền sửa" }, { status: 403 });

  // Giới hạn chỉ áp dụng ở production; lúc dev cho cập nhật ngay để thử.
  if (src.last_synced_at && process.env.NODE_ENV === "production") {
    const waitMs = MANUAL_MIN_SECONDS * 1000 - (Date.now() - new Date(src.last_synced_at).getTime());
    if (waitMs > 0) {
      return NextResponse.json(
        { error: `Vừa cập nhật xong. Thử lại sau ${Math.ceil(waitMs / 1000)} giây.` },
        { status: 429 },
      );
    }
  }

  try {
    return NextResponse.json(await syncSource(sourceId, user.id));
  } catch (e) {
    const status = e instanceof GoogleAuthError ? 403 : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lỗi" }, { status });
  }
}
