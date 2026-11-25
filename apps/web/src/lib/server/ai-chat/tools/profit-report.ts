import { normalizeText } from "@dashboard/schema";
import { summarize, type OrderProfit } from "@/lib/profit/order-profit";
import { isIsoDay } from "@/lib/profit/period";
import type { SourceInfo } from "../sources";
import { ProfitArgs } from "./args";
import { findSource } from "./lookup";
import { categoryBreakdown, inCategory, levelLabel, type CategoryOf } from "./profit-category";
import type { ToolDeps, ToolResult } from "./types";
import { num, r2, ToolError } from "./util";

/* ------------------------------ profit_report ------------------------------ */

interface Agg {
  orders: number;
  valid: number;
  computable: number;
  revenue: number;
  fee: number;
  cost: number;
  ad: number;
  ship: number;
  profit: number;
  loss: number;
}
const emptyAgg = (): Agg => ({ orders: 0, valid: 0, computable: 0, revenue: 0, fee: 0, cost: 0, ad: 0, ship: 0, profit: 0, loss: 0 });

function add(a: Agg, o: OrderProfit) {
  a.orders++;
  if (o.valid) {
    a.valid++;
    a.revenue += o.revenue;
  }
  if (o.profit !== null) {
    a.computable++;
    a.fee += o.fee;
    a.cost += o.cost;
    a.ad += o.adCost;
    a.ship += o.shipCost;
    a.profit += o.profit;
    if (o.profit < 0) a.loss++;
  }
}
const aggRow = (key: string, a: Agg) => ({
  key,
  orders: a.orders,
  valid_orders: a.valid,
  computable_orders: a.computable,
  revenue_net: num(a.revenue),
  fee: num(a.fee),
  cost: num(a.cost),
  ad: num(a.ad),
  ship_cost: num(a.ship),
  profit: num(a.profit),
  loss_orders: a.loss,
});

const GROUP_VI = { channel: "kênh", product: "sản phẩm", category: "ngành hàng", day: "ngày", month: "tháng", loss_reason: "lý do lỗ" } as const;

export async function profitReport(raw: unknown, sources: SourceInfo[], deps: ToolDeps): Promise<ToolResult> {
  const a = ProfitArgs.parse(raw);
  const source = findSource(sources, a.source);
  if (source.kind !== "orders") throw new ToolError(`Nguồn ${source.alias} không phải nguồn đơn hàng nên không có báo cáo lãi. Chỉ nguồn "Đơn hàng đa kênh" dùng được profit_report.`);
  if (!deps.profit) throw new ToolError("Báo cáo lãi chưa sẵn sàng.");
  if ((a.from && !isIsoDay(a.from)) || (a.to && !isIsoDay(a.to))) throw new ToolError("from/to phải dạng yyyy-mm-dd.");
  if (a.from && a.to && a.from > a.to) throw new ToolError("from phải trước hoặc bằng to.");
  const range = a.from || a.to ? { from: a.from ?? "2000-01-01", to: a.to ?? "2100-12-31" } : null;
  const data = await deps.profit(source, range);

  let orders = data.orders;
  let summary = data.summary;
  if (a.channel) {
    const ch = normalizeText(a.channel);
    const channels = [...new Set(orders.map((o) => o.channel))];
    const hit = channels.find((c) => normalizeText(c) === ch);
    if (!hit) throw new ToolError(`Không có kênh "${a.channel}" trong khoảng này. Các kênh có: ${channels.join(", ") || "(không có đơn)"}.`);
    orders = orders.filter((o) => o.channel === hit);
    summary = summarize(orders);
  }

  const s = summary;
  const totals = {
    orders: s.orders,
    computable_orders: s.computable,
    missing_cost_orders: s.missingCost,
    revenue_net: num(s.revenue),
    fee: num(s.fee),
    cost: num(s.cost),
    ad: num(s.adCost),
    ship_cost: num(s.shipCost),
    ship_paid_by_customer: num(s.shippingIn),
    profit: num(s.profit),
    margin_pct: s.margin === null ? null : r2(s.margin * 100),
    avg_profit_per_order: num(s.avgProfit),
    profitable_orders: s.profitable,
    loss_orders: s.loss,
    loss_amount: num(s.lossAmount),
    thin_orders: s.thin,
    returned_orders: s.returned,
    cancelled_orders: s.cancelled,
    return_loss: num(s.returnLoss),
    cancel_loss: num(s.cancelLoss),
    fee_estimated_orders: s.feeEstimated,
    ship_estimated_orders: s.shipEstimated,
  };

  const notes: string[] = [
    "Lãi = doanh thu thực + ship khách trả − phí sàn − giá vốn − quảng cáo − ship shop chịu, chỉ tính trên các đơn đủ giá vốn (computable_orders).",
  ];
  if (s.missingCost > 0) notes.push(`${s.missingCost} đơn hợp lệ chưa có giá vốn nên KHÔNG nằm trong tổng lãi: lãi thật có thể khác.`);
  if (s.feeEstimated > 0) notes.push(`${s.feeEstimated} đơn dùng phí sàn ƯỚC TÍNH theo biểu phí (file đơn không có phí).`);
  if (s.shipEstimated > 0) notes.push(`${s.shipEstimated} đơn dùng phí ship shop chịu ƯỚC TÍNH theo mức trung bình người dùng nhập.`);

  const by = a.group_by ?? "none";
  const limit = a.limit ?? 15;
  const sort = a.sort ?? (by === "product" || by === "channel" || by === "category" ? "profit_desc" : undefined);
  const categoryOf: CategoryOf | undefined = data.category;
  if ((by === "category" || a.category) && !categoryOf) throw new ToolError("Nguồn này chưa có thông tin ngành hàng nên không chia/lọc theo ngành được.");
  const level = a.category_level ?? 1;
  let breakdown: unknown = null;
  if (by === "channel" || by === "day" || by === "month") {
    const groups = new Map<string, Agg>();
    for (const o of orders) {
      const key = by === "channel" ? o.channel : o.date ? o.date.slice(0, by === "day" ? 10 : 7) : "(không có ngày)";
      const g = groups.get(key) ?? emptyAgg();
      add(g, o);
      groups.set(key, g);
    }
    let rows = [...groups.entries()].map(([k, g]) => aggRow(k, g));
    if (by === "channel") {
      if (sort === "profit_asc") rows.sort((x, y) => (x.profit ?? 0) - (y.profit ?? 0));
      else if (sort === "revenue_desc") rows.sort((x, y) => (y.revenue_net ?? 0) - (x.revenue_net ?? 0));
      else rows.sort((x, y) => (y.profit ?? 0) - (x.profit ?? 0));
    } else {
      rows.sort((x, y) => x.key.localeCompare(y.key));
      const cap = by === "day" ? 62 : 36;
      if (rows.length > cap) {
        notes.push(`Chỉ hiện ${cap} ${by === "day" ? "ngày" : "tháng"} gần nhất trong ${rows.length}.`);
        rows = rows.slice(-cap);
      }
    }
    breakdown = { by, rows: rows.slice(0, by === "channel" ? 30 : 62) };
  } else if (by === "category") {
    let products = summary.products;
    if (a.category) products = products.filter((p) => inCategory(categoryOf!(p), a.category!));
    breakdown = { by, category_level: level, ...categoryBreakdown(products, categoryOf!, { level, sort: sort ?? "profit_desc", limit }) };
    notes.push(
      "Ngành hàng là thuộc tính suy ra cho từng sản phẩm (không có cột riêng trong dữ liệu): ngành người bán đã chọn ở trang Sản phẩm và giá vốn, nếu chưa chọn thì Cerno tự nhận diện theo tên sản phẩm (là ước đoán, xem products_auto_detected).",
      "Lãi và biên lãi của mỗi ngành chỉ cộng các sản phẩm đã đủ giá vốn (products_missing_cost = số sản phẩm còn thiếu). order_lines là số đơn có chứa sản phẩm của ngành, không cộng các ngành lại thành tổng số đơn.",
      "Sản phẩm bán ở cả Shopee và TikTok Shop được xếp ngành theo biểu ngành của Shopee.",
    );
    if (a.category) notes.push(`Bảng chỉ gồm các sản phẩm thuộc ngành khớp "${a.category}"; phần totals vẫn là toàn bộ đơn.`);
  } else if (by === "product") {
    let list = summary.products;
    if (a.category) list = list.filter((p) => inCategory(categoryOf!(p), a.category!));
    const rows = [...list];
    if (sort === "profit_asc") rows.sort((x, y) => (x.profit ?? Infinity) - (y.profit ?? Infinity));
    else if (sort === "revenue_desc") rows.sort((x, y) => y.revenue - x.revenue);
    else rows.sort((x, y) => (y.profit ?? -Infinity) - (x.profit ?? -Infinity));
    breakdown = {
      by,
      total_products: rows.length,
      rows: rows.slice(0, limit).map((p) => ({
        name: p.name,
        sku: p.sku,
        ...(categoryOf ? { category: ((c) => (c ? levelLabel(c.path, level) : null))(categoryOf(p)) } : {}),
        channels: p.channels,
        quantity: p.quantity,
        orders: p.orders,
        revenue_net: num(p.revenue),
        cost: num(p.cost),
        fee: num(p.fee),
        ad: num(p.adCost),
        ship_cost: num(p.shipCost),
        profit: num(p.profit),
        profit_per_order: num(p.profitPerOrder),
        avg_price: num(p.avgPrice),
        unit_cost: num(p.unitCost),
        break_even_price: num(p.breakEvenPrice),
        cost_missing: p.costMissing,
        orders_waiting_cost: p.missingCostOrders,
      })),
    };
    if (rows.some((p) => p.profit === null)) notes.push("Sản phẩm có profit = null là chưa đủ giá vốn để tính lãi (không phải lãi bằng 0).");
  } else if (by === "loss_reason") {
    breakdown = { by, rows: summary.reasons.map((r) => ({ reason: r.reason, orders: r.orders, amount: num(r.amount) })) };
    notes.push("Lý do lỗ: return = đơn hoàn, cancel = đơn hủy (mất tiền quảng cáo), discount = giảm giá sâu, ads = quảng cáo ăn hết lãi, cost = giá vốn và phí cao hơn giá bán.");
  }

  const out = {
    source: source.alias,
    period: { from: a.from ?? null, to: a.to ?? null, data_first_day: data.dataMin, data_last_day: data.dataMax },
    scope: { channel: a.channel ? orders[0]?.channel ?? a.channel : "tất cả kênh" },
    totals,
    breakdown,
    notes,
  };
  return { ok: true, content: JSON.stringify(out), status: `Đang tính lãi${a.channel ? ` kênh ${a.channel}` : ""}${by !== "none" ? ` theo ${GROUP_VI[by]}` : ""}…` };
}
