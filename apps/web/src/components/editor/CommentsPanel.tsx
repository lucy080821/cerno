"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDialog } from "@/components/ui/DialogProvider";
import {
  addComment, buildThreads, deleteComment, listComments, MAX_COMMENT_LENGTH, subscribeComments, timeAgo,
  type CommentRow,
} from "@/lib/comments/comments";
import { widgetLabels } from "@/lib/comments/labels";
import { createClient } from "@/lib/supabase/client";
import { useEditor } from "@/lib/editor/store";
import c from "./comments.module.css";

/**
 * Bình luận của dashboard. Dùng trong editor (tab "Bình luận") và trình xem chỉ-đọc (ngăn trượt).
 * Quyền do RLS quyết định: ai xem được dashboard thì đọc và viết được; xoá được bình luận của mình,
 * chủ dashboard (`canModerate`) xoá được tất cả. Cập nhật theo thời gian thực.
 */
export function CommentsPanel({ dashboardId, canModerate = false }: { dashboardId: string; canModerate?: boolean }) {
  const dialog = useDialog();
  const widgets = useEditor((st) => st.doc.widgets);
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);

  const upsert = useCallback((row: CommentRow) => {
    setRows((cur) => (cur && !cur.some((r) => r.id === row.id) ? [...cur, row] : cur));
  }, []);

  useEffect(() => {
    let alive = true;
    void createClient().auth.getUser().then(({ data }) => alive && setMe(data.user?.id ?? null));
    listComments(dashboardId)
      .then((r) => alive && setRows(r))
      .catch((e: Error) => alive && (setError(e.message), setRows([])));
    const stop = subscribeComments(
      dashboardId,
      (r) => alive && upsert(r),
      (id) => alive && setRows((cur) => cur && cur.filter((r) => r.id !== id && r.parent_id !== id)),
    );
    return () => {
      alive = false;
      stop();
    };
  }, [dashboardId, upsert]);

  const threads = useMemo(() => buildThreads(rows ?? []), [rows]);
  const pages = useEditor((st) => st.doc.pages);
  const widgetName = useMemo(() => widgetLabels({ widgets, pages }), [widgets, pages]);

  const send = async (body: string, parentId: string | null, widgetId: string | null) => {
    if (busy || !body.trim()) return false;
    setBusy(true);
    setError(null);
    try {
      upsert(await addComment({ dashboardId, body, parentId, widgetId }));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: CommentRow) => {
    const ok = await dialog.confirm({
      title: "Xoá bình luận?",
      message: row.parent_id ? "Bình luận này sẽ bị xoá." : "Bình luận và các trả lời của nó sẽ bị xoá.",
      confirmText: "Xoá",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteComment(row.id);
      setRows((cur) => cur && cur.filter((r) => r.id !== row.id && r.parent_id !== row.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const item = (r: CommentRow, isReply: boolean) => (
    <div key={r.id} className={isReply ? c.reply : c.item}>
      <div className={c.meta}>
        <strong className={c.author}>{r.author_name || "Người dùng"}</strong>
        <time dateTime={r.created_at} title={new Date(r.created_at).toLocaleString("vi-VN")}>{timeAgo(r.created_at)}</time>
      </div>
      {!isReply && r.widget_id && (
        <span className={c.tag}>Về: {widgetName.get(r.widget_id) ?? "widget đã xoá"}</span>
      )}
      <p className={c.body}>{r.body}</p>
      <div className={c.actions}>
        {!isReply && <button onClick={() => { setReplyTo(replyTo === r.id ? null : r.id); setReplyText(""); }}>Trả lời</button>}
        {(r.author_id === me || canModerate) && <button onClick={() => void remove(r)}>Xoá</button>}
      </div>
    </div>
  );

  return (
    <div className={c.panel}>
      <form
        className={c.form}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await send(text, null, target || null)) setText("");
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          placeholder="Viết bình luận…"
          aria-label="Bình luận mới"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") e.currentTarget.form?.requestSubmit();
          }}
        />
        <div className={c.formRow}>
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Gắn bình luận vào">
            <option value="">Cả dashboard</option>
            {widgets.map((w) => <option key={w.id} value={w.id}>{widgetName.get(w.id)}</option>)}
          </select>
          <button type="submit" disabled={busy || !text.trim()}>Gửi</button>
        </div>
      </form>
      {error && <p className={c.error} role="alert">{error}</p>}
      {rows === null && <p className={c.hint}>Đang tải bình luận…</p>}
      {rows !== null && threads.length === 0 && <p className={c.hint}>Chưa có bình luận nào.</p>}
      <div className={c.list}>
        {threads.map((t) => (
          <section key={t.root.id} className={c.thread}>
            {item(t.root, false)}
            {t.replies.map((r) => item(r, true))}
            {replyTo === t.root.id && (
              <form
                className={c.replyForm}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await send(replyText, t.root.id, t.root.widget_id)) { setReplyTo(null); setReplyText(""); }
                }}
              >
                <textarea
                  autoFocus
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  maxLength={MAX_COMMENT_LENGTH}
                  rows={2}
                  placeholder="Trả lời…"
                  aria-label="Trả lời bình luận"
                />
                <button type="submit" disabled={busy || !replyText.trim()}>Gửi</button>
              </form>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
