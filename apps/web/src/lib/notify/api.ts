import type { ReportFrequency, ReportSubscriptionInput } from "@dashboard/schema";
import { createClient } from "@/lib/supabase/client";
import { errorFrom } from "./plan-error";

/**
 * Gọi API báo cáo định kỳ (app/api/dashboards/[id]/reports/route.ts). Phiên vừa hết hạn (401/503) thì làm mới rồi thử lại
 * một lần, giống các API chia sẻ.
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

export interface ReportRow {
  id: string;
  dashboard_id: string;
  created_by: string;
  recipient_email: string;
  recipient_name: string;
  prompt: string;
  frequency: ReportFrequency;
  weekday: number | null;
  month_day: number | null;
  hour_vn: number;
  widget_ids: string[];
  include_images: boolean;
  link_mode: "view_link" | "login";
  /** Thiếu ở dữ liệu cũ (trước migration 0016) = compare. */
  report_type?: "compare" | "overview";
  enabled: boolean;
  next_run_at: string | null;
  last_sent_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface ReportList {
  subscriptions: ReportRow[];
  isOwner: boolean;
  me: string;
  viewLinkEnabled: boolean;
  /** Máy chủ đã cấu hình gửi email và link huỷ nhận. */
  mailReady: boolean;
  limit: number;
  /** Gói của workspace và những gì gói cho phép (từ lib/limits.ts). */
  plan: "free" | "paid";
  planLabel: string;
  limits: { frequencies: ReportFrequency[]; aiReports: boolean };
}

export interface PreviewResult {
  subject: string;
  html: string;
  text: string;
  meta: { ai: { used: boolean; reason?: string }; images: number; imageNotes: string[]; linkFallback: boolean };
}

async function call<T>(id: string, init?: RequestInit, query = ""): Promise<T> {
  const res = await apiFetch(`/api/dashboards/${id}/reports${query}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw errorFrom(json as { error?: string; code?: string });
  return json;
}

export const listReports = (id: string) => call<ReportList>(id);

export const createReport = (id: string, input: ReportSubscriptionInput) =>
  call<{ subscription: ReportRow }>(id, { method: "POST", body: JSON.stringify(input) });

export const updateReport = (id: string, subId: string, input: ReportSubscriptionInput) =>
  call<{ subscription: ReportRow }>(id, { method: "PATCH", body: JSON.stringify(input) }, `?id=${encodeURIComponent(subId)}`);

export const deleteReport = (id: string, subId: string) =>
  call<{ ok: true }>(id, { method: "DELETE" }, `?id=${encodeURIComponent(subId)}`);

export const previewReport = (id: string, input: ReportSubscriptionInput) =>
  call<PreviewResult>(id, { method: "POST", body: JSON.stringify(input) }, "?preview=1");

export const sendTestReport = (id: string, input: ReportSubscriptionInput) =>
  call<{ sent: true; to: string }>(id, { method: "POST", body: JSON.stringify(input) }, "?test=1");
