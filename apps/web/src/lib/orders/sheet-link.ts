import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Tên Google Sheet đang nối cho kênh này (qua RLS); null nếu chưa nối hoặc chưa chạy migration 0022. */
export async function sheetLinkedTo(db: SupabaseClient, workspaceId: string, channel: string): Promise<string | null> {
  const { data, error } = await db.from("order_sheets").select("name").eq("workspace_id", workspaceId).eq("channel", channel).maybeSingle();
  return error || !data ? null : (data.name as string);
}
