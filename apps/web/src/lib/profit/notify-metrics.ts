import type { CalcFieldDef, Cell, Row } from "@dashboard/chart-engine";
import { COL, ORDER_COLUMNS } from "@/lib/orders/canonical";
import type { OrderProfit } from "./order-profit";

/**
 * Chỉ số dựng sẵn cho CẢNH BÁO và BÁO CÁO theo cửa hàng (không gắn dashboard): tất cả đọc nguồn "Đơn hàng đa kênh".
 *
 * Bảng đơn hàng chưa có lãi (lãi cần giá vốn, phí sàn ước tính, phí ship ước tính nên tính ở `buildOrders`), nên trước khi truy vấn
 * mỗi đơn được gắn thêm các cột ảo ở DÒNG ĐẦU của đơn (giống các cột cấp đơn khác như Số đơn, Phí sàn). Nhờ vậy tổng "Lãi" của một
 * khoảng ngày khớp đúng số ở các trang Tổng quan / Lãi lỗ, và mọi bộ máy cảnh báo (ngưỡng, so kỳ, bất thường, theo nhóm) dùng được ngay.
 */

export const MCOL = {
  profit: "Lãi",
  profitRevenue: "Doanh thu tính lãi",
  computable: "Đơn tính được lãi",
  loss: "Đơn lỗ",
  returned: "Đơn hoàn trả",
  fee: "Phí sàn (gồm ước tính)",
} as const;

/** Cột ảo (kiểu số). Đơn không tính được lãi (thiếu giá vốn) để trống ở các cột lãi nên không bị cộng nhầm. */
export const VIRTUAL_COLUMNS = [MCOL.profit, MCOL.profitRevenue, MCOL.computable, MCOL.loss, MCOL.returned, MCOL.fee] as const;

/** Mọi cột cảnh báo/báo cáo theo cửa hàng được dùng: cột chuẩn của nguồn + cột ảo. */
export const NOTIFY_COLUMNS: { name: string; type: string }[] = [
  ...ORDER_COLUMNS.map((c) => ({ name: c.name, type: c.type as string })),
  ...VIRTUAL_COLUMNS.map((name) => ({ name, type: "number" })),
];

const B = (c: string) => `[${c}]`;
const SUM = (c: string) => `SUM(${B(c)})`;

/**
 * Trường tính toán dạng tổng hợp dựng sẵn (chạy theo từng nhóm/khoảng, chia cho 0 ra trống). Tên hiển thị tiếng Việt;
 * người dùng chọn như một cột số trong form cảnh báo.
 */
export const NOTIFY_CALC: CalcFieldDef[] = [
  { id: "ws-margin", name: "Biên lãi (%)", expression: `${SUM(MCOL.profit)} / ${SUM(MCOL.profitRevenue)} * 100` },
  { id: "ws-avg-profit", name: "Lãi trung bình mỗi đơn", expression: `${SUM(MCOL.profit)} / ${SUM(MCOL.computable)}` },
  { id: "ws-cancel-rate", name: "Tỷ lệ hủy (%)", expression: `${SUM(COL.cancelledOrders)} / (${SUM(COL.orders)} + ${SUM(COL.cancelledOrders)} + ${SUM(MCOL.returned)}) * 100` },
  { id: "ws-return-rate", name: "Tỷ lệ hoàn trả (%)", expression: `${SUM(MCOL.returned)} / (${SUM(COL.orders)} + ${SUM(MCOL.returned)}) * 100` },
  { id: "ws-loss-rate", name: "Tỷ lệ đơn lỗ (%)", expression: `${SUM(MCOL.loss)} / ${SUM(MCOL.computable)} * 100` },
  { id: "ws-ads-ratio", name: "Quảng cáo / doanh thu (%)", expression: `${SUM(COL.adCost)} / ${SUM(COL.netRevenue)} * 100` },
  { id: "ws-fee-ratio", name: "Phí sàn / doanh thu (%)", expression: `${SUM(MCOL.fee)} / ${SUM(COL.netRevenue)} * 100` },
  { id: "ws-aov", name: "Giá trị đơn trung bình", expression: `${SUM(COL.netRevenue)} / ${SUM(COL.orders)}` },
];

const str = (c: Cell | undefined): string | null => (typeof c === "string" && c.trim() !== "" ? c.trim() : null);

/** Dòng trống đủ mọi cột (cột chuẩn + cột ảo): nguồn cũ chỉ có 16 cột vẫn truy vấn được cột mới (cho kết quả trống). */
const EMPTY: Row = Object.fromEntries(NOTIFY_COLUMNS.map((c) => [c.name, null])) as Row;

/** Số đơn khác nhau trong bảng, tính đúng như `buildOrders` (mã đơn + kênh; không có mã đơn thì mỗi dòng một đơn). */
export function countOrders(rows: Row[]): number {
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const id = str(r[COL.orderId]);
    seen.add(id ? `${str(r[COL.channel]) ?? "Khác"}\u0000${id}` : `~${i}`);
  });
  return seen.size;
}

/**
 * Gắn các cột ảo vào dòng đầu của mỗi đơn. `orders` phải là kết quả `buildOrders(rows, ...)` của CHÍNH `rows` này (cùng thứ tự đơn
 * theo lần xuất hiện đầu tiên). Trả bản sao: không sửa `rows`.
 */
export function enrichOrderRows(rows: Row[], orders: OrderProfit[]): Row[] {
  const seen = new Set<string>();
  let next = 0;
  return rows.map((r, i) => {
    const id = str(r[COL.orderId]);
    const key = id ? `${str(r[COL.channel]) ?? "Khác"}\u0000${id}` : `~${i}`;
    const out: Row = { ...EMPTY, ...r };
    if (seen.has(key)) return out;
    seen.add(key);
    const o = orders[next++];
    if (!o) return out;
    const known = o.profit !== null;
    out[MCOL.profit] = o.profit;
    out[MCOL.profitRevenue] = known ? o.revenue : null;
    out[MCOL.computable] = known ? 1 : null;
    out[MCOL.loss] = known ? (o.profit! < 0 ? 1 : 0) : null;
    out[MCOL.returned] = o.status === "Hoàn trả" ? 1 : 0;
    out[MCOL.fee] = o.fee;
    return out;
  });
}
