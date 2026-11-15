import { NextResponse, type NextRequest } from "next/server";
import { FileError } from "@/lib/orders/csv";
import { prepareImport } from "@/lib/orders/prepare";
import { readUpload, requireEditor } from "@/lib/orders/request";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { COL, ORDER_COLUMNS } from "@/lib/orders/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limited = createRateLimiter(40, 10 * 60 * 1000);
const PREVIEW_ROWS = 5;

/**
 * Xem trước một file đơn hàng, KHÔNG ghi gì: trả về sheet, kênh, ánh xạ cột đã nhận diện, tóm tắt (số đơn, khoảng ngày,
 * trạng thái), cảnh báo và vài dòng đã chuẩn hoá (đúng thứ sẽ được lưu, không có thông tin người mua).
 */
export async function POST(request: NextRequest) {
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn thao tác quá nhanh, thử lại sau ít phút." }, { status: 429 });

  const up = await readUpload(request);
  if (up instanceof NextResponse) return up;
  try {
    const p = await prepareImport(up.data, up.filename, up.opts);
    return NextResponse.json({
      filename: p.filename,
      sheetNames: p.sheetNames,
      sheet: p.sheet,
      headers: p.headers,
      profile: p.profile,
      profileLabel: p.profileLabel,
      channel: p.channel,
      mapping: p.mapping,
      problems: p.problems,
      columns: ORDER_COLUMNS.map((c) => c.name),
      summary: p.normalized
        ? {
            lines: p.normalized.stats.lines,
            orders: p.normalized.stats.orders,
            dateMin: p.normalized.stats.dateMin,
            dateMax: p.normalized.stats.dateMax,
            byStatus: p.normalized.stats.byStatus,
            keyed: p.normalized.keyed,
            netRevenue: p.normalized.rows.reduce((n, r) => n + (Number(r[COL.netRevenue]) || 0), 0),
          }
        : null,
      warnings: p.normalized?.warnings ?? [],
      preview: p.normalized?.rows.slice(0, PREVIEW_ROWS) ?? [],
    });
  } catch (e) {
    if (e instanceof FileError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("[api/orders/inspect]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Không đọc được file." }, { status: 500 });
  }
}
