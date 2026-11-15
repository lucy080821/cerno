import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/account-utils";
import { createClient } from "@/lib/supabase/server";
import { MAX_UPLOAD_BYTES } from "./canonical";
import type { PrepareOptions } from "./prepare";

export interface UploadRequest {
  data: Uint8Array;
  filename: string;
  opts: PrepareOptions;
}

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export type EditorAuth =
  | { ok: true; supabase: SupabaseClient; user: User; workspaceId: string }
  | { ok: false; response: NextResponse };

/** Đăng nhập + có quyền sửa một workspace. Không đạt thì `response` là phản hồi lỗi dùng được ngay. */
export async function requireEditor(): Promise<EditorAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: err("Chưa đăng nhập", 401) };
  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .in("role", ["owner", "editor"])
    .limit(1)
    .maybeSingle();
  if (!member) return { ok: false, response: err("Bạn chưa có workspace", 403) };
  return { ok: true, supabase, user, workspaceId: member.workspace_id as string };
}

/** Đọc yêu cầu multipart: một file + tuỳ chọn (sheet, kênh, ánh xạ cột dạng JSON). Chặn trang khác gửi chéo (CSRF). */
export async function readUpload(request: Request): Promise<UploadRequest | NextResponse> {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("host"))) return err("Yêu cầu không hợp lệ", 403);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + 64 * 1024) return err(`File lớn hơn ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("Yêu cầu không hợp lệ", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return err("Chưa chọn file.", 400);
  if (file.size > MAX_UPLOAD_BYTES) return err(`File lớn hơn ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);

  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  let mapping: unknown;
  const rawMapping = str("mapping");
  if (rawMapping) {
    if (rawMapping.length > 4000) return err("Yêu cầu không hợp lệ", 400);
    try {
      mapping = JSON.parse(rawMapping);
    } catch {
      return err("Ánh xạ cột không hợp lệ", 400);
    }
  }
  return {
    data: new Uint8Array(await file.arrayBuffer()),
    filename: file.name.slice(0, 200),
    opts: { sheet: str("sheet"), channel: str("channel"), mapping },
  };
}
