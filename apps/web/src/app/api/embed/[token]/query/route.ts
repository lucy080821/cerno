import { NextResponse } from "next/server";
import type { QuerySpec } from "@dashboard/chart-engine";
import { authorizeSharedSource } from "@/lib/server/embed";
import { clientIp, createRateLimiter } from "@/lib/server/rate-limit";
import { getSourceMeta } from "@/lib/server/row-cache";
import { executeQuery } from "@/lib/server/query-service";
import { QueryRequestSchema } from "@/lib/query/spec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 200_000;
const limited = createRateLimiter(300, 60_000);

/**
 * Truy vấn gộp số liệu cho người xem CÔNG KHAI (link xem / nhúng iframe) của một nguồn lớn. Không cần đăng nhập:
 * mã chia sẻ trong URL là thứ duy nhất bảo vệ dữ liệu. Chỉ trả nguồn mà dashboard đó dùng (cùng workspace), và
 * trường tính toán lấy từ dashboard đã lưu chứ KHÔNG tin danh sách do trình duyệt gửi.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (limited(clientIp(req))) return NextResponse.json({ error: "Quá nhiều yêu cầu, thử lại sau ít giây." }, { status: 429 });

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

  // Mọi trường hợp không hợp lệ đều trả cùng một lỗi 404 để không lộ mã nào tồn tại.
  const notFound = () => NextResponse.json({ error: "Link không còn hiệu lực" }, { status: 404 });
  try {
    const shared = await authorizeSharedSource(token, sourceId);
    if (!shared?.doc) return notFound();
    const meta = await getSourceMeta(sourceId);
    if (!meta || meta.workspaceId !== shared.workspaceId) return notFound();

    const calc = shared.doc.calculatedFields
      .filter((f) => f.sourceId === sourceId)
      .map((f) => ({ id: f.id, name: f.name, expression: f.expression }));
    const result = await executeQuery(sourceId, meta, { ...spec, calc } as QuerySpec);
    return NextResponse.json(
      { result, version: meta.version },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (e) {
    console.error("Lỗi truy vấn công khai:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Không tính được số liệu, thử lại sau." }, { status: 502 });
  }
}
