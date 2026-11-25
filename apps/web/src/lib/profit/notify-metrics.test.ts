import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runQuery, type Row } from "@dashboard/chart-engine";
import { prepareImport } from "@/lib/orders/prepare";
import { mergeOrders } from "@/lib/orders/merge";
import { applyCatalogCosts, catalogMap } from "./catalog";
import { buildOrders, summarize } from "./order-profit";
import { inRange } from "./period";
import { MCOL, NOTIFY_CALC, NOTIFY_COLUMNS, countOrders, enrichOrderRows } from "./notify-metrics";
import { COL } from "@/lib/orders/canonical";

/**
 * Cột lãi và trường tổng hợp dựng sẵn phải cho ĐÚNG số của các trang lãi (`summarize`), kể cả khi lọc theo khoảng ngày và theo kênh.
 * Dữ liệu: hai file mô phỏng Shopee và TikTok Shop (xem orders/sample-files/README.md), có giá vốn nhập theo SKU gốc.
 */
const load = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../orders/sample-files/${name}`, import.meta.url))));
const COSTS = new Map([["AO-001", 62000], ["BGN-002", 90000], ["TOTE-003", 50000], ["SRM-004", 76000], ["KCN-005", 118000], ["CHAO-006", 160000], ["DEN-007", 139000]]);

async function rows(): Promise<Row[]> {
  let all: Row[] = [];
  for (const n of ["MO-PHONG_Shopee_Order.all.20261101_20261115.xlsx", "MO-PHONG_TikTokShop_OrderSKUList_2026-11.xlsx"]) {
    const p = await prepareImport(load(n), n, {});
    all = mergeOrders(all, p.normalized!.rows, p.normalized!.keyed);
  }
  // KHAN-008 cố ý không có giá vốn: các đơn có nó phải không tính được lãi.
  return applyCatalogCosts(all, catalogMap([...COSTS].map(([sku, unitCost]) => ({ sku, unitCost })))).rows;
}

const scalar = (data: Row[], metric: { column: string; aggregation?: "sum" }, filters: Parameters<typeof runQuery>[1] extends infer S ? (S extends { filters?: infer F } ? F : never) : never = []) => {
  const r = runQuery(data, { mode: "aggregate", dims: [], metrics: [metric], filters, calc: NOTIFY_CALC });
  if (r.mode !== "aggregate" || r.matched === 0) return null;
  return r.table.rows[0].values[0] as number;
};

describe("cột lãi cho cảnh báo/báo cáo theo cửa hàng", () => {
  it("tổng khớp summarize() của các trang lãi", async () => {
    const base = await rows();
    const orders = buildOrders(base);
    const s = summarize(orders);
    expect(countOrders(base)).toBe(orders.length);
    const data = enrichOrderRows(base, orders);
    expect(data.length).toBe(base.length);
    // Đủ mọi cột (kể cả cột ảo) trên MỌI dòng: truy vấn không bị lỗi cột thiếu.
    for (const r of data) for (const c of NOTIFY_COLUMNS) expect(c.name in r).toBe(true);

    expect(s.missingCost).toBeGreaterThan(0); // có đơn thiếu giá vốn → kiểm tra việc loại chúng
    expect(scalar(data, { column: MCOL.profit })).toBe(s.profit);
    expect(scalar(data, { column: MCOL.computable })).toBe(s.computable);
    expect(scalar(data, { column: MCOL.loss })).toBe(s.loss);
    expect(scalar(data, { column: MCOL.returned })).toBe(s.returned);
    expect(scalar(data, { column: COL.cancelledOrders })).toBe(s.cancelled);
    expect(scalar(data, { column: COL.netRevenue })).toBe(s.allRevenue);
    expect(scalar(data, { column: MCOL.profitRevenue })).toBe(s.revenue);
    expect(scalar(data, { column: MCOL.fee })).toBe(orders.reduce((n, o) => n + o.fee, 0));

    const calc = (name: string) => scalar(data, { column: name });
    expect(calc("Biên lãi (%)")).toBeCloseTo(s.margin! * 100, 6);
    expect(calc("Lãi trung bình mỗi đơn")).toBeCloseTo(s.profit / s.computable, 6);
    expect(calc("Tỷ lệ hủy (%)")).toBeCloseTo((s.cancelled / s.orders) * 100, 6);
    expect(calc("Tỷ lệ hoàn trả (%)")).toBeCloseTo((s.returned / (s.orders - s.cancelled)) * 100, 6);
    expect(calc("Tỷ lệ đơn lỗ (%)")).toBeCloseTo((s.loss / s.computable) * 100, 6);
    expect(calc("Quảng cáo / doanh thu (%)")).toBe(0); // file mô phỏng không có chi phí quảng cáo
  });

  it("lọc theo khoảng ngày và theo kênh khớp summarize() trên đúng tập đơn đó", async () => {
    const base = await rows();
    const orders = buildOrders(base);
    const data = enrichOrderRows(base, orders);
    const range = { from: "2026-11-05", to: "2026-11-09" };
    const sub = summarize(orders.filter((o) => inRange(o.date, range)));
    expect(sub.orders).toBeGreaterThan(0);
    const dateF = { column: COL.date, values: [], dateRange: range };
    expect(scalar(data, { column: MCOL.profit }, [dateF])).toBe(sub.profit);
    expect(scalar(data, { column: COL.netRevenue }, [dateF])).toBe(sub.allRevenue);
    expect(scalar(data, { column: MCOL.profitRevenue }, [dateF])).toBe(sub.revenue);

    const shopee = summarize(orders.filter((o) => o.channel === "Shopee"));
    expect(scalar(data, { column: MCOL.profit }, [{ column: COL.channel, values: ["Shopee"] }])).toBe(shopee.profit);
  });

  it("theo từng kênh: nhóm và tổng lãi mỗi kênh khớp summarize().channels", async () => {
    const base = await rows();
    const orders = buildOrders(base);
    const s = summarize(orders);
    const r = runQuery(enrichOrderRows(base, orders), { mode: "aggregate", dims: [{ column: COL.channel }], metrics: [{ column: MCOL.profit, aggregation: "sum" }], filters: [], calc: [] });
    if (r.mode !== "aggregate") throw new Error("kết quả sai dạng");
    const got = new Map(r.table.rows.map((x) => [String(x.keys[0]), x.values[0] as number]));
    for (const c of s.channels) expect(got.get(c.channel)).toBe(c.profit);
  });

  it("không sửa dòng gốc", async () => {
    const base = await rows();
    const copy = JSON.stringify(base);
    enrichOrderRows(base, buildOrders(base));
    expect(JSON.stringify(base)).toBe(copy);
  });
});
