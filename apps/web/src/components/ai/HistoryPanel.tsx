"use client";

import { Spinner } from "@/components/Spinner";
import type { ChatSummary } from "@/lib/ai-chat/client";
import styles from "./ai.module.css";

interface Props {
  chats: ChatSummary[] | null;
  activeId: string | null;
  /** Tải lịch sử hoặc nguồn bị lỗi/quá hạn: hiện thông báo kèm nút thử lại. */
  loadFailed: boolean;
  /** Ngăn kéo lịch sử đang mở (màn hẹp, khung chat nhỏ). */
  open: boolean;
  onNew(): void;
  onOpen(id: string): void;
  onRename(c: ChatSummary): void;
  onRemove(c: ChatSummary): void;
  onRetry(): void;
}

/** Cột lịch sử các cuộc trò chuyện; cuộc đang mở được tô nổi. */
export function HistoryPanel({ chats, activeId, loadFailed, open, onNew, onOpen, onRename, onRemove, onRetry }: Props) {
  return (
    <aside className={`${styles.history} ${open ? styles.historyOpen : ""}`}>
      <button type="button" className={styles.newBtn} onClick={onNew}>+ Cuộc trò chuyện mới</button>
      <div className={styles.histList}>
        {loadFailed && (
          <div className={styles.histNote} role="alert">
            Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại.{" "}
            <button type="button" className={styles.retryBtn} onClick={onRetry}>Thử lại</button>
          </div>
        )}
        {chats === null ? (
          <div className={styles.histNote}><Spinner size={18} label="Đang tải…" /></div>
        ) : chats.length === 0 && !loadFailed ? (
          <div className={styles.histNote}>Chưa có cuộc trò chuyện nào. Câu hỏi của bạn sẽ được lưu ở đây để xem lại.</div>
        ) : (
          chats.map((c) => (
            <div key={c.id} className={`${styles.histItem} ${c.id === activeId ? styles.histActive : ""}`}>
              <button type="button" className={styles.histMain} onClick={() => onOpen(c.id)} title={c.title} data-i18n-skip>{c.title}</button>
              <span className={styles.histActions}>
                <button type="button" aria-label="Đổi tên" title="Đổi tên" onClick={() => onRename(c)}>✎</button>
                <button type="button" aria-label="Xóa" title="Xóa" onClick={() => onRemove(c)}>🗑</button>
              </span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
