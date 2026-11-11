import type { Row } from "./aggregate";

export interface RowFilter {
  column: string;
  /** Giá trị được giữ lại (so sánh theo chuỗi, vì nhãn trên chart luôn là chuỗi). */
  values: string[];
  /** Khoảng số (dùng cho cột kiểu số); ưu tiên hơn `values` khi có. */
  range?: { min?: number; max?: number };
  /** Khoảng ngày (ISO yyyy-mm-dd, gồm cả hai đầu); ưu tiên hơn `values`. */
  dateRange?: { from?: string; to?: string };
  /** Widget tạo ra bộ lọc; bộ lọc này không áp lên chính widget đó. */
  originId?: string;
  /** Chỉ áp cho các widget này; bỏ trống = áp cho tất cả. */
  targets?: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Ghép y/m/d thành ISO nếu là ngày có thật (31/2 không hợp lệ), ngược lại null. */
function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || y < 1000 || y > 9999) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Đưa giá trị ngày về dạng ISO yyyy-mm-dd để so sánh được; trả về null nếu không hiểu.
 * Hiểu: ISO (có thể kèm giờ), dd/mm/yyyy (-, . cũng được; số trước là NGÀY), yyyy/mm/dd, "Sep 5, 2025", "5 Sep 2025",
 * "5 thg 9, 2025" (kèm giờ phía sau cũng được), và Date. Phần giờ bị bỏ qua.
 */
/** Số ngày kể từ 1970-01-01 của một giá trị ngày (null nếu không đọc được). Ô kiểu số KHÔNG được coi là ngày. */
export function dayNumberOf(v: unknown): number | null {
  const iso = toIsoDate(v);
  if (!iso) return null;
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : null;
}

export function toIsoDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s,])/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:$|[T\s,])/.exec(s);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  // "Sep 5, 2025", "September 5th, 2025 3:20 PM", "Fri, Sep 5, 2025"
  m = /^(?:[A-Za-z]+,\s*)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:$|[\s,])/.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  // "5 Sep 2025", "5 September, 2025"
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?:$|[\s,])/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  // "5 thg 9, 2025" (Google Sheets bản tiếng Việt)
  m = /^(\d{1,2})\s+thg\s+(\d{1,2}),?\s+(\d{4})(?:$|[\s,])/i.exec(s);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  return null;
}

/**
 * Giờ (0–23) của một giá trị ngày-giờ: "2025-09-05 14:30", "…T14:30:00Z", "Sep 5, 2025 3:20 PM" (SA/CH tiếng Việt cũng được).
 * Trả null nếu giá trị không có phần giờ (chỉ có ngày).
 */
export function hourOf(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getUTCHours();
  if (typeof v !== "string") return null;
  const m = /(?:^|[T\s,])(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?\s*([AaPpSsCc][MmAaHh]?\.?)?/.exec(v.trim());
  if (!m) return null;
  let h = +m[1];
  if (h > 23) return null;
  const mark = (m[3] ?? "").toLowerCase().replace(".", "");
  const pm = mark === "pm" || mark === "p" || mark === "ch";
  const am = mark === "am" || mark === "a" || mark === "sa";
  if (pm && h < 12) h += 12;
  else if (am && h === 12) h = 0;
  return h;
}

/**
 * Như `dayNumberOf` nhưng kèm phần giờ phút: số ngày (lẻ) kể từ 1970-01-01, coi giờ trong ô là giờ địa phương của ô.
 * Ô không có giờ thì ra số nguyên.
 */
export function instantDaysOf(v: unknown): number | null {
  const day = dayNumberOf(v);
  if (day === null) return null;
  const h = hourOf(v);
  if (h === null) return day;
  const m = /(?:^|[T\s,])\d{1,2}:(\d{2})(?::(\d{2}))?/.exec(typeof v === "string" ? v.trim() : "");
  const minutes = h * 60 + (m ? Math.min(59, +m[1]) : 0);
  return day + minutes / 1440;
}

export const isFilterActive = (f: RowFilter) =>
  f.dateRange ? !!(f.dateRange.from || f.dateRange.to) : f.range ? f.range.min !== undefined || f.range.max !== undefined : f.values.length > 0;

const matches = (f: RowFilter, r: Row) => {
  if (f.dateRange) {
    const d = toIsoDate(r[f.column]);
    if (!d) return false;
    return (!f.dateRange.from || d >= f.dateRange.from) && (!f.dateRange.to || d <= f.dateRange.to);
  }
  if (f.range) {
    const n = Number(r[f.column]);
    if (!Number.isFinite(n)) return false;
    return (f.range.min === undefined || n >= f.range.min) && (f.range.max === undefined || n <= f.range.max);
  }
  return f.values.includes(String(r[f.column]));
};

/** Bộ lọc này có áp cho widget `selfId` không (bỏ qua bộ lọc do chính nó tạo, hoặc nhắm widget khác). */
export const filterAppliesTo = (f: RowFilter, selfId?: string) =>
  (f.originId === undefined || f.originId !== selfId) &&
  (!f.targets?.length || (selfId !== undefined && f.targets.includes(selfId)));

/**
 * Lọc dòng theo các bộ lọc chéo. Bộ lọc trên cột mà nguồn dữ liệu không có thì bỏ qua
 * (để chart dùng nguồn khác không bị rỗng), và bộ lọc do chính `selfId` tạo ra cũng bỏ qua.
 * Trả về đúng mảng gốc khi không có gì để lọc (giữ nguyên tham chiếu cho useMemo).
 */
export function applyFilters(rows: Row[], filters: RowFilter[], selfId?: string): Row[] {
  if (rows.length === 0) return rows;
  const active = filters.filter(
    (f) =>
      isFilterActive(f) &&
      (f.originId === undefined || f.originId !== selfId) &&
      (!f.targets?.length || (selfId !== undefined && f.targets.includes(selfId))) &&
      f.column in rows[0],
  );
  if (active.length === 0) return rows;
  return rows.filter((r) => active.every((f) => matches(f, r)));
}
