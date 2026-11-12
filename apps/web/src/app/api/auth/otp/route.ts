import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/embed/email";
import { clientIp, createRateLimiter } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const perIp = createRateLimiter(10, 60 * 60 * 1000);
const perEmail = createRateLimiter(5, 60 * 60 * 1000);

/**
 * Gửi mã đăng nhập 6 số tới email, DÀNH CHO NGƯỜI ĐƯỢC MỜI (không dùng được để tự đăng ký tài khoản):
 * chỉ gửi khi email có trong `dashboard_access`. Phản hồi luôn là { ok: true } dù email có được mời hay không,
 * để không ai dò được email nào đã được mời. Việc kiểm tra mã làm ở trình duyệt (supabase.auth.verifyOtp).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  if (!email) return NextResponse.json({ error: "Email không hợp lệ." }, { status: 400 });
  if (perIp(clientIp(req)) || perEmail(email)) {
    return NextResponse.json({ error: "Bạn thử quá nhiều lần. Hãy đợi một lúc rồi thử lại." }, { status: 429 });
  }

  try {
    const { data } = await createAdminClient().from("dashboard_access").select("dashboard_id").eq("email", email).limit(1);
    if (data && data.length > 0) {
      const { error } = await (await createClient()).auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) console.error("Sign-in code send failed:", error.message);
    }
  } catch (e) {
    console.error("Sign-in code error:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
