import { describe, expect, it } from "vitest";
import { buildOrders, summarize } from "./order-profit";
import { productInsight } from "./product-insight";
import { COL } from "@/lib/orders/canonical";
import type { Row } from "@dashboard/chart-engine";

const line = (o: Partial<Record<string, string | number | null>>): Row => ({
  [COL.channel]: "Shopee", [COL.orderId]: "A", [COL.date]: "2026-11-02 10:00", [COL.status]: "Hoàn thành", [COL.rawStatus]: "Hoàn thành",
  [COL.sku]: "NCD-1", [COL.product]: "Nồi chiên", [COL.variant]: null, [COL.quantity]: 1, [COL.revenue]: 500_000, [COL.netRevenue]: 500_000,
  [COL.orders]: 1, [COL.cancelledOrders]: 0, [COL.platformFee]: 80_000, [COL.province]: null, [COL.payment]: null,
  [COL.discount]: null, [COL.shippingFee]: 10_000, [COL.cost]: 450_000, [COL.adCost]: 40_000, ...o,
});

describe("xem nhanh sản phẩm", () => {
  it("lãi mỗi đơn khớp summarize(); nêu khoản chi lớn nhất và khoảng cách tới giá hòa vốn", () => {
    const rows = ["A", "B", "C"].map((id) => line({ [COL.orderId]: id }));
    const p = summarize(buildOrders(rows)).products[0];
    const i = productInsight(p);
    // 500.000 + 10.000 − 80.000 − 450.000 − 40.000 = −60.000 mỗi đơn.
    expect(i.profitPerOrder).toBe(-60_000);
    expect(i.profitPerOrder).toBe(p.profitPerOrder);
    expect(i.revenuePerOrder - i.feePerOrder - i.costPerOrder - i.adPerOrder - i.shipPerOrder).toBe(i.profitPerOrder);
    expect(i.topCost).toEqual({ key: "cost", amount: 1_350_000 });
    expect(i.margin).toBeCloseTo(-0.12, 6);
    expect(i.shares.cost).toBeCloseTo(0.9, 6);
    expect(i.priceGap).toBeCloseTo(p.breakEvenPrice! - p.avgPrice!, 6);
    expect(i.priceGap!).toBeGreaterThan(0);
    expect(i.profitableWithoutAds).toBe(false); // −60.000 + 40.000 vẫn âm
  });

  it("bỏ quảng cáo thì có lãi: nhận ra", () => {
    const rows = ["A", "B", "C"].map((id) => line({ [COL.orderId]: id, [COL.adCost]: 70_000 }));
    const i = productInsight(summarize(buildOrders(rows)).products[0]);
    expect(i.profitPerOrder).toBe(-90_000);
    const rows2 = ["A", "B", "C"].map((id) => line({ [COL.orderId]: id, [COL.cost]: 390_000, [COL.adCost]: 70_000, [COL.platformFee]: 60_000 }));
    const j = productInsight(summarize(buildOrders(rows2)).products[0]);
    expect(j.profitPerOrder).toBe(-10_000); // 510.000 − 60.000 − 390.000 − 70.000
    expect(j.profitableWithoutAds).toBe(true);
  });

  it("thiếu giá vốn thì chưa có lãi; không chia cho 0", () => {
    const i = productInsight(summarize(buildOrders([line({ [COL.cost]: null })])).products[0]);
    expect(i.profitPerOrder).toBeNull();
    expect(i.margin).toBeNull();
    expect(i.profitableWithoutAds).toBe(false);
  });
});
