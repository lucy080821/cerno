import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Client service role: BỎ QUA RLS. Chỉ dùng ở server, chỉ sau khi đã xác thực người dùng
 * và tự kiểm tra quyền (ví dụ is_member). Không bao giờ import vào code chạy ở trình duyệt.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Thiếu SUPABASE_SERVICE_ROLE_KEY");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
}
