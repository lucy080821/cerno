import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/server/crypto";
import { MAX_COLUMNS, MAX_ROWS } from "./sheet-data";

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export class GoogleAuthError extends Error {}

export async function saveRefreshToken(userId: string, refreshToken: string) {
  const { error } = await createAdminClient()
    .from("google_credentials")
    .upsert({
      user_id: userId,
      refresh_token_enc: encrypt(refreshToken),
      scope: GOOGLE_SCOPE,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(error.message);
}

/** Đổi refresh token (đã lưu) lấy access token ngắn hạn. */
export async function getAccessToken(userId: string): Promise<string> {
  const { data } = await createAdminClient()
    .from("google_credentials")
    .select("refresh_token_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new GoogleAuthError("Chưa có quyền Google. Hãy đăng nhập lại bằng Google.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: decrypt(data.refresh_token_enc),
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) {
    // invalid_grant: người dùng đã thu hồi quyền hoặc token hết hạn.
    throw new GoogleAuthError("Quyền truy cập Google đã hết hạn. Hãy đăng nhập lại bằng Google.");
  }
  return json.access_token;
}

async function sheetsGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) throw new GoogleAuthError("Quyền truy cập Google không hợp lệ. Hãy đăng nhập lại.");
  if (res.status === 403 || res.status === 404) {
    throw new Error("Không truy cập được file này. Hãy chọn lại file bằng nút 'Chọn Google Sheet'.");
  }
  if (!res.ok) throw new Error(`Google Sheets trả lỗi ${res.status}`);
  return (await res.json()) as T;
}

const ID_RE = /^[A-Za-z0-9_-]{10,100}$/;
export function isValidSpreadsheetId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

export async function listTabs(token: string, spreadsheetId: string) {
  const r = await sheetsGet<{ properties: { title: string }; sheets: { properties: { title: string } }[] }>(
    token,
    `${spreadsheetId}?fields=properties.title,sheets.properties.title`,
  );
  return { title: r.properties.title, tabs: r.sheets.map((s) => s.properties.title) };
}

/** Số dòng của mỗi lần gọi Sheets API khi đọc tab lớn (một lần đọc cả tab trăm nghìn dòng dễ quá tải bộ nhớ và thời gian). */
const READ_CHUNK_ROWS = 20_000;

/**
 * Đọc giá trị đã định dạng (ngày/tiền hiện như trong Sheets). Tab đặt trong dấu nháy đơn.
 * Đọc theo từng đoạn dòng; cắt cột thừa ngay khi nhận (tối đa MAX_COLUMNS) và dừng khi đã đủ `maxRows` dòng.
 * Số dòng của tab lấy từ thuộc tính lưới (không suy ra từ đoạn ngắn, vì Sheets bỏ các dòng trống cuối đoạn).
 */
export async function readTab(
  token: string,
  spreadsheetId: string,
  tab: string,
  maxRows: number = MAX_ROWS + 1000,
): Promise<string[][]> {
  const meta = await sheetsGet<{ sheets?: { properties: { title: string; gridProperties?: { rowCount?: number } } }[] }>(
    token,
    `${spreadsheetId}?fields=sheets.properties(title,gridProperties.rowCount)`,
  );
  const gridRows = meta.sheets?.find((x) => x.properties.title === tab)?.properties.gridProperties?.rowCount ?? READ_CHUNK_ROWS;

  const quoted = `'${tab.replace(/'/g, "''")}'`;
  const out: string[][] = [];
  for (let start = 1; start <= gridRows && out.length < maxRows + 1; start += READ_CHUNK_ROWS) {
    const end = Math.min(start + READ_CHUNK_ROWS - 1, gridRows);
    const range = `${quoted}!${start}:${end}`;
    const r = await sheetsGet<{ values?: string[][] }>(
      token,
      `${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
    );
    const vals = r.values ?? [];
    // Đoạn ngắn hơn số dòng yêu cầu: các dòng trống cuối đoạn bị bỏ, phải đệm lại để không dồn dòng của đoạn sau lên.
    const expected = end - start + 1;
    for (const row of vals) out.push(row.length > MAX_COLUMNS ? row.slice(0, MAX_COLUMNS) : row);
    if (end < gridRows) for (let i = vals.length; i < expected; i++) out.push([]);
  }
  return out;
}

/**
 * Thu hồi quyền truy cập của app trên tài khoản Google của người dùng (dùng khi xóa tài khoản).
 * Làm hết sức: lỗi mạng hay token đã vô hiệu thì bỏ qua, vì mục đích chính là xóa dữ liệu của chúng ta.
 */
export async function revokeGoogleAccess(userId: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient()
      .from("google_credentials")
      .select("refresh_token_enc")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return false;
    const res = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decrypt(data.refresh_token_enc) }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
