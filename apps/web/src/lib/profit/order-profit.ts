import type { Cell, Row } from "@dashboard/chart-engine";
import { COL, isValidStatus, type OrderStatus } from "@/lib/orders/canonical";
import type { ShipEstimator } from "./shipping";

/**
 * Lãi của TỪNG ĐƠN HÀNG từ nguồn "Đơn hàng đa kênh" (cột chuẩn ở lib/orders/canonical.ts). Hàm thuần, chạy ở server.
 *
 * Lãi đơn = Doanh thu thực + Phí vận chuyển khách trả − Phí sàn − Giá vốn − Chi phí quảng cáo − Phí ship shop chịu (ƯỚC TÍNH, tuỳ chọn).
 * - Đơn hợp lệ mà có dòng chưa có giá vốn: KHÔNG tính lãi (profit = null) để không báo lãi ảo; đếm vào "thiếu giá vốn".
 * - Đơn hủy / hoàn trả: doanh thu thực, phí sàn, phí vận chuyển và giá vốn đều 0 (theo cách chuẩn hoá), nhưng chi phí quảng cáo
 *   đã chi vẫn mất, nên lãi = −quảng cáo. Phí ship shop chịu (kể cả chiều hoàn) KHÔNG có trong file đơn hàng: chỉ tính khi người
 *   dùng nhập mức trung bình mỗi đơn (lib/profit/shipping.ts), khi đó đơn hủy = 0 và đơn hoàn = phí gửi + phí chiều hoàn.
 */

export interface OrderLine {
  sku: string | null;
  product: string | null;
  variant: string | null;
  quantity: number;
  /** Doanh thu thực của dòng (0 với đơn hủy/hoàn trả). */
  revenue: number;
  discount: number;
  /** Giá vốn của dòng; null = chưa biết. */
  cost: number | null;
  /** Giá trị dòng trước khi chuẩn hoá đơn hủy/hoàn (cột Doanh thu), dùng để ước tính phí sàn của đơn hoàn. */
  gross: number;
}

export type LossReason = "return" | "cancel" | "discount" | "ads" | "cost";

export interface OrderProfit {
  /** Mã đơn, hoặc "~<số>" khi file không có mã đơn (mỗi dòng là một đơn). */
  id: string;
  hasId: boolean;
  channel: string;
  date: string | null;
  status: OrderStatus;
  rawStatus: string | null;
  lines: OrderLine[];
  revenue: number;
  discount: number;
  shippingIn: number;
  fee: number;
  /** true khi phí sàn là số ƯỚC TÍNH theo biểu phí (file đơn hàng không có phí của đơn này). */
  feeEstimated: boolean;
  cost: number;
  adCost: number;
  /** Phí ship shop chịu: số ƯỚC TÍNH theo mức trung bình người dùng nhập (0 khi chưa nhập). */
  shipCost: number;
  /** null khi đơn hợp lệ mà còn dòng chưa có giá vốn. */
  profit: number | null;
  /** Lãi trên doanh thu thực; null khi chưa có lãi hoặc doanh thu bằng 0. */
  margin: number | null;
  valid: boolean;
  costKnown: boolean;
  reason: LossReason | null;
}

const num = (c: Cell | undefined): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);
const str = (c: Cell | undefined): string | null => (typeof c === "string" && c.trim() !== "" ? c.trim() : null);
const STATUSES: OrderStatus[] = ["Hoàn thành", "Chưa hoàn tất", "Đã hủy", "Hoàn trả"];
const statusOf = (c: Cell | undefined): OrderStatus => (STATUSES.includes(c as OrderStatus) ? (c as OrderStatus) : "Hoàn thành");

/** Khoá sản phẩm dùng cho bảng giá vốn: SKU, không có thì tên sản phẩm. */
export const productKey = (sku: string | null, product: string | null): string | null => sku ?? product;

/** Lý do một đơn bị lỗ, theo quy tắc dễ giải thích. Chỉ gọi khi lãi < 0. */
export function lossReason(o: Pick<OrderProfit, "status" | "revenue" | "discount" | "shippingIn" | "fee" | "cost" | "adCost" | "profit"> & { shipCost?: number }): LossReason {
  if (o.status === "Hoàn trả") return "return";
  if (o.status === "Đã hủy") return "cancel";
  const profit = o.profit ?? 0;
  const gross = o.revenue + o.shippingIn - o.fee - o.cost - (o.shipCost ?? 0); // lãi trước quảng cáo
  const listPrice = o.revenue + o.discount;
  if (o.discount > 0 && listPrice > 0 && o.discount / listPrice >= 0.15 && profit + o.discount >= 0) return "discount";
  if (gross >= 0) return "ads";
  return "cost";
}

/**
 * Ước tính phí sàn của một đơn khi file không có phí (vd Shopee theo biểu phí ngành hàng). Trả null nếu không ước tính được.
 * Chỉ được gọi cho đơn không hủy mà không dòng nào trong file có phí.
 */
export type FeeEstimator = (o: Pick<OrderProfit, "channel" | "date" | "status" | "shippingIn" | "lines">) => number | null;

/**
 * Gom các dòng sản phẩm thành đơn và tính lãi từng đơn. Thứ tự đơn giữ theo dòng đầu tiên xuất hiện.
 * `estimateFee` (tuỳ chọn): điền phí sàn ước tính cho đơn mà file không ghi phí (đánh dấu `feeEstimated`).
 * `estimateShip` (tuỳ chọn): phí ship shop chịu theo mức trung bình mỗi đơn của kênh (`shipCost`, đã làm tròn đồng).
 */
export function buildOrders(rows: Row[], estimateFee?: FeeEstimator, estimateShip?: ShipEstimator): OrderProfit[] {
  const feeInFile = new Set<OrderProfit>();
  const byKey = new Map<string, OrderProfit>();
  const order: OrderProfit[] = [];
  rows.forEach((r, i) => {
    const id = str(r[COL.orderId]);
    const channel = str(r[COL.channel]) ?? "Khác";
    const key = id ? `${channel}\u0000${id}` : `~${i}`;
    let o = byKey.get(key);
    if (!o) {
      const status = statusOf(r[COL.status]);
      o = {
        id: id ?? `~${i + 1}`,
        hasId: id !== null,
        channel,
        date: str(r[COL.date]),
        status,
        rawStatus: str(r[COL.rawStatus]),
        lines: [],
        revenue: 0,
        discount: 0,
        shippingIn: 0,
        fee: 0,
        feeEstimated: false,
        cost: 0,
        adCost: 0,
        shipCost: 0,
        profit: null,
        margin: null,
        valid: isValidStatus(status),
        costKnown: true,
        reason: null,
      };
      byKey.set(key, o);
      order.push(o);
    }
    const revenue = num(r[COL.netRevenue]) ?? 0;
    const discount = num(r[COL.discount]) ?? 0;
    const cost = num(r[COL.cost]);
    o.lines.push({ sku: str(r[COL.sku]), product: str(r[COL.product]), variant: str(r[COL.variant]), quantity: num(r[COL.quantity]) ?? 0, revenue, discount, cost, gross: num(r[COL.revenue]) ?? 0 });
    o.revenue += revenue;
    o.discount += discount;
    const fileFee = num(r[COL.platformFee]);
    if (fileFee !== null) feeInFile.add(o);
    o.fee += fileFee ?? 0;
    o.shippingIn += num(r[COL.shippingFee]) ?? 0;
    o.adCost += num(r[COL.adCost]) ?? 0;
    if (cost === null) {
      if (o.valid) o.costKnown = false;
    } else o.cost += cost;
  });
  for (const o of order) {
    if (estimateFee && o.status !== "Đã hủy" && !feeInFile.has(o)) {
      const est = estimateFee(o);
      if (est !== null && est > 0) {
        o.fee = est;
        o.feeEstimated = true;
      }
    }
    if (estimateShip) o.shipCost = estimateShip(o);
    if (o.valid && !o.costKnown) continue;
    o.profit = o.revenue + o.shippingIn - o.fee - o.cost - o.adCost - o.shipCost;
    o.margin = o.revenue > 0 ? o.profit / o.revenue : null;
    if (o.profit < 0) o.reason = lossReason(o);
  }
  return order;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tổng hợp

/** Ngưỡng "lãi mỏng": dưới 5% doanh thu. */
export const THIN_MARGIN = 0.05;

/** Khoảng lãi mỗi đơn cho biểu đồ phân bố (đồng). */
export const PROFIT_BINS: { label: string; min: number; max: number }[] = [
  { label: "< -50K", min: -Infinity, max: -50_000 },
  { label: "-50K..-20K", min: -50_000, max: -20_000 },
  { label: "-20K..0", min: -20_000, max: 0 },
  { label: "0..20K", min: 0, max: 20_000 },
  { label: "20K..40K", min: 20_000, max: 40_000 },
  { label: "40K..60K", min: 40_000, max: 60_000 },
  { label: "60K..80K", min: 60_000, max: 80_000 },
  { label: "80K..100K", min: 80_000, max: 100_000 },
  { label: "> 100K", min: 100_000, max: Infinity },
];

export interface ProductProfit {
  key: string;
  sku: string | null;
  name: string;
  /** Các kênh có bán sản phẩm này (kể cả đơn hủy/hoàn), xếp theo tên. */
  channels: string[];
  quantity: number;
  /** Số đơn có sản phẩm này. */
  orders: number;
  revenue: number;
  cost: number;
  fee: number;
  adCost: number;
  /** Phí ship shop chịu (ước tính) chia cho sản phẩm. */
  shipCost: number;
  shippingIn: number;
  /** null khi còn đơn chưa có giá vốn. */
  profit: number | null;
  profitPerOrder: number | null;
  /** Giá bán trung bình mỗi cái (doanh thu thực / số lượng). */
  avgPrice: number | null;
  /** Giá vốn mỗi cái suy ra từ dữ liệu (null khi chưa biết). */
  unitCost: number | null;
  /** Giá bán mỗi cái để lãi bằng 0 với chi phí hiện tại. */
  breakEvenPrice: number | null;
  /** Số đơn hợp lệ có sản phẩm này mà đơn chưa tính được lãi (có thể do sản phẩm KHÁC trong đơn thiếu giá vốn). */
  missingCostOrders: number;
  /** Chính sản phẩm này chưa có giá vốn (ở ít nhất một dòng của đơn hợp lệ). */
  costMissing: boolean;
}

export interface ChannelProfit {
  channel: string;
  orders: number;
  profit: number;
  avgProfit: number | null;
  lossShare: number | null;
}

export interface ReasonStat {
  reason: LossReason;
  orders: number;
  amount: number;
}

export interface ProfitSummary {
  orders: number;
  computable: number;
  missingCost: number;
  profitable: number;
  loss: number;
  thin: number;
  returned: number;
  cancelled: number;
  /** Số đơn có phí sàn là số ước tính (không phải số trong file). */
  feeEstimated: number;
  /** Số đơn có phí ship shop chịu là số ước tính theo mức trung bình người dùng nhập. */
  shipEstimated: number;
  revenue: number;
  /** Doanh thu thực của MỌI đơn (kể cả đơn chưa có giá vốn); `revenue` chỉ gồm các đơn đã tính được lãi. */
  allRevenue: number;
  fee: number;
  cost: number;
  adCost: number;
  /** Tổng phí ship shop chịu (ước tính) của các đơn đã tính lãi. */
  shipCost: number;
  shippingIn: number;
  profit: number;
  lossAmount: number;
  avgProfit: number | null;
  margin: number | null;
  /** Mất do đơn hoàn và đơn hủy (chi phí quảng cáo đã chi cho các đơn đó). */
  returnLoss: number;
  cancelLoss: number;
  histogram: { label: string; count: number; negative: boolean }[];
  daily: { date: string; profit: number; orders: number }[];
  channels: ChannelProfit[];
  reasons: ReasonStat[];
  products: ProductProfit[];
  dateMin: string | null;
  dateMax: string | null;
}

const dayOf = (d: string | null) => (d ? d.slice(0, 10) : null);

/** Chia một khoản cấp đơn cho các dòng theo tỷ lệ doanh thu (đều nhau nếu doanh thu bằng 0). */
function shares(o: OrderProfit): number[] {
  const total = o.lines.reduce((n, l) => n + Math.max(0, l.revenue), 0);
  return o.lines.map((l) => (total > 0 ? Math.max(0, l.revenue) / total : 1 / o.lines.length));
}

export function summarize(orders: OrderProfit[]): ProfitSummary {
  const s: ProfitSummary = {
    orders: orders.length, computable: 0, missingCost: 0, profitable: 0, loss: 0, thin: 0, returned: 0, cancelled: 0, feeEstimated: 0, shipEstimated: 0,
    revenue: 0, allRevenue: 0, fee: 0, cost: 0, adCost: 0, shipCost: 0, shippingIn: 0, profit: 0, lossAmount: 0, avgProfit: null, margin: null,
    returnLoss: 0, cancelLoss: 0,
    histogram: PROFIT_BINS.map((b) => ({ label: b.label, count: 0, negative: b.max <= 0 })),
    daily: [], channels: [], reasons: [], products: [], dateMin: null, dateMax: null,
  };
  const days = new Map<string, { profit: number; orders: number }>();
  const chans = new Map<string, { orders: number; profit: number; computable: number; loss: number }>();
  const reasons = new Map<LossReason, ReasonStat>();
  const prods = new Map<string, ProductProfit & { _orders: Set<string>; _unknown: boolean; _channels: Set<string> }>();

  for (const o of orders) {
    const d = dayOf(o.date);
    if (d) {
      if (!s.dateMin || d < s.dateMin) s.dateMin = d;
      if (!s.dateMax || d > s.dateMax) s.dateMax = d;
    }
    if (o.feeEstimated) s.feeEstimated++;
    if (o.shipCost > 0) s.shipEstimated++;
    s.allRevenue += o.revenue;
    if (o.status === "Hoàn trả") s.returned++;
    if (o.status === "Đã hủy") s.cancelled++;
    const ch = chans.get(o.channel) ?? { orders: 0, profit: 0, computable: 0, loss: 0 };
    ch.orders++;
    chans.set(o.channel, ch);

    // Sản phẩm: chỉ tính phần lãi của đơn hợp lệ đã đủ giá vốn; đơn thiếu giá vốn đếm riêng.
    const sh = shares(o);
    o.lines.forEach((l, i) => {
      const key = productKey(l.sku, l.product) ?? "(không rõ sản phẩm)";
      let p = prods.get(key);
      if (!p) {
        p = { key, sku: l.sku, name: l.product ?? l.sku ?? key, channels: [], quantity: 0, orders: 0, revenue: 0, cost: 0, fee: 0, adCost: 0, shipCost: 0, shippingIn: 0, profit: null, profitPerOrder: null, avgPrice: null, unitCost: null, breakEvenPrice: null, missingCostOrders: 0, costMissing: false, _orders: new Set(), _unknown: false, _channels: new Set() };
        prods.set(key, p);
      }
      p._channels.add(o.channel);
      if (!o.valid) return;
      p._orders.add(`${o.channel}\u0000${o.id}`);
      if (!o.costKnown) {
        p.missingCostOrders++;
        if (l.cost === null) p._unknown = true;
        return;
      }
      p.quantity += l.quantity;
      p.revenue += l.revenue;
      p.cost += l.cost ?? 0;
      p.fee += o.fee * sh[i];
      p.adCost += o.adCost * sh[i];
      p.shipCost += o.shipCost * sh[i];
      p.shippingIn += o.shippingIn * sh[i];
    });

    if (o.profit === null) {
      s.missingCost++;
      continue;
    }
    s.computable++;
    s.profit += o.profit;
    s.revenue += o.revenue;
    s.fee += o.fee;
    s.cost += o.cost;
    s.adCost += o.adCost;
    s.shipCost += o.shipCost;
    s.shippingIn += o.shippingIn;
    ch.computable++;
    ch.profit += o.profit;
    if (o.profit < 0) {
      s.loss++;
      s.lossAmount += o.profit;
      ch.loss++;
      const r = reasons.get(o.reason!) ?? { reason: o.reason!, orders: 0, amount: 0 };
      r.orders++;
      r.amount += o.profit;
      reasons.set(o.reason!, r);
      if (o.status === "Hoàn trả") s.returnLoss += o.profit;
      if (o.status === "Đã hủy") s.cancelLoss += o.profit;
    } else if (o.valid) {
      s.profitable++;
      if (o.margin !== null && o.margin < THIN_MARGIN) s.thin++;
    }
    const bin = PROFIT_BINS.findIndex((b) => o.profit! >= b.min && o.profit! < b.max);
    if (bin >= 0) s.histogram[bin].count++;
    if (d) {
      const day = days.get(d) ?? { profit: 0, orders: 0 };
      day.profit += o.profit;
      day.orders++;
      days.set(d, day);
    }
  }

  s.avgProfit = s.computable ? s.profit / s.computable : null;
  s.margin = s.revenue > 0 ? s.profit / s.revenue : null;
  s.daily = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, ...v }));
  s.channels = [...chans.entries()]
    .map(([channel, c]) => ({ channel, orders: c.orders, profit: c.profit, avgProfit: c.computable ? c.profit / c.computable : null, lossShare: c.computable ? c.loss / c.computable : null }))
    .sort((a, b) => b.orders - a.orders);
  s.reasons = [...reasons.values()].sort((a, b) => a.amount - b.amount);
  s.products = [...prods.values()]
    .map(({ _orders, _unknown, _channels, ...p }) => {
      const orders = _orders.size;
      const known = p.missingCostOrders === 0 && !_unknown && orders > 0;
      const profit = known ? p.revenue + p.shippingIn - p.fee - p.cost - p.adCost - p.shipCost : null;
      return {
        ...p,
        channels: [..._channels].sort(),
        orders,
        costMissing: _unknown,
        profit,
        profitPerOrder: profit !== null && orders ? profit / orders : null,
        avgPrice: p.quantity > 0 ? p.revenue / p.quantity : null,
        unitCost: known && p.quantity > 0 ? p.cost / p.quantity : null,
        breakEvenPrice: known && p.quantity > 0 ? (p.cost + p.fee + p.adCost + p.shipCost - p.shippingIn) / p.quantity : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Danh sách đơn có lọc

export type OrderFilter = "all" | "loss" | "thin" | "missing" | "return";
export type OrderSort = "date" | "profit";

export function filterOrders(orders: OrderProfit[], filter: OrderFilter, q = "", channel?: string): OrderProfit[] {
  const needle = q.trim().toLowerCase();
  return orders.filter((o) => {
    if (channel && o.channel !== channel) return false;
    if (filter === "loss" && !(o.profit !== null && o.profit < 0)) return false;
    if (filter === "thin" && !(o.valid && o.profit !== null && o.profit >= 0 && o.margin !== null && o.margin < THIN_MARGIN)) return false;
    if (filter === "missing" && o.profit !== null) return false;
    if (filter === "return" && o.valid) return false;
    if (needle) {
      const hay = [o.id, ...o.lines.flatMap((l) => [l.sku ?? "", l.product ?? ""])].join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export function sortOrders(orders: OrderProfit[], sort: OrderSort): OrderProfit[] {
  const copy = [...orders];
  if (sort === "profit") copy.sort((a, b) => (a.profit ?? Infinity) - (b.profit ?? Infinity));
  else copy.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return copy;
}

export function orderCounts(orders: OrderProfit[]): Record<OrderFilter, number> {
  return {
    all: orders.length,
    loss: filterOrders(orders, "loss").length,
    thin: filterOrders(orders, "thin").length,
    missing: filterOrders(orders, "missing").length,
    return: filterOrders(orders, "return").length,
  };
}
