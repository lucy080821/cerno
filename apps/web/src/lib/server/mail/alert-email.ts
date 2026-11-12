import { formatNumber } from "@dashboard/chart-engine";
import type { ComputationSummary } from "@/lib/server/alerts/compute";
import { clean, escapeHtml, type BuiltEmail } from "./invite-email";

/**
 * Email cảnh báo (thuần, không gửi). HTML bảng + CSS nội tuyến (KHÔNG iframe/JavaScript), luôn có bản chữ thuần.
 * Gồm: chuyện gì xảy ra, giá trị so với ngưỡng/mức bình thường, ảnh mini chart (cid:), một câu AI giải thích (tuỳ chọn),
 * nút mở dashboard, và các link không cần đăng nhập: Tạm hoãn 24 giờ, Tắt cảnh báo này, Huỷ nhận.
 * Mọi chữ do người dùng/dữ liệu/AI tạo ra đều được thoát HTML.
 */

export type AlertEmailKind = "fire" | "remind" | "recover" | "error";

export interface AlertEmailGroup {
  name: string;
  /** "12.500" hoặc "−45%" ... đã định dạng. */
  detail: string;
}

export interface AlertEmailInput {
  appName: string;
  kind: AlertEmailKind;
  ruleName: string;
  dashboardName: string;
  dashboardUrl: string;
  /** Câu mô tả điều kiện (xem `conditionSentence`). */
  sentence: string;
  /** Tóm tắt kết quả tính; null với luật "không có dữ liệu mới" hoặc thư báo lỗi. */
  summary: ComputationSummary | null;
  /** Ngưỡng dạng chữ ("thấp hơn 10.000.000"), nếu có. */
  thresholdText: string | null;
  /** Luật "không có dữ liệu mới": số giờ đã trôi qua và thời điểm dữ liệu đổi lần cuối (đã định dạng). */
  stale?: { hoursAgo: number; sinceText: string | null };
  /** Luật theo từng nhóm: các nhóm vi phạm (đã cắt tối đa 20) và số nhóm còn lại. */
  groups?: { groupBy: string; items: AlertEmailGroup[]; more: number };
  /** Ảnh mini chart đính kèm (cid), nếu vẽ được. */
  chart?: { cid: string; alt: string };
  /** Một câu AI giải thích (đã kiểm số); bỏ trống nếu AI lỗi hoặc không dùng. */
  explain?: string | null;
  /** Thư báo lỗi luật: lý do. */
  errorText?: string;
  snoozeUrl: string | null;
  muteUrl: string | null;
  unsubscribeUrl: string;
}

const e = escapeHtml;
const FONT = "font-family:Arial,Helvetica,sans-serif;";
const BAND = { fire: "#dc2626", remind: "#d97706", recover: "#16a34a", error: "#6b7280" } as const;
const TAG = { fire: "CẢNH BÁO", remind: "NHẮC LẠI", recover: "ĐÃ BÌNH THƯỜNG", error: "LỖI CẢNH BÁO" } as const;

const num = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : formatNumber(Math.round(n * 100) / 100));
const pct = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatNumber(Math.round(Math.abs(n) * 10) / 10)}%`);

/** Các dòng "giá trị" (nhãn, giá trị) từ tóm tắt. */
function factRows(i: AlertEmailInput): [string, string][] {
  const s = i.summary;
  const rows: [string, string][] = [];
  if (i.stale) {
    rows.push(["Dữ liệu đổi lần cuối", i.stale.sinceText ?? "không rõ"], ["Đã trôi qua", `${formatNumber(Math.round(i.stale.hoursAgo * 10) / 10)} giờ`]);
    return rows;
  }
  if (!s || s.kind === "deferred") return rows;
  rows.push(["Khoảng đo", s.label]);
  if (s.kind === "single") {
    rows.push(["Giá trị hiện tại", num(s.value)]);
    if (i.thresholdText) rows.push(["Điều kiện báo", i.thresholdText]);
    if (s.prev !== undefined && s.prev !== null) rows.push([s.prevLabel ? `Kỳ so sánh (${s.prevLabel})` : "Kỳ so sánh", num(s.prev)]);
    if (s.changePct !== undefined && s.changePct !== null) rows.push(["Thay đổi", pct(s.changePct)]);
    if (s.mean !== undefined) rows.push(["Mức bình thường (trung bình các kỳ trước)", num(s.mean)]);
  } else {
    rows.push(["Số nhóm vi phạm", `${s.violatingCount ?? 0}/${s.evaluated ?? 0}`]);
    if (i.thresholdText) rows.push(["Điều kiện báo", i.thresholdText]);
  }
  return rows;
}

function subjectFor(kind: AlertEmailKind, rule: string): string {
  const name = clean(rule, 100) || "Cảnh báo";
  if (kind === "fire") return `[Cảnh báo] ${name}`;
  if (kind === "remind") return `[Cảnh báo] ${name} (nhắc lại)`;
  if (kind === "recover") return `[Đã bình thường] ${name}`;
  return `[Lỗi cảnh báo] ${name}`;
}

export function buildAlertEmail(i: AlertEmailInput): BuiltEmail {
  const app = clean(i.appName, 40) || "Cerno";
  const dash = clean(i.dashboardName, 80) || "Dashboard";
  const rule = clean(i.ruleName, 100) || "Cảnh báo";
  const subject = subjectFor(i.kind, rule);
  const rows = factRows(i);

  const headline =
    i.kind === "error"
      ? `Luật “${rule}” không chạy được`
      : i.kind === "recover"
        ? `Chỉ số đã trở lại bình thường`
        : i.kind === "remind"
          ? `Vẫn đang vi phạm điều kiện`
          : `Điều kiện cảnh báo đã xảy ra`;

  const cell = `padding:8px 10px;border-bottom:1px solid #e5e7eb;${FONT}font-size:14px;line-height:1.4;`;
  const table = rows.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:8px 0 14px">` +
      rows.map(([k, v]) => `<tr><td style="${cell}color:#6b7280;width:46%">${e(k)}</td><td style="${cell}color:#14162b;font-weight:700">${e(v)}</td></tr>`).join("") +
      `</table>`
    : "";

  const groups =
    i.groups && i.groups.items.length
      ? `<div style="margin:0 0 14px;${FONT}font-size:14px;line-height:1.6;color:#1f2937"><strong>${e(`Các ${i.groups.groupBy} vi phạm`)}:</strong><ul style="margin:6px 0 0;padding-left:20px">` +
        i.groups.items.map((g) => `<li>${e(g.name)}: <strong>${e(g.detail)}</strong></li>`).join("") +
        (i.groups.more > 0 ? `<li style="color:#6b7280">${e(`và ${i.groups.more} nhóm khác`)}</li>` : "") +
        `</ul></div>`
      : "";

  const explain = i.explain ? `<div style="margin:0 0 14px;padding:10px 12px;background:#f5f3ff;border-radius:8px;${FONT}font-size:14px;line-height:1.6;color:#312e81"><strong>Nhận định:</strong> ${e(i.explain)}</div>` : "";
  const chart = i.chart
    ? `<div style="margin:0 0 14px"><a href="${e(i.dashboardUrl)}" style="text-decoration:none"><img src="cid:${e(i.chart.cid)}" width="600" alt="${e(i.chart.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:1px solid #e5e7eb;border-radius:8px"></a></div>`
    : "";
  const error = i.kind === "error" && i.errorText ? `<p style="margin:0 0 14px;${FONT}font-size:14px;line-height:1.6;color:#b91c1c">${e(i.errorText)}</p>` : "";

  const link = (href: string | null, label: string) => (href ? `<a href="${e(href)}" style="color:#4f46e5">${e(label)}</a>` : "");
  const actions = [link(i.snoozeUrl, "Tạm hoãn 24 giờ"), link(i.muteUrl, "Tắt cảnh báo này"), link(i.unsubscribeUrl, "Huỷ nhận email này")].filter(Boolean).join(" · ");

  const html =
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f8"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f8"><tr><td align="center" style="padding:20px 12px">` +
    `<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden">` +
    `<tr><td style="background:${BAND[i.kind]};padding:16px 24px;${FONT}color:#ffffff"><div style="font-size:12px;font-weight:700;letter-spacing:1px">${TAG[i.kind]}</div>` +
    `<div style="margin-top:4px;font-size:18px;font-weight:700;line-height:1.3">${e(rule)}</div>` +
    `<div style="margin-top:2px;font-size:13px;opacity:0.9">${e(dash)}</div></td></tr>` +
    `<tr><td style="padding:18px 24px 22px"><h2 style="margin:0 0 6px;${FONT}font-size:16px;color:#14162b">${e(headline)}</h2>` +
    `<p style="margin:0 0 6px;${FONT}font-size:14px;line-height:1.6;color:#1f2937">${e(i.sentence)}.</p>` +
    `${error}${table}${groups}${explain}${chart}` +
    `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 0 4px"><tr><td style="border-radius:8px;background:#6d5efc">` +
    `<a href="${e(i.dashboardUrl)}" style="display:inline-block;padding:12px 22px;${FONT}font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">Mở dashboard</a></td></tr></table>` +
    `</td></tr><tr><td style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;${FONT}font-size:12px;line-height:1.8;color:#6b7280">` +
    `Bạn nhận email này vì được thêm vào danh sách nhận cảnh báo của dashboard này.<br>${actions}</td></tr></table></td></tr></table></body></html>`;

  // Bản chữ thuần.
  const t: string[] = [`${TAG[i.kind]}: ${rule}`, `Dashboard: ${dash}`, "", `${headline}.`, `${i.sentence}.`, ""];
  if (i.kind === "error" && i.errorText) t.push(i.errorText, "");
  for (const [k, v] of rows) t.push(`- ${k}: ${v}`);
  if (rows.length) t.push("");
  if (i.groups && i.groups.items.length) {
    t.push(`Các ${i.groups.groupBy} vi phạm:`, ...i.groups.items.map((g) => `- ${g.name}: ${g.detail}`));
    if (i.groups.more > 0) t.push(`- và ${i.groups.more} nhóm khác`);
    t.push("");
  }
  if (i.explain) t.push(`Nhận định: ${i.explain}`, "");
  if (i.chart) t.push("(Email có biểu đồ dạng ảnh; xem trong dashboard nếu không hiển thị.)", "");
  t.push(`Mở dashboard: ${i.dashboardUrl}`, "");
  if (i.snoozeUrl) t.push(`Tạm hoãn 24 giờ: ${i.snoozeUrl}`);
  if (i.muteUrl) t.push(`Tắt cảnh báo này: ${i.muteUrl}`);
  t.push(`Huỷ nhận email này: ${i.unsubscribeUrl}`);

  return { subject, html, text: t.join("\n") };
}
