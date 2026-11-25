"use client";

import type { RefObject } from "react";
import type { SourceOption } from "@/lib/ai-chat/client";
import { SourcePicker } from "./SourcePicker";
import styles from "./ai.module.css";

interface Props {
  value: string;
  onChange(v: string): void;
  onSend(): void;
  onStop(): void;
  busy: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  sources: SourceOption[] | null;
  selected: string[];
  onPickSource(id: string): void;
}

/** Ô nhập dạng thẻ: chữ ở trên, thanh công cụ (chọn nguồn + Gửi/Dừng) ở dưới. Enter gửi, Shift+Enter xuống dòng. */
export function Composer({ value, onChange, onSend, onStop, busy, textareaRef, sources, selected, onPickSource }: Props) {
  return (
    <div className={styles.composer}>
      <div className={styles.composerCard}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          rows={2}
          value={value}
          maxLength={2000}
          placeholder="Hỏi về doanh thu, lãi lỗ, sản phẩm, kênh bán, chi phí…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <div className={styles.toolbar}>
          <SourcePicker sources={sources} selected={selected} onPick={onPickSource} />
          {busy ? (
            <button type="button" className={`${styles.sendBtn} ${styles.stopBtn}`} onClick={onStop}>Dừng</button>
          ) : (
            <button type="button" className={styles.sendBtn} onClick={onSend} disabled={!value.trim()}>Gửi</button>
          )}
        </div>
      </div>
      <div className={styles.fine}>Enter để gửi, Shift+Enter để xuống dòng. Số liệu do AI tra từ dữ liệu của bạn, hãy đối chiếu trước khi ra quyết định lớn.</div>
    </div>
  );
}
