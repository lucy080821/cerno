"use client";

import { Fragment, useMemo } from "react";
import { reportBlocks } from "@/lib/ai-chat/client";
import { autoHighlight, splitHighlights, usesHighlights, type Segment } from "@/lib/ai-chat/highlight";
import styles from "./ai.module.css";

/** Một dòng chữ với các chỉ số chính được làm nổi bằng nét bút dạ quang. */
function Rich({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) => (s.hot ? <mark key={i} className={styles.hl}>{s.text}</mark> : <Fragment key={i}>{s.text}</Fragment>))}
    </>
  );
}

const isSummary = (heading: string) => /TÓM TẮT|SUMMARY/i.test(heading);

/**
 * Câu trả lời dạng báo cáo chữ thuần. Chỉ số chính do AI đánh dấu bằng ⟦ ⟧ được làm nổi; tin cũ hoặc AI quên đánh dấu thì tự làm nổi
 * các con số kèm đơn vị trong mục TÓM TẮT để người đọc vẫn thấy ngay kết quả.
 */
export function Report({ text }: { text: string }) {
  const blocks = useMemo(() => reportBlocks(text), [text]);
  const marked = usesHighlights(text);
  let inSummary = false;
  return (
    <div className={styles.report} data-i18n-skip>
      {blocks.map((b, i) => {
        if (b.kind === "heading") inSummary = isSummary(b.text);
        const segs = (): Segment[] => (marked ? splitHighlights(b.text) : inSummary ? autoHighlight(b.text) : [{ text: b.text, hot: false }]);
        switch (b.kind) {
          case "gap": return <div key={i} className={styles.gap} />;
          case "title": return <div key={i} className={styles.rTitle}>{b.text.replace(/[⟦⟧]/g, "")}</div>;
          case "scope": return <div key={i} className={styles.rScope}>{b.text.replace(/[⟦⟧]/g, "")}</div>;
          case "heading": return <div key={i} className={styles.rHead}>{b.text.replace(/[⟦⟧]/g, "")}</div>;
          case "item": return <div key={i} className={styles.rItem}><span aria-hidden>–</span><span><Rich segments={segs()} /></span></div>;
          default: return <div key={i} className={styles.rPara}><Rich segments={segs()} /></div>;
        }
      })}
    </div>
  );
}
