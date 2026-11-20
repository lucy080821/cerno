"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEditor } from "@/lib/editor/store";
import { useChat } from "@/lib/editor/chat-store";
import { buildAiContext } from "@/lib/editor/ai-context";
import { widgetLabel } from "@/lib/editor/defaults";
import { Icon } from "./fields";
import { columnsWithCalc } from "@/lib/editor/calc";
import { getRows } from "@/lib/editor/sample-data";
import { useDataVersion } from "@/lib/editor/data-store";
import { buildSuggestions } from "@/lib/editor/ai-suggest";
import s from "./editor.module.css";
import { Spinner } from "@/components/Spinner";
import { addChartToDashboard } from "@/lib/editor/ai-chart";
import { StaticChart } from "./WidgetContent";

/** Markdown tối giản và an toàn (không dùng innerHTML): **đậm**, `mã`, gạch đầu dòng, danh sách số, tiêu đề. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/**
 * Model hay in số kiểu "1 234 588" (khoảng trắng hẹp/không ngắt). Đổi thành chuẩn Việt Nam "1.234.588".
 * Chỉ động vào khoảng trắng đặc biệt (U+202F, U+00A0, U+2009) giữa các nhóm đúng 3 chữ số, nên "năm 2025 100" không bị đổi.
 */
export function normalizeVnNumbers(text: string): string {
  return text
    .replace(/(?<![\d.,])(\d{1,3}(?:[\u202f\u00a0\u2009]\d{3})+)(?!\d)/g, (m) => m.replace(/[\u202f\u00a0\u2009]/g, "."))
    .replace(/(\d)[\u202f\u00a0\u2009]%/g, "$1%");
}

function RichText({ text: raw }: { text: string }) {
  const text = normalizeVnNumbers(raw);
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={blocks.length}>{list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</Tag>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) blocks.push(<p key={blocks.length}><strong>{inline(h[1])}</strong></p>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

export function ChatPanel() {
  const messages = useChat((st) => st.messages);
  const busy = useChat((st) => st.busy);
  const canEdit = useChat((st) => st.canEdit);
  const notice = useChat((st) => st.notice);
  const { send, stop, clear, setCanEdit, undoTurn, markChartAdded } = useChat.getState();
  const palette = useEditor((st) => st.doc.theme.palette);
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const selection = useEditor((st) => st.selection);
  const widgets = useEditor((st) => st.doc.widgets);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const selected = widgets.find((w) => w.id === selection[0] && selection.length === 1);
  const ask = (q: string) => {
    if (!q.trim()) return;
    setUndoNote(null);
    const st = useEditor.getState();
    send(q, async (level) => {
      const now = useEditor.getState();
      return await buildAiContext(now.doc, now.selection, now.filterValues, now.crossFilters, now.pageId, level);
    });
    setDraft("");
  };

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  // Gợi ý theo dữ liệu thật của nguồn chính: tên/kiểu cột, giá trị phổ biến, tháng mới nhất, và chỉ đề nghị thêm cái chưa có.
  const doc = useEditor((st) => st.doc);
  const filters = useEditor((st) => st.doc.filters);
  const dataVersion = useDataVersion();
  const hasForecast = selected?.config.kind === "chart" && !!selected.config.format?.forecast;
  const suggestions = useMemo(() => {
    const sourceId = doc.sources[0]?.id;
    const columns = sourceId ? columnsWithCalc(doc, sourceId).map((c) => ({ name: c.name, type: c.type })) : [];
    const rows = sourceId ? getRows(sourceId) : [];
    return buildSuggestions({
      columns,
      rows,
      widgets: doc.widgets.map((w) =>
        w.config.kind === "chart"
          ? { kind: "chart", chartType: w.config.chartType, dimensions: w.config.dimensions.map((d) => d.column), metrics: w.config.metrics.map((m) => m.column) }
          : w.config.kind === "kpi"
            ? { kind: "kpi", dimensions: [], metrics: [w.config.metric.column] }
            : { kind: w.config.kind, dimensions: [], metrics: [] },
      ),
      filterColumns: filters.map((f) => f.column),
      selected: selected ? { label: widgetLabel(selected), hasForecast } : null,
      canEdit,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.sources, doc.widgets, doc.calculatedFields, filters, selected, hasForecast, canEdit, dataVersion]);

  return (
    <div className={s.chat}>
      <div className={s.chatHead}>
        <span className={s.chatLogo} aria-hidden><Icon name="sparkle" size={16} /></span>
        <span className={s.chatTitle} title="AI luôn thấy cấu trúc dashboard và số liệu đã gộp, kể cả bộ lọc đang bật">
          <b>Trợ lý AI</b>
          <span className={s.chatScope}>{selected ? `Đang chọn: ${widgetLabel(selected)}` : "Cả dashboard"}</span>
        </span>
        {messages.length > 0 && (
          <button className={s.iconBtn} title="Cuộc trò chuyện mới" onClick={clear}><Icon name="reset" size={14} /></button>
        )}
      </div>
      <label className={s.chatEdit} title="Khi bật, AI có thể thêm/sửa/xoá widget, bộ lọc và thiết lập. Mọi thay đổi đều hoàn tác được.">
        <input type="checkbox" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} />
        <span>Cho phép AI sửa dashboard</span>
      </label>

      <div className={s.chatList} aria-live="polite">
        {messages.length === 0 && (
          <div className={s.chatEmpty}>
            <p>Hỏi AI về dữ liệu, biểu đồ hoặc cả dashboard.</p>
            <div className={s.chatSuggest}>
              {suggestions.map((q) => <button key={q} className={s.suggestBtn} onClick={() => ask(q)}>{q}</button>)}
            </div>
            <details className={s.chatInfo}>
              <summary><Icon name="info" size={13} /><span>Dữ liệu gửi cho AI</span></summary>
              <p>
                Chỉ số liệu đã gộp và vài dòng mẫu được gửi tới dịch vụ AI (Groq), không gửi toàn bộ dữ liệu. AI có thể sai, hãy kiểm tra lại số quan trọng.
              </p>
            </details>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`${s.msg} ${m.role === "user" ? s.msgUser : s.msgBot} ${m.error ? s.msgErr : ""}`}>
            {m.role === "assistant" && !m.content && !m.actions?.length && !m.charts?.length && busy
              ? <span className={s.typing}><Spinner size={12} inline />Đang phân tích…</span>
              : m.content ? <RichText text={m.content} /> : null}
            {m.role === "assistant" && m.provider === "anthropic" && !m.error && (
              <p className={s.hint} title="Câu trả lời này dùng AI trả phí và tính vào hạn mức lượt AI nâng cao của bạn.">
                Trả lời bởi Claude (AI nâng cao)
              </p>
            )}
            {m.charts?.map((ch) => (
              <div key={ch.id} className={s.chatChartCard}>
                <div className={s.chatChartTitle}>{ch.config.title}</div>
                <StaticChart config={ch.config} table={ch.table} palette={palette} />
                {ch.groups > ch.table.rows.length && (
                  <p className={s.hint}>Chỉ hiện {ch.table.rows.length}/{ch.groups} nhóm đầu.</p>
                )}
                {ch.filtered && <p className={s.hint}>Số liệu đã áp bộ lọc đang bật của dashboard.</p>}
                {ch.newFields.length > 0 && !ch.added && (
                  <p className={s.hint}>
                    Thêm vào dashboard sẽ tạo kèm trường tính toán: {ch.newFields.map((f) => `«${f.name}»`).join(", ")}.
                  </p>
                )}
                <button
                  className={`${s.smallBtn} ${ch.added ? "" : s.sendBtn}`}
                  disabled={ch.added || busy}
                  onClick={() => {
                    const err = addChartToDashboard(ch);
                    if (err) setUndoNote(err);
                    else {
                      setUndoNote(null);
                      markChartAdded(m.id, ch.id);
                    }
                  }}
                >
                  {ch.added ? "Đã thêm vào dashboard ✓" : "Thêm vào dashboard"}
                </button>
              </div>
            ))}
            {m.actions && m.actions.length > 0 && (
              <div className={s.actionLog}>
                <div className={s.actionTitle}>Thay đổi đã thực hiện</div>
                <ul>
                  {m.actions.map((a, i) => (
                    <li key={i} className={a.ok ? s.actionOk : s.actionBad}>{a.ok ? "✓" : "✕"} {a.label}</li>
                  ))}
                </ul>
                {m.undo && (
                  <button
                    className={s.smallBtn}
                    disabled={m.undo.done || busy}
                    onClick={() => setUndoNote(undoTurn(m.id))}
                  >
                    {m.undo.done ? "Đã hoàn tác" : "Hoàn tác"}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {notice && <p className={s.chatNote} style={{ color: "var(--muted)" }} role="status">{notice}</p>}
      {undoNote && <p className={s.chatNote} role="alert">{undoNote}</p>}
      <form className={s.chatForm} onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        <textarea
          className={`${s.input} ${s.chatInput}`}
          value={draft}
          rows={2}
          placeholder="Hỏi về dữ liệu… (Enter để gửi, Shift+Enter xuống dòng)"
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(draft); }
          }}
        />
        {busy
          ? <button type="button" className={s.smallBtn} onClick={stop}>Dừng</button>
          : <button type="submit" className={`${s.smallBtn} ${s.sendBtn}`} disabled={!draft.trim()}>Gửi</button>}
      </form>
    </div>
  );
}
