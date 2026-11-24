import { Dashboard } from "@dashboard/schema";
import { createClient } from "@/lib/supabase/client";

/**
 * Lịch sử phiên bản dashboard (bảng dashboard_revisions, migration 0024). Đọc/xoá qua RLS bằng client trình duyệt; tạo mốc có tên qua RPC.
 * Danh sách KHÔNG tải `doc` (nặng): chỉ tải khi người dùng bấm Khôi phục (`loadRevisionDoc`), và doc luôn được kiểm lại bằng zod.
 */
export interface RevisionRow {
  id: string;
  label: string | null;
  savedAt: string;
}

/** Thông báo thân thiện cho các lỗi thường gặp (chưa chạy migration, không đủ quyền, quá nhiều mốc). */
export function revisionError(message: string | undefined): string {
  const m = message ?? "";
  if (/relation .*dashboard_revisions|function .*create_dashboard_revision|schema cache/i.test(m)) return "Tính năng lịch sử chưa được bật trên máy chủ (cần chạy migration 0024).";
  if (/forbidden/i.test(m)) return "Bạn không có quyền sửa dashboard này.";
  if (/named_limit/i.test(m)) return "Đã có 20 mốc đặt tên, hãy xoá bớt mốc cũ.";
  return "Không thực hiện được, hãy thử lại.";
}

export async function listRevisions(dashboardId: string): Promise<{ rows: RevisionRow[] } | { error: string }> {
  const { data, error } = await createClient()
    .from("dashboard_revisions")
    .select("id, label, saved_at")
    .eq("dashboard_id", dashboardId)
    .order("saved_at", { ascending: false })
    .limit(60);
  if (error) return { error: revisionError(error.message) };
  return { rows: (data ?? []).map((r) => ({ id: r.id as string, label: (r.label as string | null) ?? null, savedAt: r.saved_at as string })) };
}

export async function createNamedRevision(dashboardId: string, label: string): Promise<string | null> {
  const { error } = await createClient().rpc("create_dashboard_revision", { p_dashboard: dashboardId, p_label: label });
  return error ? revisionError(error.message) : null;
}

export async function deleteRevision(id: string): Promise<string | null> {
  const { error } = await createClient().from("dashboard_revisions").delete().eq("id", id);
  return error ? revisionError(error.message) : null;
}

export async function loadRevisionDoc(id: string): Promise<{ doc: Dashboard } | { error: string }> {
  const { data, error } = await createClient().from("dashboard_revisions").select("doc").eq("id", id).maybeSingle();
  if (error || !data) return { error: revisionError(error?.message) };
  const parsed = Dashboard.safeParse(data.doc);
  return parsed.success ? { doc: parsed.data } : { error: "Phiên bản này không còn đọc được (cấu trúc đã thay đổi)." };
}

/** "Hôm nay 14:05", "Hôm qua 09:30", "21/11 18:20"; theo giờ Việt Nam. Ghép từ từng phần để không phụ thuộc kiểu dấu phân cách của ICU. */
export function formatRevisionTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = (x: Date) => {
    const o: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(x)) o[p.type] = p.value;
    return o;
  };
  const a = parts(d);
  const dayKey = (o: Record<string, string>) => `${o.year}-${o.month}-${o.day}`;
  const time = `${a.hour}:${a.minute}`;
  if (dayKey(a) === dayKey(parts(now))) return `Hôm nay ${time}`;
  if (dayKey(a) === dayKey(parts(new Date(now.getTime() - 86_400_000)))) return `Hôm qua ${time}`;
  return `${a.day}/${a.month} ${time}`;
}
