import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Row } from "@dashboard/chart-engine";

vi.mock("server-only", () => ({}));

import { DEFAULT_FEE_SETTINGS } from "@/lib/fees/constants";
import { COL } from "@/lib/orders/canonical";
import { feePayload, type FeeConfig } from "@/lib/server/fees";
import { buildOrders, summarize } from "@/lib/profit/order-profit";
import type { SummaryResponse } from "./useProfit";

const line = (o: Partial<Record<string, string | number | null>>): Row => ({
  [COL.channel]: "Shopee", [COL.orderId]: "A", [COL.date]: "2026-11-02 10:00", [COL.status]: "Hoàn thành", [COL.rawStatus]: "Hoàn thành",
  [COL.sku]: "CHAO-1", [COL.product]: "Chảo chống dính 24cm", [COL.variant]: null, [COL.quantity]: 1, [COL.revenue]: 100_000, [COL.netRevenue]: 100_000,
  [COL.orders]: 1, [COL.cancelledOrders]: 0, [COL.platformFee]: null, [COL.province]: null, [COL.payment]: null,
  [COL.discount]: null, [COL.shippingFee]: null, [COL.cost]: 40_000, [COL.adCost]: null, ...o,
});

const cfg: FeeConfig = {
  available: true, multiPlatform: true, settings: { ...DEFAULT_FEE_SETTINGS, enabled: true },
  categories: { Shopee: new Map(), "TikTok Shop": new Map() }, manual: { available: true, rates: {} }, ship: { available: true, rates: {} }, signature: "t",
};

let response: SummaryResponse;
vi.mock("./useProfit", () => ({ useProfitSummary: () => ({ data: response, error: "", loading: false, reload: async () => {} }) }));

import { ProductsView } from "./ProductsView";

describe("trang Sản phẩm và giá vốn", () => {
  it("vẽ được bảng sản phẩm và bảng ngành hàng theo sàn (mỗi sản phẩm một dòng cho mỗi sàn có bán)", () => {
    const rows = [line({}), line({ [COL.orderId]: "B", [COL.channel]: "TikTok Shop" }), line({ [COL.orderId]: "C", [COL.sku]: "KCN-5", [COL.product]: "Kem chống nắng SPF50 50g" })];
    const summary = summarize(buildOrders(rows));
    response = {
      source: { id: "s", rowCount: rows.length, lastSyncedAt: null },
      editable: true,
      summary,
      todos: [],
      catalog: { available: true, entries: [] },
      fees: feePayload(cfg, summary.products.map((p) => ({ key: p.key, name: p.name, channels: p.channels }))),
    };
    const html = renderToStaticMarkup(<ProductsView initialFilter="all" />);
    expect(html).toContain("Ngành hàng tính phí");
    expect(html).toContain("Chảo chống dính 24cm");
    // Bảng sản phẩm: chảo (Shopee + TikTok Shop) + kem (Shopee) = 3 nhãn; bảng ngành hàng: 3 dòng sản phẩm × sàn = 3 nhãn.
    expect(html.match(/platformTag/g)?.length).toBe(6);
  });

  it("vẽ được khi chưa chạy migration 0021 hoặc chưa có đơn nào", () => {
    response = { source: null, editable: true, catalog: { available: true, entries: [] }, fees: feePayload({ ...cfg, multiPlatform: false }, []) };
    expect(() => renderToStaticMarkup(<ProductsView initialFilter="all" />)).not.toThrow();
  });
});
