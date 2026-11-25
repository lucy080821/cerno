"use client";

import Link from "next/link";
import { SUGGESTIONS } from "@/lib/ai-chat/suggestions";
import styles from "./ai.module.css";

/** Màn hình trống của khung chat: lời giới thiệu và các câu gợi ý để bấm hỏi ngay (hoặc nhắc thêm nguồn khi chưa có nguồn nào). */
export function Welcome({ noSources, onAsk }: { noSources: boolean; onAsk(question: string): void }) {
  return (
    <div className={styles.emptyBox}>
      <h2>Bạn muốn biết điều gì về số liệu của mình?</h2>
      <p>Chọn nguồn dữ liệu ở khung nhập rồi hỏi bằng tiếng Việt. AI tự tra số liệu thật và trả lời dạng báo cáo: tóm tắt, số liệu chi tiết, phân tích và đề xuất hành động.</p>
      {noSources ? (
        <p>Bạn chưa có nguồn dữ liệu nào. <Link href="/sources">Thêm nguồn dữ liệu</Link> để bắt đầu.</p>
      ) : (
        <div className={styles.sugs}>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className={styles.sug} onClick={() => onAsk(s)}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
