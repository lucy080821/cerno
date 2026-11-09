import type { FieldBinding, KpiCompare } from "@dashboard/schema";
import { aggregate, type Row } from "./aggregate";
import { applyFilters, filterAppliesTo, isFilterActive, toIsoDate, type RowFilter } from "./filter";
import type { CalcSet } from "./formula";
import { formatCompact, formatNumber } from "./format";

/**
 * So sánh kỳ (kỳ trước / cùng kỳ năm ngoái) cho KPI. Hàm thuần, không phụ thuộc DOM:
 * web tính tại máy, server dùng lại qua runQuery cho nguồn lớn.
 */

export type Grain = "day" | "week" | "month" | "quarter" | "year";
/** Cấp gom của chiều ngày: ngoài các cấp theo dòng thời gian còn có cấp theo chu kỳ (mọi năm/tuần gộp lại). */
export type DimGrain = Grain | "month_of_year" | "weekday" | "hour" | "hour_of_day";
export interface DateSpan { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, "0");
const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
};
const make = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(iso: string, n: number): string {
  const { y, m, d } = parse(iso);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Cộng tháng, kẹp ngày về cuối tháng (31/3 − 1 tháng = 28/2). */
export function addMonths(iso: string, n: number): string {
  const { y, m, d } = parse(iso);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return make(ny, nm, Math.min(d, daysIn(ny, nm)));
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const STEP: Record<Grain, number> = { day: 0, week: 0, month: 1, quarter: 3, year: 12 };
/** Thứ trong tuần, 0 = Thứ 2 … 6 = Chủ nhật. */
const weekdayOf = (iso: string) => {
  const { y, m, d } = parse(iso);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};
const WEEKDAYS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "CN"];

/** Tuần ISO (thứ 2 đầu tuần, tuần 1 chứa thứ 5 đầu tiên của năm). */
function isoWeek(iso: string): { year: number; week: number } {
  const thursday = addDays(iso, 3 - weekdayOf(iso));
  const { y } = parse(thursday);
  const jan1 = make(y, 1, 1);
  return { year: y, week: Math.floor(daysBetween(jan1, thursday) / 7) + 1 };
}

export function periodStart(iso: string, grain: Grain): string {
  const { y, m } = parse(iso);
  if (grain === "day") return iso;
  if (grain === "week") return addDays(iso, -weekdayOf(iso));
  if (grain === "month") return make(y, m, 1);
  if (grain === "quarter") return make(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
  return make(y, 1, 1);
}

export function periodEnd(iso: string, grain: Grain): string {
  if (grain === "day") return iso;
  if (grain === "week") return addDays(periodStart(iso, "week"), 6);
  return addDays(addMonths(periodStart(iso, grain), STEP[grain]), -1);
}

/** Nhãn gom theo cấp ngày: "2025-03-09", "2025-03-09 14:00", "2025-W36", "2025-03", "2025-Q1", "2025", "Tháng 3", "Thứ 2", "14h". */
export function grainLabel(iso: string, grain: DimGrain, hour = 0): string {
  const { y, m } = parse(iso);
  if (grain === "day") return iso;
  if (grain === "hour") return `${iso} ${pad(hour)}:00`;
  if (grain === "hour_of_day") return `${pad(hour)}h`;
  if (grain === "week") {
    const w = isoWeek(iso);
    return `${w.year}-W${pad(w.week)}`;
  }
  if (grain === "month") return `${y}-${pad(m)}`;
  if (grain === "quarter") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  if (grain === "month_of_year") return `Tháng ${m}`;
  if (grain === "weekday") return WEEKDAYS[weekdayOf(iso)];
  return String(y);
}

/** Khoá sắp xếp của nhãn: nhãn theo dòng thời gian tự sắp đúng theo chữ, còn "Tháng 10" / "CN" thì cần khoá riêng. */
export function grainSortKey(iso: string, grain: DimGrain, hour = 0): string {
  if (grain === "hour_of_day") return pad(hour);
  if (grain === "month_of_year") return pad(parse(iso).m);
  if (grain === "weekday") return String(weekdayOf(iso));
  return grainLabel(iso, grain, hour);
}

const LABELS: Record<KpiCompare["to"], Record<Grain, string>> = {
  prev_period: { day: "so với hôm trước", week: "so với tuần trước", month: "so với tháng trước", quarter: "so với quý trước", year: "so với năm trước" },
  prev_year: { day: "so với cùng ngày năm ngoái", week: "so với cùng kỳ năm ngoái", month: "so với cùng kỳ năm ngoái", quarter: "so với cùng kỳ năm ngoái", year: "so với năm trước" },
};

export interface Periods { cur: DateSpan; prev: DateSpan; label: string }

/**
 * Xác định kỳ hiện tại và kỳ so sánh.
 * - Có khoảng ngày đầy đủ (từ bộ lọc dashboard): kỳ hiện tại chính là khoảng đó; "kỳ trước" là khoảng liền kề cùng độ dài.
 * - Không có: kỳ hiện tại là kỳ (theo `grain`) chứa ngày tham chiếu `ref` (ngày mới nhất trong dữ liệu hoặc đầu mút phải của bộ lọc).
 */
export function resolvePeriods(cmp: KpiCompare, explicit: DateSpan | null, ref: string | null): Periods | null {
  if (explicit) {
    const n = daysBetween(explicit.from, explicit.to) + 1;
    if (n < 1) return null;
    const prev: DateSpan =
      cmp.to === "prev_year"
        ? { from: addMonths(explicit.from, -12), to: addMonths(explicit.to, -12) }
        : { from: addDays(explicit.from, -n), to: addDays(explicit.from, -1) };
    return { cur: explicit, prev, label: cmp.to === "prev_year" ? "so với cùng kỳ năm ngoái" : "so với kỳ trước" };
  }
  if (!ref) return null;
  const g = cmp.grain;
  const start = periodStart(ref, g);
  const cur: DateSpan = { from: start, to: cmp.toDate ? ref : periodEnd(ref, g) };
  let pStart: string;
  if (g === "week") pStart = addDays(start, cmp.to === "prev_year" ? -364 : -7); // 52 tuần: giữ nguyên thứ trong tuần
  else if (cmp.to === "prev_year") pStart = periodStart(addMonths(ref, -12), g);
  else pStart = g === "day" ? addDays(start, -1) : addMonths(start, -STEP[g]);
  const pFull = periodEnd(pStart, g);
  const pTo = cmp.toDate ? [addDays(pStart, daysBetween(start, ref)), pFull].sort()[0] : pFull;
  return { cur, prev: { from: pStart, to: pTo }, label: LABELS[cmp.to][g] };
}

export interface CompareResult {
  current: number;
  /** null khi kỳ so sánh không có dòng dữ liệu nào (không tính được %). */
  previous: number | null;
  label: string;
  cur: DateSpan;
  prev: DateSpan;
}

/**
 * Tính số đo ở kỳ hiện tại và kỳ so sánh. `rows` là dòng CHƯA lọc; bộ lọc khoảng ngày trên chính cột ngày bị thay bằng
 * kỳ do hàm này tự xác định (nếu không, kỳ trước luôn rỗng).
 */
export function computeCompare(
  rows: Row[], filters: RowFilter[], selfId: string | undefined, metric: FieldBinding, cmp: KpiCompare, calc?: CalcSet,
): CompareResult | null {
  const isDateF = (f: RowFilter) => f.column === cmp.dateColumn && !!f.dateRange;
  const dateFs = filters.filter((f) => isDateF(f) && isFilterActive(f) && filterAppliesTo(f, selfId));
  const base = applyFilters(rows, filters.filter((f) => !isDateF(f)), selfId);

  let from: string | undefined;
  let to: string | undefined;
  for (const f of dateFs) {
    if (f.dateRange?.from && (!from || f.dateRange.from > from)) from = f.dateRange.from;
    if (f.dateRange?.to && (!to || f.dateRange.to < to)) to = f.dateRange.to;
  }
  let ref = to ?? null;
  if (!ref) {
    for (const r of base) {
      const d = toIsoDate(r[cmp.dateColumn]);
      if (d && (!ref || d > ref)) ref = d;
    }
  }
  const periods = resolvePeriods(cmp, from && to ? { from, to } : null, ref);
  if (!periods) return null;

  const inSpan = (d: string, s: DateSpan) => d >= s.from && d <= s.to;
  const curRows: Row[] = [];
  const prevRows: Row[] = [];
  for (const r of base) {
    const d = toIsoDate(r[cmp.dateColumn]);
    if (!d) continue;
    if (inSpan(d, periods.cur)) curRows.push(r);
    else if (inSpan(d, periods.prev)) prevRows.push(r);
  }
  const value = (rs: Row[]) => aggregate(rs, [], [metric], calc).rows[0]?.values[0] ?? 0;
  return {
    current: value(curRows),
    previous: prevRows.length ? value(prevRows) : null,
    label: periods.label,
    cur: periods.cur,
    prev: periods.prev,
  };
}

export interface GrowthText {
  /** "+12,3%", "−1,2K", "+0,5 pp"; rỗng nếu không tính được. */
  text: string;
  dir: "up" | "down" | "flat" | null;
  /** Tốt / xấu / trung tính theo `goodWhen`. */
  tone: "good" | "bad" | "neutral";
}

/** Chuyển kết quả so sánh thành chữ hiển thị + hướng + sắc thái. */
export function formatGrowth(r: CompareResult | null, cmp: KpiCompare): GrowthText {
  if (!r || r.previous === null) return { text: "", dir: null, tone: "neutral" };
  const diff = r.current - r.previous;
  let text: string;
  let measure = diff;
  if (cmp.show === "percent") {
    if (r.previous === 0) return { text: "", dir: null, tone: "neutral" }; // chia cho 0: để trống
    measure = diff / Math.abs(r.previous);
    text = `${formatNumber(Math.round(Math.abs(measure) * 1000) / 10)}%`;
  } else if (cmp.show === "pp") {
    text = `${formatNumber(Math.round(Math.abs(diff) * 100) / 100)} pp`;
  } else {
    text = formatCompact(Math.abs(diff));
  }
  const dir = measure === 0 || text === "0%" || text === "0 pp" ? "flat" : measure > 0 ? "up" : "down";
  const sign = dir === "up" ? "+" : dir === "down" ? "−" : "";
  const tone = dir === "flat" ? "neutral" : (dir === "up") === (cmp.goodWhen === "up") ? "good" : "bad";
  return { text: sign + text, dir, tone };
}
