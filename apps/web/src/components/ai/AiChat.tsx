"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { useDialog } from "@/components/ui/DialogProvider";
import { getJson, sendJson } from "@/lib/ai-chat/api";
import type { ChatSummary, Msg } from "@/lib/ai-chat/client";
import { stripHighlights } from "@/lib/ai-chat/highlight";
import { streamAnswer } from "@/lib/ai-chat/stream";
import type { Visual } from "@/lib/ai-chat/visual";
import { useShell } from "@/lib/shell/store";
import { Composer } from "./Composer";
import { HistoryPanel } from "./HistoryPanel";
import { MessageList } from "./MessageList";
import { useChatLists } from "./use-chat-lists";
import { Welcome } from "./Welcome";
import styles from "./ai.module.css";

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
  const { chats, setChats, sources, selected, setSelected, loadFailed, loadAll, refreshChats, pick, resetSelection, byId } = useChatLists();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Phần đang viết dở của câu trả lời: chữ, hình và dòng trạng thái.
  const [draft, setDraft] = useState("");
  const [visuals, setVisuals] = useState<Visual[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<{ message: string; question: string; quota?: boolean } | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lang = typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "vi";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, draft, status, error, visuals]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Bỏ phần đang viết dở và hạ cờ bận (khi đổi cuộc trò chuyện hoặc kết thúc một lượt). */
  const clearLive = useCallback(() => {
    setDraft("");
    setVisuals([]);
    setStatus("");
  }, []);

  const newChat = () => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    clearLive();
    setError(null);
    setBusy(false);
    setHistoryOpen(false);
    resetSelection();
    taRef.current?.focus();
  };

  const openChat = async (id: string) => {
    if (id === activeId) return setHistoryOpen(false);
    abortRef.current?.abort();
    setBusy(false);
    clearLive();
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
    if (await sendJson("PATCH", `/api/ai/chats/${c.id}`, { title: title.trim() })) setChats((cur) => cur?.map((x) => (x.id === c.id ? { ...x, title: title.trim() } : x)) ?? cur);
    else void dialog.alert({ title: "Không đổi được tên", message: "Hãy thử lại sau.", tone: "danger" });
  };

  const remove = async (c: ChatSummary) => {
    const ok = await dialog.confirm({ title: "Xóa cuộc trò chuyện?", message: `Cuộc trò chuyện "${c.title}" và toàn bộ câu trả lời sẽ bị xóa, không khôi phục được.`, confirmText: "Xóa", tone: "danger" });
    if (!ok) return;
    if (!(await sendJson("DELETE", `/api/ai/chats/${c.id}`))) return void dialog.alert({ title: "Không xóa được", message: "Hãy thử lại sau.", tone: "danger" });
    setChats((cur) => cur?.filter((x) => x.id !== c.id) ?? cur);
    if (c.id === activeId) newChat();
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    if (!selected.length) return void dialog.alert({ title: "Chưa chọn nguồn dữ liệu", message: "Hãy chọn ít nhất một nguồn dữ liệu ở nút \"Nguồn dữ liệu\" bên dưới khung nhập để AI có số liệu trả lời." });
    setInput("");
    setError(null);
    clearLive();
    setBusy(true);
    setMessages((cur) => [...cur, { id: `tmp-${Date.now()}`, role: "user", content: question, meta: {}, createdAt: new Date().toISOString() }]);
    const ctl = new AbortController();
    abortRef.current = ctl;
    await streamAnswer(
      { chatId: activeId, question, sourceIds: selected, lang, context },
      {
        onChat: (id, title) => {
          setActiveId(id);
          setChats((cur) => (cur && !cur.some((c) => c.id === id) ? [{ id, title, sourceIds: selected, updatedAt: new Date().toISOString() }, ...cur] : cur));
        },
        onStatus: setStatus,
        onText: (chunk) => setDraft((d) => d + chunk),
        onReset: () => setDraft(""),
        onVisual: (v) => setVisuals((cur) => [...cur, v]),
        onDone: (message) => setMessages((cur) => [...cur, message]),
        onError: (message, quota) => setError({ message, question, ...(quota ? { quota } : {}) }),
      },
      ctl.signal,
    );
    setBusy(false);
    clearLive();
    void refreshChats();
  };

  const copy = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(stripHighlights(m.content));
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

  const empty = messages.length === 0 && !busy && !loadingChat;

  return (
    <div className={`${styles.wrap} ${dock ? styles.dockWrap : ""}`}>
      <HistoryPanel
        chats={chats}
        activeId={activeId}
        loadFailed={loadFailed}
        open={historyOpen}
        onNew={newChat}
        onOpen={(id) => void openChat(id)}
        onRename={(c) => void rename(c)}
        onRemove={(c) => void remove(c)}
        onRetry={() => void loadAll()}
      />

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
          {loadingChat ? (
            <div className={styles.center}><Spinner size={28} label="Đang tải…" /></div>
          ) : empty ? (
            <Welcome noSources={sources !== null && sources.length === 0} onAsk={(q) => void send(q)} />
          ) : (
            <MessageList
              messages={messages}
              live={busy ? { draft, visuals, status } : null}
              error={error}
              copiedId={copied}
              onCopy={(m) => void copy(m)}
              onRetry={(q) => {
                setInput(q);
                setError(null);
                taRef.current?.focus();
              }}
              endRef={endRef}
            />
          )}
        </div>

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => void send(input)}
          onStop={() => abortRef.current?.abort()}
          busy={busy}
          textareaRef={taRef}
          sources={sources}
          selected={selected}
          onPickSource={pick}
        />
      </section>
    </div>
  );
}
