import type { Lang } from "./store";

/**
 * Nhớ ngôn ngữ theo TÀI KHOẢN (khi đã đăng nhập) để mở ở máy/trình duyệt khác vẫn đúng ngôn ngữ đã chọn.
 * Lưu ở `user_metadata.lang` của Supabase Auth. Đọc từ phiên có sẵn trong cookie nên không tốn lần gọi mạng;
 * mọi lỗi đều bỏ qua (chưa đăng nhập, chưa cấu hình Supabase...): khi đó chỉ dựa vào trình duyệt.
 */
const isLang = (v: unknown): v is Lang => v === "vi" || v === "en";

async function client() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

/** `null` = chưa đăng nhập; `undefined` = đã đăng nhập nhưng chưa từng lưu ngôn ngữ ở tài khoản. */
export async function readAccountLang(): Promise<Lang | null | undefined> {
  try {
    const sb = await client();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const v = user.user_metadata?.lang;
    return isLang(v) ? v : undefined;
  } catch {
    return null;
  }
}

/** Ghi ngôn ngữ vào tài khoản nếu đang đăng nhập (không làm gì nếu chưa). */
export async function saveAccountLang(lang: Lang): Promise<void> {
  try {
    const sb = await client();
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    if (!data.session?.user || data.session.user.user_metadata?.lang === lang) return;
    await sb.auth.updateUser({ data: { lang } });
  } catch {
    /* bỏ qua: lần chọn vẫn được nhớ ở trình duyệt */
  }
}
