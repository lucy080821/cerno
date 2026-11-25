"use client";

import Link from "next/link";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { isOrdersSource, MAX_SOURCES, sourceLabel, type SourceOption } from "@/lib/ai-chat/client";
import styles from "./ai.module.css";

interface Props {
  /** null = đang tải. */
  sources: SourceOption[] | null;
  selected: string[];
  onPick(id: string): void;
}

/** Nút "Nguồn dữ liệu (n/5)" mở danh sách chọn (tối đa 5) và các chip nguồn đang chọn. Nằm trong thanh công cụ của ô nhập. */
export function SourcePicker({ sources, selected, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const byId = new Map((sources ?? []).map((s) => [s.id, s]));
  const chosen = selected.map((id) => byId.get(id)).filter((s): s is SourceOption => !!s);
  return (
    <div className={styles.srcRow}>
      <div className={styles.pickerWrap}>
        <button type="button" className={styles.srcBtn} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Nguồn dữ liệu ({selected.length}/{MAX_SOURCES}) ▾
        </button>
        {open && (
          <>
            <div className={styles.backdrop} onClick={() => setOpen(false)} />
            <div className={styles.picker} role="listbox">
              {sources === null ? (
                <div className={styles.histNote}><Spinner size={18} label="Đang tải…" /></div>
              ) : sources.length === 0 ? (
                <div className={styles.histNote}>Chưa có nguồn dữ liệu. <Link href="/sources">Thêm nguồn</Link></div>
              ) : (
                sources.map((s) => {
                  const on = selected.includes(s.id);
                  const full = !on && selected.length >= MAX_SOURCES;
                  return (
                    <label key={s.id} className={`${styles.pickItem} ${full ? styles.pickOff : ""}`}>
                      <input type="checkbox" checked={on} disabled={full} onChange={() => onPick(s.id)} />
                      <span className={styles.pickName} data-i18n-skip>{sourceLabel(s)}</span>
                      <span className={styles.pickKind}>{isOrdersSource(s) ? "Đơn hàng" : "Google Sheet"}</span>
                    </label>
                  );
                })
              )}
              <div className={styles.pickHint}>{`Chọn tối đa ${MAX_SOURCES} nguồn. AI chỉ đọc số liệu, không sửa dữ liệu.`}</div>
            </div>
          </>
        )}
      </div>
      {chosen.map((s) => (
        <span key={s.id} className={styles.chip}>
          <span data-i18n-skip>{sourceLabel(s)}</span>
          <button type="button" aria-label="Bỏ nguồn này" onClick={() => onPick(s.id)}>×</button>
        </span>
      ))}
    </div>
  );
}
