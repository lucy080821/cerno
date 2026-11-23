import { describe, expect, it } from "vitest";
import type { Row } from "@dashboard/chart-engine";
import { COL } from "@/lib/orders/canonical";
import { buildOrders, summarize } from "./order-profit";
import { cleanShipRates, makeShipEstimator } from "./shipping";

const row = (channel: string, id: string, status: string, revenue: number, cost: number | null = 40_000): Row => ({
  [COL.channel]: channel,
  [COL.orderId]: id,
  [COL.date]: "2026-06-01",
  [COL.status]: status,
  [COL.sku]: "SP1",
  [COL.product]: "Áo",
  [COL.quantity]: 1,
  [COL.revenue]: revenue,
  [COL.netRevenue]: status === "Hoàn thành" ? revenue : 0,
  [COL.platformFee]: 10_000,
  [COL.cost]: cost,
});

describe("makeShipEstimator", () => {
  const est = makeShipEstimator({ Shopee: { perOrder: 12_000, perReturn: 15_000 } })!;
  it("đơn đã gửi tính mỗi đơn, đơn hoàn thêm chiều hoàn, đơn hủy bằng 0", () => {
    expect(est({ channel: "Shopee", status: "Hoàn thành" })).toBe(12_000);
    expect(est({ channel: "Shopee", status: "Chưa hoàn tất" })).toBe(12_000);
    expect(est({ channel: "Shopee", status: "Hoàn trả" })).toBe(27_000);
    expect(est({ channel: "Shopee", status: "Đã hủy" })).toBe(0);
  });
  it("kênh chưa nhập thì 0; chưa nhập kênh nào thì không có bộ ước tính", () => {
    expect(est({ channel: "TikTok Shop", status: "Hoàn thành" })).toBe(0);
    expect(makeShipEstimator({})).toBeUndefined();
  });
});

describe("cleanShipRates", () => {
  it("chỉ giữ kênh hợp lệ có số tiền hợp lệ, làm tròn, bỏ kênh toàn 0", () => {
    expect(
      cleanShipRates({
        Shopee: { perOrder: 12_000.4, perReturn: 0 },
        "TikTok Shop": { perOrder: 0, perReturn: 0 },
        "<script>": { perOrder: 5, perReturn: 5 },
        Lazada: { perOrder: -5, perReturn: 20_000_000 },
        Facebook: { perOrder: "9000", perReturn: 7_000 },
      }),
    ).toEqual({ Shopee: { perOrder: 12_000, perReturn: 0 }, Facebook: { perOrder: 0, perReturn: 7_000 } });
    expect(cleanShipRates(null)).toEqual({});
  });
});

describe("lãi từng đơn có phí ship shop chịu", () => {
  const rows = [row("Shopee", "A", "Hoàn thành", 100_000), row("Shopee", "B", "Hoàn trả", 100_000, 0), row("Shopee", "C", "Đã hủy", 100_000, 0), row("TikTok Shop", "D", "Hoàn thành", 100_000)];
  const base = buildOrders(rows);
  const withShip = buildOrders(rows, undefined, makeShipEstimator({ Shopee: { perOrder: 12_000, perReturn: 15_000 } }));
  const by = (list: ReturnType<typeof buildOrders>, id: string) => list.find((o) => o.id === id)!;

  it("không nhập phí ship thì lãi như cũ", () => {
    expect(base.every((o) => o.shipCost === 0)).toBe(true);
    expect(by(base, "A").profit).toBe(100_000 - 10_000 - 40_000);
  });

  it("trừ đúng phí ship theo trạng thái và kênh", () => {
    expect(by(withShip, "A").shipCost).toBe(12_000);
    expect(by(withShip, "A").profit).toBe(100_000 - 10_000 - 40_000 - 12_000);
    expect(by(withShip, "B").shipCost).toBe(27_000);
    expect(by(withShip, "B").profit).toBe(by(base, "B").profit! - 27_000);
    expect(by(withShip, "C").shipCost).toBe(0);
    expect(by(withShip, "D").shipCost).toBe(0);
    expect(by(withShip, "D").profit).toBe(by(base, "D").profit);
  });

  it("tổng hợp: tổng ship, số đơn dùng ước tính và lãi giảm đúng số đó", () => {
    const a = summarize(base);
    const b = summarize(withShip);
    expect(b.shipCost).toBe(12_000 + 27_000);
    expect(b.shipEstimated).toBe(2);
    expect(a.shipEstimated).toBe(0);
    expect(b.profit).toBe(a.profit - 39_000);
    const prodBefore = a.products.find((p) => p.sku === "SP1")!;
    const prodAfter = b.products.find((p) => p.sku === "SP1")!;
    expect(prodAfter.shipCost).toBe(12_000); // chỉ đơn hợp lệ được chia cho sản phẩm
    expect(prodAfter.profit).toBe(prodBefore.profit! - 12_000);
    expect(prodAfter.breakEvenPrice).toBeGreaterThan(prodBefore.breakEvenPrice!);
  });

  it("đơn thiếu giá vốn vẫn chưa tính lãi dù có phí ship", () => {
    const r = buildOrders([row("Shopee", "X", "Hoàn thành", 100_000, null)], undefined, makeShipEstimator({ Shopee: { perOrder: 1, perReturn: 0 } }));
    expect(r[0].profit).toBeNull();
  });
});
