import Link from "next/link";
import type { ReactNode } from "react";
import { Spinner } from "@/components/Spinner";
import styles from "./profit.module.css";

export function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${tone === "pos" ? styles.pos : tone === "neg" ? styles.neg : ""}`}>{value}</div>
      {note && <div className={styles.kpiNote}>{note}</div>}
    </div>
  );
}

export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{title}</h2>
        {aside && <span className={styles.small}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** Chưa có nguồn đơn hàng: hướng dẫn tải file. */
export function NoOrders() {
  return (
    <div className={styles.empty}>
      <b style={{ color: "var(--text)", fontSize: "1.05rem" }}>Chưa có dữ liệu đơn hàng</b>
      <span>Tải file đơn hàng Excel/CSV từ Shopee, TikTok Shop hoặc sổ bán hàng của bạn ở trang Dashboard, mục Nguồn dữ liệu.</span>
      <Link href="/dashboards" className={`${styles.btn} ${styles.primary}`}>Tải file đơn hàng</Link>
    </div>
  );
}

export function Loading() {
  return (
    <div className={styles.empty}>
      <Spinner size={32} label="Đang tính lãi từng đơn…" />
    </div>
  );
}

export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className={styles.warn}>
      <span style={{ flex: 1 }}>{message}</span>
      {retry && <button className={styles.btn} onClick={retry}>Thử lại</button>}
    </div>
  );
}

/** Nhắc khi còn đơn chưa có giá vốn (số liệu lãi chỉ tính trên đơn đã đủ dữ liệu). */
export function MissingCostNote({ missing, total }: { missing: number; total: number }) {
  if (!missing) return null;
  return (
    <div className={styles.warn}>
      <span style={{ flex: 1 }}>
        <b>{missing.toLocaleString("vi-VN")}</b> trên <b>{total.toLocaleString("vi-VN")}</b> đơn chưa tính được lãi vì sản phẩm chưa có giá vốn. Các số liệu lãi bên dưới chỉ tính trên những đơn đã đủ dữ liệu.
      </span>
      <Link href="/products?filter=missing" className={`${styles.btn} ${styles.primary}`}>Nhập giá vốn</Link>
    </div>
  );
}

/** Nhắc khi có đơn dùng phí sàn ước tính (file không có phí). */
export function FeeEstimateNote({ count }: { count: number }) {
  if (!count) return null;
  return (
    <div className={styles.note}>
      <b>{count.toLocaleString("vi-VN")}</b> đơn dùng phí sàn <b>ước tính</b> theo biểu phí Shopee vì file đơn hàng không có phí. Số thật nằm ở Báo cáo thu nhập của Shopee. Bật hoặc chỉnh ở trang{" "}
      <Link href="/products">Sản phẩm và giá vốn</Link>.
    </div>
  );
}
