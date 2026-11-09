import type { Filter } from "@dashboard/schema";
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
    if (f.control === "date_range") out.push({ column: f.column, values: [], dateRange: { from: v.from, to: v.to }, targets: f.targets });
    else if (f.control === "slider") out.push({ column: f.column, values: [], range: { min: v.min, max: v.max }, targets: f.targets });
    else if (v.values?.length) out.push({ column: f.column, values: v.values, targets: f.targets });
  }
  return out;
}

export { dateBounds, distinctValues, numberRange } from "@dashboard/chart-engine";
