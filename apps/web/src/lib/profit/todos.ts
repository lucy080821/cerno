import type { ProfitSummary } from "./order-profit";

/**
 * Việc nên làm để lãi mỗi đơn cao hơn, suy ra từ số liệu (không dùng AI). Sắp xếp: dữ liệu thiếu trước (vì thiếu giá vốn thì
 * mọi con số khác đều chưa đúng), rồi theo số tiền đang mất.
 */
export type TodoKind = "missing_cost" | "loss_product" | "ads_product" | "returns" | "thin";

export interface Todo {
  kind: TodoKind;
  priority: "high" | "medium" | "data";
  /** Khoá ổn định để giao diện nhớ việc đã xong. */
  id: string;
  product?: string;
  /** Số tiền đang mất mỗi tháng (âm) hoặc số đơn liên quan, tuỳ loại. */
  amount?: number;
  orders?: number;
  breakEvenPrice?: number | null;
  avgPrice?: number | null;
  adPerOrder?: number;
  grossPerOrder?: number;
  href: string;
}

/** Ít nhất bao nhiêu đơn mới coi là có xu hướng (tránh gợi ý dựa trên 1 đơn lẻ). */
export const MIN_ORDERS_FOR_TREND = 3;

export function buildTodos(s: ProfitSummary): Todo[] {
  const todos: Todo[] = [];
  const missing = s.products.filter((p) => p.costMissing);
  if (missing.length) {
    todos.push({ kind: "missing_cost", priority: "data", id: "missing-cost", orders: s.missingCost, amount: missing.length, href: "/products?filter=missing" });
  }
  for (const p of s.products) {
    if (p.profit === null || p.orders < MIN_ORDERS_FOR_TREND) continue;
    if (p.profit < 0) {
      todos.push({ kind: "loss_product", priority: "high", id: `loss:${p.key}`, product: p.name, amount: p.profit, orders: p.orders, breakEvenPrice: p.breakEvenPrice, avgPrice: p.avgPrice, href: "/products" });
      continue;
    }
    const gross = p.revenue + p.shippingIn - p.fee - p.cost - p.shipCost;
    if (p.adCost > 0 && gross > 0 && p.adCost / gross >= 0.6) {
      todos.push({ kind: "ads_product", priority: "medium", id: `ads:${p.key}`, product: p.name, orders: p.orders, adPerOrder: p.adCost / p.orders, grossPerOrder: gross / p.orders, amount: -p.adCost, href: "/profit" });
    }
  }
  if (s.returned + s.cancelled > 0 && s.returnLoss + s.cancelLoss < 0) {
    todos.push({ kind: "returns", priority: "medium", id: "returns", orders: s.returned + s.cancelled, amount: s.returnLoss + s.cancelLoss, href: "/returns" });
  }
  if (s.thin > 0) todos.push({ kind: "thin", priority: "medium", id: "thin", orders: s.thin, href: "/orders?filter=thin" });
  const rank = { data: 0, high: 1, medium: 2 } as const;
  return todos.sort((a, b) => rank[a.priority] - rank[b.priority] || (a.amount ?? 0) - (b.amount ?? 0));
}
