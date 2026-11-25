import { NextResponse } from "next/server";
import { AlertDraft, AlertRuleInput } from "@dashboard/schema";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/server/session-user";
import { alertViolation, limitsOf } from "@/lib/plan";
import { planForWorkspace } from "@/lib/server/plan";
import { mailConfigured } from "@/lib/server/mail";
import { unsubscribeConfigured } from "@/lib/server/notify/unsubscribe";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { membershipOf } from "@/lib/server/profit";
import { computeAlert, summarize } from "@/lib/server/alerts/compute";
import { checkRule } from "@/lib/server/alerts/validate";
import { loadWorkspaceAlertCtx } from "@/lib/server/workspace-notify/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f-]{36}$/i;
const evalLimited = createRateLimiter(20, 60_000);

/** Cột trả về cho giao diện (không gồm group_state). */
const COLUMNS =
  "id, dashboard_id, workspace_id, created_by, name, source_prompt, widget_id, metric, condition, recipients, channels, cooldown_minutes, notify_recover, enabled, snooze_until, last_state, last_value, last_checked_at, last_triggered_at, last_error, created_at";

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/** Cột chưa có: chưa chạy migration 0025. */
const needsMigration = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || e.code === "PGRST200" || /workspace_id/.test(e.message ?? ""));
const MIGRATION_MSG = "Cần chạy migration 0025_workspace_notify.sql trên Supabase trước khi dùng cảnh báo theo cửa hàng.";

/**
 * Cảnh báo theo CỬA HÀNG (workspace): đọc dữ liệu "Đơn hàng đa kênh" (doanh thu, lãi, tỷ lệ hủy/hoàn... của các trang lãi), không gắn dashboard.
 * Quyền: thành viên owner/editor quản lý mọi luật của cửa hàng; thành viên viewer chỉ tạo/quản lý luật của CHÍNH mình và chỉ gửi tới email của mình
 * (RLS của migration 0025 + kiểm ở đây). Luật cũ gắn dashboard vẫn chạy, được liệt kê riêng (`legacy`) để xem; sửa chúng ở dashboard tương ứng.
 */
async function context() {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return { error: auth.response } as const;
  const m = await membershipOf(supabase, auth.user.id);
  if (!m) return { error: fail("Bạn chưa thuộc cửa hàng nào", 403) } as const;
  return { supabase, workspaceId: m.workspaceId, user: auth.user, email: (auth.user.email ?? "").toLowerCase(), isOwner: m.editable } as const;
}

export async function GET() {
  const c = await context();
  if ("error" in c) return c.error;
  const { data, error } = await c.supabase.from("alert_rules").select(COLUMNS).eq("workspace_id", c.workspaceId).is("dashboard_id", null).order("created_at");
  if (error) {
    if (needsMigration(error)) return NextResponse.json({ rules: [], legacy: [], migrationNeeded: true, isOwner: c.isOwner, me: c.email, schema: { sources: [], calc: [] } });
    return fail("Không đọc được danh sách cảnh báo", 500);
  }

  // Luật cũ gắn dashboard (chỉ xem): tên dashboard lấy qua RLS của người dùng.
  const { data: old } = await c.supabase.from("alert_rules").select(COLUMNS).eq("workspace_id", c.workspaceId).not("dashboard_id", "is", null).order("created_at");
  const ids = [...new Set((old ?? []).map((r) => r.dashboard_id as string))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: ds } = await c.supabase.from("dashboards").select("id, name").in("id", ids);
    for (const d of ds ?? []) names.set(d.id as string, d.name as string);
  }

  const ac = await loadWorkspaceAlertCtx(c.workspaceId);
  const plan = await planForWorkspace(c.workspaceId);
  const lim = limitsOf(plan);
  return NextResponse.json(
    {
      rules: data ?? [],
      legacy: (old ?? []).map((r) => ({ ...r, dashboard_name: names.get(r.dashboard_id as string) ?? "Dashboard" })),
      isOwner: c.isOwner,
      me: c.email,
      mailReady: mailConfigured() && unsubscribeConfigured(),
      limit: lim.alertRules,
      plan,
      planLabel: lim.label,
      limits: { types: lim.alertTypes, aiParsePerMonth: lim.aiAlertParsePerMonth },
      noOrders: !ac,
      schema: ac ? { sources: [{ id: ac.ordersSourceId, name: "Đơn hàng đa kênh", columns: ac.sources[0].columns }], calc: ac.calc } : { sources: [], calc: [] },
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

/** POST: tạo luật. `?evaluate=1`: tính "giá trị hiện tại → bây giờ có báo không" cho bản nháp (không lưu). */
export async function POST(req: Request) {
  const c = await context();
  if ("error" in c) return c.error;
  const wantEval = new URL(req.url).searchParams.get("evaluate") === "1";
  const body = await req.json().catch(() => null);

  const ac = await loadWorkspaceAlertCtx(c.workspaceId);
  if (!ac) return fail("Cửa hàng chưa có dữ liệu đơn hàng. Hãy tải file đơn hàng hoặc nối Google Sheet đơn hàng ở trang Nguồn dữ liệu.", 409);

  if (wantEval) {
    if (evalLimited(c.user.id)) return fail("Bạn thao tác quá nhanh, thử lại sau ít phút.", 429);
    const d = AlertDraft.safeParse(body);
    if (!d.success) return fail(d.error.issues[0]?.message ?? "Thông tin không hợp lệ", 400);
    const errors = checkRule(d.data, ac.sources, ac.calc);
    if (errors.length) return fail(errors[0], 400, { errors });
    if (d.data.condition.type === "stale") return NextResponse.json({ summary: null, note: "stale" });
    try {
      const r = await computeAlert(d.data.metric, d.data.condition, { exec: ac.exec!, calc: ac.calcDefs(d.data.metric.sourceId), now: new Date() });
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
  if (!c.isOwner && (input.recipients.length !== 1 || input.recipients[0] !== c.email)) {
    return fail("Bạn chỉ tạo được cảnh báo gửi tới chính email của mình.", 403);
  }

  const plan = await planForWorkspace(c.workspaceId);
  const { count } = await createAdminClient().from("alert_rules").select("id", { count: "exact", head: true }).eq("workspace_id", c.workspaceId).is("dashboard_id", null);
  const v = alertViolation(plan, input, count ?? 0, true);
  if (v) return fail(v.message, 403, { code: v.code });

  const { data, error } = await c.supabase
    .from("alert_rules")
    .insert({
      workspace_id: c.workspaceId,
      dashboard_id: null,
      created_by: c.user.id,
      name: input.name,
      source_prompt: input.source_prompt ?? null,
      widget_id: null,
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
  if (error || !data) return needsMigration(error) ? fail(MIGRATION_MSG, 409) : fail("Không tạo được luật cảnh báo", 500);
  return NextResponse.json({ rule: data }, { status: 201 });
}

/**
 * PATCH ?id=<luật>: sửa (gửi đủ các trường như lúc tạo).
 * PATCH ?id=<luật>&snooze=<giờ>: tạm hoãn N giờ (1–720); snooze=0 để bỏ tạm hoãn.
 */
export async function PATCH(req: Request) {
  const c = await context();
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const ruleId = url.searchParams.get("id") ?? "";
  if (!UUID_RE.test(ruleId)) return fail("ID luật không hợp lệ", 400);

  const snooze = url.searchParams.get("snooze");
  if (snooze !== null) {
    const hours = Number(snooze);
    if (!Number.isFinite(hours) || hours < 0 || hours > 720) return fail("Số giờ tạm hoãn không hợp lệ", 400);
    const until = hours === 0 ? null : new Date(Date.now() + hours * 3_600_000).toISOString();
    const { data, error } = await c.supabase.from("alert_rules").update({ snooze_until: until }).eq("id", ruleId).eq("workspace_id", c.workspaceId).is("dashboard_id", null).select(COLUMNS).maybeSingle();
    if (error) return fail("Không lưu được thay đổi", 500);
    if (!data) return fail("Không tìm thấy luật (hoặc bạn không có quyền sửa)", 404);
    return NextResponse.json({ rule: data });
  }

  const parsed = AlertRuleInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin không hợp lệ", 400);
  const input = parsed.data;
  const ac = await loadWorkspaceAlertCtx(c.workspaceId);
  if (!ac) return fail("Cửa hàng chưa có dữ liệu đơn hàng.", 409);
  const errors = checkRule(input, ac.sources, ac.calc);
  if (errors.length) return fail(errors[0], 400, { errors });
  if (!c.isOwner && (input.recipients.length !== 1 || input.recipients[0] !== c.email)) {
    return fail("Bạn chỉ tạo được cảnh báo gửi tới chính email của mình.", 403);
  }
  const pv = alertViolation(await planForWorkspace(c.workspaceId), input, 0, false);
  if (pv) return fail(pv.message, 403, { code: pv.code });

  const { data: old } = await c.supabase.from("alert_rules").select("metric, condition").eq("id", ruleId).eq("workspace_id", c.workspaceId).is("dashboard_id", null).maybeSingle();
  if (!old) return fail("Không tìm thấy luật (hoặc bạn không có quyền sửa)", 404);

  const { data, error } = await c.supabase
    .from("alert_rules")
    .update({
      name: input.name,
      source_prompt: input.source_prompt ?? null,
      metric: input.metric,
      condition: input.condition,
      recipients: input.recipients,
      channels: input.channels,
      cooldown_minutes: input.cooldown_minutes,
      notify_recover: input.notify_recover,
      enabled: input.enabled,
    })
    .eq("id", ruleId)
    .eq("workspace_id", c.workspaceId)
    .is("dashboard_id", null)
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

export async function DELETE(req: Request) {
  const c = await context();
  if ("error" in c) return c.error;
  const ruleId = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(ruleId)) return fail("ID luật không hợp lệ", 400);
  const { data, error } = await c.supabase.from("alert_rules").delete().eq("id", ruleId).eq("workspace_id", c.workspaceId).is("dashboard_id", null).select("id");
  if (error) return fail("Không xoá được luật", 500);
  if (!data?.length) return fail("Không tìm thấy luật (hoặc bạn không có quyền xoá)", 404);
  return NextResponse.json({ ok: true });
}
