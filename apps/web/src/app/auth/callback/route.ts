import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveRefreshToken } from "@/lib/google/api";
import { NEXT_COOKIE, safeNext } from "@/lib/auth/next";
import { publicOrigin } from "@/lib/auth/public-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Google quay về đây với ?code=. Đổi lấy phiên, rồi lưu refresh token (mã hoá) để đồng bộ Sheets. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = publicOrigin(request);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/login?error=no_code`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) return NextResponse.redirect(`${origin}/login?error=exchange`);

  // Google chỉ trả refresh token khi người dùng đồng ý (prompt=consent). Không có thì giữ token cũ.
  const refresh = data.session.provider_refresh_token;
  if (refresh) {
    try {
      await saveRefreshToken(data.session.user.id, refresh);
    } catch (e) {
      console.error("Không lưu được refresh token Google:", e instanceof Error ? e.message : e);
      return NextResponse.redirect(`${origin}/login?error=token_store`);
    }
  }
  // Quay lại trang người dùng định vào (link được mời), nếu hợp lệ; ngược lại về danh sách dashboard.
  const target = safeNext(request.cookies.get(NEXT_COOKIE)?.value) ?? "/dashboards";
  const res = NextResponse.redirect(`${origin}${target}`);
  res.cookies.set(NEXT_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
