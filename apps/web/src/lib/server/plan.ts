import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLAN_LIMITS } from "@/lib/limits";
import { monthKeyVn, normalizePlan, startOfDayVn, type Plan } from "@/lib/plan";

/**
 * Gói và bộ đếm hạn mức phía server (service role). Chịu được việc migration 0014 chưa chạy: gói mặc định là miễn phí,
 * còn bộ đếm email lỗi thì KHÔNG chặn gửi (chỉ mất giới hạn, không mất tính năng).
 */

export interface DashboardPlan {
  plan: Plan;
  workspaceId: string;
}

/** Gói của workspace chứa dashboard. null nếu dashboard không tồn tại. */
export async function planForDashboard(dashboardId: string): Promise<DashboardPlan | null> {
  const admin = createAdminClient();
  const { data: d } = await admin.from("dashboards").select("workspace_id").eq("id", dashboardId).maybeSingle();
  if (!d) return null;
  const { data: w } = await admin.from("workspaces").select("plan").eq("id", d.workspace_id).maybeSingle();
  return { plan: normalizePlan(w?.plan), workspaceId: d.workspace_id as string };
}

/** Số email đã gửi thành công hôm nay (giờ VN) của workspace. null nếu không đếm được. */
export async function mailsSentToday(workspaceId: string, now = new Date()): Promise<number | null> {
  const { data, error } = await createAdminClient().rpc("mails_sent_since", { p_workspace: workspaceId, p_since: startOfDayVn(now) });
  if (error || typeof data !== "number") return null;
  return data;
}

/** Còn được gửi thêm email hôm nay không (theo gói của workspace chứa dashboard). Không đếm được thì cho phép. */
export async function mailAllowedForDashboard(dashboardId: string, now = new Date()): Promise<boolean> {
  const p = await planForDashboard(dashboardId);
  if (!p) return true;
  const sent = await mailsSentToday(p.workspaceId, now);
  if (sent === null) return true;
  return sent < PLAN_LIMITS[p.plan].mailsPerDay;
}

const AI_PARSE = "alert_ai_parse";

/**
 * Giữ chỗ một lượt "tạo cảnh báo bằng AI" trong tháng (chỉ gói có giới hạn). true = được phép; false = đã hết lượt.
 * Lỗi DB (vd migration chưa chạy) thì cho phép (không chặn tính năng vì lỗi hạ tầng).
 */
export async function reserveAiParse(userId: string, plan: Plan, now = new Date()): Promise<boolean> {
  const limit = PLAN_LIMITS[plan].aiAlertParsePerMonth;
  if (limit === null) return true;
  const { data, error } = await createAdminClient().rpc("feature_usage_reserve", { p_user: userId, p_feature: AI_PARSE, p_period: monthKeyVn(now), p_limit: limit });
  if (error) return true;
  return data === true;
}

/** Trả lại lượt khi AI không phản hồi (không tốn lượt của người dùng). */
export async function releaseAiParse(userId: string, plan: Plan, now = new Date()): Promise<void> {
  if (PLAN_LIMITS[plan].aiAlertParsePerMonth === null) return;
  await createAdminClient().rpc("feature_usage_release", { p_user: userId, p_feature: AI_PARSE, p_period: monthKeyVn(now) });
}
