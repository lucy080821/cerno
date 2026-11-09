/**
 * Soạn email mời xem/sửa dashboard (thuần, không gửi). Có bản HTML (nút bấm) và bản chữ thuần cho trình đọc mail
 * không hiện HTML. Mọi giá trị do người dùng đặt (tên người mời, tên dashboard) đều được cắt ngắn và thoát HTML.
 */
export interface InviteEmailInput {
  inviterName: string;
  inviterEmail: string;
  dashboardName: string;
  role: "viewer" | "editor";
  /** Link mở dashboard (sau khi đăng nhập Google bằng đúng email được mời). */
  url: string;
  appName: string;
  /** Email liên hệ/báo lạm dụng của Cerno. */
  contactEmail: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/** Bỏ ký tự điều khiển (chống chèn dòng vào tiêu đề), gộp khoảng trắng, cắt ngắn. */
export function clean(s: string, max: number): string {
  let t = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 32;
    t += code < 32 || code === 127 || code === 0x2028 || code === 0x2029 ? " " : ch;
  }
  t = t.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const COPY = {
  vi: {
    subject: (who: string, name: string, app: string, edit: boolean) =>
      `${who} mời bạn ${edit ? "chỉnh sửa" : "xem"} dashboard “${name}” trên ${app}`,
    pre: (who: string, name: string) => `${who} đã chia sẻ dashboard “${name}” với bạn. · English version below.`,
    heading: (who: string) => `${who} mời bạn cùng làm việc trên dashboard`,
    body: (who: string, email: string, edit: boolean) =>
      `${who} (${email}) đã mời bạn ${edit ? "xem và chỉnh sửa" : "xem"} dashboard này.`,
    role: (edit: boolean) => (edit ? "Quyền của bạn: Được sửa" : "Quyền của bạn: Chỉ xem"),
    button: "Mở dashboard",
    signin: "Bạn cần đăng nhập Google bằng đúng email nhận thư này để mở dashboard.",
    ignore: (app: string) => `Nếu bạn không quen người này hoặc không mong đợi email này, hãy bỏ qua. ${app} sẽ không làm gì nếu bạn không mở link.`,
    report: (mail: string) => `Báo cáo lạm dụng: ${mail}`,
  },
  en: {
    heading: (who: string) => `${who} invited you to a dashboard`,
    body: (who: string, email: string, edit: boolean) =>
      `${who} (${email}) invited you to ${edit ? "view and edit" : "view"} this dashboard.`,
    role: (edit: boolean) => (edit ? "Your access: Can edit" : "Your access: View only"),
    button: "Open dashboard",
    signin: "You need to sign in with Google using the exact email address that received this message.",
    ignore: (app: string) => `If you don't know this person or weren't expecting this email, just ignore it. ${app} does nothing unless you open the link.`,
    report: (mail: string) => `Report abuse: ${mail}`,
  },
} as const;

/** Dòng dẫn người đọc tiếng Anh xuống phần dưới (đặt ở đầu thư, phần tiếng Việt). */
const ENGLISH_BELOW = "English below ↓";

/**
 * Một thư, hai phần: tiếng Việt ở trên (có dòng "English below ↓" ở đầu), tiếng Anh ở dưới. Gửi cho người lạ nên không
 * đoán được ngôn ngữ của họ; ai đọc tiếng Anh thì kéo xuống, nút ở phần nào cũng mở cùng một link.
 */
export function buildInviteEmail(i: InviteEmailInput): BuiltEmail {
  const vi = COPY.vi;
  const en = COPY.en;
  const edit = i.role === "editor";
  const who = clean(i.inviterName, 60) || clean(i.inviterEmail, 60);
  const name = clean(i.dashboardName, 80) || "Dashboard";
  const app = clean(i.appName, 30) || "Cerno";
  const inviterEmail = clean(i.inviterEmail, 100);
  const url = i.url;
  const e = escapeHtml;

  // Tiêu đề: tiếng Việt trước, kèm vài chữ tiếng Anh để người đọc tiếng Anh nhận ra ngay đây là lời mời.
  const subject = `${vi.subject(who, name, app, edit)} · ${app} invitation`;

  const text = [
    ENGLISH_BELOW,
    "",
    vi.heading(who),
    `“${name}”`,
    vi.body(who, inviterEmail, edit),
    vi.role(edit),
    `${vi.button}: ${url}`,
    vi.signin,
    "",
    "----------------------------------------",
    "ENGLISH",
    "",
    en.heading(who),
    `“${name}”`,
    en.body(who, inviterEmail, edit),
    en.role(edit),
    `${en.button}: ${url}`,
    en.signin,
    "",
    "----------------------------------------",
    vi.ignore(app),
    vi.report(i.contactEmail),
    "",
    en.ignore(app),
    en.report(i.contactEmail),
  ].join("\n");

  const button = (label: string) =>
    `<a href="${e(url)}" style="display:inline-block;background:#6d5efc;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 26px;border-radius:10px;border:0;outline:0;">${e(label)}</a>`;

  const section = (c: typeof vi | typeof en) => `
<tr><td style="padding:8px 32px 0;font-size:20px;line-height:1.35;font-weight:700;">${e(c.heading(who))}</td></tr>
<tr><td style="padding:16px 32px 0;">
<div style="border:1px solid #e3e5ee;border-radius:10px;padding:14px 16px;background:#f8f9fc;">
<div style="font-size:16px;font-weight:600;">“${e(name)}”</div>
<div style="margin-top:4px;font-size:13px;color:#5b6078;">${e(c.role(edit))}</div>
</div></td></tr>
<tr><td style="padding:16px 32px 0;font-size:14px;line-height:1.55;color:#33364d;">${e(c.body(who, inviterEmail, edit))}</td></tr>
<tr><td style="padding:20px 32px 0;">${button(c.button)}</td></tr>
<tr><td style="padding:14px 32px 0;font-size:13px;line-height:1.5;color:#5b6078;">${e(c.signin)}</td></tr>`;

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(vi.pre(who, name))}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e3e5ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14162b;">
<tr><td style="padding:28px 32px 4px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td style="font-size:18px;font-weight:700;color:#6d5efc;">${e(app)}</td>
<td align="right" style="font-size:12px;color:#7a7f96;">${e(ENGLISH_BELOW)}</td>
</tr></table></td></tr>
${section(vi)}
<tr><td style="padding:26px 32px 0;"><div style="border-top:1px solid #e3e5ee;"></div></td></tr>
<tr><td style="padding:14px 32px 0;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#9096ac;">ENGLISH</td></tr>
${section(en)}
<tr><td style="padding:20px 32px 0;font-size:12px;line-height:1.5;color:#7a7f96;"><a href="${e(url)}" style="color:#6d5efc;word-break:break-all;">${e(url)}</a></td></tr>
<tr><td style="padding:14px 32px 28px;font-size:12px;line-height:1.55;color:#9096ac;">${e(vi.ignore(app))}<br>${e(vi.report(i.contactEmail))}<br><br>${e(en.ignore(app))}<br>${e(en.report(i.contactEmail))}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}
