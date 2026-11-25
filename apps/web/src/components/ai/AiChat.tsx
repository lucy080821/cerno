"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { useDialog } from "@/components/ui/DialogProvider";
import { useShell } from "@/lib/shell/store";
import {
  defaultSelection, isOrdersSource, MAX_SOURCES, parseEvent, reportBlocks, sourceLabel, splitLines, toggleSource,
  type ChatSummary, type Msg, type SourceOption,
} from "@/lib/ai-chat/client";
import { visualsOf, type Visual } from "@/lib/ai-chat/visual";
import { Visuals } from "./ChatVisual";
import styles from "./ai.module.css";

const SAVED_KEY = "cerno.ai.sources";

const SUGGESTIONS = [
  "Tháng này lãi lỗ ra sao? Phân tích chi tiết theo từng kênh.",
  "Sản phẩm nào đang lỗ và nguyên nhân chính là gì?",
  "So sánh doanh thu và lãi tháng này với tháng trước.",
  "Chi phí quảng cáo có đang ăn hết lãi không?",
  "Tỷ lệ hủy và hoàn trả theo từng kênh, kênh nào đáng lo nhất?",
  "Top 10 sản phẩm bán chạy nhất và biên lãi của từng sản phẩm.",
  "Vẽ biểu đồ doanh thu và lãi theo ngày trong 30 ngày gần nhất.",
  "Hiện thẻ KPI: tổng doanh thu thực, lãi, số đơn và tỷ lệ hủy tháng này.",
];

const readSaved = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const writeSaved = (ids: string[]) => {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(ids));
  } catch {
    /* localStorage bị chặn */
  }
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    // Có hạn chờ: máy chủ treo thì báo lỗi cho người dùng thử lại thay vì quay mãi.
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function Report({ text }: { text: string }) {
  const blocks = useMemo(() => reportBlocks(text), [text]);
  return (
    <div className={styles.report} data-i18n-skip>
      {blocks.map((b, i) =>
        b.kind === "gap" ? <div key={i} className={styles.gap} /> :
        b.kind === "title" ? <div key={i} className={styles.rTitle}>{b.text}</div> :
        b.kind === "scope" ? <div key={i} className={styles.rScope}>{b.text}</div> :
        b.kind === "heading" ? <div key={i} className={styles.rHead}>{b.text}</div> :
        b.kind === "item" ? <div key={i} className={styles.rItem}><span aria-hidden>–</span><span>{b.text}</span></div> :
        <div key={i} className={styles.rPara}>{b.text}</div>,
      )}
    </div>
  );
}

/** Trang chat với AI về số liệu: lịch sử bên trái, chọn nguồn ngay ở khung nhập, câu trả lời dạng báo cáo chữ thuần. */
export interface AiChatProps {
  /** "dock" = khung chat nhỏ bên phải mọi trang (lịch sử thành danh sách thả xuống); "page" = trang /ai toàn màn hình. */
  variant?: "page" | "dock";
  /** Mô tả trang người dùng đang xem (vd "Lãi lỗ, khoảng 01/11 đến 24/11") để AI hiểu "ở đây", "tháng này". */
  context?: string;
  /** Nhận câu hỏi từ ô tìm kiếm ("Hỏi AI: ..."). Chỉ MỘT khung được nhận cùng lúc. */
  listenAsk?: boolean;
  onClose?: () => void;
}

export function AiChat({ variant = "page", context, listenAsk = true, onClose }: AiChatProps = {}) {
  const dock = variant === "dock";
  const ask = useShell((st) => st.ask);
  const clearAsk = useShell((st) => st.clearAsk);
  const dialog = useDialog();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [sources, setSources] = useState<SourceOption[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [visuals, setVisuals] = useState<Visual[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<{ message: string; question: string } | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lang = typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "vi";

  const refreshChats = useCallback(async (): Promise<boolean> => {
    const r = await getJson<{ chats: ChatSummary[] }>("/api/ai/chats");
    if (r) setChats(r.chats);
    else setChats((cur) => cur ?? []);
    return r !== null;
  }, []);

  /** Tải lịch sử và danh sách nguồn; một trong hai lỗi thì báo và cho thử lại (không để vòng quay chạy mãi). */
  const loadAll = useCallback(async () => {
    setLoadFailed(false);
    const [chatsOk, src] = await Promise.all([refreshChats(), getJson<{ sources: SourceOption[] }>("/api/sources")]);
    if (src) {
      setSources(src.sources);
      setSelected(defaultSelection(readSaved(), src.sources));
    }
    if (!chatsOk || !src) setLoadFailed(true);
  }, [refreshChats]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, draft, status, error, visuals]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const byId = useMemo(() => new Map((sources ?? []).map((s) => [s.id, s])), [sources]);

  const newChat = () => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setDraft("");
    setVisuals([]);
    setStatus("");
    setError(null);
    setBusy(false);
    setHistoryOpen(false);
    setSelected(defaultSelection(readSaved(), sources ?? []));
    taRef.current?.focus();
  };

  const openChat = async (id: string) => {
    if (id === activeId) return setHistoryOpen(false);
    abortRef.current?.abort();
    setBusy(false);
    setDraft("");
    setVisuals([]);
    setStatus("");
    setError(null);
    setHistoryOpen(false);
    setLoadingChat(true);
    const r = await getJson<{ chat: ChatSummary; messages: Msg[] }>(`/api/ai/chats/${id}`);
    setLoadingChat(false);
    if (!r) return void dialog.alert({ title: "Không mở được", message: "Không tải được cuộc trò chuyện này, hãy thử lại.", tone: "danger" });
    setActiveId(id);
    setMessages(r.messages);
    const existing = r.chat.sourceIds.filter((s) => byId.has(s));
    if (existing.length) setSelected(existing);
  };

  const rename = async (c: ChatSummary) => {
    const title = await dialog.prompt({ title: "Đổi tên cuộc trò chuyện", label: "Tên", defaultValue: c.title, maxLength: 120, validate: (v) => (v.trim() ? null : "Hãy nhập tên") });
    if (!title?.trim() || title.trim() === c.title) return;
    const r = await fetch(`/api/ai/chats/${c.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: title.trim() }) });
    if (r.ok) setChats((cur) => cur?.map((x) => (x.id === c.id ? { ...x, title: title.trim() } : x)) ?? cur);
    else void dialog.alert({ title: "Không đổi được tên", message: "Hãy thử lại sau.", tone: "danger" });
  };

  const remove = async (c: ChatSummary) => {
    const ok = await dialog.confirm({ title: "Xóa cuộc trò chuyện?", message: `Cuộc trò chuyện "${c.title}" và toàn bộ câu trả lời sẽ bị xóa, không khôi phục được.`, confirmText: "Xóa", tone: "danger" });
    if (!ok) return;
    const r = await fetch(`/api/ai/chats/${c.id}`, { method: "DELETE" });
    if (!r.ok) return void dialog.alert({ title: "Không xóa được", message: "Hãy thử lại sau.", tone: "danger" });
    setChats((cur) => cur?.filter((x) => x.id !== c.id) ?? cur);
    if (c.id === activeId) newChat();
  };

  const pick = (id: string) => {
    setSelected((cur) => {
      const next = toggleSource(cur, id);
      writeSaved(next);
      return next;
    });
  };

  const stop = () => abortRef.current?.abort();

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    if (!selected.length) return void dialog.alert({ title: "Chưa chọn nguồn dữ liệu", message: "Hãy chọn ít nhất một nguồn dữ liệu ở nút \"Nguồn dữ liệu\" bên dưới khung nhập để AI có số liệu trả lời." });
    setInput("");
    setError(null);
    setDraft("");
    setVisuals([]);
    setStatus("");
    setBusy(true);
    setMessages((cur) => [...cur, { id: `tmp-${Date.now()}`, role: "user", content: question, meta: {}, createdAt: new Date().toISOString() }]);
    const ctl = new AbortController();
    abortRef.current = ctl;
    let finished = false;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: activeId, question, sourceIds: selected, lang, ...(context ? { context } : {}) }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError({ message: j?.error ?? "Không gọi được AI, hãy thử lại.", question });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const parts = splitLines(rest, dec.decode(value, { stream: true }));
        rest = parts.rest;
        for (const line of parts.lines) {
          const ev = parseEvent(line);
          if (!ev) continue;
          if (ev.t === "chat") {
            setActiveId(ev.id);
            setChats((cur) => (cur && !cur.some((c) => c.id === ev.id) ? [{ id: ev.id, title: ev.title, sourceIds: selected, updatedAt: new Date().toISOString() }, ...cur] : cur));
          } else if (ev.t === "status") setStatus(ev.v);
          else if (ev.t === "text") setDraft((d) => d + ev.v);
          else if (ev.t === "reset") setDraft("");
          else if (ev.t === "visual") setVisuals((cur) => [...cur, ev.visual]);
          else if (ev.t === "done") {
            finished = true;
            setDraft("");
            setVisuals([]);
            setStatus("");
            setMessages((cur) => [...cur, ev.message]);
          } else if (ev.t === "error") {
            finished = true;
            setDraft("");
            setVisuals([]);
            setStatus("");
            setError({ message: ev.message, question });
          }
        }
      }
      if (!finished) setError({ message: "Kết nối bị gián đoạn trước khi AI trả lời xong, hãy thử lại.", question });
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") setError({ message: "Đã dừng.", question });
      else setError({ message: "Mất kết nối tới máy chủ, hãy thử lại.", question });
    } finally {
      setBusy(false);
      setDraft("");
      setVisuals([]);
      setStatus("");
      void refreshChats();
    }
  };

  const copy = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopied(m.id);
      setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1500);
    } catch {
      void dialog.alert({ title: "Không sao chép được", message: "Trình duyệt chặn việc sao chép, hãy bôi đen và sao chép thủ công." });
    }
  };

  // Câu hỏi từ ô tìm kiếm: gửi ngay khi đã biết nguồn dữ liệu, rồi xoá để không gửi lặp.
  useEffect(() => {
    if (!listenAsk || !ask || busy || sources === null) return;
    clearAsk();
    void send(ask.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, sources, busy, listenAsk]);

  const noSources = sources !== null && sources.length === 0;
  const empty = messages.length === 0 && !busy && !loadingChat;

  return (
    <div className={`${styles.wrap} ${dock ? styles.dockWrap : ""}`}>
      <aside className={`${styles.history} ${historyOpen ? styles.historyOpen : ""}`}>
        <button type="button" className={styles.newBtn} onClick={newChat}>+ Cuộc trò chuyện mới</button>
        <div className={styles.histList}>
          {loadFailed && (
            <div className={styles.histNote} role="alert">
              Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại.{" "}
              <button type="button" className={styles.retryBtn} onClick={() => void loadAll()}>Thử lại</button>
            </div>
          )}
          {chats === null ? <div className={styles.histNote}><Spinner size={18} label="Đang tải…" /></div> : chats.length === 0 && !loadFailed ? (
            <div className={styles.histNote}>Chưa có cuộc trò chuyện nào. Câu hỏi của bạn sẽ được lưu ở đây để xem lại.</div>
          ) : chats.map((c) => (
            <div key={c.id} className={`${styles.histItem} ${c.id === activeId ? styles.histActive : ""}`}>
              <button type="button" className={styles.histMain} onClick={() => void openChat(c.id)} title={c.title} data-i18n-skip>{c.title}</button>
              <span className={styles.histActions}>
                <button type="button" aria-label="Đổi tên" title="Đổi tên" onClick={() => void rename(c)}>✎</button>
                <button type="button" aria-label="Xóa" title="Xóa" onClick={() => void remove(c)}>🗑</button>
              </span>
            </div>
          ))}
        </div>
      </aside>

      <section className={styles.chat}>
        <div className={styles.chatBar}>
          <button type="button" className={styles.histToggle} onClick={() => setHistoryOpen((o) => !o)}>☰ Lịch sử</button>
          <span className={styles.chatTitle} data-i18n-skip>{chats?.find((c) => c.id === activeId)?.title ?? ""}</span>
          {dock && (
            <span className={styles.barBtns}>
              <button type="button" onClick={newChat} title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới">＋</button>
              <Link href="/ai" title="Mở toàn màn hình" aria-label="Mở toàn màn hình">⤢</Link>
              {onClose && <button type="button" onClick={onClose} title="Đóng khung chat" aria-label="Đóng khung chat">✕</button>}
            </span>
          )}
        </div>

        <div className={styles.scroll}>
          {loadingChat ? <div className={styles.center}><Spinner size={28} label="Đang tải…" /></div> : empty ? (
            <div className={styles.emptyBox}>
              <h2>Bạn muốn biết điều gì về số liệu của mình?</h2>
              <p>Chọn nguồn dữ liệu ở khung nhập rồi hỏi bằng tiếng Việt. AI tự tra số liệu thật và trả lời dạng báo cáo: tóm tắt, số liệu chi tiết, phân tích và đề xuất hành động.</p>
              {noSources ? (
                <p>Bạn chưa có nguồn dữ liệu nào. <Link href="/sources">Thêm nguồn dữ liệu</Link> để bắt đầu.</p>
              ) : (
                <div className={styles.sugs}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className={styles.sug} onClick={() => void send(s)}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className={styles.msgs}>
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className={styles.userMsg}><div data-i18n-skip>{m.content}</div></div>
                ) : (
                  <article key={m.id} className={styles.aiMsg}>
                    <Visuals items={visualsOf(m.meta)} />
                    <Report text={m.content} />
                    <footer className={styles.aiFoot}>
                      <button type="button" onClick={() => void copy(m)}>{copied === m.id ? "Đã sao chép" : "Sao chép"}</button>
                      {m.meta.provider === "anthropic" && <span>Trả lời bởi Claude (AI nâng cao)</span>}
                      {Array.isArray(m.meta.sources) && m.meta.sources.length > 0 && <span data-i18n-skip>{(m.meta.sources as string[]).join(", ")}</span>}
                    </footer>
                  </article>
                ),
              )}
              {busy && (
                <article className={styles.aiMsg}>
                  <Visuals items={visuals} />
                  {draft ? <Report text={draft} /> : null}
                  <div className={styles.working}><Spinner size={16} label="" /><span>{status || "AI đang tra cứu số liệu…"}</span></div>
                </article>
              )}
              {error && (
                <div className={styles.errBox} role="alert">
                  <span>{error.message}</span>
                  <button type="button" onClick={() => { setInput(error.question); setError(null); taRef.current?.focus(); }}>Hỏi lại</button>
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className={styles.composer}>
          <div className={styles.composerCard}>
            <textarea
              ref={taRef}
              className={styles.input}
              rows={2}
              value={input}
              maxLength={2000}
              placeholder="Hỏi về doanh thu, lãi lỗ, sản phẩm, kênh bán, chi phí…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <div className={styles.toolbar}>
            <div className={styles.srcRow}>
              <div className={styles.pickerWrap}>
                <button type="button" className={styles.srcBtn} onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen}>
                  Nguồn dữ liệu ({selected.length}/{MAX_SOURCES}) ▾
                </button>
                {pickerOpen && (
                  <>
                    <div className={styles.backdrop} onClick={() => setPickerOpen(false)} />
                    <div className={styles.picker} role="listbox">
                      {sources === null ? <div className={styles.histNote}><Spinner size={18} label="Đang tải…" /></div> : sources.length === 0 ? (
                        <div className={styles.histNote}>Chưa có nguồn dữ liệu. <Link href="/sources">Thêm nguồn</Link></div>
                      ) : sources.map((s) => {
                        const on = selected.includes(s.id);
                        const full = !on && selected.length >= MAX_SOURCES;
                        return (
                          <label key={s.id} className={`${styles.pickItem} ${full ? styles.pickOff : ""}`}>
                            <input type="checkbox" checked={on} disabled={full} onChange={() => pick(s.id)} />
                            <span className={styles.pickName} data-i18n-skip>{sourceLabel(s)}</span>
                            <span className={styles.pickKind}>{isOrdersSource(s) ? "Đơn hàng" : "Google Sheet"}</span>
                          </label>
                        );
                      })}
                      <div className={styles.pickHint}>{`Chọn tối đa ${MAX_SOURCES} nguồn. AI chỉ đọc số liệu, không sửa dữ liệu.`}</div>
                    </div>
                  </>
                )}
              </div>
              {selected.map((id) => byId.get(id)).filter((s): s is SourceOption => !!s).map((s) => (
                <span key={s.id} className={styles.chip}>
                  <span data-i18n-skip>{sourceLabel(s)}</span>
                  <button type="button" aria-label="Bỏ nguồn này" onClick={() => pick(s.id)}>×</button>
                </span>
              ))}
            </div>
              {busy ? (
                <button type="button" className={`${styles.sendBtn} ${styles.stopBtn}`} onClick={stop}>Dừng</button>
              ) : (
                <button type="button" className={styles.sendBtn} onClick={() => void send(input)} disabled={!input.trim()}>Gửi</button>
              )}
            </div>
          </div>
          <div className={styles.fine}>Enter để gửi, Shift+Enter để xuống dòng. Số liệu do AI tra từ dữ liệu của bạn, hãy đối chiếu trước khi ra quyết định lớn.</div>
        </div>
      </section>
    </div>
  );
}
