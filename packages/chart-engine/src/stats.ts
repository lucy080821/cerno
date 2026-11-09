import { toIsoDate } from "./filter";

type AnyRow = Record<string, unknown>;

/** Các giá trị khác nhau của một cột (giữ thứ tự xuất hiện, tối đa `limit`). */
export function distinctValues(rows: AnyRow[], column: string, limit = 200): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(String(r[column] ?? ""));
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/** Ngày nhỏ nhất/lớn nhất (ISO) của một cột ngày. */
export function dateBounds(rows: AnyRow[], column: string): { min: string; max: string } | null {
  let min = "";
  let max = "";
  for (const r of rows) {
    const d = toIsoDate(r[column]);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  return min ? { min, max } : null;
}

export function numberRange(rows: AnyRow[], column: string): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const v = r[column];
    // Number(null) = 0 và Number("") = 0 sẽ làm sai khoảng: chỉ nhận số thật hoặc chuỗi số.
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) {
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }
  return min <= max ? { min, max } : null;
}
