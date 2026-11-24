import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage } from "../ai/types";

/** Lưu lịch sử trò chuyện của trang Hỏi AI. Mọi truy vấn qua client của người dùng nên RLS bảo đảm chỉ thấy cuộc trò chuyện của chính mình. */

export interface ChatSummary {
  id: string;
  title: string;
  sourceIds: string[];
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export const MAX_QUESTION_CHARS = 2000;
/** Số tin gần nhất gửi lại cho AI làm ngữ cảnh, và độ dài tối đa của mỗi tin cũ (báo cáo dài sẽ ăn hết ngữ cảnh nếu giữ nguyên). */
const HISTORY_MESSAGES = 8;
const HISTORY_ASSISTANT_CHARS = 3000;

const rowToChat = (r: Record<string, unknown>): ChatSummary => ({
  id: r.id as string,
  title: r.title as string,
  sourceIds: Array.isArray(r.source_ids) ? (r.source_ids as string[]) : [],
  updatedAt: r.updated_at as string,
});

export const titleFrom = (question: string): string => {
  const t = question.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}...` : t || "Cuộc trò chuyện mới";
};

export async function listChats(db: SupabaseClient, limit = 100): Promise<ChatSummary[]> {
  const { data } = await db.from("ai_chats").select("id, title, source_ids, updated_at").order("updated_at", { ascending: false }).limit(limit);
  return (data ?? []).map(rowToChat);
}

export async function getChat(db: SupabaseClient, id: string): Promise<ChatSummary | null> {
  const { data } = await db.from("ai_chats").select("id, title, source_ids, updated_at").eq("id", id).maybeSingle();
  return data ? rowToChat(data) : null;
}

export async function createChat(db: SupabaseClient, args: { workspaceId: string; userId: string; title: string; sourceIds: string[] }): Promise<ChatSummary | null> {
  const { data, error } = await db
    .from("ai_chats")
    .insert({ workspace_id: args.workspaceId, user_id: args.userId, title: args.title, source_ids: args.sourceIds })
    .select("id, title, source_ids, updated_at")
    .single();
  if (error || !data) return null;
  return rowToChat(data);
}

export async function updateChat(db: SupabaseClient, id: string, patch: { title?: string; sourceIds?: string[] }): Promise<boolean> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.sourceIds !== undefined) row.source_ids = patch.sourceIds;
  const { error } = await db.from("ai_chats").update(row).eq("id", id);
  return !error;
}

export async function deleteChat(db: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await db.from("ai_chats").delete().eq("id", id);
  return !error;
}

export async function listMessages(db: SupabaseClient, chatId: string, limit = 400): Promise<StoredMessage[]> {
  const { data } = await db.from("ai_messages").select("id, role, content, meta, created_at").eq("chat_id", chatId).order("created_at", { ascending: true }).limit(limit);
  return (data ?? []).map((r) => ({ id: r.id as string, role: r.role as "user" | "assistant", content: r.content as string, meta: (r.meta as Record<string, unknown>) ?? {}, createdAt: r.created_at as string }));
}

export async function addMessage(db: SupabaseClient, chatId: string, role: "user" | "assistant", content: string, meta: Record<string, unknown> = {}): Promise<StoredMessage | null> {
  const { data, error } = await db.from("ai_messages").insert({ chat_id: chatId, role, content: content.slice(0, 30_000), meta }).select("id, role, content, meta, created_at").single();
  if (error || !data) return null;
  return { id: data.id as string, role, content: data.content as string, meta: (data.meta as Record<string, unknown>) ?? {}, createdAt: data.created_at as string };
}

/** Lịch sử rút gọn gửi cho AI: các tin gần nhất, câu trả lời cũ bị cắt bớt. */
export async function loadHistory(db: SupabaseClient, chatId: string): Promise<ChatMessage[]> {
  const { data } = await db.from("ai_messages").select("role, content").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(HISTORY_MESSAGES);
  const rows = (data ?? []).slice().reverse();
  // Phải bắt đầu bằng tin của người dùng (một số nhà cung cấp từ chối nếu mở đầu bằng tin AI).
  while (rows.length && rows[0].role !== "user") rows.shift();
  return rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.role === "assistant" && (r.content as string).length > HISTORY_ASSISTANT_CHARS ? `${(r.content as string).slice(0, HISTORY_ASSISTANT_CHARS)}\n[...đã rút gọn]` : (r.content as string),
  }));
}
