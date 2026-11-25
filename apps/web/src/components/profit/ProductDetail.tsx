"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { ProductProfit } from "@/lib/profit/order-profit";
import { productInsight } from "@/lib/profit/product-insight";
import { Waterfall } from "./charts";
import { count, pct, signed, vnd } from "./format";
import styles from "./profit.module.css";

/** Câu "khoản chi lớn nhất" viết sẵn từng loại để dịch được (phần thay đổi chỉ là con số). */
const TOP_COST = {
  fee: (s: string) => `Khoản chi lớn nhất là phí sàn (${s} doanh thu). `,
  cost: (s: string) => `Khoản chi lớn nhất là giá vốn (${s} doanh thu). `,
  ads: (s: string) => `Khoản chi lớn nhất là quảng cáo (${s} doanh thu). `,
  ship: (s: string) => `Khoản chi lớn nhất là phí ship shop chịu (${s} doanh thu). `,
} as const;

/**
 * Xem nhanh MỘT sản phẩm trong hộp thoại (giống ngăn chi tiết của một đơn nhưng cho cả sản phẩm): tiền của mỗi đơn đi đâu, tổng hợp theo kênh/SKU,
 * giá hòa vốn và vì sao lỗ. Số liệu lấy từ `ProductProfit` đã có sẵn nên mở ngay, không gọi thêm máy chủ.
 */
export function ProductDetailModal({ p, onClose }: { p: ProductProfit; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const i = productInsight(p);
  const loss = p.profit !== null && p.profit < 0;
  const items = [
    { label: "Doanh thu", value: i.revenuePerOrder, kind: "total" as const },
    { label: "Phí sàn", value: i.feePerOrder, kind: "neg" as const },
    { label: "Giá vốn", value: i.costPerOrder, kind: "neg" as const },
    { label: "Quảng cáo", value: i.adPerOrder, kind: "neg" as const },
    ...(p.shipCost > 0 ? [{ label: "Ship shop chịu", value: i.shipPerOrder, kind: "neg" as const }] : []),
    { label: "Lãi", value: 0, kind: "result" as const },
  ];
  const seek = encodeURIComponent(p.sku ?? p.name);

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Xem nhanh sản phẩm" style={{ width: "min(560px, 100%)", overflowY: "auto" }}>
        <div className={styles.dialogHead}>
          <div>
            <div className={styles.small}>Xem nhanh sản phẩm</div>
            <h2 data-i18n-skip>{p.name}</h2>
            {p.sku && p.sku !== p.name && <div className={styles.small} data-i18n-skip>{`SKU ${p.sku}`}</div>}
          </div>
          <button className={styles.btn} onClick={onClose}>Đóng</button>
        </div>

        <div className={styles.toolbar}>
          {p.channels.map((c) => <span key={c} className={styles.platformTag} data-platform={c} data-i18n-skip>{c}</span>)}
          <span className={`${styles.badge} ${p.profit === null ? styles.bWarn : loss ? styles.bNeg : styles.bPos}`}>
            {p.profit === null ? "Chưa có giá vốn" : loss ? "Lỗ mỗi đơn" : "Có lãi"}
          </span>
        </div>

        <div>
          <div className={styles.small}>Lãi mỗi đơn</div>
          {i.profitPerOrder === null ? (
            <div className={styles.warn} style={{ margin: "6px 0" }}>
              <span style={{ flex: 1 }}>Sản phẩm chưa có giá vốn nên chưa tính được lãi.</span>
              <Link href="/products?filter=missing" className={styles.btn}>Nhập giá vốn</Link>
            </div>
          ) : (
            <>
              <div className={`${styles.bigProfit} ${i.profitPerOrder < 0 ? styles.neg : styles.pos}`}>{signed(i.profitPerOrder)}</div>
              <div className={styles.small} style={{ marginBottom: 6 }}>{`Biên lãi ${pct(i.margin)} · tổng ${signed(p.profit ?? 0)} trên ${count(p.orders)} đơn`}</div>
              <Waterfall items={items} height={200} fmt={(n) => `${Math.round(n / 1000).toLocaleString("vi-VN")}K`} />
            </>
          )}
        </div>

        <table className={styles.lines}>
          <tbody>
            <tr><td>Đã bán</td><td className={styles.r}><b>{`${count(p.quantity)} cái · ${count(p.orders)} đơn`}</b></td></tr>
            <tr><td>Giá bán trung bình / cái</td><td className={styles.r}><b>{vnd(p.avgPrice)}</b></td></tr>
            <tr><td>Giá vốn / cái</td><td className={styles.r}>{p.unitCost === null ? "chưa có" : vnd(p.unitCost)}</td></tr>
            <tr><td>Giá hòa vốn / cái</td><td className={styles.r}><b>{vnd(p.breakEvenPrice)}</b></td></tr>
            <tr><td>Doanh thu thực</td><td className={styles.r}>{vnd(p.revenue)}</td></tr>
            <tr><td>Phí vận chuyển khách trả</td><td className={`${styles.r} ${styles.pos}`}>+{vnd(p.shippingIn)}</td></tr>
            <tr><td>Phí sàn</td><td className={`${styles.r} ${styles.neg}`}>-{vnd(p.fee)}{i.shares.fee !== null && <span className={styles.muted}>{` (${pct(i.shares.fee, 0)} doanh thu)`}</span>}</td></tr>
            <tr><td>Giá vốn</td><td className={`${styles.r} ${styles.neg}`}>-{vnd(p.cost)}{i.shares.cost !== null && <span className={styles.muted}>{` (${pct(i.shares.cost, 0)})`}</span>}</td></tr>
            <tr><td>Quảng cáo</td><td className={`${styles.r} ${styles.neg}`}>-{vnd(p.adCost)}{i.shares.ads !== null && <span className={styles.muted}>{` (${pct(i.shares.ads, 0)})`}</span>}</td></tr>
            {p.shipCost > 0 && <tr><td>Phí ship shop chịu<span className={styles.muted}> (ước tính)</span></td><td className={`${styles.r} ${styles.neg}`}>-{vnd(p.shipCost)}</td></tr>}
            <tr><td><b>Tổng lãi</b></td><td className={styles.r}>{p.profit === null ? "—" : <b className={p.profit < 0 ? styles.neg : styles.pos}>{signed(p.profit)}</b>}</td></tr>
          </tbody>
        </table>

        {loss && (
          <div className={styles.note}>
            <b>Vì sao đang lỗ:</b>{" "}
            {i.priceGap !== null && i.priceGap > 0 && <>{`Giá bán trung bình ${vnd(p.avgPrice)} thấp hơn giá hòa vốn ${vnd(p.breakEvenPrice)} (thiếu ${vnd(i.priceGap)} mỗi cái). `}</>}
            {i.topCost && i.shares[i.topCost.key] !== null && <>{TOP_COST[i.topCost.key](pct(i.shares[i.topCost.key], 0))}</>}
            {i.profitableWithoutAds ? "Nếu không chạy quảng cáo cho sản phẩm này thì nó đã có lãi. " : ""}
            Tăng giá, giảm voucher hoặc quảng cáo cho sản phẩm này.
          </div>
        )}

        <div className={styles.toolbar}>
          <Link href={p.costMissing ? "/products?filter=missing" : "/products"} className={styles.btn}>Mở Sản phẩm và giá vốn</Link>
          <Link href={`/orders?q=${seek}`} className={styles.btn}>Xem đơn hàng</Link>
        </div>
      </div>
    </div>
  );
}
