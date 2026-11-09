import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleAuthError, getAccessToken } from "@/lib/google/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Access token ngắn hạn (scope drive.file) cho Google Picker chạy ở trình duyệt. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  try {
    const accessToken = await getAccessToken(user.id);
    return NextResponse.json({ accessToken }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof GoogleAuthError ? 403 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lỗi" }, { status });
  }
}
