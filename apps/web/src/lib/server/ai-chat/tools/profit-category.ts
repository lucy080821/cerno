import { normalizeText } from "@dashboard/schema";
import { SEP } from "@/lib/fees/table-core";
import type { ProductProfit } from "@/lib/profit/order-profit";
import type { ProductCategory } from "./types";
import { num, r2 } from "./util";

/**
 * Ngành hàng trong báo cáo lãi của AI. Nguồn đơn hàng không có cột "ngành hàng": ngành là thuộc tính SUY RA cho từng sản phẩm
 * (người bán chọn ở trang Sản phẩm và giá vốn, hoặc Cerno tự nhận diện từ tên), cùng cách với ước tính phí sàn. Hàm ở đây thuần: nhận bộ tra ngành.
 */
export type CategoryOf = (p: Pick<ProductProfit, "key" | "name" | "channels">) => ProductCategory | null;

export const UNKNOWN_CATEGORY = "Chưa xác định ngành";

/** Cắt đường dẫn ngành đến `level` cấp ("Thời Trang Nữ › Áo › Áo thun" cấp 2 = "Thời Trang Nữ › Áo"). */
export const levelLabel = (path: string, level: number) => path.split(SEP).slice(0, level).join(SEP);

/** Sản phẩm có thuộc ngành người dùng nêu không (khớp một phần, không phân biệt hoa/dấu). */
export function inCategory(c: ProductCategory | null, filter: string): boolean {
  const f = normalizeText(filter);
  return !!c && !!f && normalizeText(c.path).includes(f);
}

interface Acc {
  products: number;
  quantity: number;
  revenue: number;
  cost: number;
  fee: number;
  ad: number;
  ship: number;
  /** Lãi cộng các sản phẩm đã đủ giá vốn, và doanh thu của đúng các sản phẩm đó (mẫu số của biên lãi). */
  profit: number;
  revenueKnown: number;
  missingCost: number;
  auto: number;
  orderLines: number;
  top: ProductProfit[];
}
const emptyAcc = (): Acc => ({ products: 0, quantity: 0, revenue: 0, cost: 0, fee: 0, ad: 0, ship: 0, profit: 0, revenueKnown: 0, missingCost: 0, auto: 0, orderLines: 0, top: [] });

export type CategorySort = "profit_desc" | "profit_asc" | "revenue_desc";

/** Gộp các sản phẩm đã tính lãi theo ngành. Lãi/biên lãi chỉ tính trên sản phẩm đủ giá vốn (cờ `products_missing_cost` cho biết còn thiếu). */
export function categoryBreakdown(products: ProductProfit[], categoryOf: CategoryOf, opts: { level: number; sort: CategorySort; limit: number }) {
  const groups = new Map<string, Acc>();
  for (const p of products) {
    const c = categoryOf(p);
    const key = c ? levelLabel(c.path, opts.level) : UNKNOWN_CATEGORY;
    const g = groups.get(key) ?? emptyAcc();
    g.products++;
    g.quantity += p.quantity;
    g.revenue += p.revenue;
    g.cost += p.cost;
    g.fee += p.fee;
    g.ad += p.adCost;
    g.ship += p.shipCost;
    g.orderLines += p.orders;
    if (p.profit === null) g.missingCost++;
    else {
      g.profit += p.profit;
      g.revenueKnown += p.revenue;
    }
    if (c?.source === "suggested") g.auto++;
    g.top.push(p);
    groups.set(key, g);
  }
  const totalProfit = [...groups.values()].reduce((n, g) => n + g.profit, 0);
  const rows = [...groups.entries()].map(([category, g]) => ({
    category,
    products: g.products,
    quantity: g.quantity,
    /** Tổng số đơn có chứa từng sản phẩm của ngành: một đơn nhiều sản phẩm có thể đếm nhiều lần, KHÔNG cộng các ngành để ra tổng số đơn. */
    order_lines: g.orderLines,
    revenue_net: num(g.revenue),
    cost: num(g.cost),
    fee: num(g.fee),
    ad: num(g.ad),
    ship_cost: num(g.ship),
    profit: num(g.profit),
    margin_pct: g.revenueKnown > 0 ? r2((g.profit / g.revenueKnown) * 100) : null,
    profit_share_pct: totalProfit !== 0 ? r2((g.profit / totalProfit) * 100) : null,
    products_missing_cost: g.missingCost,
    products_auto_detected: g.auto,
    top_products: g.top
      .filter((p) => p.profit !== null)
      .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))
      .slice(0, 3)
      .map((p) => ({ name: p.name, profit: num(p.profit) })),
  }));
  if (opts.sort === "profit_asc") rows.sort((a, b) => (a.profit ?? 0) - (b.profit ?? 0));
  else if (opts.sort === "revenue_desc") rows.sort((a, b) => (b.revenue_net ?? 0) - (a.revenue_net ?? 0));
  else rows.sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0));
  return { total_categories: rows.length, rows: rows.slice(0, opts.limit) };
}
