import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Row } from "@dashboard/chart-engine";

vi.mock("server-only", () => ({}));

import { COL } from "@/lib/orders/canonical";
import { buildOrders, summarize } from "@/lib/profit/order-profit";
import { buildTodos } from "@/lib/profit/todos";
import { ProductDetailModal } from "./ProductDetail";

const line = (o: Partial<Record<string, string | number | null>>): Row => ({
  [COL.channel]: "Shopee", [COL.orderId]: "A", [COL.date]: "2026-11-02 10:00", [COL.status]: "Hoàn thành", [COL.rawStatus]: "Hoàn thành",
  [COL.sku]: "NCD-016-TRANG", [COL.product]: "Nồi chiên mini", [COL.variant]: null, [COL.quantity]: 1, [COL.revenue]: 530_000, [COL.netRevenue]: 530_000,
  [COL.orders]: 1, [COL.cancelledOrders]: 0, [COL.platformFee]: 95_000, [COL.province]: null, [COL.payment]: null,
  [COL.discount]: null, [COL.shippingFee]: 10_000, [COL.cost]: 472_000, [COL.adCost]: 40_000, ...o,
});

describe("xem nhanh sản phẩm", () => {
  it("hộp thoại nêu đúng tên, SKU, kênh, lãi mỗi đơn và lý do lỗ", () => {
    const rows = [
      ...[0, 1, 2].map((i) => line({ [COL.orderId]: `S${i}` })),
      ...[0, 1, 2].map((i) => line({ [COL.orderId]: `T${i}`, [COL.channel]: "TikTok Shop", [COL.sku]: "NCD-016" })),
    ];
    const s = summarize(buildOrders(rows));
    const p = s.products.find((x) => x.sku === "NCD-016-TRANG")!;
    const html = renderToStaticMarkup(<ProductDetailModal p={p} onClose={() => {}} />);
    expect(html).toContain("Nồi chiên mini");
    expect(html).toContain("SKU NCD-016-TRANG");
    expect(html).toContain("Shopee");
    expect(html).not.toContain("TikTok Shop"); // chỉ kênh của đúng sản phẩm/SKU này
    expect(html).toContain("Lỗ mỗi đơn");
    expect(html).toContain("-67.000đ"); // 530.000 + 10.000 − 95.000 − 472.000 − 40.000
    expect(html).toContain("Vì sao đang lỗ");
    expect(html).toContain("Khoản chi lớn nhất là giá vốn");
    expect(html).toContain('href="/orders?q=NCD-016-TRANG"');
  });

  it("việc 'sản phẩm lỗ' mang khoá, SKU và kênh để phân biệt sản phẩm cùng tên", () => {
    const rows = [
      ...[0, 1, 2].map((i) => line({ [COL.orderId]: `S${i}` })),
      ...[0, 1, 2].map((i) => line({ [COL.orderId]: `X${i}`, [COL.sku]: "NCD-016-XAM" })),
    ];
    const todos = buildTodos(summarize(buildOrders(rows))).filter((t) => t.kind === "loss_product");
    expect(todos.map((t) => t.sku).sort()).toEqual(["NCD-016-TRANG", "NCD-016-XAM"]);
    expect(todos.every((t) => t.key && t.channels?.includes("Shopee"))).toBe(true);
  });
});
