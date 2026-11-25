"use client";

import type { RefObject } from "react";
import { Spinner } from "@/components/Spinner";
import type { Msg } from "@/lib/ai-chat/client";
import { visualsOf, type Visual } from "@/lib/ai-chat/visual";
import { Visuals } from "./ChatVisual";
import { Report } from "./Report";
import styles from "./ai.module.css";

export interface LiveAnswer {
  /** Chữ đang được viết. */
  draft: string;
  /** Biểu đồ/thẻ KPI đã có trong lượt đang chạy. */
  visuals: Visual[];
  /** Dòng trạng thái ("Đang tính doanh thu…"). */
  status: string;
}

interface Props {
  messages: Msg[];
  /** Có khi AI đang trả lời. */
  live: LiveAnswer | null;
  error: { message: string; question: string } | null;
  copiedId: string | null;
  onCopy(m: Msg): void;
  onRetry(question: string): void;
  endRef: RefObject<HTMLDivElement | null>;
}

/** Cuộc trò chuyện: câu hỏi (bong bóng bên phải), câu trả lời (hình + báo cáo + thanh công cụ), câu đang viết dở và lỗi. */
export function MessageList({ messages, live, error, copiedId, onCopy, onRetry, endRef }: Props) {
  return (
    <div className={styles.msgs}>
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className={styles.userMsg}><div data-i18n-skip>{m.content}</div></div>
        ) : (
          <article key={m.id} className={styles.aiMsg}>
            <Visuals items={visualsOf(m.meta)} />
            <Report text={m.content} />
            <footer className={styles.aiFoot}>
              <button type="button" onClick={() => onCopy(m)}>{copiedId === m.id ? "Đã sao chép" : "Sao chép"}</button>
              {m.meta.provider === "anthropic" && <span>Trả lời bởi Claude (AI nâng cao)</span>}
              {Array.isArray(m.meta.sources) && m.meta.sources.length > 0 && <span data-i18n-skip>{(m.meta.sources as string[]).join(", ")}</span>}
            </footer>
          </article>
        ),
      )}
      {live && (
        <article className={styles.aiMsg}>
          <Visuals items={live.visuals} />
          {live.draft ? <Report text={live.draft} /> : null}
          <div className={styles.working}><Spinner size={16} label="" /><span>{live.status || "AI đang tra cứu số liệu…"}</span></div>
        </article>
      )}
      {error && (
        <div className={styles.errBox} role="alert">
          <span>{error.message}</span>
          <button type="button" onClick={() => onRetry(error.question)}>Hỏi lại</button>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
