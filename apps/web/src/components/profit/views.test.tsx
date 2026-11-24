import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Row } from "@dashboard/chart-engine";
import { COL } from "@/lib/orders/canonical";
import { buildOrders, summarize } from "@/lib/profit/order-profit";
import type { SummaryResponse } from "./useProfit";

const line = (o: Partial<Record<string, string | number | null>>): Row => ({
  [COL.channel]: "Shopee", [COL.orderId]: "A", [COL.date]: "2026-11-02 10:00", [COL.status]: "Hoàn thành", [COL.rawStatus]: "Hoàn thành",
  [COL.sku]: "CHAO-1", [COL.product]: "Chảo", [COL.variant]: null, [COL.quantity]: 1, [COL.revenue]: 100_000, [COL.netRevenue]: 100_000,
  [COL.orders]: 1, [COL.cancelledOrders]: 0, [COL.platformFee]: 5_000, [COL.province]: null, [COL.payment]: null,
  [COL.discount]: null, [COL.shippingFee]: null, [COL.cost]: 40_000, [COL.adCost]: null, ...o,
});

let response: SummaryResponse;
vi.mock("./useProfit", () => ({
  useProfitSummary: () => ({ data: response, error: "", loading: false, reload: async () => {} }),
  rangeQuery: () => "",
}));

import { PeriodBar } from "./PeriodBar";
import { ProfitView } from "./ProfitView";
import { CostsView } from "./CostsView";
import { OverviewView } from "./OverviewView";
import { ReturnsView } from "./ReturnsView";

const make = (rows: Row[]): SummaryResponse => {
  const summary = summarize(buildOrders(rows));
  return { source: { id: "s", rowCount: rows.length, lastSyncedAt: null }, editable: true, summary, todos: [], catalog: { available: true, entries: [] }, dataRange: { min: summary.dateMin, max: summary.dateMax } };
};

describe("thanh chọn khoảng thời gian trên các trang lãi", () => {
  it("PeriodBar có lối tắt, ô Lọc theo và ghi chú khoảng dữ liệu", () => {
    const html = renderToStaticMarkup(<PeriodBar dataMin="2026-01-05" dataMax="2026-11-24" />);
    expect(html).toContain("Hôm nay");
    expect(html).toContain("Quý này");
    expect(html).toContain("Lọc theo");
    expect(html).toContain("dữ liệu từ 05/01/2026 đến 24/11/2026");
  });

  it("Lãi lỗ, Chi phí, Tổng quan, Hoàn và hủy đều có thanh chọn và vẽ được", () => {
    response = make([line({}), line({ [COL.orderId]: "B", [COL.status]: "Hoàn trả" })]);
    for (const el of [<ProfitView key="p" />, <CostsView key="c" />, <OverviewView key="o" />, <ReturnsView key="r" />]) {
      const html = renderToStaticMarkup(el);
      expect(html, String((el as { type: { name: string } }).type.name)).toContain("Lọc theo");
    }
  });

  it("chưa có đơn thì vẫn hiện hướng dẫn tải file, không hiện thanh chọn", () => {
    response = { source: null, editable: true, catalog: { available: true, entries: [] } };
    expect(renderToStaticMarkup(<ProfitView />)).not.toContain("Lọc theo");
  });
});
