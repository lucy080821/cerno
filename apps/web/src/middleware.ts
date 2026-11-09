import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { frameAncestors } from "@/lib/embed/domains";
import { TOKEN_RE } from "@/lib/embed/token";
import { safeNext } from "@/lib/auth/next";

/**
 * Làm mới phiên Supabase ở mỗi request và chặn trang cần đăng nhập.
 * Cả /dashboards và /editor đều yêu cầu đăng nhập. Người đã đăng nhập vào / hoặc /login thì chuyển tới /dashboards.
 */
const PROTECTED = ["/dashboards", "/editor", "/account", "/d"];
const isProtected = (path: string) => PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Trang nhúng /embed/<mã>: đặt CSP `frame-ancestors` theo danh sách tên miền của dashboard đó, nên chỉ website
 * khách khai báo mới nhúng được (trình duyệt chặn các trang khác). Lỗi hoặc không có mã thì "không ai nhúng được".
 * Hỏi DB bằng khoá anon qua hàm embed_domains_for (chỉ trả danh sách tên miền của đúng một mã).
 */
async function embedResponse(request: NextRequest, url: string | undefined, anon: string | undefined) {
  const token = request.nextUrl.pathname.split("/")[2] ?? "";
  let domains: string[] = [];
  if (url && anon && TOKEN_RE.test(token)) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/embed_domains_for`, {
        method: "POST",
        headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
        body: JSON.stringify({ p_token: token }),
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const json: unknown = await res.json();
        if (Array.isArray(json)) domains = json.filter((x): x is string => typeof x === "string");
      }
    } catch {
      /* lỗi mạng: giữ danh sách rỗng, tức không cho ai nhúng */
    }
  }
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", frameAncestors(domains));
  // Mã nằm trong URL: không để lọt sang bên thứ ba qua header Referer (ví dụ ảnh người dùng chèn từ website khác).
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (request.nextUrl.pathname.startsWith("/embed/")) return embedResponse(request, url, anon);
  // Chưa cấu hình Supabase: trang chủ vẫn chạy, trang cần đăng nhập thì chuyển về /login báo thiếu cấu hình.
  if (!url || !anon) {
    if (isProtected(request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL("/login?error=config", request.url));
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && isProtected(path)) {
    // Nhớ trang định vào (ví dụ link người được mời) để quay lại sau khi đăng nhập.
    const login = new URL("/login", request.url);
    if (safeNext(path)) login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  // Đã đăng nhập (phiên còn trong cookie): bỏ qua trang chủ và trang đăng nhập, vào thẳng danh sách dashboard.
  if (user && (path === "/login" || path === "/")) {
    return NextResponse.redirect(new URL("/dashboards", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/", "/dashboards/:path*", "/editor/:path*", "/account/:path*", "/d/:path*", "/login", "/embed/:path*"],
};
