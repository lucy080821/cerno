import type { AlertCondition, AlertMetric, AlertRuleInput, AlertState } from "@dashboard/schema";
import { createClient } from "@/lib/supabase/client";
import type { AlertSchema } from "./alert-form";

/**
 * Gọi API cảnh báo (app/api/dashboards/[id]/alerts). Phiên vừa hết hạn (401/503) thì làm mới rồi thử lại một lần.
 */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 401 && res.status !== 503) return res;
  try {
    await createClient().auth.refreshSession();
  } catch {
    /* không làm mới được thì vẫn thử lại */
  }
  await new Promise((r) => setTimeout(r, 400));
  return fetch(url, init);
}

export interface AlertRow {
  id: string;
  dashboard_id: string;
  created_by: string;
  name: string;
  source_prompt: string | null;
  widget_id: string | null;
  metric: AlertMetric;
  condition: AlertCondition;
  recipients: string[];
  channels: string[];
  cooldown_minutes: number;
  notify_recover: boolean;
  enabled: boolean;
  snooze_until: string | null;
  last_state: AlertState;
  last_value: number | null;
  last_checked_at: string | null;
  last_triggered_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface AlertList {
  rules: AlertRow[];
  isOwner: boolean;
  me: string;
  mailReady: boolean;
  limit: number;
  schema: AlertSchema;
}

export interface Summary {
  kind: "single" | "groups" | "deferred";
  verdict: "firing" | "ok" | "insufficient" | "deferred";
  label: string;
  prevLabel?: string;
  value?: number | null;
  prev?: number | null;
  changePct?: number | null;
  z?: number | null;
  mean?: number;
  n?: number;
  reason?: string;
  settleHour?: number;
  groupBy?: string;
  evaluated?: number;
  insufficient?: number;
  violatingCount?: number;
  groups?: { group: string; value: number | null; changePct?: number | null; z?: number | null }[];
}

/** Kết quả "Tạo bằng AI": bản nháp (kèm giá trị hiện tại), câu hỏi lại, lỗi, hoặc AI không dùng được. */
export type ParseResult =
  | { ai: true; draft: { name: string; metric: AlertMetric; condition: AlertCondition; source_prompt: string }; summary: Summary | null }
  | { ai: true; question: string }
  | { ai: true; invalid: true; errors: string[] }
  | { ai: false; error: string };

async function call<T>(id: string, path: string, init?: RequestInit, query = ""): Promise<T> {
  const res = await apiFetch(`/api/dashboards/${id}/alerts${path}${query}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Có lỗi xảy ra, thử lại sau.");
  return json;
}

export const listAlerts = (id: string) => call<AlertList>(id, "");
export const createAlert = (id: string, input: AlertRuleInput) => call<{ rule: AlertRow }>(id, "", { method: "POST", body: JSON.stringify(input) });
export const updateAlert = (id: string, ruleId: string, input: AlertRuleInput) =>
  call<{ rule: AlertRow }>(id, "", { method: "PATCH", body: JSON.stringify(input) }, `?id=${encodeURIComponent(ruleId)}`);
export const deleteAlert = (id: string, ruleId: string) => call<{ ok: true }>(id, "", { method: "DELETE" }, `?id=${encodeURIComponent(ruleId)}`);
/** hours = 0 để bỏ tạm hoãn. */
export const snoozeAlert = (id: string, ruleId: string, hours: number) =>
  call<{ rule: AlertRow }>(id, "", { method: "PATCH" }, `?id=${encodeURIComponent(ruleId)}&snooze=${hours}`);
export const evaluateAlert = (id: string, draft: { metric: AlertMetric; condition: AlertCondition }) =>
  call<{ summary: Summary | null }>(id, "", { method: "POST", body: JSON.stringify(draft) }, "?evaluate=1");

/** Hỏi AI dịch lời mô tả thành luật. Lỗi mạng/máy chủ được trả về dạng `{ai:false}` để giao diện cho tự cài. */
export async function parseAlertText(id: string, text: string): Promise<ParseResult> {
  const res = await apiFetch(`/api/dashboards/${id}/alerts/parse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ai: false, error: typeof json.error === "string" ? json.error : "AI chưa dùng được lúc này." };
  return json as unknown as ParseResult;
}
