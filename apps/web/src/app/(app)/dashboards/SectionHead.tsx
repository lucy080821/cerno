import type { ReactNode } from "react";
import styles from "./dashboards.module.css";

type Kind = "dash" | "source" | "shared";

const ICON: Record<Kind, string> = {
  dash: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  source: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  shared: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21a8 8 0 0 1 16 0",
};

/** Lớp đặt cho khung của mục: mỗi loại mục một màu nhấn riêng để phân biệt ngay khi nhìn lướt. */
export const sectionClass = (kind: Kind) =>
  `${styles.section} ${kind === "dash" ? styles.kDash : kind === "source" ? styles.kSource : styles.kShared}`;

/** Đầu một mục: biểu tượng có màu, tiêu đề, số lượng, mô tả và các nút hành động ở bên phải. */
export function SectionHead({
  kind, title, count, desc, actions,
}: { kind: Kind; title: string; count?: number; desc: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.secHead}>
      <span className={styles.secIcon} aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d={ICON[kind]} />
        </svg>
      </span>
      <div className={styles.secText}>
        <h2 className={styles.secTitle}>
          {title}
          {count !== undefined && <span className={styles.secCount}>{count}</span>}
        </h2>
        <p className={styles.muted}>{desc}</p>
      </div>
      {actions && <div className={styles.secActions}>{actions}</div>}
    </div>
  );
}
