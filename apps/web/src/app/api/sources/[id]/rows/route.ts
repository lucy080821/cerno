import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSourceRows } from "@/lib/server/source-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Trả dòng đã đồng bộ của một nguồn (tối đa 20.000 dòng, giới hạn lúc đồng bộ; `?limit=N` để chỉ lấy N dòng đầu).
 * Dùng client của người dùng nên RLS tự đảm bảo chỉ đọc được nguồn thuộc workspace của mình.
 * Editor hiện gộp số liệu ở trình duyệt; khi dữ liệu lớn hơn sẽ chuyển sang gộp ở server.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // ?limit=N chỉ lấy N dòng đầu (xem trước). Không có thì lấy hết.
  const limitParam = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 25_000) : 25_000;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "ID không hợp lệ" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const { data: src } = await supabase.from("data_sources").select("id, row_count, last_synced_at").eq("id", id).maybeSingle();
  if (!src) return NextResponse.json({ error: "Không tìm thấy nguồn" }, { status: 404 });

  const { rows, error } = await fetchSourceRows(supabase, id, limit);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ rows, syncedAt: src.last_synced_at }, { headers: { "cache-control": "private, no-store" } });
}
