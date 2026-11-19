/** Định dạng số tiền cho các trang lãi từng đơn (luôn kiểu Việt Nam). */
export const vnd = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${Math.round(n).toLocaleString("vi-VN")}đ`);
export const signed = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(Math.round(n)).toLocaleString("vi-VN")}đ`);
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tỷ`;
  if (a >= 1e6) return `${s}${(a / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} triệu`;
  if (a >= 1e3) return `${s}${(a / 1e3).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} nghìn`;
  return `${s}${a.toLocaleString("vi-VN")}`;
}
export const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toLocaleString("vi-VN", { maximumFractionDigits: d })}%`);
export const count = (n: number) => n.toLocaleString("vi-VN");

