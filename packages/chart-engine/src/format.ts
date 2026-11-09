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
