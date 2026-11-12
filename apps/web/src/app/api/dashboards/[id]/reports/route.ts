import { NextResponse } from "next/server";
import { ReportSubscriptionInput } from "@dashboard/schema";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/server/session-user";
import { requestOrigin } from "@/lib/auth/public-origin";
import { limitsOf, normalizePlan, reportViolation } from "@/lib/plan";
import { planForDashboard } from "@/lib/server/plan";
import { mailConfigured, sendMail } from "@/lib/server/mail";
import { unsubscribeConfigured } from "@/lib/server/notify/unsubscribe";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { composeReport, createComposeCaches } from "@/lib/server/reports/compose";
import { liveComposeDeps } from "@/lib/server/reports/live";
import { inlineCidImages, scheduleFor, subscriptionColumns, testSubject } from "@/lib/server/reports/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string }> };

// Xem trước và gửi thử tốn lượt AI/ảnh/email nên giới hạn chặt theo người dùng.
const previewLimited = createRateLimiter(6, 60_000);
const testLimited = createRateLimiter(3, 10 * 60_000);

const COLUMNS =
  "id, dashboard_id, created_by, recipient_email, recipient_name, prompt, frequency, weekday, month_day, hour_vn, widget_ids, include_images, link_mode, enabled, next_run_at, last_sent_at, last_error, created_at";

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * Báo cáo định kỳ qua email của một dashboard. Quyền do RLS (migration 0012) và dashboard_role quyết định:
 * chủ dashboard quản lý mọi người nhận; người được mời/thành viên chỉ đăng ký cho CHÍNH email của mình.
 */
async function context(ctx: Params) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return { error: fail("ID không hợp lệ", 400) } as const;
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return { error: auth.response } as const;
  const { data: role } = await supabase.rpc("dashboard_role", { d: id });
  if (!role) return { error: fail("Bạn không có quyền với dashboard này", 403) } as const;
  const email = (auth.user.email ?? "").toLowerCase();
  return { supabase, id, user: auth.user, email, isOwner: role === "owner" } as const;
}

export async function GET(_req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const { data, error } = await c.supabase.from("report_subscriptions").select(COLUMNS).eq("dashboard_id", c.id).order("created_at");
  if (error) return fail("Không đọc được danh sách báo cáo", 500);
  // Người không phải chủ không đọc được dashboard_links qua RLS: chỉ hỏi "có đang bật không" bằng service role (không lộ mã).
  const plan = (await planForDashboard(c.id))?.plan ?? normalizePlan(null);
  const lim = limitsOf(plan);
  const { data: link } = await createAdminClient().from("dashboard_links").select("dashboard_id").eq("dashboard_id", c.id).maybeSingle();
  return NextResponse.json(
    {
      subscriptions: data ?? [],
      isOwner: c.isOwner,
      me: c.email,
      viewLinkEnabled: !!link,
      mailReady: mailConfigured() && unsubscribeConfigured(),
      limit: lim.reportSubscriptions,
      plan,
      planLabel: lim.label,
      limits: { frequencies: lim.reportFrequencies, aiReports: lim.aiReports },
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

/** POST: tạo đăng ký. `?preview=1` xem trước (không lưu, không gửi). `?test=1` gửi thử cho chính mình. */
export async function POST(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const parsed = ReportSubscriptionInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin không hợp lệ", 400);
  const input = parsed.data;
  if (!c.isOwner && input.recipient_email !== c.email) return fail("Bạn chỉ đăng ký nhận báo cáo cho chính email của mình.", 403);

  const origin = requestOrigin(req);
  const wantPreview = url.searchParams.get("preview") === "1";
  const wantTest = url.searchParams.get("test") === "1";

  if (wantPreview || wantTest) {
    if (wantTest && !c.email) return fail("Tài khoản của bạn chưa có email để gửi thử.", 400);
    if (wantTest ? testLimited(c.user.id) : previewLimited(c.user.id)) return fail("Bạn thao tác quá nhanh, thử lại sau ít phút.", 429);
    if (wantTest && !mailConfigured()) return fail("Máy chủ chưa cấu hình gửi email.", 503);

    let r;
    try {
      r = await composeReport(liveComposeDeps(origin), c.id, input, {
        now: new Date(),
        caches: createComposeCaches(),
        // Thư xem trước/thử không phải đăng ký thật: link huỷ nhận chỉ dẫn về trang quản lý.
        unsubscribeUrl: `${origin}/dashboards`,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Không soạn được báo cáo.", 500);
    }
    if (!r.ok) return fail(r.error, 404);

    if (wantPreview) {
      return NextResponse.json({
        subject: r.email.subject,
        html: inlineCidImages(r.email.html, r.images),
        text: r.email.text,
        meta: r.meta,
      });
    }
    const sent = await sendMail({
      to: c.email,
      subject: testSubject(r.email.subject),
      html: r.email.html,
      text: r.email.text,
      images: r.images,
    });
    if (!sent.ok) return fail("Không gửi được email thử, thử lại sau.", 502);
    return NextResponse.json({ sent: true, to: c.email, meta: r.meta });
  }

  // Tạo đăng ký thật.
  const admin = createAdminClient();
  const plan = (await planForDashboard(c.id))?.plan ?? normalizePlan(null);
  const { count } = await admin.from("report_subscriptions").select("id", { count: "exact", head: true }).eq("dashboard_id", c.id);
  const v = reportViolation(plan, input, count ?? 0, true);
  if (v) return fail(v.message, 403, { code: v.code });
  const { data, error } = await c.supabase
    .from("report_subscriptions")
    .insert({ dashboard_id: c.id, created_by: c.user.id, ...subscriptionColumns(input) })
    .select(COLUMNS)
    .single();
  if (error || !data) return fail("Không tạo được đăng ký báo cáo", 500);
  // Lịch chạy chỉ service role được ghi (column grant): đặt ngay sau khi RLS đã cho phép tạo.
  const { data: scheduled } = await admin.from("report_subscriptions").update(scheduleFor(input, new Date())).eq("id", data.id).select(COLUMNS).single();
  return NextResponse.json({ subscription: scheduled ?? data }, { status: 201 });
}

/** PATCH ?id=<đăng ký>: sửa (gửi đủ các trường cấu hình, giống lúc tạo). */
export async function PATCH(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const subId = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(subId)) return fail("ID đăng ký không hợp lệ", 400);
  const parsed = ReportSubscriptionInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin không hợp lệ", 400);
  const input = parsed.data;
  if (!c.isOwner && input.recipient_email !== c.email) return fail("Bạn chỉ đăng ký nhận báo cáo cho chính email của mình.", 403);

  const v = reportViolation((await planForDashboard(c.id))?.plan ?? normalizePlan(null), input, 0, false);
  if (v) return fail(v.message, 403, { code: v.code });

  const { data, error } = await c.supabase
    .from("report_subscriptions")
    .update(subscriptionColumns(input))
    .eq("id", subId)
    .eq("dashboard_id", c.id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) return fail("Không lưu được thay đổi", 500);
  if (!data) return fail("Không tìm thấy đăng ký (hoặc bạn không có quyền sửa)", 404);
  const { data: scheduled } = await createAdminClient().from("report_subscriptions").update(scheduleFor(input, new Date())).eq("id", subId).select(COLUMNS).single();
  return NextResponse.json({ subscription: scheduled ?? data });
}

/** DELETE ?id=<đăng ký>. */
export async function DELETE(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const subId = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(subId)) return fail("ID đăng ký không hợp lệ", 400);
  const { data, error } = await c.supabase.from("report_subscriptions").delete().eq("id", subId).eq("dashboard_id", c.id).select("id");
  if (error) return fail("Không xoá được đăng ký", 500);
  if (!data?.length) return fail("Không tìm thấy đăng ký (hoặc bạn không có quyền xoá)", 404);
  return NextResponse.json({ ok: true });
}
