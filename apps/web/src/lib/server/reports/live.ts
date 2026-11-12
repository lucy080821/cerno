import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { callAnthropic } from "@/lib/server/ai/anthropic";
import { callGroq } from "@/lib/server/ai/groq";
import { QUOTA_MESSAGES, recordPaid, releasePaid, reservePaid } from "@/lib/server/ai/quota";
import { parseOrder, routeChat } from "@/lib/server/ai/router";
import type { ProviderOutcome, ProviderRequest } from "@/lib/server/ai/types";
import { sendMail } from "@/lib/server/mail";
import { createNotifyToken, unsubscribeApiUrl, unsubscribeConfigured, unsubscribePageUrl } from "@/lib/server/notify/unsubscribe";
import { executeQuery } from "@/lib/server/query-service";
import { getSourceMeta } from "@/lib/server/row-cache";
import type { ComposeDeps, LoadedDashboard } from "./compose";
import type { DueSub, RunDeps } from "./run-due";

/** Nối các phụ thuộc thật (DB service role, AI, truy vấn) cho báo cáo. Chỉ chạy ở server. */

/** Gọi AI qua router (Groq trước, Anthropic dự phòng) và tính vào hạn mức của `userId` (chủ workspace). */
export function liveChat(userId: string): (req: ProviderRequest) => Promise<ProviderOutcome> {
  const groqKey = process.env.GROQ_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  return async (req) => {
    if (!groqKey && !anthropicKey) {
      return { ok: false, provider: "groq", status: 503, body: { error: "Chưa cấu hình AI trên máy chủ." }, fallbackable: false };
    }
    return routeChat(userId, req, {
      groq: groqKey ? (r) => callGroq(groqKey, r) : undefined,
      anthropic: anthropicKey ? (r, onUsage) => callAnthropic(anthropicKey, r, onUsage) : undefined,
      order: parseOrder(process.env.AI_PROVIDER_ORDER),
      reserve: reservePaid,
      release: releasePaid,
      record: recordPaid,
      quotaMessages: QUOTA_MESSAGES,
    });
  };
}

/** Đọc dashboard bằng service role. Chỉ gọi SAU khi đã kiểm quyền người dùng (xem trước/gửi thử) hoặc từ cron. */
export async function loadDashboard(id: string): Promise<LoadedDashboard | null> {
  const admin = createAdminClient();
  const { data: d } = await admin.from("dashboards").select("id, name, doc, workspace_id").eq("id", id).maybeSingle();
  if (!d) return null;
  const { data: ws } = await admin.from("workspaces").select("owner_id").eq("id", d.workspace_id).maybeSingle();
  if (!ws) return null;

  // Chỉ cho đọc nguồn thuộc CHÍNH workspace của dashboard (người được mời quyền sửa có thể đã thêm id nguồn của người khác vào doc).
  const sources = ((d.doc as { sources?: { id?: unknown; type?: unknown }[] })?.sources ?? [])
    .filter((s) => s?.type === "google_sheets" && typeof s.id === "string")
    .map((s) => s.id as string);
  let updatedAt: string | null = null;
  if (sources.length) {
    const { data: own } = await admin.from("data_sources").select("id, last_synced_at").in("id", sources).eq("workspace_id", d.workspace_id);
    if ((own ?? []).length !== new Set(sources).size) throw new Error("Dashboard dùng nguồn dữ liệu không thuộc workspace của nó.");
    for (const r of own ?? []) if (r.last_synced_at && (!updatedAt || r.last_synced_at > updatedAt)) updatedAt = r.last_synced_at;
  }
  return { id: d.id, name: d.name, doc: d.doc, ownerId: ws.owner_id, updatedAt };
}

/** Chạy truy vấn gộp trên nguồn (có cache theo phiên bản dữ liệu). Chỉ gọi sau khi đã kiểm quyền/workspace của nguồn. */
export const liveExec: ComposeDeps["exec"] = async (sourceId, spec) => {
  const meta = await getSourceMeta(sourceId);
  if (!meta) throw new Error("Không tìm thấy nguồn dữ liệu.");
  return executeQuery(sourceId, meta, spec);
};

export function liveComposeDeps(origin: string): ComposeDeps {
  return {
    loadDashboard,
    exec: liveExec,
    chat: liveChat,
    viewToken: async (dashboardId) => {
      const { data } = await createAdminClient().from("dashboard_links").select("token").eq("dashboard_id", dashboardId).maybeSingle();
      return data?.token ?? null;
    },
    origin,
  };
}

/** Phụ thuộc cho cron: nhận báo cáo đến hạn, gửi mail thật, ghi nhật ký và lịch. */
export function liveRunDeps(origin: string): RunDeps {
  const admin = createAdminClient();
  return {
    compose: liveComposeDeps(origin),
    async claim(limit) {
      const { data, error } = await admin.rpc("claim_due_reports", { p_limit: limit });
      if (error) throw new Error(`claim_due_reports: ${error.message}`);
      return (data ?? []) as DueSub[];
    },
    async isOptedOut(email, subId) {
      const { data } = await admin
        .from("notification_optouts")
        .select("id")
        .eq("email", email.toLowerCase())
        .eq("ref_kind", "report")
        .or(`ref_id.is.null,ref_id.eq.${subId}`)
        .limit(1);
      return (data ?? []).length > 0;
    },
    send: sendMail,
    async log(e) {
      await admin.from("notification_log").insert({ ...e, channel: "email" });
    },
    async finish(id, patch) {
      await admin.from("report_subscriptions").update(patch).eq("id", id);
    },
    unsubscribeLinks(sub: DueSub) {
      if (!unsubscribeConfigured()) return null;
      const token = createNotifyToken({ k: "report", r: sub.id, e: sub.recipient_email, a: "unsub" });
      return { pageUrl: unsubscribePageUrl(origin, token), apiUrl: unsubscribeApiUrl(origin, token) };
    },
    now: () => new Date(),
  };
}
