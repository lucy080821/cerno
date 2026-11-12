import {
  AlertDraft, nextAlertState, nextGroupState, MAX_GROUPS_LISTED,
  type AlertCondition, type AlertMetric, type AlertState, type GroupState, type Notify,
} from "@dashboard/schema";
import type { CalcFieldDef } from "@dashboard/chart-engine";
import type { InlineImage, MailMessage, SendResult } from "@/lib/server/mail";
import { buildAlertEmail, type AlertEmailInput, type AlertEmailKind } from "@/lib/server/mail/alert-email";
import { alertChartPng } from "./chart";
import { computeAlert, computeSeries, summarize, verdictOf, type AlertComputation, type Executor } from "./compute";
import { conditionSentence, metricLabel, thresholdText } from "./describe";
import type { ExplainInput } from "./explain";
import { checkRule, type CalcInfo, type SourceInfo } from "./validate";

/**
 * Chạy luật cảnh báo: tính số liệu → đánh giá → quyết định có gửi thư không (trạng thái, thời gian chờ, tạm hoãn, theo nhóm) →
 * gửi email → ghi trạng thái. Gọi từ đồng bộ dữ liệu (luật thường) và từ cron (luật "không có dữ liệu mới").
 * Mọi phụ thuộc truyền vào (DB, SMTP, AI) nên kiểm thử được. Lỗi của MỘT luật không ảnh hưởng luật khác; hàm không ném lỗi ra ngoài.
 */

export interface RuleRow {
  id: string;
  dashboard_id: string;
  created_by: string;
  name: string;
  metric: unknown;
  condition: unknown;
  recipients: string[];
  cooldown_minutes: number;
  notify_recover: boolean;
  enabled: boolean;
  snooze_until: string | null;
  last_state: AlertState;
  last_value: number | null;
  last_triggered_at: string | null;
  last_error: string | null;
  group_state: unknown;
}

export interface AlertCtx {
  dashboardName: string;
  ownerId: string;
  sources: SourceInfo[];
  calc: CalcInfo[];
  calcDefs(sourceId: string): CalcFieldDef[];
}

export interface AlertLinks {
  pageUrl: string;
  apiUrl: string;
  snoozeUrl: string;
  muteUrl: string;
}

export interface RulePatch {
  last_state?: AlertState;
  last_value?: number | null;
  last_checked_at?: string;
  last_triggered_at?: string | null;
  last_error?: string | null;
  group_state?: GroupState;
}

export interface AlertLog {
  kind: "alert";
  ref_id: string;
  dashboard_id: string;
  recipient: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  meta: Record<string, unknown>;
}

export interface AlertDeps {
  now(): Date;
  rulesForSource(sourceId: string): Promise<RuleRow[]>;
  staleRules(): Promise<RuleRow[]>;
  context(dashboardId: string): Promise<AlertCtx | null>;
  exec: Executor;
  /** Lúc dữ liệu của nguồn đổi lần cuối (ISO), null nếu chưa biết. */
  dataChangedAt(sourceId: string): Promise<string | null>;
  isOptedOut(email: string, ruleId: string): Promise<boolean>;
  send(m: MailMessage): Promise<SendResult>;
  log(e: AlertLog): Promise<void>;
  save(ruleId: string, patch: RulePatch): Promise<void>;
  creatorEmail(userId: string): Promise<string | null>;
  viewToken(dashboardId: string): Promise<string | null>;
  /** null = chưa cấu hình khoá link (KHÔNG được gửi: luôn phải có link huỷ nhận). */
  links(rule: RuleRow, email: string): AlertLinks | null;
  explain?(i: ExplainInput, ownerId: string): Promise<string | null>;
  origin: string;
  appName?: string;
}

export interface RuleOutcome {
  ruleId: string;
  state: AlertState | "skipped";
  notify: Notify | "error";
  sent: number;
}

export interface EvalSummary {
  evaluated: number;
  notified: number;
  errors: number;
  outcomes: RuleOutcome[];
}

const MAX_RECIPIENTS = 20;
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);

function parseGroupState(v: unknown): GroupState {
  const out = Object.create(null) as GroupState;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
      const o = e as { since?: unknown; notifiedAt?: unknown } | null;
      if (o && typeof o.since === "string") out[k] = { since: o.since, notifiedAt: typeof o.notifiedAt === "string" ? o.notifiedAt : null };
    }
  }
  return out;
}

const dmyHm = (iso: string) => {
  const d = new Date(Date.parse(iso) + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

// ---------------------------------------------------------------------------------------------
// Gửi thư cho người nhận
// ---------------------------------------------------------------------------------------------

type EmailParts = Omit<AlertEmailInput, "appName" | "kind" | "ruleName" | "dashboardName" | "dashboardUrl" | "snoozeUrl" | "muteUrl" | "unsubscribeUrl">;

/** Gửi thư tới các email trong `to` (bỏ người đã huỷ nhận). Trả số thư gửi thành công. */
async function deliver(
  rule: RuleRow, ctx: AlertCtx, kind: AlertEmailKind, parts: EmailParts, to: string[], deps: AlertDeps,
  image: InlineImage | null, meta: Record<string, unknown>,
): Promise<number> {
  const token = await deps.viewToken(rule.dashboard_id);
  const dashboardUrl = token ? `${deps.origin}/view/${token}` : `${deps.origin}/d/${rule.dashboard_id}`;
  let sent = 0;
  for (const email of [...new Set(to.map((x) => x.toLowerCase()))].slice(0, MAX_RECIPIENTS)) {
    const base = { kind: "alert" as const, ref_id: rule.id, dashboard_id: rule.dashboard_id, recipient: email };
    try {
      if (await deps.isOptedOut(email, rule.id)) {
        await deps.log({ ...base, status: "skipped", meta: { ...meta, reason: "optout" } });
        continue;
      }
      const links = deps.links(rule, email);
      if (!links) {
        await deps.log({ ...base, status: "failed", error: "Chưa cấu hình UNSUBSCRIBE_SECRET", meta });
        continue;
      }
      const mail = buildAlertEmail({
        ...parts, appName: deps.appName ?? "Cerno", kind, ruleName: rule.name, dashboardName: ctx.dashboardName, dashboardUrl,
        snoozeUrl: links.snoozeUrl, muteUrl: links.muteUrl, unsubscribeUrl: links.pageUrl,
      });
      const r = await deps.send({
        to: email, subject: mail.subject, html: mail.html, text: mail.text,
        ...(image ? { images: [image] } : {}),
        headers: { "List-Unsubscribe": `<${links.apiUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      await deps.log({ ...base, status: r.ok ? "sent" : "failed", ...(r.ok ? {} : { error: r.code === "not_configured" ? "Máy chủ chưa cấu hình gửi email." : "Không gửi được email." }), meta: { ...meta, ...(r.ok ? {} : { code: r.code }) } });
      if (r.ok) sent++;
    } catch (e) {
      await deps.log({ ...base, status: "failed", error: (e instanceof Error ? e.message : "Lỗi").slice(0, 200), meta }).catch(() => {});
    }
  }
  return sent;
}

/** Ảnh mini chart 14 kỳ có vạch ngưỡng (chỉ luật một giá trị có khoảng thời gian). Lỗi vẽ thì bỏ ảnh. */
async function chartFor(draft: AlertDraft2, comp: AlertComputation, ctx: AlertCtx, deps: AlertDeps): Promise<{ image: InlineImage; alt: string } | null> {
  if (comp.kind !== "single") return null;
  try {
    const series = await computeSeries(draft.metric, { exec: deps.exec, calc: ctx.calcDefs(draft.metric.sourceId), now: deps.now() }, 14);
    if (!series) return null;
    const c = draft.condition;
    const threshold = c.type === "threshold" ? c.value : null;
    const title = `${metricLabel(draft.metric, ctx.calc.map((x) => x.name))} · ${series.labels.length} kỳ gần nhất`;
    const png = alertChartPng(series, threshold, title);
    if (!png) return null;
    return { image: { filename: "canh-bao.png", content: png.png, cid: "alert-chart@cerno.report", contentType: "image/png" }, alt: title };
  } catch {
    return null;
  }
}

type AlertDraft2 = { metric: AlertMetric; condition: AlertCondition };

// ---------------------------------------------------------------------------------------------
// Một luật
// ---------------------------------------------------------------------------------------------

/** Đánh dấu luật lỗi (cột đổi tên/xoá...) và báo người tạo MỘT lần (khi vừa chuyển sang lỗi). */
async function markError(rule: RuleRow, ctx: AlertCtx | null, message: string, deps: AlertDeps): Promise<RuleOutcome> {
  const first = rule.last_state !== "error";
  await deps.save(rule.id, { last_state: "error", last_error: message.slice(0, 300), last_checked_at: deps.now().toISOString() });
  let sent = 0;
  if (first && ctx) {
    sent = await notifyCreatorOfErrorCount(rule, ctx, message, deps);
  }
  return { ruleId: rule.id, state: "error", notify: first ? "error" : null, sent };
}

async function notifyCreatorOfErrorCount(rule: RuleRow, ctx: AlertCtx, message: string, deps: AlertDeps): Promise<number> {
  const email = await deps.creatorEmail(rule.created_by);
  if (!email) return 0;
  return deliver(rule, ctx, "error", { sentence: `Luật “${rule.name}” không chạy được`, summary: null, thresholdText: null, errorText: message }, [email], deps, null, { notify: "error" });
}

/** Đánh giá và (nếu cần) gửi cảnh báo cho MỘT luật không phải `stale`. */
export async function processRule(rule: RuleRow, deps: AlertDeps, ctxCache: Map<string, Promise<AlertCtx | null>> = new Map()): Promise<RuleOutcome> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const skip = (): RuleOutcome => ({ ruleId: rule.id, state: "skipped", notify: null, sent: 0 });
  if (!rule.enabled) return skip();

  const parsed = AlertDraft.safeParse({ metric: rule.metric, condition: rule.condition });
  let ctxP = ctxCache.get(rule.dashboard_id);
  if (!ctxP) {
    ctxP = deps.context(rule.dashboard_id);
    ctxCache.set(rule.dashboard_id, ctxP);
  }
  const ctx = await ctxP;
  if (!parsed.success) return markError(rule, ctx, "Luật không còn hợp lệ, hãy mở và lưu lại luật này.", deps);
  if (!ctx) return skip(); // dashboard đã bị xoá: luật sẽ bị xoá theo (cascade)
  const draft = parsed.data;
  if (draft.condition.type === "stale") return skip();

  // Cột/nguồn của luật còn tồn tại không (có thể đã đổi tên hoặc xoá sau khi tạo luật)?
  const problems = checkRule(draft, ctx.sources, ctx.calc);
  if (problems.length) return markError(rule, ctx, problems[0], deps);

  let comp: AlertComputation;
  try {
    comp = await computeAlert(draft.metric, draft.condition, { exec: deps.exec, calc: ctx.calcDefs(draft.metric.sourceId), now });
  } catch {
    // Lỗi tạm thời (DB, truy vấn): giữ nguyên trạng thái, ghi nhận để người dùng thấy.
    await deps.save(rule.id, { last_checked_at: nowIso, last_error: "Không tính được số liệu lần này, sẽ thử lại ở lần cập nhật dữ liệu sau." });
    return { ruleId: rule.id, state: rule.last_state, notify: null, sent: 0 };
  }

  const verdict = verdictOf(comp);
  if (verdict === "deferred") {
    await deps.save(rule.id, { last_checked_at: nowIso, last_error: null });
    return { ruleId: rule.id, state: rule.last_state, notify: null, sent: 0 };
  }

  // ---- Quyết định gửi ----
  const prev = { state: rule.last_state, lastTriggeredAt: rule.last_triggered_at ? new Date(rule.last_triggered_at) : null };
  const snooze = rule.snooze_until ? new Date(rule.snooze_until) : null;
  const base = nextAlertState(prev, verdict, now, rule.cooldown_minutes, rule.notify_recover, snooze);
  let notify: Notify = base.notify;
  let groupState: GroupState | undefined;
  let groupsToList: string[] = [];

  if (comp.kind === "groups") {
    const g = nextGroupState(parseGroupState(rule.group_state), comp.violating.map((v) => v.group), now, rule.cooldown_minutes, snooze, MAX_GROUPS_LISTED);
    groupState = g.state;
    groupsToList = g.notify;
    notify = g.notify.length > 0 ? (prev.state === "firing" ? "remind" : "fire") : base.notify === "recover" ? "recover" : null;
  }
  const triggered = notify === "fire" || notify === "remind";
  let lastTriggeredAt = triggered ? now : base.lastTriggeredAt;

  // ---- Gửi ----
  let sent = 0;
  let sendFailed = false;
  if (notify) {
    const summary = summarize(comp);
    const sentence = conditionSentence(draft.condition, draft.metric, comp.info.label, { calcNames: ctx.calc.map((c) => c.name), prevLabel: comp.info.prevLabel });
    const parts: EmailParts = { sentence, summary, thresholdText: thresholdText(draft.condition) };
    if (comp.kind === "groups") {
      const items = comp.violating.filter((v) => groupsToList.includes(v.group)).map((v) => ({
        name: v.group,
        detail: v.evaluation.changePct != null ? `${v.evaluation.changePct > 0 ? "+" : "−"}${Math.abs(Math.round(v.evaluation.changePct * 10) / 10).toLocaleString("vi-VN")}%` : (v.evaluation.value ?? 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 }),
      }));
      parts.groups = { groupBy: comp.groupBy, items, more: Math.max(0, comp.violating.length - items.length) };
    }
    let image: InlineImage | null = null;
    if (notify !== "recover") {
      const chart = await chartFor(draft, comp, ctx, deps);
      if (chart) {
        image = chart.image;
        parts.chart = { cid: chart.image.cid, alt: chart.alt };
      }
    }
    if (notify === "fire" && deps.explain) {
      parts.explain = await deps.explain({ ruleName: rule.name, sentence, summary, condition: draft.condition }, ctx.ownerId).catch(() => null);
    }
    const kind: AlertEmailKind = notify === "recover" ? "recover" : notify === "remind" ? "remind" : "fire";
    sent = await deliver(rule, ctx, kind, parts, rule.recipients, deps, image, {
      notify, verdict, label: comp.info.label, ai: !!parts.explain, chart: !!image,
      ...(comp.kind === "groups" ? { groups: groupsToList.length } : {}),
    });
    // Không gửi được cho ai thì KHÔNG ghi là đã báo: lần cập nhật dữ liệu sau sẽ thử lại.
    if (triggered && sent === 0 && rule.recipients.length > 0) {
      sendFailed = true;
      lastTriggeredAt = prev.lastTriggeredAt;
      if (comp.kind === "groups") groupState = parseGroupState(rule.group_state);
    }
  }

  const value = comp.kind === "single" ? num(comp.evaluation.value) : comp.kind === "groups" ? comp.violating.length : null;
  await deps.save(rule.id, {
    last_state: base.state,
    last_value: value,
    last_checked_at: nowIso,
    last_triggered_at: lastTriggeredAt ? lastTriggeredAt.toISOString() : null,
    last_error: sendFailed ? "Không gửi được email cảnh báo, sẽ thử lại ở lần cập nhật dữ liệu sau." : null,
    ...(groupState ? { group_state: groupState } : {}),
  });
  return { ruleId: rule.id, state: base.state, notify, sent };
}

// ---------------------------------------------------------------------------------------------
// Luật "không có dữ liệu mới trong X giờ"
// ---------------------------------------------------------------------------------------------

async function processStale(rule: RuleRow, deps: AlertDeps, ctxCache: Map<string, Promise<AlertCtx | null>>): Promise<RuleOutcome> {
  if (!rule.enabled) return { ruleId: rule.id, state: "skipped", notify: null, sent: 0 };
  const now = deps.now();
  const nowIso = now.toISOString();
  const parsed = AlertDraft.safeParse({ metric: rule.metric, condition: rule.condition });
  let ctxP = ctxCache.get(rule.dashboard_id);
  if (!ctxP) {
    ctxP = deps.context(rule.dashboard_id);
    ctxCache.set(rule.dashboard_id, ctxP);
  }
  const ctx = await ctxP;
  if (!parsed.success || parsed.data.condition.type !== "stale") return markError(rule, ctx, "Luật không còn hợp lệ, hãy mở và lưu lại luật này.", deps);
  if (!ctx) return { ruleId: rule.id, state: "skipped", notify: null, sent: 0 };
  const draft = parsed.data;
  const cond = draft.condition as Extract<AlertCondition, { type: "stale" }>;
  const problems = checkRule(draft, ctx.sources, ctx.calc);
  if (problems.length) return markError(rule, ctx, problems[0], deps);

  const changedAt = await deps.dataChangedAt(draft.metric.sourceId);
  const hoursAgo = changedAt ? (now.getTime() - Date.parse(changedAt)) / 3_600_000 : null;
  const verdict = hoursAgo === null ? "insufficient" : hoursAgo > cond.hours ? "firing" : "ok";

  const prev = { state: rule.last_state, lastTriggeredAt: rule.last_triggered_at ? new Date(rule.last_triggered_at) : null };
  const snooze = rule.snooze_until ? new Date(rule.snooze_until) : null;
  const res = nextAlertState(prev, verdict, now, rule.cooldown_minutes, rule.notify_recover, snooze);

  let sent = 0;
  let lastTriggeredAt = res.lastTriggeredAt;
  let failed = false;
  if (res.notify) {
    const kind: AlertEmailKind = res.notify === "recover" ? "recover" : res.notify === "remind" ? "remind" : "fire";
    sent = await deliver(
      rule, ctx, kind,
      { sentence: conditionSentence(cond, draft.metric, "", {}), summary: null, thresholdText: null, stale: { hoursAgo: hoursAgo ?? 0, sinceText: changedAt ? dmyHm(changedAt) : null } },
      rule.recipients, deps, null, { notify: res.notify, verdict, hoursAgo: hoursAgo === null ? null : Math.round(hoursAgo * 10) / 10 },
    );
    if ((res.notify === "fire" || res.notify === "remind") && sent === 0 && rule.recipients.length > 0) {
      failed = true;
      lastTriggeredAt = prev.lastTriggeredAt;
    }
  }
  await deps.save(rule.id, {
    last_state: res.state,
    last_value: hoursAgo === null ? null : Math.round(hoursAgo * 10) / 10,
    last_checked_at: nowIso,
    last_triggered_at: lastTriggeredAt ? lastTriggeredAt.toISOString() : null,
    last_error: failed ? "Không gửi được email cảnh báo, sẽ thử lại ở lần kiểm tra sau." : null,
  });
  return { ruleId: rule.id, state: res.state, notify: res.notify, sent };
}

// ---------------------------------------------------------------------------------------------

async function runAll(rules: RuleRow[], fn: (r: RuleRow) => Promise<RuleOutcome>, errorsOut: { n: number }): Promise<RuleOutcome[]> {
  const out: RuleOutcome[] = [];
  for (const r of rules) {
    try {
      out.push(await fn(r));
    } catch (e) {
      errorsOut.n++;
      console.error("[alerts] luật lỗi:", r.id, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

const summarizeRun = (outcomes: RuleOutcome[], errors: number): EvalSummary => ({
  evaluated: outcomes.filter((o) => o.state !== "skipped").length,
  notified: outcomes.reduce((n, o) => n + (o.sent > 0 ? 1 : 0), 0),
  errors: errors + outcomes.filter((o) => o.state === "error").length,
  outcomes,
});

/**
 * Chạy mọi luật (không phải stale) của một nguồn, SAU khi dữ liệu nguồn đã đổi. Không ném lỗi: lỗi cảnh báo không được làm hỏng đồng bộ.
 */
export async function evaluateAlertsForSource(sourceId: string, deps: AlertDeps): Promise<EvalSummary> {
  const err = { n: 0 };
  try {
    const rules = await deps.rulesForSource(sourceId);
    const cache = new Map<string, Promise<AlertCtx | null>>();
    const outcomes = await runAll(rules, (r) => processRule(r, deps, cache), err);
    return summarizeRun(outcomes, err.n);
  } catch (e) {
    console.error("[alerts] không chạy được luật của nguồn", sourceId, e instanceof Error ? e.message : e);
    return { evaluated: 0, notified: 0, errors: 1, outcomes: [] };
  }
}

/** Chạy mọi luật "không có dữ liệu mới" (gọi từ cron, không cần dữ liệu đổi). */
export async function evaluateStaleRules(deps: AlertDeps): Promise<EvalSummary> {
  const err = { n: 0 };
  try {
    const rules = await deps.staleRules();
    const cache = new Map<string, Promise<AlertCtx | null>>();
    const outcomes = await runAll(rules, (r) => processStale(r, deps, cache), err);
    return summarizeRun(outcomes, err.n);
  } catch (e) {
    console.error("[alerts] không chạy được luật stale", e instanceof Error ? e.message : e);
    return { evaluated: 0, notified: 0, errors: 1, outcomes: [] };
  }
}
