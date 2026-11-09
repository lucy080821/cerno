import nodemailer, { type Transporter } from "nodemailer";
import { clean } from "./invite-email";

/**
 * Gửi email qua SMTP của Gmail bằng mật khẩu ứng dụng (xem .env: MAIL_USER, MAIL_APP_PASSWORD, MAIL_FROM_NAME).
 * Chỉ máy chủ chạm tới mật khẩu. Muốn đổi sang dịch vụ khác (Resend, SES...) khi có domain thì chỉ sửa file này:
 * nơi gọi chỉ biết `sendMail` và `mailConfigured`.
 */
export type SendResult = { ok: true } | { ok: false; code: "not_configured" | "send_failed" };

interface MailConfig {
  user: string;
  pass: string;
  fromName: string;
}

function config(): MailConfig | null {
  const user = process.env.MAIL_USER?.trim();
  // Google hiển thị mật khẩu ứng dụng thành 4 nhóm cách nhau bởi dấu cách: bỏ hết khoảng trắng.
  const pass = process.env.MAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass || !user.includes("@")) return null;
  return { user, pass, fromName: clean(process.env.MAIL_FROM_NAME || "Cerno", 40) || "Cerno" };
}

export const mailConfigured = () => config() !== null;

let cached: { key: string; t: Transporter } | null = null;

function transporter(c: MailConfig): Transporter {
  const key = `${c.user}:${c.pass.length}`;
  if (cached?.key === key) return cached.t;
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  cached = { key, t };
  return t;
}

export async function sendMail(m: { to: string; subject: string; html: string; text: string; replyTo?: string }): Promise<SendResult> {
  const c = config();
  if (!c) return { ok: false, code: "not_configured" };
  try {
    await transporter(c).sendMail({
      from: { name: c.fromName, address: c.user },
      to: m.to,
      replyTo: m.replyTo,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
    return { ok: true };
  } catch (err) {
    // Chỉ ghi mã lỗi, không ghi nội dung thư hay thông tin đăng nhập.
    const e = err as { code?: string; responseCode?: number };
    console.error("[mail] gửi thất bại:", e.code ?? "", e.responseCode ?? "");
    return { ok: false, code: "send_failed" };
  }
}
