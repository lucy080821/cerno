import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleAuthError, getAccessToken, isValidSpreadsheetId } from "@/lib/google/api";
import { syncSource } from "@/lib/google/sync";
import { MAX_SOURCES_PER_WORKSPACE } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;


/** Danh sách nguồn của người dùng (RLS chỉ trả nguồn thuộc workspace của mình), cho editor chọn. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const { data, error } = await supabase
    .from("data_sources")
    .select("id, name, sheet_name, spreadsheet_id, columns, row_count, last_synced_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources: data });
}

/** Thêm một tab Google Sheets làm nguồn dữ liệu rồi đồng bộ lần đầu. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    spreadsheetId?: unknown;
    sheetName?: unknown;
    name?: unknown;
  } | null;
  const sheetName = typeof body?.sheetName === "string" ? body.sheetName.trim() : "";
  if (!isValidSpreadsheetId(body?.spreadsheetId) || !sheetName || sheetName.length > 120) {
    return NextResponse.json({ error: "Thiếu hoặc sai thông tin file/tab" }, { status: 400 });
  }
  const spreadsheetId = body.spreadsheetId;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  // Workspace mà người dùng được sửa (RLS chỉ trả workspace mình là thành viên).
  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .in("role", ["owner", "editor"])
    .limit(1)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Bạn chưa có workspace" }, { status: 403 });

  const { count } = await supabase
    .from("data_sources")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", member.workspace_id);
  if ((count ?? 0) >= MAX_SOURCES_PER_WORKSPACE) {
    return NextResponse.json(
      { error: `Đã đạt giới hạn ${MAX_SOURCES_PER_WORKSPACE} nguồn dữ liệu (bản miễn phí).` },
      { status: 403 },
    );
  }

  try {
    // Lấy token trước: nếu Google từ chối thì không tạo bản ghi rác.
    const token = await getAccessToken(user.id);

    const { data: src, error } = await supabase
      .from("data_sources")
      .insert({
        workspace_id: member.workspace_id,
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        name: name || sheetName,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) {
      const dup = error.code === "23505";
      return NextResponse.json(
        { error: dup ? "Tab này đã được thêm rồi." : error.message },
        { status: dup ? 409 : 500 },
      );
    }

    try {
      const result = await syncSource(src.id, user.id, token);
      return NextResponse.json({ id: src.id, ...result });
    } catch (e) {
      // Đồng bộ lần đầu lỗi: xoá nguồn vừa tạo để người dùng thử lại sạch sẽ.
      await supabase.from("data_sources").delete().eq("id", src.id);
      throw e;
    }
  } catch (e) {
    const status = e instanceof GoogleAuthError ? 403 : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lỗi" }, { status });
  }
}
