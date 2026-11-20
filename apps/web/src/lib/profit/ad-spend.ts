import type { Cell, Row } from "@dashboard/chart-engine";
import { COL } from "@/lib/orders/canonical";

/**
 * Chi phí quảng cáo theo NGÀY và KÊNH (từ file báo cáo quảng cáo), chia cho từng đơn hàng của ngày đó.
 *
 * Báo cáo quảng cáo của sàn/Facebook chỉ cho biết "hôm đó tiêu bao nhiêu", không biết đơn nào do quảng cáo mang về. Cách chia:
 * số tiền của (kênh, ngày) được chia cho MỌI đơn của kênh đó trong ngày (kể cả đơn hủy, vì quảng cáo đã tốn tiền) theo tỉ lệ
 * doanh thu gộp của đơn; đơn nhiều tiền gánh nhiều chi phí hơn. Đây là số ƯỚC TÍNH theo ngày, không phải số thật từng đơn.
 * Kênh `*` = chia cho đơn của mọi kênh trong ngày (vd. quảng cáo Facebook dẫn khách mua trên Shopee).
 *
 * Ghi vào cột "Chi phí quảng cáo" ở DÒNG ĐẦU của đơn (các dòng sau để trống), đúng quy ước cấp đơn của file đơn hàng, và THẮNG
 * giá trị có sẵn trong file cho những đơn được chi phí này phủ tới. Hàm idempotent: chạy lại với cùng dữ liệu ra cùng kết quả.
 */

export const ALL_CHANNELS = "*";
export const MAX_AD_ENTRIES = 20_000;
export const MAX_DAILY_SPEND = 10_000_000_000;

export interface AdSpendEntry {
  /** Tên kênh của đơn hàng ("Shopee"...) hoặc `*` = mọi kênh. */
  channel: string;
  /** yyyy-mm-dd */
  day: string;
  /** đồng */
  amount: number;
}

export const adKey = (e: Pick<AdSpendEntry, "channel" | "day">) => `${e.channel}\u0000${e.day}`;

const str = (c: Cell | undefined): string | null => (typeof c === "string" && c.trim() !== "" ? c.trim() : null);
const num = (c: Cell | undefined): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);
const DAY = /^\d{4}-\d{2}-\d{2}/;

interface OrderRef {
  /** Chỉ số các dòng của đơn; dòng đầu là nơi ghi chi phí cấp đơn. */
  idx: number[];
  channel: string;
  day: string | null;
  weight: number;
}

/** Gom dòng thành đơn đúng như `buildOrders` (kênh + mã đơn; không có mã thì mỗi dòng một đơn). */
function groupOrders(rows: Row[]): OrderRef[] {
  const byKey = new Map<string, OrderRef>();
  const out: OrderRef[] = [];
  rows.forEach((r, i) => {
    const id = str(r[COL.orderId]);
    const channel = str(r[COL.channel]) ?? "Khác";
    const key = id ? `${channel}\u0000${id}` : `~${i}`;
    let o = byKey.get(key);
    if (!o) {
      const d = str(r[COL.date]);
      o = { idx: [], channel, day: d && DAY.test(d) ? d.slice(0, 10) : null, weight: 0 };
      byKey.set(key, o);
      out.push(o);
    }
    o.idx.push(i);
    o.weight += Math.max(0, num(r[COL.revenue]) ?? 0);
  });
  return out;
}

function byDay(orders: OrderRef[]): Map<string, OrderRef[]> {
  const m = new Map<string, OrderRef[]>();
  for (const o of orders) {
    if (!o.day) continue;
    const list = m.get(o.day);
    if (list) list.push(o);
    else m.set(o.day, [o]);
  }
  return m;
}

const targetsOf = (days: Map<string, OrderRef[]>, e: AdSpendEntry): OrderRef[] =>
  (days.get(e.day) ?? []).filter((o) => e.channel === ALL_CHANNELS || o.channel === e.channel);

/** Chia `total` (đồng, nguyên) theo trọng số; phần dư chia cho những phần có số lẻ lớn nhất nên tổng luôn đúng. */
export function splitAmount(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wsum = sum > 0 ? sum : n;
  const exact = w.map((x) => (total * x) / wsum);
  const out = exact.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k].i] += 1;
  return out;
}

export interface ApplyAdResult {
  rows: Row[];
  /** Số dòng đã đổi giá trị. */
  changed: number;
  /** Số đơn được ghi chi phí quảng cáo. */
  orders: number;
  /** Tổng tiền đã chia cho đơn (đồng). */
  allocated: number;
  /** Chi phí của ngày/kênh không có đơn nào để chia (vd. chạy quảng cáo nhưng chưa có đơn, hoặc chưa tải file đơn của ngày đó). */
  unallocated: AdSpendEntry[];
}

/** Ghi giá trị cấp đơn: dòng đầu = value, các dòng sau = trống. Trả về số dòng đổi. */
function writeOrder(rows: Row[], out: Row[], o: OrderRef, value: number | null): number {
  let changed = 0;
  o.idx.forEach((i, k) => {
    const want = k === 0 ? value : null;
    const cur = (out[i] ?? rows[i])[COL.adCost] ?? null;
    if (cur === want) return;
    out[i] = { ...(out[i] ?? rows[i]), [COL.adCost]: want };
    changed++;
  });
  return changed;
}

export function applyAdSpend(rows: Row[], entries: AdSpendEntry[]): ApplyAdResult {
  if (entries.length === 0 || rows.length === 0) return { rows, changed: 0, orders: 0, allocated: 0, unallocated: entries.length ? entries.filter((e) => e.amount > 0) : [] };
  const orders = groupOrders(rows);
  const days = byDay(orders);
  const share = new Map<OrderRef, number>();
  const unallocated: AdSpendEntry[] = [];
  let allocated = 0;
  for (const e of entries) {
    const amount = Math.round(e.amount);
    if (!(amount >= 0)) continue;
    const targets = targetsOf(days, e);
    if (targets.length === 0) {
      if (amount > 0) unallocated.push(e);
      continue;
    }
    const parts = splitAmount(amount, targets.map((o) => o.weight));
    targets.forEach((o, k) => share.set(o, (share.get(o) ?? 0) + parts[k]));
    allocated += amount;
  }
  const out: Row[] = rows.slice();
  let changed = 0;
  for (const [o, v] of share) changed += writeOrder(rows, out, o, v);
  return { rows: changed ? out : rows, changed, orders: share.size, allocated, unallocated };
}

/** Xoá chi phí quảng cáo của các đơn mà `entries` phủ tới (dùng khi xoá một kênh; sau đó gọi `applyAdSpend` với phần còn lại). */
export function clearAdSpend(rows: Row[], entries: AdSpendEntry[]): { rows: Row[]; changed: number } {
  if (entries.length === 0 || rows.length === 0) return { rows, changed: 0 };
  const orders = groupOrders(rows);
  const days = byDay(orders);
  const hit = new Set<OrderRef>();
  for (const e of entries) for (const o of targetsOf(days, e)) hit.add(o);
  const out: Row[] = rows.slice();
  let changed = 0;
  for (const o of hit) changed += writeOrder(rows, out, o, null);
  return { rows: changed ? out : rows, changed };
}

export interface AdChannelSummary {
  channel: string;
  days: number;
  total: number;
  from: string;
  to: string;
}

export function summarizeAdSpend(entries: AdSpendEntry[]): AdChannelSummary[] {
  const m = new Map<string, AdChannelSummary>();
  for (const e of entries) {
    const s = m.get(e.channel);
    if (!s) m.set(e.channel, { channel: e.channel, days: 1, total: e.amount, from: e.day, to: e.day });
    else {
      s.days++;
      s.total += e.amount;
      if (e.day < s.from) s.from = e.day;
      if (e.day > s.to) s.to = e.day;
    }
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
