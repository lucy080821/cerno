/**
 * Khoảng thời gian lọc cho các trang lãi (Tổng quan, Lãi lỗ, Chi phí, Hoàn và hủy, Đơn hàng). Hàm thuần, có test; dùng cả ở trình
 * duyệt (chọn, hiển thị, lưu) lẫn máy chủ (kiểm tham số `from`/`to`). Ngày là chuỗi yyyy-mm-dd, tính theo UTC nên không lệch múi giờ.
 *
 * `value` theo từng đơn vị: day "2026-11-24", month "2026-11", quarter "2026-Q4", year "2026", range "2026-11-01..2026-11-24".
 */
export type PeriodUnit = "all" | "day" | "month" | "quarter" | "year" | "range";

export interface Period {
  unit: PeriodUnit;
  value: string;
}

export interface DateRange {
  from: string;
  to: string;
}

export const ALL_TIME: Period = { unit: "all", value: "" };

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Ngày hợp lệ (có thật trong lịch) và năm trong khoảng cho phép. */
export function isIsoDay(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

const toMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => fromMs(toMs(day) + n * 86_400_000);
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Ngày hôm nay (yyyy-mm-dd) theo giờ của máy truyền vào. */
export const todayIso = (now: Date = new Date()): string => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export function monthPeriod(year: number, month: number): Period {
  return { unit: "month", value: `${pad(year, 4)}-${pad(month)}` };
}
export function quarterPeriod(year: number, quarter: number): Period {
  return { unit: "quarter", value: `${pad(year, 4)}-Q${quarter}` };
}
export const yearPeriod = (year: number): Period => ({ unit: "year", value: pad(year, 4) });
export const dayPeriod = (day: string): Period => ({ unit: "day", value: day });
export const rangePeriod = (from: string, to: string): Period => ({ unit: "range", value: `${from}..${to}` });

/** Khoảng ngày [from, to] (gồm cả hai đầu) của một kỳ; null = không lọc (Tất cả) hoặc giá trị không hợp lệ. */
export function periodRange(p: Period): DateRange | null {
  switch (p.unit) {
    case "day":
      return isIsoDay(p.value) ? { from: p.value, to: p.value } : null;
    case "month": {
      const m = /^(\d{4})-(\d{2})$/.exec(p.value);
      if (!m) return null;
      const y = +m[1], mo = +m[2];
      if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12) return null;
      return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${pad(lastDayOfMonth(y, mo))}` };
    }
    case "quarter": {
      const m = /^(\d{4})-Q([1-4])$/.exec(p.value);
      if (!m) return null;
      const y = +m[1], q = +m[2];
      if (y < MIN_YEAR || y > MAX_YEAR) return null;
      const m1 = (q - 1) * 3 + 1, m3 = q * 3;
      return { from: `${m[1]}-${pad(m1)}-01`, to: `${m[1]}-${pad(m3)}-${pad(lastDayOfMonth(y, m3))}` };
    }
    case "year": {
      const m = /^(\d{4})$/.exec(p.value);
      if (!m) return null;
      const y = +m[1];
      return y < MIN_YEAR || y > MAX_YEAR ? null : { from: `${m[1]}-01-01`, to: `${m[1]}-12-31` };
    }
    case "range": {
      const [from, to, extra] = p.value.split("..");
      if (extra !== undefined || !isIsoDay(from) || !isIsoDay(to) || from > to) return null;
      return { from, to };
    }
    default:
      return null;
  }
}

/** Kỳ có đang lọc thật không (đơn vị khác Tất cả và giá trị hợp lệ). */
export const isFiltering = (p: Period): boolean => periodRange(p) !== null;

/** Kiểm tra giá trị đọc từ nơi không tin cậy (localStorage); sai thì quay về Tất cả. */
export function sanitizePeriod(raw: unknown): Period {
  if (!raw || typeof raw !== "object") return ALL_TIME;
  const { unit, value } = raw as Record<string, unknown>;
  if (typeof unit !== "string" || typeof value !== "string") return ALL_TIME;
  const p = { unit: unit as PeriodUnit, value };
  return periodRange(p) ? p : ALL_TIME;
}

/** Lùi/tiến `n` kỳ (ngày, tháng, quý, năm; khoảng ngày dịch đúng bằng độ dài của nó). Tất cả thì giữ nguyên. */
export function shiftPeriod(p: Period, n: number): Period {
  const r = periodRange(p);
  if (!r) return p;
  switch (p.unit) {
    case "day":
      return dayPeriod(addDays(p.value, n));
    case "month": {
      const [y, m] = p.value.split("-").map(Number);
      const idx = y * 12 + (m - 1) + n;
      return monthPeriod(Math.floor(idx / 12), (idx % 12) + 1);
    }
    case "quarter": {
      const [ys, qs] = p.value.split("-Q");
      const idx = +ys * 4 + (+qs - 1) + n;
      return quarterPeriod(Math.floor(idx / 4), (idx % 4) + 1);
    }
    case "year":
      return yearPeriod(+p.value + n);
    case "range": {
      const len = Math.round((toMs(r.to) - toMs(r.from)) / 86_400_000) + 1;
      return rangePeriod(addDays(r.from, n * len), addDays(r.to, n * len));
    }
    default:
      return p;
  }
}

/** Chuyển sang đơn vị khác, giữ kỳ chứa ngày hôm nay (hoặc ngày đầu của kỳ đang chọn nếu có). */
export function switchUnit(p: Period, unit: PeriodUnit, today: string): Period {
  if (unit === "all") return ALL_TIME;
  const day = periodRange(p)?.from ?? today;
  const [y, m] = [+day.slice(0, 4), +day.slice(5, 7)];
  switch (unit) {
    case "day":
      return dayPeriod(day);
    case "month":
      return monthPeriod(y, m);
    case "quarter":
      return quarterPeriod(y, Math.ceil(m / 3));
    case "year":
      return yearPeriod(y);
    default: {
      const r = periodRange(p);
      return rangePeriod(r?.from ?? addDays(today, -29), r?.to ?? today);
    }
  }
}

export type PresetKey = "all" | "today" | "7d" | "30d" | "month" | "quarter" | "year";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "today", label: "Hôm nay" },
  { key: "7d", label: "7 ngày gần nhất" },
  { key: "30d", label: "30 ngày gần nhất" },
  { key: "month", label: "Tháng này" },
  { key: "quarter", label: "Quý này" },
  { key: "year", label: "Năm nay" },
];

export function presetPeriod(key: PresetKey, today: string): Period {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  switch (key) {
    case "today":
      return dayPeriod(today);
    case "7d":
      return rangePeriod(addDays(today, -6), today);
    case "30d":
      return rangePeriod(addDays(today, -29), today);
    case "month":
      return monthPeriod(y, m);
    case "quarter":
      return quarterPeriod(y, Math.ceil(m / 3));
    case "year":
      return yearPeriod(y);
    default:
      return ALL_TIME;
  }
}

export const samePeriod = (a: Period, b: Period): boolean => a.unit === b.unit && a.value === b.value;

const vn = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** Nhãn hiển thị tiếng Việt. */
export function periodLabel(p: Period): string {
  const r = periodRange(p);
  if (!r) return "Tất cả thời gian";
  switch (p.unit) {
    case "day":
      return vn(p.value);
    case "month":
      return `Tháng ${+p.value.slice(5, 7)}/${p.value.slice(0, 4)}`;
    case "quarter":
      return `Quý ${p.value.slice(-1)}/${p.value.slice(0, 4)}`;
    case "year":
      return `Năm ${p.value}`;
    default:
      return `${vn(r.from)} → ${vn(r.to)}`;
  }
}

/** Đọc `from`/`to` từ tham số địa chỉ (máy chủ). Thiếu, sai định dạng hoặc from > to thì null (không lọc). */
export function parseRangeParams(from: string | null | undefined, to: string | null | undefined): DateRange | null {
  if (!isIsoDay(from) || !isIsoDay(to) || from > to) return null;
  return { from, to };
}

/** Ngày của đơn (yyyy-mm-dd hoặc kèm giờ) có nằm trong khoảng không; đơn không có ngày bị loại khi đang lọc. */
export function inRange(date: string | null | undefined, r: DateRange): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  return d >= r.from && d <= r.to;
}
