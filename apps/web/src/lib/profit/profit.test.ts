import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Row } from "@dashboard/chart-engine";
import { COL } from "@/lib/orders/canonical";
import { prepareImport } from "@/lib/orders/prepare";
import { applyCatalogCosts, catalogMap, parseCostPaste } from "./catalog";
import { buildOrders, filterOrders, orderCounts, sortOrders, summarize } from "./order-profit";
import { buildTodos } from "./todos";

/** Một dòng sản phẩm theo cột chuẩn của nguồn "Đơn hàng đa kênh". */
const line = (o: Partial<Record<string, string | number | null>>): Row => ({
  [COL.channel]: "Shopee", [COL.orderId]: "A", [COL.date]: "2026-11-02 10:00", [COL.status]: "Hoàn thành", [COL.rawStatus]: "Hoàn thành",
  [COL.sku]: "SKU1", [COL.product]: "Áo", [COL.variant]: null, [COL.quantity]: 1, [COL.revenue]: 100_000, [COL.netRevenue]: 100_000,
  [COL.orders]: 1, [COL.cancelledOrders]: 0, [COL.platformFee]: null, [COL.province]: null, [COL.payment]: null,
  [COL.discount]: null, [COL.shippingFee]: null, [COL.cost]: 40_000, [COL.adCost]: null, ...o,
});

describe("lãi từng đơn", () => {
  it("gộp dòng theo mã đơn, giá trị cấp đơn chỉ ở dòng đầu", () => {
    const orders = buildOrders([
      line({ [COL.platformFee]: 15_000, [COL.shippingFee]: 20_000, [COL.adCost]: 10_000 }),
      line({ [COL.sku]: "SKU2", [COL.product]: "Quần", [COL.netRevenue]: 200_000, [COL.cost]: 90_000, [COL.orders]: 0 }),
      line({ [COL.orderId]: "B", [COL.cost]: 30_000 }),
    ]);
    expect(orders.map((o) => o.id)).toEqual(["A", "B"]);
    // 300.000 + 20.000 - 15.000 - 130.000 - 10.000
    expect(orders[0].profit).toBe(165_000);
    expect(orders[0].lines).toHaveLength(2);
    expect(orders[1].profit).toBe(70_000);
  });

  it("đơn thiếu giá vốn không có lãi (không báo lãi ảo)", () => {
    const [o] = buildOrders([line({ [COL.cost]: null })]);
    expect(o.profit).toBeNull();
    expect(o.costKnown).toBe(false);
    const s = summarize([o]);
    expect(s.missingCost).toBe(1);
    expect(s.computable).toBe(0);
  });

  it("đơn hủy mất tiền quảng cáo, đơn hoàn được phân loại riêng", () => {
    const orders = buildOrders([
      line({ [COL.orderId]: "H", [COL.status]: "Đã hủy", [COL.netRevenue]: 0, [COL.cost]: 0, [COL.adCost]: 12_000 }),
      line({ [COL.orderId]: "R", [COL.status]: "Hoàn trả", [COL.netRevenue]: 0, [COL.cost]: 0, [COL.adCost]: 5_000 }),
      line({ [COL.orderId]: "K", [COL.status]: "Đã hủy", [COL.netRevenue]: 0, [COL.cost]: 0 }),
    ]);
    expect(orders.map((o) => [o.profit, o.reason])).toEqual([[-12_000, "cancel"], [-5_000, "return"], [0, null]]);
    const s = summarize(orders);
    expect(s.cancelLoss).toBe(-12_000);
    expect(s.returnLoss).toBe(-5_000);
    expect(s.loss).toBe(2);
    expect(filterOrders(orders, "return").length).toBe(3);
  });

  it("phân loại lý do lỗ: voucher, quảng cáo, giá vốn", () => {
    const [voucher, ads, cost] = buildOrders([
      // Giá niêm yết 150.000, voucher 40.000 (26,7%): bỏ voucher thì có lãi.
      line({ [COL.orderId]: "V", [COL.netRevenue]: 110_000, [COL.discount]: 40_000, [COL.cost]: 100_000, [COL.platformFee]: 15_000 }),
      line({ [COL.orderId]: "Q", [COL.cost]: 50_000, [COL.platformFee]: 10_000, [COL.adCost]: 60_000 }),
      line({ [COL.orderId]: "C", [COL.cost]: 95_000, [COL.platformFee]: 12_000 }),
    ]);
    expect([voucher.reason, ads.reason, cost.reason]).toEqual(["discount", "ads", "cost"]);
  });

  it("tổng hợp: lãi trung bình, phân bố, theo sản phẩm (chia phí cấp đơn theo doanh thu)", () => {
    const orders = buildOrders([
      line({ [COL.platformFee]: 30_000, [COL.adCost]: 30_000 }),
      line({ [COL.sku]: "SKU2", [COL.product]: "Quần", [COL.netRevenue]: 200_000, [COL.cost]: 100_000, [COL.orders]: 0 }),
      line({ [COL.orderId]: "B", [COL.date]: "2026-11-03 09:00", [COL.cost]: 130_000 }),
    ]);
    const s = summarize(orders);
    expect(s.profit).toBe(100_000 + -30_000);
    expect(s.avgProfit).toBe(35_000);
    expect(s.loss).toBe(1);
    expect(s.histogram.find((b) => b.label === "> 100K")!.count).toBe(1);
    expect(s.histogram.find((b) => b.label === "-50K..-20K")!.count).toBe(1);
    expect(s.daily.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03"]);
    const ao = s.products.find((p) => p.key === "SKU1")!;
    // Áo: 2 đơn; phí và quảng cáo của đơn A chia 1/3 cho Áo (100k trên 300k doanh thu).
    expect(ao.orders).toBe(2);
    expect(ao.fee).toBeCloseTo(10_000);
    expect(ao.profit).toBeCloseTo(100_000 - 40_000 - 10_000 - 10_000 + (100_000 - 130_000));
    expect(ao.breakEvenPrice).toBeCloseTo((170_000 + 20_000) / 2);
  });

  it("lọc, đếm và sắp xếp danh sách đơn", () => {
    const orders = buildOrders([
      line({ [COL.orderId]: "L", [COL.cost]: 120_000 }),
      line({ [COL.orderId]: "T", [COL.cost]: 97_000, [COL.date]: "2026-11-05 08:00" }),
      line({ [COL.orderId]: "M", [COL.cost]: null }),
    ]);
    expect(orderCounts(orders)).toEqual({ all: 3, loss: 1, thin: 1, missing: 1, return: 0 });
    expect(sortOrders(orders, "profit").map((o) => o.id)).toEqual(["L", "T", "M"]);
    expect(sortOrders(orders, "date")[0].id).toBe("T");
    expect(filterOrders(orders, "all", "sku1").length).toBe(3);
    expect(filterOrders(orders, "all", "không có").length).toBe(0);
  });
});

describe("bảng giá vốn", () => {
  it("ghi giá vốn = giá mỗi cái × số lượng, 0 với đơn hủy, không đổi sản phẩm ngoài bảng", () => {
    const rows = [
      line({ [COL.quantity]: 3, [COL.cost]: null }),
      line({ [COL.orderId]: "H", [COL.status]: "Đã hủy", [COL.cost]: 0 }),
      line({ [COL.sku]: "KHAC", [COL.cost]: 7 }),
      line({ [COL.sku]: null, [COL.product]: "Túi vải", [COL.quantity]: 2, [COL.cost]: null }),
    ];
    const { rows: out, changed } = applyCatalogCosts(rows, catalogMap([{ sku: "sku1", unitCost: 35_000 }, { sku: "Túi vải", unitCost: 20_000 }]));
    expect(out.map((r) => r[COL.cost])).toEqual([105_000, 0, 7, 40_000]);
    expect(changed).toBe(2);
    expect(rows[0][COL.cost]).toBeNull(); // không sửa mảng gốc
  });

  it("đọc giá vốn dán từ Excel", () => {
    const { items, errors } = parseCostPaste("SKU\tGiá vốn\nAO-01\t120.000\nQUAN-02;95000đ\nTúi vải  45,5\nVỚ 12000\nLOI\tabc");
    expect(items).toEqual([
      { sku: "AO-01", unitCost: 120_000 },
      { sku: "QUAN-02", unitCost: 95_000 },
      { sku: "Túi vải", unitCost: 45.5 },
      { sku: "VỚ", unitCost: 12_000 },
    ]);
    expect(errors).toHaveLength(1);
  });
});

describe("việc cần làm", () => {
  it("thiếu giá vốn trước, rồi sản phẩm lỗ theo số tiền", () => {
    const rows: Row[] = [];
    for (let i = 0; i < 4; i++) rows.push(line({ [COL.orderId]: `L${i}`, [COL.sku]: "LO", [COL.product]: "Tai nghe", [COL.cost]: 95_000, [COL.platformFee]: 12_000 }));
    rows.push(line({ [COL.orderId]: "M", [COL.sku]: "MISS", [COL.cost]: null }));
    const todos = buildTodos(summarize(buildOrders(rows)));
    expect(todos.map((t) => t.kind)).toEqual(["missing_cost", "loss_product"]);
    expect(todos[1].breakEvenPrice).toBeCloseTo(107_000);
  });
});

describe("chạy trên file mô phỏng Shopee", () => {
  it("lãi tổng bằng tổng tính tay từ các cột chuẩn", async () => {
    const f = "MO-PHONG_Shopee_Order.all.20261101_20261115.xlsx";
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL(`../orders/sample-files/${f}`, import.meta.url))));
    const p = await prepareImport(bytes, f, {});
    const rows = p.normalized!.rows;
    // File mô phỏng không có giá vốn: mọi đơn hợp lệ thiếu giá vốn.
    const before = summarize(buildOrders(rows));
    expect(before.computable).toBe(rows.filter((r) => r[COL.status] === "Đã hủy" && r[COL.orders] === 0 && r[COL.cancelledOrders] === 1).length);
    // Có bảng giá vốn cho mọi SKU thì tính được hết.
    const skus = [...new Set(rows.map((r) => r[COL.sku] as string))];
    const { rows: costed } = applyCatalogCosts(rows, catalogMap(skus.map((sku) => ({ sku, unitCost: 50_000 }))));
    const s = summarize(buildOrders(costed));
    expect(s.missingCost).toBe(0);
    const sum = (k: string) => costed.reduce((n, r) => n + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
    expect(s.profit).toBeCloseTo(sum(COL.netRevenue) + sum(COL.shippingFee) - sum(COL.platformFee) - sum(COL.cost) - sum(COL.adCost));
  });
});

describe("phí sàn của đơn hoàn và phí ước tính", () => {
  it("đơn hoàn trả vẫn mất phí ghi trong file, lãi = -(phí + quảng cáo)", () => {
    const [o] = buildOrders([line({ [COL.status]: "Hoàn trả", [COL.netRevenue]: 0, [COL.cost]: 0, [COL.platformFee]: 18_000, [COL.adCost]: 5_000 })]);
    expect(o.fee).toBe(18_000);
    expect(o.profit).toBe(-23_000);
    expect(o.reason).toBe("return");
    expect(o.feeEstimated).toBe(false);
  });

  const estimator = (calls: { n: number }) => () => {
    calls.n++;
    return 30_000;
  };

  it("điền phí ước tính khi file không có phí, và đánh dấu", () => {
    const calls = { n: 0 };
    const [o] = buildOrders([line({})], estimator(calls));
    expect(o.fee).toBe(30_000);
    expect(o.feeEstimated).toBe(true);
    expect(o.profit).toBe(100_000 - 30_000 - 40_000);
    const s = summarize([o]);
    expect(s.feeEstimated).toBe(1);
  });

  it("file đã có phí thì KHÔNG ước tính, kể cả khi phí ghi là 0", () => {
    const calls = { n: 0 };
    const orders = buildOrders([line({ [COL.platformFee]: 12_000 }), line({ [COL.orderId]: "B", [COL.platformFee]: 0 })], estimator(calls));
    expect(orders.map((o) => o.fee)).toEqual([12_000, 0]);
    expect(orders.every((o) => !o.feeEstimated)).toBe(true);
    expect(calls.n).toBe(0);
  });

  it("đơn hủy không được ước tính phí; đơn hoàn thì có (dùng giá trị gốc của dòng)", () => {
    let seen: number[] = [];
    const orders = buildOrders(
      [line({ [COL.status]: "Đã hủy", [COL.netRevenue]: 0, [COL.cost]: 0 }), line({ [COL.orderId]: "R", [COL.status]: "Hoàn trả", [COL.netRevenue]: 0, [COL.cost]: 0 })],
      (o) => {
        seen = o.lines.map((l) => l.gross);
        return 25_000;
      },
    );
    expect(orders[0].fee).toBe(0);
    expect(orders[0].feeEstimated).toBe(false);
    expect(orders[1].fee).toBe(25_000);
    expect(seen).toEqual([100_000]);
    expect(orders[1].profit).toBe(-25_000);
  });

  it("bộ ước tính trả null thì giữ nguyên (không phí)", () => {
    const [o] = buildOrders([line({})], () => null);
    expect(o.fee).toBe(0);
    expect(o.feeEstimated).toBe(false);
  });
});
