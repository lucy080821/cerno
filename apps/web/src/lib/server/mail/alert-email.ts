import { formatNumber } from "@dashboard/chart-engine";
import type { ComputationSummary } from "@/lib/server/alerts/compute";
import { languageBand, toEn } from "./bilingual";
import { clean, escapeHtml, type BuiltEmail } from "./invite-email";

/**
 * Email cảnh báo (thuần, không gửi), SONG NGỮ trong MỘT thư: phần tiếng Việt ở trên, phần tiếng Anh ở dưới.
 * HTML bảng + CSS nội tuyến (KHÔNG iframe/JavaScript), luôn có bản chữ thuần.
 * Gồm: chuyện gì xảy ra, giá trị so với ngưỡng/mức bình thường, ảnh mini chart (cid:, một lần), một câu AI giải thích (tuỳ chọn),
 * nút mở dashboard, và các link không cần đăng nhập: Tạm hoãn 24 giờ, Tắt cảnh báo này, Huỷ nhận.
 * Mọi chữ do người dùng/dữ liệu/AI tạo ra đều được thoát HTML. Chữ tiếng Anh động (câu điều kiện, nhãn khoảng thời gian,
 * câu nhận định) do người gọi cung cấp trong `en`; thiếu thì dùng từ điển hoặc giữ nguyên chữ gốc.
 */

export type AlertEmailKind = "fire" | "remind" | "recover" | "error";

export interface AlertEmailGroup {
  name: string;
  /** "12.500" hoặc "−45%" ... đã định dạng. */
  detail: string;
}

/** Phần tiếng Anh của các chữ động. */
export interface AlertEmailEn {
  sentence: string;
  thresholdText: string | null;
  /** Nhãn khoảng đo và kỳ so sánh bằng tiếng Anh. */
  label?: string;
  prevLabel?: string;
  explain?: string | null;
  errorText?: string;
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
  /** Chữ động bằng tiếng Anh cho phần tiếng Anh của thư. */
  en?: AlertEmailEn;
  snoozeUrl: string | null;
  muteUrl: string | null;
  unsubscribeUrl: string;
}

type Lang = "vi" | "en";

const e = escapeHtml;
const FONT = "font-family:Arial,Helvetica,sans-serif;";
const BAND = { fire: "#dc2626", remind: "#d97706", recover: "#16a34a", error: "#6b7280" } as const;
const TAG = {
  vi: { fire: "CẢNH BÁO", remind: "NHẮC LẠI", recover: "ĐÃ BÌNH THƯỜNG", error: "LỖI CẢNH BÁO" },
  en: { fire: "ALERT", remind: "REMINDER", recover: "BACK TO NORMAL", error: "ALERT ERROR" },
} as const;

const T = {
  vi: {
    noteWhy: "Bạn nhận email này vì được thêm vào danh sách nhận cảnh báo của dashboard này.",
    snooze: "Tạm hoãn 24 giờ", mute: "Tắt cảnh báo này", unsub: "Huỷ nhận email này", open: "Mở dashboard", insight: "Nhận định:",
    unknown: "không rõ", hours: "giờ", band: "TIẾNG VIỆT", chartNote: "(Email có biểu đồ dạng ảnh; xem trong dashboard nếu không hiển thị.)",
    more: (n: number) => `và ${n} nhóm khác`, groupsOf: (g: string) => `Các ${g} vi phạm`,
    ruleFailed: (r: string) => `Luật “${r}” không chạy được`, backNormal: "Chỉ số đã trở lại bình thường",
    stillBad: "Vẫn đang vi phạm điều kiện", happened: "Điều kiện cảnh báo đã xảy ra", defaultRule: "Cảnh báo",
  },
  en: {
    noteWhy: "You are receiving this email because you were added to this dashboard's alert recipients.",
    snooze: "Snooze 24 hours", mute: "Turn off this alert", unsub: "Unsubscribe from this email", open: "Open dashboard", insight: "Insight:",
    unknown: "unknown", hours: "hours", band: "ENGLISH VERSION", chartNote: "The chart is shown in the Vietnamese section above.",
    more: (n: number) => `and ${n} more groups`, groupsOf: (g: string) => `Groups in violation (${g})`,
    ruleFailed: (r: string) => `The rule “${r}” could not run`, backNormal: "The metric is back to normal",
    stillBad: "The condition is still being violated", happened: "The alert condition has occurred", defaultRule: "Alert",
  },
} as const;

const num = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : formatNumber(Math.round(n * 100) / 100));
const pct = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatNumber(Math.round(Math.abs(n) * 10) / 10)}%`);

/** Các dòng "giá trị" (nhãn, giá trị) từ tóm tắt, theo ngôn ngữ. */
function factRows(i: AlertEmailInput, lang: Lang): [string, string][] {
  const s = i.summary;
  const en = lang === "en";
  const t = T[lang];
  const rows: [string, string][] = [];
  const threshold = en ? i.en?.thresholdText ?? i.thresholdText : i.thresholdText;
  if (i.stale) {
    rows.push(
      [en ? "Data last changed" : "Dữ liệu đổi lần cuối", i.stale.sinceText ?? t.unknown],
      [en ? "Elapsed" : "Đã trôi qua", `${formatNumber(Math.round(i.stale.hoursAgo * 10) / 10)} ${t.hours}`],
    );
    return rows;
  }
  if (!s || s.kind === "deferred") return rows;
  const label = en ? i.en?.label ?? toEn(s.label) : s.label;
  const prevLabel = en ? i.en?.prevLabel ?? (s.prevLabel ? toEn(s.prevLabel) : undefined) : s.prevLabel;
  rows.push([en ? "Measured period" : "Khoảng đo", label]);
  if (s.kind === "single") {
    rows.push([en ? "Current value" : "Giá trị hiện tại", num(s.value)]);
    if (threshold) rows.push([en ? "Alert condition" : "Điều kiện báo", threshold]);
    if (s.prev !== undefined && s.prev !== null) {
      const k = en ? "Comparison period" : "Kỳ so sánh";
      rows.push([prevLabel ? `${k} (${prevLabel})` : k, num(s.prev)]);
    }
    if (s.changePct !== undefined && s.changePct !== null) rows.push([en ? "Change" : "Thay đổi", pct(s.changePct)]);
    if (s.mean !== undefined) rows.push([en ? "Normal level (average of previous periods)" : "Mức bình thường (trung bình các kỳ trước)", num(s.mean)]);
  } else {
    rows.push([en ? "Groups in violation" : "Số nhóm vi phạm", `${s.violatingCount ?? 0}/${s.evaluated ?? 0}`]);
    if (threshold) rows.push([en ? "Alert condition" : "Điều kiện báo", threshold]);
  }
  return rows;
}

function subjectFor(kind: AlertEmailKind, rule: string): string {
  const name = clean(rule, 100) || "Cảnh báo";
  if (kind === "fire") return `[Cảnh báo · Alert] ${name}`;
  if (kind === "remind") return `[Cảnh báo · Alert] ${name} (nhắc lại · reminder)`;
  if (kind === "recover") return `[Đã bình thường · Back to normal] ${name}`;
  return `[Lỗi cảnh báo · Alert error] ${name}`;
}

export function buildAlertEmail(i: AlertEmailInput): BuiltEmail {
  const app = clean(i.appName, 40) || "Cerno";
  const dash = clean(i.dashboardName, 80) || "Dashboard";
  const rule = clean(i.ruleName, 100) || "Cảnh báo";
  const subject = subjectFor(i.kind, rule);

  const headline = (lang: Lang) => {
    const t = T[lang];
    return i.kind === "error" ? t.ruleFailed(rule) : i.kind === "recover" ? t.backNormal : i.kind === "remind" ? t.stillBad : t.happened;
  };
  const sentenceOf = (lang: Lang) => (lang === "en" ? i.en?.sentence ?? toEn(i.sentence) : i.sentence);
  const explainOf = (lang: Lang) => (lang === "en" ? i.en?.explain ?? null : i.explain ?? null);
  const errorOf = (lang: Lang) => (lang === "en" ? i.en?.errorText ?? (i.errorText ? toEn(i.errorText) : undefined) : i.errorText);

  const cell = `padding:8px 10px;border-bottom:1px solid #e5e7eb;${FONT}font-size:14px;line-height:1.4;`;

  /** Khối nội dung của MỘT ngôn ngữ. */
  const block = (lang: Lang): string => {
    const t = T[lang];
    const rows = factRows(i, lang);
    const table = rows.length
      ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:8px 0 14px">` +
        rows.map(([k, v]) => `<tr><td style="${cell}color:#6b7280;width:46%">${e(k)}</td><td style="${cell}color:#14162b;font-weight:700">${e(v)}</td></tr>`).join("") +
        `</table>`
      : "";
    const groups =
      i.groups && i.groups.items.length
        ? `<div style="margin:0 0 14px;${FONT}font-size:14px;line-height:1.6;color:#1f2937"><strong>${e(t.groupsOf(i.groups.groupBy))}:</strong><ul style="margin:6px 0 0;padding-left:20px">` +
          i.groups.items.map((g) => `<li>${e(g.name)}: <strong>${e(g.detail)}</strong></li>`).join("") +
          (i.groups.more > 0 ? `<li style="color:#6b7280">${e(t.more(i.groups.more))}</li>` : "") +
          `</ul></div>`
        : "";
    const ex = explainOf(lang);
    const explain = ex
      ? `<div style="margin:0 0 14px;padding:10px 12px;background:#f5f3ff;border-radius:8px;${FONT}font-size:14px;line-height:1.6;color:#312e81"><strong>${t.insight}</strong> ${e(ex)}</div>`
      : "";
    const err = errorOf(lang);
    const error = i.kind === "error" && err ? `<p style="margin:0 0 14px;${FONT}font-size:14px;line-height:1.6;color:#b91c1c">${e(err)}</p>` : "";
    const chart = i.chart
      ? lang === "vi"
        ? `<div style="margin:0 0 14px"><a href="${e(i.dashboardUrl)}" style="text-decoration:none"><img src="cid:${e(i.chart.cid)}" width="600" alt="${e(i.chart.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:1px solid #e5e7eb;border-radius:8px"></a></div>`
        : `<p style="margin:0 0 14px;${FONT}font-size:13px;color:#6b7280">${e(t.chartNote)}</p>`
      : "";
    return (
      `<h2 style="margin:0 0 6px;${FONT}font-size:16px;color:#14162b">${e(headline(lang))}</h2>` +
      `<p style="margin:0 0 6px;${FONT}font-size:14px;line-height:1.6;color:#1f2937">${e(sentenceOf(lang))}.</p>` +
      `${error}${table}${groups}${explain}${chart}`
    );
  };

  const link = (href: string | null, vi: string, en: string) => (href ? `<a href="${e(href)}" style="color:#4f46e5">${e(vi)} · ${e(en)}</a>` : "");
  const actions = [link(i.snoozeUrl, T.vi.snooze, T.en.snooze), link(i.muteUrl, T.vi.mute, T.en.mute), link(i.unsubscribeUrl, T.vi.unsub, T.en.unsub)].filter(Boolean).join("<br>");

  const html =
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f8"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f8"><tr><td align="center" style="padding:20px 12px">` +
    `<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden">` +
    `<tr><td style="background:${BAND[i.kind]};padding:16px 24px;${FONT}color:#ffffff"><div style="font-size:12px;font-weight:700;letter-spacing:1px">${TAG.vi[i.kind]} · ${TAG.en[i.kind]}</div>` +
    `<div style="margin-top:4px;font-size:18px;font-weight:700;line-height:1.3">${e(rule)}</div>` +
    `<div style="margin-top:2px;font-size:13px;opacity:0.9">${e(dash)}</div></td></tr>` +
    `<tr><td style="padding:18px 24px 22px">` +
    `<div style="margin:0 0 10px;${FONT}font-size:12px;color:#6b7280">${T.vi.band} · English version below ↓</div>` +
    block("vi") +
    languageBand(T.en.band) +
    block("en") +
    `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 0 4px"><tr><td style="border-radius:8px;background:#6d5efc">` +
    `<a href="${e(i.dashboardUrl)}" style="display:inline-block;padding:12px 22px;${FONT}font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">${T.vi.open} · ${T.en.open}</a></td></tr></table>` +
    `</td></tr><tr><td style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;${FONT}font-size:12px;line-height:1.8;color:#6b7280">` +
    `${T.vi.noteWhy}<br>${T.en.noteWhy}<br>${actions}</td></tr></table></td></tr></table></body></html>`;

  // Bản chữ thuần.
  const textBlock = (lang: Lang): string[] => {
    const t = T[lang];
    const out: string[] = [`${headline(lang)}.`, `${sentenceOf(lang)}.`, ""];
    const err = errorOf(lang);
    if (i.kind === "error" && err) out.push(err, "");
    const rows = factRows(i, lang);
    for (const [k, v] of rows) out.push(`- ${k}: ${v}`);
    if (rows.length) out.push("");
    if (i.groups && i.groups.items.length) {
      out.push(`${t.groupsOf(i.groups.groupBy)}:`, ...i.groups.items.map((g) => `- ${g.name}: ${g.detail}`));
      if (i.groups.more > 0) out.push(`- ${t.more(i.groups.more)}`);
      out.push("");
    }
    const ex = explainOf(lang);
    if (ex) out.push(`${t.insight} ${ex}`, "");
    if (i.chart) out.push(lang === "vi" ? t.chartNote : T.en.chartNote, "");
    return out;
  };
  const tx: string[] = [
    `${TAG.vi[i.kind]} · ${TAG.en[i.kind]}: ${rule}`, `Dashboard: ${dash}`, "",
    ...textBlock("vi"), "----- ENGLISH VERSION -----", "", ...textBlock("en"),
    `${T.vi.open} / ${T.en.open}: ${i.dashboardUrl}`, "",
  ];
  if (i.snoozeUrl) tx.push(`${T.vi.snooze} / ${T.en.snooze}: ${i.snoozeUrl}`);
  if (i.muteUrl) tx.push(`${T.vi.mute} / ${T.en.mute}: ${i.muteUrl}`);
  tx.push(`${T.vi.unsub} / ${T.en.unsub}: ${i.unsubscribeUrl}`);

  return { subject, html, text: tx.join("\n") };
}
