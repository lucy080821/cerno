import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideMute, snoozeUntil } from "@/lib/server/notify/actions";
import { verifyNotifyToken } from "@/lib/server/notify/unsubscribe";
import { clientIp, createRateLimiter } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limited = createRateLimiter(30, 60_000);

/** Lấy token từ ?t= (một chạm của Gmail/Outlook gửi POST tới đúng URL trong tiêu đề List-Unsubscribe) hoặc từ thân JSON. */
async function tokenOf(req: Request): Promise<string | null> {
  const q = new URL(req.url).searchParams.get("t");
  if (q) return q;
  const body = (await req.json().catch(() => null)) as { t?: unknown } | null;
  return typeof body?.t === "string" ? body.t : null;
}

/**
 * Các link không cần đăng nhập trong email báo cáo/cảnh báo (token ký HMAC):
 * - huỷ nhận (báo cáo và cảnh báo);
 * - cảnh báo: tạm hoãn 24 giờ, tắt cảnh báo.
 * Chỉ nhận POST: GET (bộ quét link của hộp thư, trình duyệt xem trước) không được phép làm thay người nhận.
 * Lặp lại nhiều lần không gây hại.
 */
export async function POST(req: Request) {
  if (limited(clientIp(req))) return NextResponse.json({ error: "Thử lại sau một phút." }, { status: 429 });
  const t = verifyNotifyToken(await tokenOf(req));
  if (!t) return NextResponse.json({ error: "Link không hợp lệ hoặc đã hết hạn." }, { status: 400 });
  if (t.a !== "unsub" && t.k !== "alert") return NextResponse.json({ error: "Thao tác này chưa được hỗ trợ." }, { status: 400 });

  try {
    const admin = createAdminClient();
    const optout = async () => {
      const { error } = await admin
        .from("notification_optouts")
        .upsert({ email: t.e, ref_kind: t.k, ref_id: t.r }, { onConflict: "email,ref_kind,ref_id", ignoreDuplicates: true });
      if (error) throw error;
    };

    if (t.a === "unsub") {
      await optout();
      // Báo cáo: tắt luôn đăng ký để giao diện hiện đúng trạng thái (chỉ dòng của đúng người nhận này).
      if (t.k === "report") await admin.from("report_subscriptions").update({ enabled: false }).eq("id", t.r).eq("recipient_email", t.e);
      return NextResponse.json({ ok: true, action: "unsub" });
    }

    if (t.a === "snooze") {
      const { data, error } = await admin.from("alert_rules").update({ snooze_until: snoozeUntil(new Date()) }).eq("id", t.r).select("id");
      if (error) throw error;
      if (!data?.length) return NextResponse.json({ error: "Cảnh báo này không còn tồn tại." }, { status: 404 });
      return NextResponse.json({ ok: true, action: "snooze" });
    }

    // mute
    const { data: rule } = await admin.from("alert_rules").select("recipients, created_by").eq("id", t.r).maybeSingle();
    if (!rule) return NextResponse.json({ error: "Cảnh báo này không còn tồn tại." }, { status: 404 });
    const creator = (await admin.auth.admin.getUserById(rule.created_by)).data.user?.email ?? null;
    if (decideMute(rule.recipients ?? [], t.e, creator) === "disable") {
      const { error } = await admin.from("alert_rules").update({ enabled: false }).eq("id", t.r);
      if (error) throw error;
    } else {
      await optout();
    }
    return NextResponse.json({ ok: true, action: "mute" });
  } catch {
    return NextResponse.json({ error: "Chưa huỷ được, vui lòng thử lại sau." }, { status: 500 });
  }
}
