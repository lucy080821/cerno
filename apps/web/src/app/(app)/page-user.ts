import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Trang sau đăng nhập: lấy client + người dùng, chưa đăng nhập thì về /login. */
export async function requirePageUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const name = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "";
  return { supabase, user, name };
}

/** Các workspace người dùng là thành viên. */
export async function workspaceIds(supabase: Awaited<ReturnType<typeof requirePageUser>>["supabase"], userId: string): Promise<string[]> {
  const { data } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", userId);
  return (data ?? []).map((m) => m.workspace_id as string);
}

export interface DashRef { id: string; name: string; updated_at: string }

/** Dashboard của các workspace người dùng (mới sửa trước). */
export async function ownDashboards(supabase: Awaited<ReturnType<typeof requirePageUser>>["supabase"], wsIds: string[]): Promise<DashRef[]> {
  if (!wsIds.length) return [];
  const { data } = await supabase.from("dashboards").select("id, name, updated_at").in("workspace_id", wsIds).order("updated_at", { ascending: false });
  return (data ?? []) as DashRef[];
}

/** dd/mm/yyyy HH:mm theo giờ Việt Nam; trống thì "—". */
export function vnTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
