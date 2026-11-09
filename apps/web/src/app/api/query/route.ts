import { NextResponse } from "next/server";
import type { QuerySpec } from "@dashboard/chart-engine";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { getSourceMeta } from "@/lib/server/row-cache";
import { executeQuery } from "@/lib/server/query-service";
import { QueryRequestSchema } from "@/lib/query/spec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 200_000;
// Mỗi widget một truy vấn; một dashboard 15 widget mở lại nhiều lần khi lọc vẫn nằm dưới mức này.
const limited = createRateLimiter(300, 60_000);

/**
 * Truy vấn gộp số liệu cho nguồn dữ liệu LỚN (hàng chục nghìn dòng trở lên), cho người đã đăng nhập.
 * Quyền đọc nguồn được kiểm tra bằng RLS (thành viên workspace hoặc người được mời); tính toán dùng service role.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Quá nhiều yêu cầu, thử lại sau ít giây." }, { status: 429 });

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Yêu cầu quá lớn" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  }
  const parsed = QueryRequestSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Truy vấn không hợp lệ" }, { status: 400 });
  const { sourceId, spec } = parsed.data;

  // RLS: chỉ thấy nguồn thuộc workspace của mình hoặc nguồn mà dashboard được mời đang dùng.
  const { data: visible } = await supabase.from("data_sources").select("id").eq("id", sourceId).maybeSingle();
  if (!visible) return NextResponse.json({ error: "Không tìm thấy nguồn" }, { status: 404 });

  try {
    const meta = await getSourceMeta(sourceId);
    if (!meta) return NextResponse.json({ error: "Không tìm thấy nguồn" }, { status: 404 });
    const result = await executeQuery(sourceId, meta, spec as QuerySpec);
    return NextResponse.json({ result, version: meta.version }, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("Lỗi truy vấn:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Không tính được số liệu, thử lại sau." }, { status: 502 });
  }
}
