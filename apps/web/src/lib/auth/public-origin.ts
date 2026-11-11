import type { NextRequest } from "next/server";

/**
 * Địa chỉ công khai của app (https://cerno.cloud), dùng khi chuyển hướng.
 * Sau reverse proxy (Hostinger) `request.url` là địa chỉ nội bộ (vd https://0.0.0.0:3000), nên không dùng được.
 * Thứ tự: NEXT_PUBLIC_SITE_URL → header x-forwarded-host/proto → origin của request (dev/localhost).
 * Không phụ thuộc module Node nên dùng được cả trong middleware.
 */
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
