import { COL } from "./canonical";
import type { NormalizeResult } from "./normalize";

export const PREVIEW_ROWS = 5;

/** Phần xem trước dùng chung cho file tải lên và Sheet: tóm tắt, cảnh báo và vài dòng đã chuẩn hoá (đúng thứ sẽ lưu, không có thông tin người mua). */
export function buildPreview(normalized: NormalizeResult | null) {
  return {
    summary: normalized
      ? {
          lines: normalized.stats.lines,
          orders: normalized.stats.orders,
          dateMin: normalized.stats.dateMin,
          dateMax: normalized.stats.dateMax,
          byStatus: normalized.stats.byStatus,
          keyed: normalized.keyed,
          netRevenue: normalized.rows.reduce((n, r) => n + (Number(r[COL.netRevenue]) || 0), 0),
        }
      : null,
    warnings: normalized?.warnings ?? [],
    preview: normalized?.rows.slice(0, PREVIEW_ROWS) ?? [],
  };
}
