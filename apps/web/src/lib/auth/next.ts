/** Trang quay lại sau khi đăng nhập (ví dụ người được mời mở link /editor/<id> khi chưa đăng nhập). */
export const NEXT_COOKIE = "cerno_next";

// Chỉ cho quay lại những trang cần đăng nhập của chính app, tránh bị lợi dụng làm "open redirect".
const ALLOWED = [/^\/editor\/[0-9a-f-]{36}$/i, /^\/d\/[0-9a-f-]{36}$/i, /^\/dashboards$/, /^\/account$/];

/** Trả về đường dẫn an toàn để chuyển hướng tới, hoặc null nếu không hợp lệ. */
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value;
  try {
    v = decodeURIComponent(value);
  } catch {
    return null;
  }
  return ALLOWED.some((re) => re.test(v)) ? v : null;
}
