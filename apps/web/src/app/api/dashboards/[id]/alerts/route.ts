import { NextResponse } from "next/server";
import { AlertDraft, AlertRuleInput } from "@dashboard/schema";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/server/session-user";
import { alertViolation, limitsOf, normalizePlan } from "@/lib/plan";
import { planForDashboard } from "@/lib/server/plan";
import { mailConfigured } from "@/lib/server/mail";
import { unsubscribeConfigured } from "@/lib/server/notify/unsubscribe";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { loadAlertContext } from "@/lib/server/alerts/context";
import { computeAlert, summarize } from "@/lib/server/alerts/compute";
import { checkRule } from "@/lib/server/alerts/validate";
import { liveExec } from "@/lib/server/reports/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string }> };

const evalLimited = createRateLimiter(20, 60_000);

/** Cột trả về cho giao diện (không gồm group_state). */
const COLUMNS =
  "id, dashboard_id, created_by, name, source_prompt, widget_id, metric, condition, recipients, channels, cooldown_minutes, notify_recover, enabled, snooze_until, last_state, last_value, last_checked_at, last_triggered_at, last_error, created_at";

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * Luật cảnh báo của một dashboard. Quyền: chủ dashboard quản lý mọi luật; người được mời/thành viên chỉ tạo và quản lý luật của
 * CHÍNH mình, và chỉ gửi tới email của chính mình (RLS của migration 0012 + kiểm ở đây).
 */
async function context(ctx: Params) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return { error: fail("ID không hợp lệ", 400) } as const;
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return { error: auth.response } as const;
  const { data: role } = await supabase.rpc("dashboard_role", { d: id });
  if (!role) return { error: fail("Bạn không có quyền với dashboard này", 403) } as const;
  return { supabase, id, user: auth.user, email: (auth.user.email ?? "").toLowerCase(), isOwner: role === "owner" } as const;
}

/** Nạp cấu trúc dashboard; lỗi (nguồn không thuộc workspace...) trả 500 với thông báo rõ ràng. */
async function structure(id: string) {
  try {
    return { ac: await loadAlertContext(id) } as const;
  } catch (e) {
    return { error: fail(e instanceof Error ? e.message : "Không đọc được dashboard", 500) } as const;
  }
}

export async function GET(_req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const { data, error } = await c.supabase.from("alert_rules").select(COLUMNS).eq("dashboard_id", c.id).order("created_at");
  if (error) return fail("Không đọc được danh sách cảnh báo", 500);
  const s = await structure(c.id);
  if ("error" in s) return s.error;
  const plan = (await planForDashboard(c.id))?.plan ?? normalizePlan(null);
  const lim = limitsOf(plan);
  return NextResponse.json(
    {
      rules: data ?? [],
      isOwner: c.isOwner,
      me: c.email,
      mailReady: mailConfigured() && unsubscribeConfigured(),
      limit: lim.alertRules,
      plan,
      planLabel: lim.label,
      limits: { types: lim.alertTypes, aiParsePerMonth: lim.aiAlertParsePerMonth },
      // Cấu trúc để dựng biểu mẫu: cột lấy từ DB (luôn mới nhất), không dựa vào bản trong doc.
      schema: s.ac
        ? { sources: s.ac.sources.map((x) => ({ id: x.id, name: x.name, columns: x.columns })), calc: s.ac.calc }
        : { sources: [], calc: [] },
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

/** POST: tạo luật. `?evaluate=1`: tính "giá trị hiện tại → bây giờ có báo không" cho bản nháp (không lưu). */
export async function POST(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const wantEval = new URL(req.url).searchParams.get("evaluate") === "1";
  const body = await req.json().catch(() => null);

  const s = await structure(c.id);
  if ("error" in s) return s.error;
  if (!s.ac) return fail("Không tìm thấy dashboard", 404);
  const ac = s.ac;

  if (wantEval) {
    if (evalLimited(c.user.id)) return fail("Bạn thao tác quá nhanh, thử lại sau ít phút.", 429);
    const d = AlertDraft.safeParse(body);
    if (!d.success) return fail(d.error.issues[0]?.message ?? "Thông tin không hợp lệ", 400);
    const errors = checkRule(d.data, ac.sources, ac.calc);
    if (errors.length) return fail(errors[0], 400, { errors });
    if (d.data.condition.type === "stale") return NextResponse.json({ summary: null, note: "stale" });
    try {
      const r = await computeAlert(d.data.metric, d.data.condition, { exec: liveExec, calc: ac.calcDefs(d.data.metric.sourceId), now: new Date() });
      return NextResponse.json({ summary: summarize(r) });
    } catch {
      return fail("Không tính được số liệu hiện tại cho luật này.", 500);
    }
  }

  const parsed = AlertRuleInput.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin không hợp lệ", 400);
  const input = parsed.data;
  const errors = checkRule(input, ac.sources, ac.calc);
  if (errors.length) return fail(errors[0], 400, { errors });
  // Người không phải chủ chỉ được gửi cảnh báo tới CHÍNH email của mình (không dùng tài khoản được mời để gửi thư cho người khác).
  if (!c.isOwner && (input.recipients.length !== 1 || input.recipients[0] !== c.email)) {
    return fail("Bạn chỉ tạo được cảnh báo gửi tới chính email của mình.", 403);
  }

  const admin = createAdminClient();
  const plan = (await planForDashboard(c.id))?.plan ?? normalizePlan(null);
  const { count } = await admin.from("alert_rules").select("id", { count: "exact", head: true }).eq("dashboard_id", c.id);
  const v = alertViolation(plan, input, count ?? 0, true);
  if (v) return fail(v.message, 403, { code: v.code });

  const { data, error } = await c.supabase
    .from("alert_rules")
    .insert({
      dashboard_id: c.id,
      created_by: c.user.id,
      name: input.name,
      source_prompt: input.source_prompt ?? null,
      widget_id: input.widget_id ?? null,
      metric: input.metric,
      condition: input.condition,
      recipients: input.recipients,
      channels: input.channels,
      cooldown_minutes: input.cooldown_minutes,
      notify_recover: input.notify_recover,
      enabled: input.enabled,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) return fail("Không tạo được luật cảnh báo", 500);
  return NextResponse.json({ rule: data }, { status: 201 });
}

/**
 * PATCH ?id=<luật>: sửa (gửi đủ các trường như lúc tạo).
 * PATCH ?id=<luật>&snooze=<giờ>: tạm hoãn N giờ (1–720); snooze=0 để bỏ tạm hoãn.
 */
export async function PATCH(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const ruleId = url.searchParams.get("id") ?? "";
  if (!UUID_RE.test(ruleId)) return fail("ID luật không hợp lệ", 400);

  const snooze = url.searchParams.get("snooze");
  if (snooze !== null) {
    const hours = Number(snooze);
    if (!Number.isFinite(hours) || hours < 0 || hours > 720) return fail("Số giờ tạm hoãn không hợp lệ", 400);
    const until = hours === 0 ? null : new Date(Date.now() + hours * 3_600_000).toISOString();
    const { data, error } = await c.supabase.from("alert_rules").update({ snooze_until: until }).eq("id", ruleId).eq("dashboard_id", c.id).select(COLUMNS).maybeSingle();
    if (error) return fail("Không lưu được thay đổi", 500);
    if (!data) return fail("Không tìm thấy luật (hoặc bạn không có quyền sửa)", 404);
    return NextResponse.json({ rule: data });
  }

  const parsed = AlertRuleInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin không hợp lệ", 400);
  const input = parsed.data;
  const s = await structure(c.id);
  if ("error" in s) return s.error;
  if (!s.ac) return fail("Không tìm thấy dashboard", 404);
  const errors = checkRule(input, s.ac.sources, s.ac.calc);
  if (errors.length) return fail(errors[0], 400, { errors });
  if (!c.isOwner && (input.recipients.length !== 1 || input.recipients[0] !== c.email)) {
    return fail("Bạn chỉ tạo được cảnh báo gửi tới chính email của mình.", 403);
  }

  const pv = alertViolation((await planForDashboard(c.id))?.plan ?? normalizePlan(null), input, 0, false);
  if (pv) return fail(pv.message, 403, { code: pv.code });

  const { data: old } = await c.supabase.from("alert_rules").select("metric, condition").eq("id", ruleId).eq("dashboard_id", c.id).maybeSingle();
  if (!old) return fail("Không tìm thấy luật (hoặc bạn không có quyền sửa)", 404);

  const { data, error } = await c.supabase
    .from("alert_rules")
    .update({
      name: input.name,
      source_prompt: input.source_prompt ?? null,
      widget_id: input.widget_id ?? null,
      metric: input.metric,
      condition: input.condition,
      recipients: input.recipients,
      channels: input.channels,
      cooldown_minutes: input.cooldown_minutes,
      notify_recover: input.notify_recover,
      enabled: input.enabled,
    })
    .eq("id", ruleId)
    .eq("dashboard_id", c.id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) return fail("Không lưu được thay đổi", 500);
  if (!data) return fail("Không tìm thấy luật (hoặc bạn không có quyền sửa)", 404);

  // Đổi chỉ số/điều kiện thì trạng thái cũ không còn đúng: bắt đầu lại (chỉ service role ghi được các cột trạng thái).
  if (JSON.stringify(old.metric) !== JSON.stringify(input.metric) || JSON.stringify(old.condition) !== JSON.stringify(input.condition)) {
    await createAdminClient()
      .from("alert_rules")
      .update({ last_state: "ok", last_value: null, last_error: null, last_checked_at: null, group_state: {} })
      .eq("id", ruleId);
  }
  return NextResponse.json({ rule: data });
}

export async function DELETE(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const ruleId = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(ruleId)) return fail("ID luật không hợp lệ", 400);
  const { data, error } = await c.supabase.from("alert_rules").delete().eq("id", ruleId).eq("dashboard_id", c.id).select("id");
  if (error) return fail("Không xoá được luật", 500);
  if (!data?.length) return fail("Không tìm thấy luật (hoặc bạn không có quyền xoá)", 404);
  return NextResponse.json({ ok: true });
}
