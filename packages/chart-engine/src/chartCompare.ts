import type { ChartConfig } from "@dashboard/schema";
import { aggregate, type AggregatedTable, type Row } from "./aggregate";
import { applyFilters, filterAppliesTo, isFilterActive, toIsoDate, type RowFilter } from "./filter";
import type { CalcSet } from "./formula";
import { addDays, addMonths, daysBetween, resolvePeriods, type DateSpan, type Grain } from "./period";
import { chartFields } from "./option";

/**
 * So sánh kỳ ngay trên chart (đường/vùng/cột): lấy dữ liệu của kỳ trước hoặc cùng kỳ năm ngoái, dời ngày của nó về đúng vị trí
 * tương ứng trong kỳ hiện tại rồi gộp cùng cách với chart, nên hai đường dùng chung các nhãn trục (ngày 1 của kỳ trước nằm cạnh
 * ngày 1 của kỳ này). Hàm thuần, không phụ thuộc DOM. Chỉ cho nguồn tính tại máy: nguồn lớn (server gộp) chưa hỗ trợ.
 */
export type ChartCompareTo = "prev_period" | "prev_year";

const GRAINS: string[] = ["day", "week", "month", "quarter", "year"];
const CHART_TYPES = ["line", "area", "bar"];

export interface ChartCompareData {
  /** Bảng đã gộp của kỳ so sánh, nhãn đã dời về kỳ hiện tại. */
  table: AggregatedTable;
  to: ChartCompareTo;
  label: string;
  cur: DateSpan;
  prev: DateSpan;
}

export type ChartCompareFail = "unsupported" | "no_range" | "no_data";
export type ChartCompareResult = ({ ok: true } & ChartCompareData) | { ok: false; reason: ChartCompareFail };

/** Chart này có thể so sánh kỳ không (chỉ xét cấu hình, chưa xét dữ liệu). */
export function chartCompareSupported(config: ChartConfig): boolean {
  const g = config.dimensions[0]?.grain;
  return CHART_TYPES.includes(config.chartType) && config.dimensions.length === 1 && !!g && GRAINS.includes(g);
}

export function computeChartCompare(
  allRows: Row[], filters: RowFilter[], selfId: string | undefined, config: ChartConfig, calc?: CalcSet,
): ChartCompareResult | null {
  const to = config.format?.compare?.to;
  if (!to) return null;
  const f = chartFields(config);
  if (!f || !chartCompareSupported(config)) return { ok: false, reason: "unsupported" };
  const dateColumn = f.dimensions[0].column;
  const grain = f.dimensions[0].grain as Grain;

  const isDateF = (x: RowFilter) => x.column === dateColumn && !!x.dateRange;
  const dateFs = filters.filter((x) => isDateF(x) && isFilterActive(x) && filterAppliesTo(x, selfId));
  let from: string | undefined;
  let end: string | undefined;
  for (const x of dateFs) {
    if (x.dateRange?.from && (!from || x.dateRange.from > from)) from = x.dateRange.from;
    if (x.dateRange?.to && (!end || x.dateRange.to < end)) end = x.dateRange.to;
  }
  if (!from || !end) return { ok: false, reason: "no_range" };
  const periods = resolvePeriods({ to, dateColumn, grain, show: "percent", goodWhen: "up", toDate: false }, { from, to: end }, null);
  if (!periods) return { ok: false, reason: "no_range" };

  const base = applyFilters(allRows, filters.filter((x) => !isDateF(x)), selfId);
  const n = daysBetween(periods.cur.from, periods.cur.to) + 1;
  const shift = (d: string) => (to === "prev_year" ? addMonths(d, 12) : addDays(d, n));
  const shifted: Row[] = [];
  for (const r of base) {
    const d = toIsoDate(r[dateColumn]);
    if (!d || d < periods.prev.from || d > periods.prev.to) continue;
    shifted.push({ ...r, [dateColumn]: shift(d) });
  }
  if (!shifted.length) return { ok: false, reason: "no_data" };
  return { ok: true, table: aggregate(shifted, f.dimensions, f.metrics, calc), to, label: to === "prev_year" ? "cùng kỳ năm ngoái" : "kỳ trước", cur: periods.cur, prev: periods.prev };
}
