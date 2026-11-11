/** Số đầy đủ, ngăn cách hàng nghìn: 1.234.567 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}

/** Số gọn: 1,2K · 3,4M · 5,6B */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  const fmt = (v: number, suffix: string) =>
    `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(v)}${suffix}`;
  if (abs >= 1e9) return fmt(n / 1e9, "B");
  if (abs >= 1e6) return fmt(n / 1e6, "M");
  if (abs >= 1e3) return fmt(n / 1e3, "K");
  return fmt(n, "");
}

/** Kiểu giá trị của một số đo: số thường, hoặc ngày (lưu dưới dạng số ngày kể từ 1970-01-01, vd MAX của cột ngày). */
export type MetricKind = "number" | "date";

/** Số ngày (có thể lẻ) kể từ 1970-01-01 → "dd/mm/yyyy", kèm " hh:mm" nếu có phần giờ. */
export function formatDay(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const total = Math.round(n * 1440); // làm tròn đến phút
  const days = Math.floor(total / 1440);
  const mins = total - days * 1440;
  const d = new Date(days * 86_400_000);
  if (Number.isNaN(d.getTime())) return "–";
  const p = (x: number) => String(x).padStart(2, "0");
  const date = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return mins === 0 ? date : `${date} ${p(Math.floor(mins / 60))}:${p(mins % 60)}`;
}

/** Định dạng đầy đủ theo kiểu số đo (ngày thì ra dd/mm/yyyy). */
export const formatByKind = (n: number, kind?: MetricKind) => (kind === "date" ? formatDay(n) : formatNumber(n));
/** Định dạng gọn theo kiểu số đo (ngày không rút gọn được nên giống `formatByKind`). */
export const formatCompactByKind = (n: number, kind?: MetricKind) => (kind === "date" ? formatDay(n) : formatCompact(n));
