import type { ProductProfit } from "./order-profit";

/**
 * Số liệu "xem nhanh" của MỘT sản phẩm (từ `ProductProfit`, đã gộp mọi đơn): tiền đi đâu trên mỗi đơn, biên lãi, và vì sao lỗ.
 * Hàm thuần, có test. Cùng công thức với `summarize()`: lãi = doanh thu thực + ship khách trả − phí sàn − giá vốn − quảng cáo − ship shop chịu.
 */
export interface ProductInsight {
  orders: number;
  /** Mỗi đơn: doanh thu thực + ship khách trả. */
  revenuePerOrder: number;
  feePerOrder: number;
  costPerOrder: number;
  adPerOrder: number;
  shipPerOrder: number;
  /** null khi còn đơn chưa có giá vốn. */
  profitPerOrder: number | null;
  /** Lãi trên doanh thu thực; null khi chưa có lãi hoặc doanh thu bằng 0. */
  margin: number | null;
  /** Mỗi khoản chi chiếm bao nhiêu % doanh thu thực (0–1+); null khi doanh thu bằng 0. */
  shares: { fee: number | null; cost: number | null; ads: number | null; ship: number | null };
  /** Khoản chi lớn nhất. */
  topCost: { key: "fee" | "cost" | "ads" | "ship"; amount: number } | null;
  /** Giá hòa vốn trừ giá bán trung bình (dương = đang bán thấp hơn giá hòa vốn); null khi thiếu một trong hai. */
  priceGap: number | null;
  /** Bỏ quảng cáo thì sản phẩm này có lãi không (chỉ khi đang lỗ): true khi lãi + quảng cáo ≥ 0. */
  profitableWithoutAds: boolean;
}

export function productInsight(p: ProductProfit): ProductInsight {
  const o = Math.max(1, p.orders);
  const costs = [
    { key: "fee" as const, amount: p.fee },
    { key: "cost" as const, amount: p.cost },
    { key: "ads" as const, amount: p.adCost },
    { key: "ship" as const, amount: p.shipCost },
  ];
  const top = costs.reduce((a, b) => (b.amount > a.amount ? b : a), costs[0]);
  const share = (n: number) => (p.revenue > 0 ? n / p.revenue : null);
  return {
    orders: p.orders,
    revenuePerOrder: (p.revenue + p.shippingIn) / o,
    feePerOrder: p.fee / o,
    costPerOrder: p.cost / o,
    adPerOrder: p.adCost / o,
    shipPerOrder: p.shipCost / o,
    profitPerOrder: p.profit === null ? null : p.profit / o,
    margin: p.profit !== null && p.revenue > 0 ? p.profit / p.revenue : null,
    shares: { fee: share(p.fee), cost: share(p.cost), ads: share(p.adCost), ship: share(p.shipCost) },
    topCost: top.amount > 0 ? top : null,
    priceGap: p.breakEvenPrice !== null && p.avgPrice !== null ? p.breakEvenPrice - p.avgPrice : null,
    profitableWithoutAds: p.profit !== null && p.profit < 0 && p.adCost > 0 && p.profit + p.adCost >= 0,
  };
}
