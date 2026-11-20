import { NextResponse, type NextRequest } from "next/server";
import { prepareAdSpend } from "@/lib/orders/ad-file";
import { FileError } from "@/lib/orders/csv";
import { readUpload, requireEditor } from "@/lib/orders/request";
import { createRateLimiter } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limited = createRateLimiter(40, 10 * 60 * 1000);

/** Xem trước file chi phí quảng cáo theo ngày, KHÔNG ghi gì: cột nhận diện, tổng tiền, khoảng ngày, cảnh báo. */
export async function POST(request: NextRequest) {
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn thao tác quá nhanh, thử lại sau ít phút." }, { status: 429 });
  const up = await readUpload(request);
  if (up instanceof NextResponse) return up;
  try {
    const p = await prepareAdSpend(up.data, up.filename, up.opts);
    return NextResponse.json({
      filename: p.filename,
      sheetNames: p.sheetNames,
      sheet: p.sheet,
      headers: p.headers,
      mapping: p.mapping,
      channel: p.channel,
      problems: p.problems,
      warnings: p.warnings,
      summary: p.summary,
      preview: p.entries.slice(0, 6),
    });
  } catch (e) {
    if (e instanceof FileError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("[api/ads/inspect]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Không đọc được file." }, { status: 500 });
  }
}
