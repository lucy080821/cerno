import type { NextRequest } from "next/server";

/**
 * Địa chỉ công khai của app (https://cerno.cloud), dùng khi chuyển hướng.
 * Sau reverse proxy (Hostinger) `request.url` là địa chỉ nội bộ (vd https://0.0.0.0:3000), nên không dùng được.
 * Thứ tự: NEXT_PUBLIC_SITE_URL → header x-forwarded-host/proto → origin của request (dev/localhost).
 * Không phụ thuộc module Node nên dùng được cả trong middleware.
 */
/**
 * Như `publicOrigin` nhưng cho route handler dùng `Request` thường, và chịu được việc NEXT_PUBLIC_SITE_URL
 * chưa đặt lúc build (khi đó siteUrl() rơi về localhost và link gửi cho người khác sẽ hỏng):
 * NEXT_PUBLIC_SITE_URL (nếu không phải localhost) → x-forwarded-host → header Origin của trình duyệt → Host.
 */
export function requestOrigin(req: Request): string {
  const isLocal = (u: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u);
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    try {
      const o = new URL(site).origin;
      if (!isLocal(o)) return o;
    } catch {
      /* giá trị sai: thử cách sau */
    }
  }
  const fwd = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (fwd) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${fwd}`;
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      const o = new URL(origin).origin;
      if (!isLocal(o)) return o;
    } catch {
      /* bỏ qua */
    }
  }
  const host = req.headers.get("host");
  if (host && !isLocal(`http://${host}`)) return `https://${host}`;
  return origin && origin !== "null" ? origin : new URL(req.url).origin;
}

export function publicOrigin(request: NextRequest): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    try {
      return new URL(site).origin;
    } catch {
      /* giá trị sai: thử cách sau */
    }
  }
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (host) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${host}`;
  }
  return request.nextUrl.origin;
}
