import { createClient } from "@/lib/supabase/client";

export const MAX_COMMENT_LENGTH = 4000;

export interface CommentRow {
  id: string;
  dashboard_id: string;
  widget_id: string | null;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface CommentThread {
  root: CommentRow;
  replies: CommentRow[];
}

/** Gom bình luận thành chuỗi: bình luận gốc mới nhất trước, trả lời cũ nhất trước. Trả lời mất bình luận gốc thì bỏ. */
export function buildThreads(rows: CommentRow[]): CommentThread[] {
  const byTime = (a: CommentRow, b: CommentRow) => a.created_at.localeCompare(b.created_at);
  const roots = rows.filter((r) => !r.parent_id).sort((a, b) => byTime(b, a));
  const replies = new Map<string, CommentRow[]>();
  for (const r of rows) {
    if (!r.parent_id) continue;
    const list = replies.get(r.parent_id) ?? [];
    list.push(r);
    replies.set(r.parent_id, list);
  }
  return roots.map((root) => ({ root, replies: (replies.get(root.id) ?? []).sort(byTime) }));
}

function friendly(err: { message: string }): string {
  if (err.message.includes("comment_limit")) return "Dashboard này đã đạt giới hạn 500 bình luận.";
  if (err.message.includes("bad_parent")) return "Bình luận gốc không còn tồn tại.";
  return "Không gửi được bình luận. Hãy thử lại.";
}

export async function listComments(dashboardId: string): Promise<CommentRow[]> {
  const { data, error } = await createClient()
    .from("comments")
    .select("id, dashboard_id, widget_id, parent_id, author_id, author_name, body, created_at")
    .eq("dashboard_id", dashboardId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error("Không tải được bình luận.");
  return (data ?? []) as CommentRow[];
}

export async function addComment(input: {
  dashboardId: string;
  body: string;
  widgetId?: string | null;
  parentId?: string | null;
}): Promise<CommentRow> {
  const body = input.body.trim();
  if (!body) throw new Error("Bình luận trống.");
  if (body.length > MAX_COMMENT_LENGTH) throw new Error(`Bình luận tối đa ${MAX_COMMENT_LENGTH} ký tự.`);
  const { data: auth } = await createClient().auth.getUser();
  if (!auth.user) throw new Error("Bạn cần đăng nhập.");
  // author_id/author_name do trigger DB đặt lại theo phiên đăng nhập; giá trị gửi lên chỉ để qua kiểm tra not null.
  const { data, error } = await createClient()
    .from("comments")
    .insert({
      dashboard_id: input.dashboardId,
      widget_id: input.widgetId ?? null,
      parent_id: input.parentId ?? null,
      author_id: auth.user.id,
      body,
    })
    .select("id, dashboard_id, widget_id, parent_id, author_id, author_name, body, created_at")
    .single();
  if (error) throw new Error(friendly(error));
  return data as CommentRow;
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await createClient().from("comments").delete().eq("id", id);
  if (error) throw new Error("Không xoá được bình luận.");
}

/** Nghe bình luận mới/xoá theo thời gian thực (RLS vẫn áp dụng). Trả hàm huỷ đăng ký. */
export function subscribeComments(
  dashboardId: string,
  onInsert: (row: CommentRow) => void,
  onDelete: (id: string) => void,
): () => void {
  const supabase = createClient();
  const channel = supabase
    .channel(`comments:${dashboardId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "comments", filter: `dashboard_id=eq.${dashboardId}` },
      (p) => onInsert(p.new as CommentRow),
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "comments", filter: `dashboard_id=eq.${dashboardId}` },
      (p) => {
        const id = (p.old as { id?: string }).id;
        if (id) onDelete(id);
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "vừa xong";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}
