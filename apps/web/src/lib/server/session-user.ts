import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Lấy người dùng đang đăng nhập cho route handler, phân biệt rõ hai trường hợp:
 *  - thật sự chưa đăng nhập / phiên hết hạn → 401;
 *  - không gọi được máy chủ xác thực (mạng chậm, quá tải) → thử lại một lần rồi trả 503.
 * Trước đây cả hai đều bị báo "Chưa đăng nhập", gây hiểu lầm khi người dùng vẫn đang đăng nhập bình thường.
 */
export async function requireUser(
  supabase: SupabaseClient,
): Promise<{ user: User } | { response: NextResponse }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };
    // Có phản hồi từ máy chủ mà không có người dùng = chưa đăng nhập thật.
    const transient = !!error && (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500 || error.status === 0);
    if (!transient) {
      return { response: NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 }) };
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return {
    response: NextResponse.json(
      { error: "Không kết nối được máy chủ đăng nhập, vui lòng thử lại sau vài giây." },
      { status: 503 },
    ),
  };
}
