import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Link không cần đăng nhập trong email báo cáo/cảnh báo: huỷ nhận, và (cảnh báo) tạm hoãn / tắt luật.
 * Mỗi link là một token ký HMAC-SHA256 bằng UNSUBSCRIBE_SECRET: không đoán được, không sửa được, chỉ làm đúng MỘT việc
 * trên đúng MỘT đăng ký/luật. Chưa cấu hình khoá (hoặc quá ngắn) thì không tạo và không chấp nhận token nào.
 */

export type NotifyKind = "report" | "alert";
export type NotifyAction = "unsub" | "snooze" | "mute";

export interface NotifyToken {
  /** Loại thông báo. */
  k: NotifyKind;
  /** id đăng ký báo cáo hoặc luật cảnh báo (uuid). */
  r: string;
  /** email người nhận (chữ thường). */
  e: string;
  /** Việc sẽ làm: huỷ nhận / tạm hoãn / tắt luật. */
  a: NotifyAction;
  /** Hết hạn (giây Unix); bỏ trống = không hết hạn (link huỷ nhận phải luôn dùng được). */
  x?: number;
}

const MIN_SECRET = 32;

export const unsubscribeConfigured = (): boolean => (process.env.UNSUBSCRIBE_SECRET ?? "").length >= MIN_SECRET;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function sign(payload: string): Buffer {
  const secret = process.env.UNSUBSCRIBE_SECRET ?? "";
  return createHmac("sha256", secret).update(payload).digest();
}

/** Tạo token. Ném lỗi nếu chưa cấu hình khoá (người gọi quyết định có gửi thư không). */
export function createNotifyToken(t: NotifyToken): string {
  if (!unsubscribeConfigured()) throw new Error("UNSUBSCRIBE_SECRET is missing or too short (at least 32 characters are required).");
  const payload = b64(JSON.stringify({ ...t, e: t.e.toLowerCase() }));
  return `${payload}.${b64(sign(payload))}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kiểm token. Trả null nếu sai chữ ký, sai dạng, hết hạn hoặc chưa cấu hình khoá. */
export function verifyNotifyToken(token: unknown, nowSec = Math.floor(Date.now() / 1000)): NotifyToken | null {
  if (typeof token !== "string" || token.length > 600 || !unsubscribeConfigured()) return null;
  const [payload, sig, ...rest] = token.split(".");
  if (!payload || !sig || rest.length) return null;
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  const want = sign(payload);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let t: unknown;
  try {
    t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!t || typeof t !== "object") return null;
  const o = t as Record<string, unknown>;
  if ((o.k !== "report" && o.k !== "alert") || !["unsub", "snooze", "mute"].includes(String(o.a))) return null;
  if (typeof o.r !== "string" || !UUID_RE.test(o.r) || typeof o.e !== "string" || !o.e.includes("@")) return null;
  if (o.x !== undefined && (typeof o.x !== "number" || o.x < nowSec)) return null;
  return { k: o.k, r: o.r, e: o.e, a: o.a as NotifyAction, ...(o.x !== undefined ? { x: o.x } : {}) };
}

/** Link trang xác nhận (người dùng bấm nút). */
export const unsubscribePageUrl = (origin: string, token: string) => `${origin}/unsubscribe?t=${encodeURIComponent(token)}`;
/** Link một chạm cho tiêu đề `List-Unsubscribe` (Gmail/Outlook gửi POST tới đây). */
export const unsubscribeApiUrl = (origin: string, token: string) => `${origin}/api/unsubscribe?t=${encodeURIComponent(token)}`;
