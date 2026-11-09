import { Dashboard } from "@dashboard/schema";
import { createClient } from "@/lib/supabase/client";
import type { SaveResult } from "@/lib/editor/autosave";

/** Khớp ràng buộc `dashboards_doc_size` ở DB (2.000.000 byte). */
export const MAX_DOC_BYTES = 1_900_000;

export interface DashboardRow {
  id: string;
  name: string;
  updated_at: string;
}

function friendly(err: { code?: string; message: string }): string {
  if (err.message.includes("dashboard_limit")) return "Đã đạt giới hạn 20 dashboard (bản miễn phí). Hãy xoá bớt dashboard cũ.";
  if (err.code === "23514") return "Dashboard quá lớn (tối đa 2 MB).";
  return err.message;
}

async function myWorkspaceId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Bạn cần đăng nhập.");
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .in("role", ["owner", "editor"])
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("Chưa có workspace. Hãy đăng xuất rồi đăng nhập lại.");
  return data.workspace_id;
}

/** Tạo dashboard mới trong workspace của mình. Trả id. */
export async function createDashboard(doc: Dashboard): Promise<string> {
  const workspaceId = await myWorkspaceId();
  const { data, error } = await createClient()
    .from("dashboards")
    .insert({ workspace_id: workspaceId, name: doc.name.slice(0, 200) || "Dashboard chưa đặt tên", doc })
    .select("id")
    .single();
  if (error) throw new Error(friendly(error));
  return data.id;
}

/**
 * Lưu có kiểm tra phiên bản: chỉ ghi nếu `updated_at` trên server vẫn bằng `rev` mà bản đang mở dựa vào.
 * Nếu không (tab khác hoặc người khác đã lưu trước) thì trả "conflict", không ghi đè âm thầm.
 * `rev` là chuỗi từ Postgres, đưa nguyên văn trở lại (không qua Date) để giữ độ chính xác micro giây.
 */
export async function saveDashboard(id: string, doc: Dashboard, rev: string): Promise<SaveResult> {
  if (new TextEncoder().encode(JSON.stringify(doc)).length > MAX_DOC_BYTES) {
    return { ok: false, kind: "error", message: "Dashboard quá lớn (tối đa 2 MB), thử giảm ảnh hoặc số widget." };
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dashboards")
    .update({ name: doc.name.slice(0, 200) || "Dashboard chưa đặt tên", doc })
    .eq("id", id)
    .eq("updated_at", rev)
    .select("updated_at");
  if (error) return { ok: false, kind: "error", message: friendly(error) };
  if (data.length === 1) return { ok: true, rev: data[0].updated_at };

  // Không có dòng nào được cập nhật: hoặc đã bị người khác sửa, hoặc đã bị xoá / không còn quyền.
  const cur = await supabase.from("dashboards").select("updated_at").eq("id", id).maybeSingle();
  if (!cur.data) return { ok: false, kind: "error", message: "Dashboard không còn tồn tại hoặc bạn không còn quyền sửa." };
  return { ok: false, kind: "conflict" };
}

/** Phiên bản hiện tại trên server (dùng khi chọn "ghi đè"). */
export async function fetchRev(id: string): Promise<string> {
  const { data, error } = await createClient().from("dashboards").select("updated_at").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Không đọc được dashboard từ server.");
  return data.updated_at;
}

export async function fetchDashboard(id: string): Promise<{ doc: Dashboard; rev: string; name: string }> {
  const { data, error } = await createClient()
    .from("dashboards")
    .select("id, name, doc, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error("Không đọc được dashboard từ server.");
  const parsed = Dashboard.safeParse(data.doc);
  if (!parsed.success) throw new Error("Dữ liệu dashboard trên server không hợp lệ.");
  return { doc: { ...parsed.data, id: data.id }, rev: data.updated_at, name: data.name };
}

export async function renameDashboard(id: string, name: string): Promise<void> {
  const supabase = createClient();
  const clean = name.trim().slice(0, 200);
  if (!clean) throw new Error("Tên không được để trống.");
  // Tên nằm cả ở cột `name` lẫn trong `doc.name`: sửa cả hai để mở editor không bị lệch.
  const { data, error } = await supabase.from("dashboards").select("doc").eq("id", id).single();
  if (error) throw new Error(friendly(error));
  const doc = { ...(data.doc as Record<string, unknown>), name: clean };
  const up = await supabase.from("dashboards").update({ name: clean, doc }).eq("id", id);
  if (up.error) throw new Error(friendly(up.error));
}

export async function deleteDashboard(id: string): Promise<void> {
  const { error } = await createClient().from("dashboards").delete().eq("id", id);
  if (error) throw new Error(friendly(error));
}
