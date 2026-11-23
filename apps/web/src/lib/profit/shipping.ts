import { CHANNELS } from "@/lib/orders/canonical";
import type { OrderStatus } from "@/lib/orders/canonical";

/**
 * Phí vận chuyển SHOP CHỊU, ước tính theo trung bình mỗi đơn của từng kênh (file đơn hàng của sàn thường không có khoản này:
 * đó là phí ship thực tế trừ phần khách trả, thêm phí ship chiều hoàn của đơn hoàn). Người bán tự lấy con số trung bình từ
 * Báo cáo thu nhập / đối soát của sàn (tổng phí ship shop chịu ÷ số đơn) rồi nhập ở trang Chi phí.
 *
 * Chỉ nằm ở lớp tính lãi (như ước tính phí sàn), KHÔNG ghi vào bảng đơn hàng, nên dashboard/báo cáo/cảnh báo không thấy khoản này.
 * - Đơn hợp lệ (đã giao hoặc đang giao): `perOrder`.
 * - Đơn hoàn trả: `perOrder` (đã gửi đi) cộng thêm `perReturn` (chiều hoàn về).
 * - Đơn hủy: 0 (chưa gửi hàng).
 */
export interface ShipRate {
  /** Phí ship shop chịu cho mỗi đơn đã gửi đi (đồng). */
  perOrder: number;
  /** Phí thêm cho mỗi đơn hoàn trả, chiều hoàn về (đồng). */
  perReturn: number;
}

export type ShipRates = Record<string, ShipRate>;

export const MAX_SHIP_AMOUNT = 10_000_000;

export const isShipChannel = (v: unknown): v is string => typeof v === "string" && (CHANNELS as readonly string[]).includes(v);

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_SHIP_AMOUNT;

/** Giữ lại các kênh hợp lệ có số tiền hợp lệ và khác 0; làm tròn đồng. */
export function cleanShipRates(raw: unknown): ShipRates {
  const out: ShipRates = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [ch, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isShipChannel(ch) || !v || typeof v !== "object") continue;
    const { perOrder, perReturn } = v as Record<string, unknown>;
    const a = valid(perOrder) ? Math.round(perOrder) : 0;
    const b = valid(perReturn) ? Math.round(perReturn) : 0;
    if (a > 0 || b > 0) out[ch] = { perOrder: a, perReturn: b };
  }
  return out;
}

export type ShipEstimator = (o: { channel: string; status: OrderStatus }) => number;

/** Bộ ước tính cho `buildOrders`; undefined khi chưa nhập kênh nào. */
export function makeShipEstimator(rates: ShipRates): ShipEstimator | undefined {
  if (Object.keys(rates).length === 0) return undefined;
  return (o) => {
    const r = rates[o.channel];
    if (!r || o.status === "Đã hủy") return 0;
    return o.status === "Hoàn trả" ? r.perOrder + r.perReturn : r.perOrder;
  };
}
