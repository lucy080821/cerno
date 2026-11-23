import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_SOURCES_PER_WORKSPACE, PLAN_LIMITS } from "@/lib/limits";
import { normalizePlan, type Plan } from "@/lib/plan";
import { buildTodos } from "@/lib/profit/todos";
import { channelLine, shopName } from "@/lib/shell/sidebar";
import { computeProfitFor, findOrdersSource } from "./profit";

export interface SidebarData {
  shop: string;
  /** Ảnh đại diện Google của người đăng nhập; null thì hiện chữ viết tắt. */
  avatar: string | null;
  channels: string;
  todos: number;
  alertsFiring: number;
  plan: Plan;
  planLabel: string;
  sources: number;
  maxSources: number;
}

/** Thử một phần dữ liệu của thanh bên; lỗi (chưa chạy migration, mạng...) thì dùng giá trị mặc định, không làm hỏng trang. */
async function attempt<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[shell/sidebar] ${label}`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

/**
 * Số liệu cho thanh bên của các trang sau đăng nhập (đọc qua RLS bằng client của người dùng): tên cửa hàng, các kênh có
 * đơn, số việc cần làm, số cảnh báo đang báo, gói và số nguồn đã dùng. Lãi từng đơn dùng chung bộ nhớ đệm của computeProfit.
 */
export async function loadSidebar(supabase: SupabaseClient, userId: string, userName: string, avatar: string | null = null): Promise<SidebarData> {
  const base: SidebarData = {
    shop: shopName(null, userName), avatar, channels: "", todos: 0, alertsFiring: 0,
    plan: "free", planLabel: PLAN_LIMITS.free.label, sources: 0, maxSources: MAX_SOURCES_PER_WORKSPACE,
  };
  const mem = await attempt("workspace", async () => {
    const { data } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
    return (data?.workspace_id as string | undefined) ?? null;
  }, null);
  if (!mem) return base;

  const [ws, sources, alertsFiring, profit] = await Promise.all([
    attempt("plan", async () => {
      const { data, error } = await supabase.from("workspaces").select("name, plan").eq("id", mem).maybeSingle();
      if (error) {
        // Chưa chạy migration 0014 (chưa có cột plan): chỉ đọc tên.
        const { data: d2 } = await supabase.from("workspaces").select("name").eq("id", mem).maybeSingle();
        return { name: (d2?.name as string | undefined) ?? null, plan: "free" as Plan };
      }
      return { name: (data?.name as string | undefined) ?? null, plan: normalizePlan(data?.plan) };
    }, { name: null, plan: "free" as Plan }),
    attempt("sources", async () => {
      const { count } = await supabase.from("data_sources").select("id", { count: "exact", head: true }).eq("workspace_id", mem);
      return count ?? 0;
    }, 0),
    attempt("alerts", async () => {
      const { data: dash } = await supabase.from("dashboards").select("id").eq("workspace_id", mem);
      const ids = (dash ?? []).map((d) => d.id as string);
      if (!ids.length) return 0;
      const { count, error } = await supabase.from("alert_rules").select("id", { count: "exact", head: true })
        .in("dashboard_id", ids).eq("enabled", true).eq("last_state", "firing");
      if (error) return 0;
      return count ?? 0;
    }, 0),
    attempt("profit", async () => {
      const src = await findOrdersSource(supabase, mem);
      if (!src) return null;
      return (await computeProfitFor(supabase, mem, src.id)).summary;
    }, null),
  ]);

  return {
    ...base,
    shop: shopName(ws.name, userName),
    channels: profit ? channelLine(profit.channels) : "",
    todos: profit ? buildTodos(profit).length : 0,
    alertsFiring,
    plan: ws.plan,
    planLabel: PLAN_LIMITS[ws.plan].label,
    sources,
  };
}
