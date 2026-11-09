import type { ChartConfig, DateGrain, Filter, Widget } from "@dashboard/schema";
import type { RowFilter } from "@dashboard/chart-engine";
import type { FilterValue } from "./store";

/** Đổi bộ lọc dashboard + giá trị đang chọn thành RowFilter cho `applyFilters`, chỉ lấy bộ lọc cùng nguồn dữ liệu. */
export function toRowFilters(
  filters: Filter[],
  values: Record<string, FilterValue>,
  sourceId: string,
): RowFilter[] {
  const out: RowFilter[] = [];
  for (const f of filters) {
    if (f.sourceId !== sourceId) continue;
    const v = values[f.id];
    if (!v) continue;
    if (f.control === "grain") continue; // đổi cấp gom, không lọc dòng (xem withGrainOverride)
    if (f.control === "date_range") out.push({ column: f.column, values: [], dateRange: { from: v.from, to: v.to }, targets: f.targets });
    else if (f.control === "slider") out.push({ column: f.column, values: [], range: { min: v.min, max: v.max }, targets: f.targets });
    else if (v.values?.length) out.push({ column: f.column, values: v.values, targets: f.targets });
  }
  return out;
}

/** Các cấp thời gian người xem được chọn mặc định ở bộ chọn "grain". */
export const DEFAULT_GRAINS: DateGrain[] = ["day", "week", "month", "quarter", "year"];

export const GRAIN_LABEL: Record<DateGrain, string> = {
  day: "Ngày", week: "Tuần", month: "Tháng", quarter: "Quý", year: "Năm",
  month_of_year: "Tháng trong năm", weekday: "Thứ trong tuần", hour: "Ngày + giờ", hour_of_day: "Giờ trong ngày",
};

/**
 * Áp các bộ chọn cấp thời gian lên widget: chiều nào thuộc cột của bộ chọn (và widget nằm trong `targets`) thì đổi `grain`.
 * Trả đúng widget gốc khi không có gì đổi (giữ tham chiếu cho memo).
 */
export function withGrainOverride(widget: Widget, filters: Filter[], values: Record<string, FilterValue>): Widget {
  const cfg = widget.config;
  if (cfg.kind !== "chart") return widget;
  let dims = cfg.dimensions;
  for (const f of filters) {
    if (f.control !== "grain" || f.sourceId !== cfg.sourceId) continue;
    const grain = values[f.id]?.values?.[0] as DateGrain | undefined;
    if (!grain || (f.targets?.length && !f.targets.includes(widget.id))) continue;
    dims = dims.map((d) => (d.column === f.column && d.grain !== grain ? { ...d, grain } : d));
  }
  if (dims === cfg.dimensions || dims.every((d, i) => d === cfg.dimensions[i])) return widget;
  const next: ChartConfig = { ...cfg, dimensions: dims };
  return { ...widget, config: next };
}

export { dateBounds, distinctValues, numberRange } from "@dashboard/chart-engine";
