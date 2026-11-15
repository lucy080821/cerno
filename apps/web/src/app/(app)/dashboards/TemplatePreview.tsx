"use client";

import { useEffect } from "react";
import type { TemplateEntry } from "@/content/templates";
import { TemplateViewerLazy } from "@/components/templates/TemplateViewerLazy";
import dash from "./dashboards.module.css";
import styles from "./template-preview.module.css";

/**
 * Xem trước một mẫu ngay tại chỗ: dashboard chạy thật trên dữ liệu mẫu để người dùng thử lọc, bấm biểu đồ rồi mới quyết
 * định có dùng không. Dữ liệu mẫu là số minh họa, không phải số liệu của người dùng.
 */
export function TemplatePreview({ entry, onClose, onUse }: { entry: TemplateEntry; onClose: () => void; onUse: () => void }) {
  const t = entry.template;
  const { width, height } = t.doc.canvas;

  useEffect(() => {
    // Pha bắt + stopPropagation: Esc chỉ đóng lớp trên cùng.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="tpl-prev-title">
        <header className={styles.head}>
          <div>
            <span className={styles.industry}>{t.industry}</span>
            <h2 id="tpl-prev-title" className={styles.title}>{t.name}</h2>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Đóng">×</button>
        </header>
        <p className={styles.note}>Dữ liệu mẫu minh họa. Bạn có thể đổi bộ lọc và bấm vào biểu đồ để thử.</p>
        <div className={styles.scroll}>
          <div className={styles.frame} style={{ ["--ratio" as string]: width / height }}>
            <TemplateViewerLazy template={t} />
          </div>
        </div>
        <footer className={styles.foot}>
          <button className={dash.ghost} onClick={onClose}>Đóng</button>
          <button className={dash.primary} onClick={onUse}>Dùng mẫu này</button>
        </footer>
      </div>
    </div>
  );
}
