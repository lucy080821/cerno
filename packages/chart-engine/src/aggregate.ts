import type { FieldBinding } from "@dashboard/schema";
import { dayNumberOf, hourOf, instantDaysOf, toIsoDate } from "./filter";
import { evalAggField, minMaxColumn, type CalcSet } from "./formula";
import type { MetricKind } from "./format";
import { grainLabel, grainSortKey } from "./period";

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export const AGG_LABEL = {
  sum: "Tổng",
  avg: "Trung bình",
  count: "Số dòng",
  min: "Nhỏ nhất",
  max: "Lớn nhất",
  count_distinct: "Đếm duy nhất",
} as const;

export type AggName = keyof typeof AGG_LABEL;

export interface AggregatedRow {
  keys: Cell[];
  values: number[];
}

export interface AggregatedTable {
  dimLabels: string[];
  metricLabels: string[];
  rows: AggregatedRow[];
  /** Kiểu từng số đo. Chỉ có khi có số đo là NGÀY (MIN/MAX của cột ngày, giá trị = số ngày kể từ 1970); bỏ trống = toàn số. */
  metricKinds?: MetricKind[];
}

export function bindingLabel(b: FieldBinding, isMetric: boolean): string {
  if (b.label) return b.label;
  if (!isMetric) return b.column;
  return `${AGG_LABEL[b.aggregation ?? "sum"]} ${b.column}`;
}

export function aggregateValues(values: Cell[], agg: AggName): number {
  if (agg === "count") return values.length;
  if (agg === "count_distinct") return new Set(values).size;
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) {
    // min/max của cột ngày: số ngày kể từ 1970 (hiển thị thành ngày nhờ `metricKinds`).
    if (agg === "min" || agg === "max") {
      const days = values.map(instantDaysOf).filter((x): x is number => x !== null);
      if (days.length) return agg === "min" ? days.reduce((a, b) => (b < a ? b : a)) : days.reduce((a, b) => (b > a ? b : a));
    }
    return 0;
  }
  switch (agg) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
}

/** Cột có phải cột ngày không: trong 50 ô có giá trị đầu tiên, không ô nào là số và có ít nhất một ô đọc được thành ngày. */
function isDateColumn(rows: Row[], column: string): boolean {
  let seen = 0;
  let dates = 0;
  for (const r of rows) {
    const v = r[column];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "number") return false;
    if (dayNumberOf(v) !== null) dates++;
    if (++seen >= 50) break;
  }
  return dates > 0;
}

const isBinned = (d: FieldBinding) => !!(d.bins || d.binWidth);
const tidy = (v: number) => String(+v.toPrecision(12));

export interface BinPlan {
  start: number;
  step: number;
  labels: string[];
}

export interface BinOpts {
  /** Số khoảng tối đa (bước được làm tròn 1/2/5 × 10^k). Bị `width` ghi đè nếu có. */
  bins?: number;
  /** Độ rộng mỗi khoảng, dùng đúng giá trị này (không làm tròn). */
  width?: number;
  /** Cận dưới của khoảng đầu tiên; giá trị nhỏ hơn bị bỏ. Bỏ trống = tự theo dữ liệu. */
  start?: number;
}

/** Chia các giá trị số thành khoảng bằng nhau. Null nếu không có giá trị số. */
export function planBins(values: number[], o: BinOpts): BinPlan | null {
  const nums = o.start === undefined ? values : values.filter((v) => v >= o.start!);
  if (nums.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of nums) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const from = o.start ?? min;
  const range = max - from;
  let step: number;
  if (o.width && o.width > 0) step = o.width;
  else if (range === 0) step = Math.abs(from) >= 1 ? Math.pow(10, Math.floor(Math.log10(Math.abs(from)))) : 1;
  else {
    const raw = range / Math.max(2, o.bins ?? 10);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }
  const start = o.start ?? Math.floor(min / step) * step;
  const count = Math.max(1, Math.min(200, Math.floor((max - start) / step) + 1));
  const labels = Array.from({ length: count }, (_, i) => `${tidy(start + i * step)}–${tidy(start + (i + 1) * step)}`);
  return { start, step, labels };
}

/**
 * Nhóm các dòng theo dimension rồi tính từng metric.
 * Thứ tự nhóm giữ theo lần xuất hiện đầu tiên trong dữ liệu.
 * Không có dimension = một nhóm duy nhất (dùng cho KPI).
 */
export function aggregate(
  rows: Row[],
  dims: FieldBinding[],
  metrics: FieldBinding[],
  /** Trường tính toán dạng tổng hợp (SUM([a])/SUM([b])...): số đo trỏ tới chúng được tính trên cả nhóm dòng. */
  calc?: CalcSet,
): AggregatedTable {
  const aggField = (m: FieldBinding) => calc?.aggFields.get(m.column);
  const groups = new Map<string, { keys: Cell[]; rows: Row[] }>();
  // Dimension có `bins` (histogram): gom giá trị số vào khoảng; dòng không phải số bị bỏ.
  const plans = dims.map((d) => {
    if (!isBinned(d)) return null;
    const nums: number[] = [];
    for (const r of rows) {
      const v = r[d.column];
      if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
    }
    return planBins(nums, { bins: d.bins, width: d.binWidth, start: d.binStart });
  });
  const binned = dims.some(isBinned);
  const order = new Map<string, string>(); // nhãn → khoá sắp xếp (chiều ngày có grain)
  if (binned && dims.length === 1 && plans[0]) {
    // Giữ cả khoảng trống (đếm 0) để hình dạng phân phối không bị đứt.
    for (const label of plans[0].labels) groups.set(label, { keys: [label], rows: [] });
  }
  for (const row of rows) {
    let skip = false;
    const keys = dims.map((d, i) => {
      const v = row[d.column] ?? null;
      if (d.grain) {
        const iso = toIsoDate(v);
        if (!iso) {
          skip = true;
          return null;
        }
        let hour = 0;
        if (d.grain === "hour" || d.grain === "hour_of_day") {
          const h = hourOf(v);
          if (h === null) {
            skip = true; // ô chỉ có ngày, không có giờ
            return null;
          }
          hour = h;
        }
        const label = grainLabel(iso, d.grain, hour);
        if (d === dims[0] && !order.has(label)) order.set(label, grainSortKey(iso, d.grain, hour));
        return label;
      }
      if (!isBinned(d)) return v;
      const plan = plans[i];
      if (!plan || typeof v !== "number" || !Number.isFinite(v)) {
        skip = true;
        return null;
      }
      if (v < plan.start) {
        skip = true;
        return null;
      }
      const idx = Math.min(plan.labels.length - 1, Math.floor((v - plan.start) / plan.step));
      return plan.labels[idx];
    });
    if (skip) continue;
    const id = keys.map((k) => String(k)).join("\u0001");
    let g = groups.get(id);
    if (!g) {
      g = { keys, rows: [] };
      groups.set(id, g);
    }
    g.rows.push(row);
  }
  if (dims.length === 0 && groups.size === 0) groups.set("", { keys: [], rows: [] });

  const kinds: MetricKind[] = metrics.map((m) => {
    const f = aggField(m);
    const col = f ? minMaxColumn(f) : m.aggregation === "min" || m.aggregation === "max" ? m.column : null;
    return col && isDateColumn(rows, col) ? "date" : "number";
  });

  return {
    ...(kinds.includes("date") ? { metricKinds: kinds } : {}),
    dimLabels: dims.map((d) => bindingLabel(d, false)),
    metricLabels: metrics.map((m) => (aggField(m) ? m.label ?? m.column : bindingLabel(m, true))),
    rows: (dims[0]?.grain
      ? [...groups.values()].sort((a, b) => {
          const ka = order.get(String(a.keys[0])) ?? String(a.keys[0]);
          const kb = order.get(String(b.keys[0])) ?? String(b.keys[0]);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        })
      : [...groups.values()]
    ).map((g) => ({
      keys: g.keys,
      values: metrics.map((m) => {
        const f = aggField(m);
        if (f) return evalAggField(f, g.rows);
        return aggregateValues(
          g.rows.map((r) => r[m.column] ?? null),
          m.aggregation ?? "sum",
        );
      }),
    })),
  };
}
