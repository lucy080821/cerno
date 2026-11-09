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

/** Đưa giá trị ngày về dạng ISO yyyy-mm-dd để so sánh được; trả về null nếu không hiểu. Hỗ trợ ISO, dd/mm/yyyy, Date. */
export function toIsoDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

const isActive = (f: RowFilter) =>
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

/**
 * Lọc dòng theo các bộ lọc chéo. Bộ lọc trên cột mà nguồn dữ liệu không có thì bỏ qua
 * (để chart dùng nguồn khác không bị rỗng), và bộ lọc do chính `selfId` tạo ra cũng bỏ qua.
 * Trả về đúng mảng gốc khi không có gì để lọc (giữ nguyên tham chiếu cho useMemo).
 */
export function applyFilters(rows: Row[], filters: RowFilter[], selfId?: string): Row[] {
  if (rows.length === 0) return rows;
  const active = filters.filter(
    (f) =>
      isActive(f) &&
      (f.originId === undefined || f.originId !== selfId) &&
      (!f.targets?.length || (selfId !== undefined && f.targets.includes(selfId))) &&
      f.column in rows[0],
  );
  if (active.length === 0) return rows;
  return rows.filter((r) => active.every((f) => matches(f, r)));
}
