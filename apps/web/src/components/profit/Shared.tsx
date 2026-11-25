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
      <span>Tải file đơn hàng Excel/CSV từ Shopee, TikTok Shop hoặc sổ bán hàng của bạn, hoặc nối một Google Sheet đơn hàng (dán dữ liệu mới xuống dưới, Cerno tự cập nhật), ở trang Nguồn dữ liệu.</span>
      <Link href="/sources" className={`${styles.btn} ${styles.primary}`}>Thêm dữ liệu đơn hàng</Link>
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

/** Số sản phẩm Shopee mà Cerno tự nhận diện ngành hàng (người bán chưa chọn/xác nhận). */
export const autoCategoryCount = (fees: { platforms?: Record<string, { suggestions?: Record<string, unknown>; categories?: Record<string, { ai?: boolean }> }> } | undefined): number =>
  Object.values(fees?.platforms ?? {}).reduce((n, p) => n + Object.keys(p.suggestions ?? {}).length + Object.values(p.categories ?? {}).filter((c) => c.ai).length, 0);

/** Nhắc khi có đơn dùng phí sàn ước tính (file không có phí). `auto` = số sản phẩm có ngành hàng do Cerno tự nhận diện. */
export function FeeEstimateNote({ count, auto = 0 }: { count: number; auto?: number }) {
  if (!count) return null;
  return (
    <div className={styles.note}>
      <b>{count.toLocaleString("vi-VN")}</b> đơn dùng phí sàn <b>ước tính</b> (theo biểu phí Shopee, TikTok Shop hoặc tỷ lệ bạn nhập) vì file đơn hàng không có phí. Số thật nằm ở báo cáo thu nhập hoặc đối soát của sàn. Bật hoặc chỉnh ở trang{" "}
      <Link href="/products">Sản phẩm và giá vốn</Link>.
      {auto > 0 && (
        <>
          {" "}Ngành hàng của <b>{auto.toLocaleString("vi-VN")}</b> sản phẩm do Cerno tự nhận diện hoặc AI phân từ tên sản phẩm; nếu thấy chưa đúng, bạn đổi ở trang Sản phẩm và giá vốn.
        </>
      )}
    </div>
  );
}

/** Nhắc khi có đơn dùng phí ship shop chịu ước tính (mức trung bình người dùng nhập). */
export function ShipEstimateNote({ count }: { count: number }) {
  if (!count) return null;
  return (
    <div className={styles.note}>
      <b>{count.toLocaleString("vi-VN")}</b> đơn đang trừ phí ship shop chịu theo mức trung bình bạn nhập, không phải số thật của từng đơn. Chỉnh ở trang <Link href="/costs">Chi phí</Link>.
    </div>
  );
}
