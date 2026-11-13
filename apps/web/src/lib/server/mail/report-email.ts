import type { KpiFact, MoverFact, ReportFacts } from "@/lib/server/reports/facts";
import type { ReportBody, ReportText } from "@/lib/server/reports/write-report";
import { growthEn, languageBand, toEn } from "./bilingual";
import { clean, escapeHtml, type BuiltEmail } from "./invite-email";

/**
 * Email báo cáo định kỳ (thuần, không gửi), SONG NGỮ trong MỘT thư: phần tiếng Việt ở trên, phần tiếng Anh ở dưới
 * (cùng cách với thư mời). HTML thuần theo bảng + CSS nội tuyến: KHÔNG iframe, KHÔNG JavaScript (Gmail/Outlook chặn).
 * Ảnh biểu đồ đính kèm nội tuyến (cid:), mỗi ảnh bọc trong link mở dashboard; chỉ đặt ở phần tiếng Việt (không lặp ảnh).
 * Luôn có bản chữ thuần và link huỷ nhận. Mọi chữ do AI, người dùng hoặc dữ liệu tạo ra đều được thoát HTML.
 * Bố cục mỗi ngôn ngữ: lời chào → Tóm tắt điều hành → Chỉ số chính → Điểm nổi bật → Điểm cần lưu ý → nhóm tăng/giảm → ảnh →
 * Phân tích theo yêu cầu → Đề xuất hành động; rồi nút mở dashboard, ghi chú, cập nhật lúc / huỷ nhận.
 * Phần AI tiếng Anh lấy từ `body.en`; thiếu thì phần tiếng Anh chỉ có số liệu (bảng, nhóm tăng giảm) và nhãn.
 */

export interface ReportEmailImage {
  cid: string;
  title: string;
}

export interface ReportEmailInput {
  appName: string;
  dashboardName: string;
  /** Tên người nhận; rỗng thì chào "Kính gửi anh/chị,". */
  recipientName: string;
  facts: ReportFacts;
  /** null = báo cáo không có phần AI (AI lỗi/không kiểm được số/gói không có AI): chỉ bảng số và ảnh. */
  body: ReportBody | null;
  images: ReportEmailImage[];
  /** Link mở dashboard (link xem hoặc link đăng nhập). */
  dashboardUrl: string;
  /** Link trang huỷ nhận. */
  unsubscribeUrl: string;
  /** Ghi chú hiển thị cuối thư (ảnh bị bỏ, link dự phòng...). Tiếng Anh lấy từ từ điển, không có thì giữ nguyên. */
  notes?: string[];
}

type Lang = "vi" | "en";

/** Nhãn cố định theo ngôn ngữ. */
const L = {
  vi: {
    greeting: (n: string) => (n ? `Kính gửi anh/chị ${n},` : "Kính gửi anh/chị,"),
    summary: "Tóm tắt điều hành", keyMetrics: "Chỉ số chính", metric: "Chỉ số", change: "Thay đổi", vs: "so với",
    movers: "Nhóm tăng, giảm nhiều nhất", up: "Tăng", down: "Giảm", highlights: "Điểm nổi bật", concerns: "Điểm cần lưu ý",
    charts: "Biểu đồ", analysis: "Phân tích theo yêu cầu", actions: "Đề xuất hành động",
    intro: (dash: string, cur: string, prev: string) => `Dưới đây là số liệu của dashboard “${dash}” trong ${cur} so với ${prev}.`,
    chartsAbove: "",
    open: "Mở dashboard", regards: "Trân trọng,", updated: (t: string) => `Số liệu cập nhật lúc ${t} (giờ Việt Nam).`,
    why: "Bạn nhận email này vì được đăng ký nhận báo cáo định kỳ của dashboard này.", unsub: "Huỷ nhận email này",
    noData: "không có dữ liệu", prevWord: "kỳ trước", chartsInMail: (n: number) => `(Email có ${n} biểu đồ dạng ảnh; xem trong dashboard nếu không hiển thị.)`,
    band: "TIẾNG VIỆT",
  },
  en: {
    greeting: (n: string) => (n ? `Dear ${n},` : "Dear reader,"),
    summary: "Executive summary", keyMetrics: "Key metrics", metric: "Metric", change: "Change", vs: "vs.",
    movers: "Biggest gainers and decliners", up: "Up", down: "Down", highlights: "Highlights", concerns: "Points to watch",
    charts: "Charts", analysis: "Analysis on request", actions: "Recommended actions",
    intro: (dash: string, cur: string, prev: string) => `Here are the figures for the dashboard “${dash}” for ${cur} compared with ${prev}.`,
    chartsAbove: "The charts are shown in the Vietnamese section above.",
    open: "Open dashboard", regards: "Best regards,", updated: (t: string) => `Data updated at ${t} (Vietnam time).`,
    why: "You are receiving this email because you were subscribed to this dashboard's scheduled reports.", unsub: "Unsubscribe from this email",
    noData: "no data", prevWord: "previous period", chartsInMail: (n: number) => `(This email has ${n} charts as images; see the dashboard if they don't display.)`,
    band: "ENGLISH VERSION",
  },
} as const;

const COLOR = { good: "#16a34a", bad: "#dc2626", neutral: "#6b7280" } as const;
const ARROW = { up: "▲", down: "▼", flat: "■" } as const;

const e = escapeHtml;
const para = (s: string) => e(s).replace(/\r?\n/g, "<br>");

/** dd/mm/yyyy HH:mm theo giờ Việt Nam. */
export function formatVnTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const h2 = (t: string) => `<h2 style="margin:24px 0 8px;${FONT}font-size:16px;line-height:1.3;font-weight:700;color:#14162b">${e(t)}</h2>`;
const p = (html: string) => `<p style="margin:0 0 10px;${FONT}font-size:14px;line-height:1.6;color:#1f2937">${html}</p>`;
const list = (items: string[]) =>
  items.length
    ? `<ul style="margin:0 0 10px;padding-left:20px;${FONT}font-size:14px;line-height:1.6;color:#1f2937">${items.map((i) => `<li style="margin:0 0 6px">${para(i)}</li>`).join("")}</ul>`
    : "";

/** Chữ thay đổi theo ngôn ngữ ("+6 ngày" → "+6 days"). */
const growthOf = (k: KpiFact, lang: Lang) => (lang === "en" ? growthEn(k.growthText) : k.growthText);
const labelOf = (s: { label: string; labelEn?: string }, lang: Lang) => (lang === "en" ? s.labelEn ?? toEn(s.label) : s.label);

function kpiRow(k: KpiFact, lang: Lang): string {
  const color = COLOR[k.tone];
  const change = k.growthText
    ? `<span style="color:${color};font-weight:700">${k.dir ? ARROW[k.dir] + " " : ""}${e(growthOf(k, lang))}</span>`
    : `<span style="color:#9ca3af">–</span>`;
  const cell = `padding:10px 8px;border-bottom:1px solid #e5e7eb;${FONT}font-size:14px;line-height:1.4;`;
  return (
    `<tr><td style="${cell}color:#374151">${e(k.title)}</td>` +
    `<td style="${cell}text-align:right;font-weight:700;color:#14162b">${k.value ? e(k.value.text) : "—"}</td>` +
    `<td style="${cell}text-align:right;color:#6b7280">${k.prev ? e(k.prev.text) : "—"}</td>` +
    `<td style="${cell}text-align:right">${change}</td></tr>`
  );
}

function kpiTable(f: ReportFacts, lang: Lang): string {
  if (!f.kpis.length) return "";
  const t = L[lang];
  const th = `padding:8px;border-bottom:2px solid #14162b;${FONT}font-size:12px;line-height:1.3;font-weight:700;color:#6b7280;text-transform:uppercase;`;
  return (
    h2(t.keyMetrics) +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">` +
    `<tr><th align="left" style="${th}">${t.metric}</th><th align="right" style="${th}">${e(labelOf(f.period, lang))}</th>` +
    `<th align="right" style="${th}">${e(labelOf(f.prevPeriod, lang))}</th><th align="right" style="${th}">${t.change}</th></tr>` +
    f.kpis.map((k) => kpiRow(k, lang)).join("") +
    `</table>`
  );
}

// ---- Bố cục cho báo cáo CÓ phần AI (gói trả phí): thẻ chỉ số, khung tóm tắt, thẻ nổi bật/lưu ý, đề xuất đánh số ----

/** Thẻ chỉ số: số lớn, chip thay đổi, kỳ trước. Hai thẻ mỗi hàng (bảng lồng bảng để Gmail/Outlook hiển thị đúng). */
function kpiCards(f: ReportFacts, lang: Lang): string {
  if (!f.kpis.length) return "";
  const t = L[lang];
  const card = (k: KpiFact): string => {
    const color = COLOR[k.tone];
    const change = k.growthText
      ? `<span style="color:${color};font-weight:700">${k.dir ? ARROW[k.dir] + " " : ""}${e(growthOf(k, lang))}</span>`
      : `<span style="color:#9ca3af">–</span>`;
    return (
      `<td width="50%" valign="top" style="padding:0 4px 8px">` +
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-left:4px solid ${k.growthText ? color : "#d1d5db"};border-radius:10px;background:#ffffff">` +
      `<tr><td style="padding:12px 14px 2px;${FONT}font-size:12px;line-height:1.3;font-weight:700;color:#6b7280;text-transform:uppercase">${e(k.title)}</td></tr>` +
      `<tr><td style="padding:0 14px;${FONT}font-size:24px;line-height:1.3;font-weight:700;color:#14162b">${k.value ? e(k.value.text) : "—"}</td></tr>` +
      `<tr><td style="padding:4px 14px 12px;${FONT}font-size:13px;line-height:1.4;color:#6b7280">${change}` +
      (k.prev ? ` <span style="color:#9ca3af">${t.vs} ${e(k.prev.text)}</span>` : "") +
      `</td></tr></table></td>`
    );
  };
  const rows: string[] = [];
  for (let i = 0; i < f.kpis.length; i += 2) {
    const pair = f.kpis.slice(i, i + 2).map(card);
    if (pair.length === 1) pair.push(`<td width="50%" style="padding:0 4px 8px">&nbsp;</td>`);
    rows.push(`<tr>${pair.join("")}</tr>`);
  }
  return (
    h2(t.keyMetrics) +
    `<div style="margin:0 0 6px;${FONT}font-size:12px;color:#6b7280">${e(labelOf(f.period, lang))} ${t.vs} ${e(labelOf(f.prevPeriod, lang))}</div>` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join("")}</table>`
  );
}

/** Khung có vạch màu bên trái. */
function callout(html: string, accent: string, bg: string): string {
  return (
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 6px;border-collapse:separate"><tr>` +
    `<td style="padding:14px 16px;background:${bg};border-left:4px solid ${accent};border-radius:8px;${FONT}font-size:14px;line-height:1.65;color:#1f2937">${html}</td>` +
    `</tr></table>`
  );
}

/** Danh sách có ký hiệu đầu dòng riêng (✓, !) trong khung màu. */
function markedList(items: string[], mark: string, markColor: string, accent: string, bg: string): string {
  if (!items.length) return "";
  const rows = items
    .map(
      (t) =>
        `<tr><td valign="top" width="22" style="padding:3px 0;${FONT}font-size:14px;line-height:1.6;font-weight:700;color:${markColor}">${mark}</td>` +
        `<td style="padding:3px 0;${FONT}font-size:14px;line-height:1.6;color:#1f2937">${para(t)}</td></tr>`,
    )
    .join("");
  return callout(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>`, accent, bg);
}

/** Đề xuất hành động đánh số 1, 2, 3. */
function numberedActions(items: string[]): string {
  if (!items.length) return "";
  return items
    .map(
      (t, i) =>
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 8px;border:1px solid #e5e7eb;border-radius:8px"><tr>` +
        `<td valign="top" width="40" style="padding:10px 0 10px 12px;${FONT}font-size:16px;line-height:1.4;font-weight:700;color:#6d5efc">${i + 1}.</td>` +
        `<td style="padding:10px 14px 10px 0;${FONT}font-size:14px;line-height:1.6;color:#1f2937">${para(t)}</td></tr></table>`,
    )
    .join("");
}

function moversBlock(f: ReportFacts, lang: Lang): string {
  if (!f.movers.length) return "";
  const t = L[lang];
  const side = (label: string, color: string, items: MoverFact["up"]) =>
    items.length
      ? `<div style="margin:2px 0;${FONT}font-size:13px;line-height:1.5;color:#374151"><strong style="color:${color}">${label}:</strong> ` +
        items.map((i) => `${e(i.name)} (${i.delta.value > 0 ? "+" : ""}${e(i.delta.text)})`).join("; ") +
        `</div>`
      : "";
  return (
    h2(t.movers) +
    f.movers
      .map(
        (m) =>
          `<div style="margin:0 0 12px"><div style="${FONT}font-size:13px;line-height:1.4;font-weight:700;color:#14162b">${e(m.chart)}</div>` +
          side(t.up, COLOR.good, m.up) + side(t.down, COLOR.bad, m.down) + `</div>`,
      )
      .join("")
  );
}

function imagesBlock(images: ReportEmailImage[], url: string): string {
  return images
    .map(
      (i) =>
        `<div style="margin:0 0 14px"><a href="${e(url)}" style="text-decoration:none"><img src="cid:${e(i.cid)}" width="600" alt="${e(i.title)}" ` +
        `style="display:block;width:100%;max-width:600px;height:auto;border:1px solid #e5e7eb;border-radius:8px"></a></div>`,
    )
    .join("");
}

/** Các khối HTML của MỘT ngôn ngữ. `text` là bài AI đúng ngôn ngữ đó (null = không có phần AI cho ngôn ngữ này). */
function sectionsFor(lang: Lang, i: ReportEmailInput, dash: string, name: string, text: ReportText | null): string[] {
  const t = L[lang];
  const f = i.facts;
  const fancy = !!text; // có phần AI thì dùng bố cục đầy đủ (thẻ chỉ số, khung màu)
  const intro = t.intro(e(dash), e(labelOf(f.period, lang)), e(labelOf(f.prevPeriod, lang)));
  const images = lang === "vi" && i.images.length ? h2(t.charts) + imagesBlock(i.images, i.dashboardUrl) : "";
  const imagesNote = lang === "en" && i.images.length ? p(`<span style="color:#6b7280">${e(t.chartsAbove)}</span>`) : "";
  const head = p(`<strong>${e(t.greeting(name))}</strong>`);
  if (!text) {
    return [head, p(intro), kpiTable(f, lang), moversBlock(f, lang), images, imagesNote];
  }
  return [
    head,
    h2(t.summary) + callout(para(text.executiveSummary), "#6d5efc", "#f4f3ff"),
    fancy ? kpiCards(f, lang) : kpiTable(f, lang),
    text.highlights.length ? h2(t.highlights) + markedList(text.highlights, "✓", "#16a34a", "#16a34a", "#f0fdf4") : "",
    text.concerns.length ? h2(t.concerns) + markedList(text.concerns, "!", "#b45309", "#f59e0b", "#fffbeb") : "",
    moversBlock(f, lang),
    images,
    imagesNote,
    text.analysis ? h2(t.analysis) + p(para(text.analysis)) : "",
    text.actions.length ? h2(t.actions) + numberedActions(text.actions) : "",
  ];
}

/** Bản chữ thuần của MỘT ngôn ngữ. */
function textFor(lang: Lang, i: ReportEmailInput, dash: string, name: string, text: ReportText | null): string[] {
  const t = L[lang];
  const f = i.facts;
  const out: string[] = [t.greeting(name), ""];
  if (text) out.push(t.summary.toUpperCase(), text.executiveSummary, "");
  else out.push(t.intro(dash, labelOf(f.period, lang), labelOf(f.prevPeriod, lang)).replace(/[“”]/g, '"'), "");
  if (f.kpis.length) {
    out.push(t.keyMetrics.toUpperCase());
    for (const k of f.kpis) {
      const g = growthOf(k, lang);
      out.push(`- ${k.title}: ${k.value ? k.value.text : t.noData}${k.prev ? ` (${t.prevWord} ${k.prev.text})` : ""}${g ? `, ${g}` : ""}`);
    }
    out.push("");
  }
  if (text?.highlights.length) out.push(t.highlights.toUpperCase(), ...text.highlights.map((x) => `- ${x}`), "");
  if (text?.concerns.length) out.push(t.concerns.toUpperCase(), ...text.concerns.map((x) => `- ${x}`), "");
  if (f.movers.length) {
    out.push(t.movers.toUpperCase());
    for (const m of f.movers) {
      out.push(m.chart);
      if (m.up.length) out.push(`  ${t.up}: ${m.up.map((x) => `${x.name} (+${x.delta.text})`).join("; ")}`);
      if (m.down.length) out.push(`  ${t.down}: ${m.down.map((x) => `${x.name} (${x.delta.text})`).join("; ")}`);
    }
    out.push("");
  }
  if (lang === "vi" && i.images.length) out.push(t.chartsInMail(i.images.length), "");
  if (text?.analysis) out.push(t.analysis.toUpperCase(), text.analysis, "");
  if (text?.actions.length) out.push(t.actions.toUpperCase(), ...text.actions.map((x) => `- ${x}`), "");
  return out;
}

/** Soạn email báo cáo song ngữ. */
export function buildReportEmail(i: ReportEmailInput): BuiltEmail {
  const { facts: f, body } = i;
  const dash = clean(i.dashboardName, 80) || "Dashboard";
  const app = clean(i.appName, 40) || "Cerno";
  const name = clean(i.recipientName, 60);
  const updated = formatVnTime(f.updatedAt);
  const subject = clean(`[${app}] ${dash} · ${f.period.label} / ${labelOf(f.period, "en")}`, 150);
  const notes = [...f.notes, ...(i.notes ?? [])];

  const viText = body;
  const enText = body?.en ?? null;
  const vi = L.vi;
  const en = L.en;

  const noteHtml = (n: string) => `<div style="${FONT}font-size:12px;line-height:1.5;color:#6b7280">• ${para(n)}<br><span style="color:#9ca3af">${para(toEn(n))}</span></div>`;

  const html =
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${e(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f8"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f8"><tr><td align="center" style="padding:20px 12px">` +
    `<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden">` +
    `<tr><td style="background:#14162b;padding:18px 24px;${FONT}font-size:18px;line-height:1.2;font-weight:700;color:#ffffff">${e(app)}` +
    `<div style="margin-top:4px;${FONT}font-size:13px;line-height:1.3;font-weight:400;color:#b8bdd6">${e(dash)} · ${e(f.period.label)} / ${e(labelOf(f.period, "en"))}</div></td></tr>` +
    `<tr><td style="padding:8px 24px 24px">` +
    `<div style="margin:8px 0 0;${FONT}font-size:12px;color:#6b7280">${vi.band} · English version below ↓</div>` +
    sectionsFor("vi", i, dash, name, viText).join("") +
    languageBand(en.band) +
    sectionsFor("en", i, dash, name, enText).join("") +
    `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0 6px"><tr><td style="border-radius:8px;background:#6d5efc">` +
    `<a href="${e(i.dashboardUrl)}" style="display:inline-block;padding:12px 22px;${FONT}font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">${vi.open} · ${en.open}</a></td></tr></table>` +
    (notes.length ? `<div style="margin-top:14px">${notes.map(noteHtml).join("")}</div>` : "") +
    p(`<span style="color:#6b7280">${vi.regards} / ${en.regards}<br>${e(app)}</span>`) +
    `</td></tr>` +
    `<tr><td style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;${FONT}font-size:12px;line-height:1.6;color:#6b7280">` +
    (updated ? `${e(vi.updated(updated))}<br>${e(en.updated(updated))}<br>` : "") +
    `${vi.why}<br>${en.why} ` +
    `<a href="${e(i.unsubscribeUrl)}" style="color:#6b7280">${vi.unsub} · ${en.unsub}</a>.` +
    `</td></tr></table></td></tr></table></body></html>`;

  // Bản chữ thuần.
  const t: string[] = [
    ...textFor("vi", i, dash, name, viText),
    "----- ENGLISH VERSION -----",
    "",
    ...textFor("en", i, dash, name, enText),
    `${vi.open} / ${en.open}: ${i.dashboardUrl}`,
    "",
  ];
  for (const n of notes) t.push(`* ${n}`, `  ${toEn(n)}`);
  t.push("", `${vi.regards} / ${en.regards}`, app, "");
  if (updated) t.push(vi.updated(updated), en.updated(updated));
  t.push(`${vi.unsub} / ${en.unsub}: ${i.unsubscribeUrl}`);

  return { subject, html, text: t.join("\n") };
}
