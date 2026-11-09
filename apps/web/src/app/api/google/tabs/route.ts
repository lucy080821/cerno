import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleAuthError, getAccessToken, isValidSpreadsheetId, listTabs } from "@/lib/google/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liệt kê các tab (sheet) của một file Google Sheets đã chọn bằng Picker. */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("spreadsheetId");
  if (!isValidSpreadsheetId(id)) return NextResponse.json({ error: "ID file không hợp lệ" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  try {
    const token = await getAccessToken(user.id);
    return NextResponse.json(await listTabs(token, id));
  } catch (e) {
    const status = e instanceof GoogleAuthError ? 403 : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lỗi" }, { status });
  }
}
