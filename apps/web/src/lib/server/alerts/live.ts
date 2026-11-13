import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/seo";
import { sendMail } from "@/lib/server/mail";
import { createNotifyToken, unsubscribeApiUrl, unsubscribeConfigured, unsubscribePageUrl } from "@/lib/server/notify/unsubscribe";
import { liveChat, liveExec } from "@/lib/server/reports/live";
import { mailAllowedForDashboard } from "@/lib/server/plan";
import { loadAlertContext } from "./context";
import { explainBilingual } from "./explain";
import type { AlertCtx, AlertDeps, RuleRow } from "./evaluate";

/** Nối các phụ thuộc thật (DB service role, SMTP, AI) cho việc chạy luật cảnh báo. Chỉ chạy ở server. */

const RULE_COLUMNS =
  "id, dashboard_id, created_by, name, metric, condition, recipients, cooldown_minutes, notify_recover, enabled, snooze_until, last_state, last_value, last_triggered_at, last_error, group_state";

/** Link "Tạm hoãn" hết hạn sau 30 ngày (link huỷ nhận thì không bao giờ hết hạn). */
const SNOOZE_LINK_DAYS = 30;

const aiConfigured = () => !!(process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY);

export function liveAlertDeps(origin: string = siteUrl()): AlertDeps {
  const admin = createAdminClient();
  return {
    now: () => new Date(),
    origin,

    async rulesForSource(sourceId) {
      const { data, error } = await admin
        .from("alert_rules")
        .select(RULE_COLUMNS)
        .eq("enabled", true)
        .eq("metric->>sourceId", sourceId)
        .neq("condition->>type", "stale");
      if (error) throw new Error(`alert_rules: ${error.message}`);
      return (data ?? []) as RuleRow[];
    },

    async staleRules() {
      const { data, error } = await admin.from("alert_rules").select(RULE_COLUMNS).eq("enabled", true).eq("condition->>type", "stale");
      if (error) throw new Error(`alert_rules: ${error.message}`);
      return (data ?? []) as RuleRow[];
    },

    async context(dashboardId): Promise<AlertCtx | null> {
      const c = await loadAlertContext(dashboardId);
      return c ? { dashboardName: c.dashboardName, ownerId: c.ownerId, sources: c.sources, calc: c.calc, calcDefs: c.calcDefs } : null;
    },

    exec: liveExec,

    async dataChangedAt(sourceId) {
      const { data } = await admin.from("data_sources").select("data_changed_at, last_synced_at").eq("id", sourceId).maybeSingle();
      return (data?.data_changed_at as string | null) ?? (data?.last_synced_at as string | null) ?? null;
    },

    async isOptedOut(email, ruleId) {
      const { data } = await admin
        .from("notification_optouts")
        .select("id")
        .eq("email", email.toLowerCase())
        .eq("ref_kind", "alert")
        .or(`ref_id.is.null,ref_id.eq.${ruleId}`)
        .limit(1);
      return (data ?? []).length > 0;
    },

    send: sendMail,
    mailAllowed: (dashboardId) => mailAllowedForDashboard(dashboardId),

    async log(e) {
      await admin.from("notification_log").insert({ ...e, channel: "email" });
    },

    async save(ruleId, patch) {
      const { error } = await admin.from("alert_rules").update(patch).eq("id", ruleId);
      if (error) throw new Error(`alert_rules: ${error.message}`);
    },

    async creatorEmail(userId) {
      const { data } = await admin.auth.admin.getUserById(userId);
      return data.user?.email?.toLowerCase() ?? null;
    },

    async viewToken(dashboardId) {
      const { data } = await admin.from("dashboard_links").select("token").eq("dashboard_id", dashboardId).maybeSingle();
      return data?.token ?? null;
    },

    links(rule, email) {
      if (!unsubscribeConfigured()) return null;
      const exp = Math.floor(Date.now() / 1000) + SNOOZE_LINK_DAYS * 86_400;
      const unsub = createNotifyToken({ k: "alert", r: rule.id, e: email, a: "unsub" });
      const snooze = createNotifyToken({ k: "alert", r: rule.id, e: email, a: "snooze", x: exp });
      const mute = createNotifyToken({ k: "alert", r: rule.id, e: email, a: "mute" });
      return {
        pageUrl: unsubscribePageUrl(origin, unsub),
        apiUrl: unsubscribeApiUrl(origin, unsub),
        snoozeUrl: unsubscribePageUrl(origin, snooze),
        muteUrl: unsubscribePageUrl(origin, mute),
      };
    },

    explain: aiConfigured() ? (i, ownerId) => explainBilingual(liveChat(ownerId), i) : undefined,
  };
}
