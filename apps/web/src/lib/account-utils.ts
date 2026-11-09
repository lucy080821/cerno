// Hàm thuần (không "server-only") để test được. Dùng cho thao tác xóa tài khoản.

/** Người dùng phải gõ lại đúng email của tài khoản (không phân biệt hoa thường, bỏ khoảng trắng thừa). */
export function confirmMatches(email: string | undefined | null, typed: unknown): boolean {
  if (!email || typeof typed !== "string") return false;
  return typed.trim().toLowerCase() === email.trim().toLowerCase();
}

/**
 * Chặn yêu cầu từ trang web khác (CSRF) cho thao tác nguy hiểm: nếu có header Origin thì phải cùng host với
 * trang đang chạy. Không có Origin (công cụ dòng lệnh, cùng nguồn một số trình duyệt) thì không chặn ở đây,
 * vì còn phiên đăng nhập và bước xác nhận email.
 */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
