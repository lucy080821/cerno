import type { KpiFact, MoverFact, ReportFacts } from "@/lib/server/reports/facts";
import type { ReportBody } from "@/lib/server/reports/write-report";
import { clean, escapeHtml, type BuiltEmail } from "./invite-email";

/**
 * Email báo cáo định kỳ (thuần, không gửi). HTML thuần theo bảng + CSS nội tuyến: KHÔNG iframe, KHÔNG JavaScript
 * (Gmail/Outlook chặn). Ảnh biểu đồ đính kèm nội tuyến (cid:), mỗi ảnh bọc trong link mở dashboard. Luôn có bản chữ thuần
 * và link huỷ nhận. Mọi chữ do AI, người dùng hoặc dữ liệu tạo ra đều được thoát HTML.
 * Bố cục: lời chào → Tóm tắt điều hành → Chỉ số chính → Điểm nổi bật → Điểm cần lưu ý → ảnh → Phân tích theo yêu cầu →
 * Đề xuất hành động → nút mở dashboard → cập nhật lúc / huỷ nhận.
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
  /** Ghi chú hiển thị cuối thư (ảnh bị bỏ, link dự phòng...). */
  notes?: string[];
}

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

function kpiRow(k: KpiFact): string {
  const color = COLOR[k.tone];
  const change = k.growthText
    ? `<span style="color:${color};font-weight:700">${k.dir ? ARROW[k.dir] + " " : ""}${e(k.growthText)}</span>`
    : `<span style="color:#9ca3af">–</span>`;
  const cell = `padding:10px 8px;border-bottom:1px solid #e5e7eb;${FONT}font-size:14px;line-height:1.4;`;
  return (
    `<tr><td style="${cell}color:#374151">${e(k.title)}</td>` +
    `<td style="${cell}text-align:right;font-weight:700;color:#14162b">${k.value ? e(k.value.text) : "—"}</td>` +
    `<td style="${cell}text-align:right;color:#6b7280">${k.prev ? e(k.prev.text) : "—"}</td>` +
    `<td style="${cell}text-align:right">${change}</td></tr>`
  );
}

function kpiTable(f: ReportFacts): string {
  if (!f.kpis.length) return "";
  const th = `padding:8px;border-bottom:2px solid #14162b;${FONT}font-size:12px;line-height:1.3;font-weight:700;color:#6b7280;text-transform:uppercase;`;
  return (
    h2("Chỉ số chính") +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">` +
    `<tr><th align="left" style="${th}">Chỉ số</th><th align="right" style="${th}">${e(f.period.label)}</th>` +
    `<th align="right" style="${th}">${e(f.prevPeriod.label)}</th><th align="right" style="${th}">Thay đổi</th></tr>` +
    f.kpis.map(kpiRow).join("") +
    `</table>`
  );
}

function moversBlock(f: ReportFacts): string {
  if (!f.movers.length) return "";
  const side = (label: string, color: string, items: MoverFact["up"]) =>
    items.length
      ? `<div style="margin:2px 0;${FONT}font-size:13px;line-height:1.5;color:#374151"><strong style="color:${color}">${label}:</strong> ` +
        items.map((i) => `${e(i.name)} (${i.delta.value > 0 ? "+" : ""}${e(i.delta.text)})`).join("; ") +
        `</div>`
      : "";
  return (
    h2("Nhóm tăng, giảm nhiều nhất") +
    f.movers
      .map(
        (m) =>
          `<div style="margin:0 0 12px"><div style="${FONT}font-size:13px;line-height:1.4;font-weight:700;color:#14162b">${e(m.chart)}</div>` +
          side("Tăng", COLOR.good, m.up) + side("Giảm", COLOR.bad, m.down) + `</div>`,
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

/** Soạn email báo cáo. */
export function buildReportEmail(i: ReportEmailInput): BuiltEmail {
  const { facts: f, body } = i;
  const dash = clean(i.dashboardName, 80) || "Dashboard";
  const app = clean(i.appName, 40) || "Cerno";
  const name = clean(i.recipientName, 60);
  const greeting = name ? `Kính gửi anh/chị ${name},` : "Kính gửi anh/chị,";
  const updated = formatVnTime(f.updatedAt);
  const subject = clean(`[${app}] ${dash} · ${f.period.label}`, 150);

  const intro = body
    ? p(para(body.executiveSummary))
    : p(`Dưới đây là số liệu của dashboard “${e(dash)}” trong ${e(f.period.label)} so với ${e(f.prevPeriod.label)}.`);

  const sections: string[] = [
    p(`<strong>${e(greeting)}</strong>`),
    body ? h2("Tóm tắt điều hành") + intro : intro,
    kpiTable(f),
    body && body.highlights.length ? h2("Điểm nổi bật") + list(body.highlights) : "",
    body && body.concerns.length ? h2("Điểm cần lưu ý") + list(body.concerns) : "",
    moversBlock(f),
    i.images.length ? h2("Biểu đồ") + imagesBlock(i.images, i.dashboardUrl) : "",
    body && body.analysis ? h2("Phân tích theo yêu cầu") + p(para(body.analysis)) : "",
    body && body.actions.length ? h2("Đề xuất hành động") + list(body.actions) : "",
  ];
  const notes = [...f.notes, ...(i.notes ?? [])];

  const html =
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${e(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f8"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f8"><tr><td align="center" style="padding:20px 12px">` +
    `<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden">` +
    `<tr><td style="background:#14162b;padding:18px 24px;${FONT}font-size:18px;line-height:1.2;font-weight:700;color:#ffffff">${e(app)}` +
    `<div style="margin-top:4px;${FONT}font-size:13px;line-height:1.3;font-weight:400;color:#b8bdd6">${e(dash)} · ${e(f.period.label)}</div></td></tr>` +
    `<tr><td style="padding:8px 24px 24px">${sections.join("")}` +
    `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0 6px"><tr><td style="border-radius:8px;background:#6d5efc">` +
    `<a href="${e(i.dashboardUrl)}" style="display:inline-block;padding:12px 22px;${FONT}font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">Mở dashboard</a></td></tr></table>` +
    (notes.length
      ? `<div style="margin-top:14px">${notes.map((n) => `<div style="${FONT}font-size:12px;line-height:1.5;color:#6b7280">• ${para(n)}</div>`).join("")}</div>`
      : "") +
    p(`<span style="color:#6b7280">Trân trọng,<br>${e(app)}</span>`) +
    `</td></tr>` +
    `<tr><td style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;${FONT}font-size:12px;line-height:1.6;color:#6b7280">` +
    (updated ? `Số liệu cập nhật lúc ${e(updated)} (giờ Việt Nam).<br>` : "") +
    `Bạn nhận email này vì được đăng ký nhận báo cáo định kỳ của dashboard này. ` +
    `<a href="${e(i.unsubscribeUrl)}" style="color:#6b7280">Huỷ nhận email này</a>.` +
    `</td></tr></table></td></tr></table></body></html>`;

  // Bản chữ thuần.
  const t: string[] = [greeting, ""];
  if (body) t.push("TÓM TẮT ĐIỀU HÀNH", body.executiveSummary, "");
  else t.push(`Số liệu của dashboard "${dash}" trong ${f.period.label} so với ${f.prevPeriod.label}.`, "");
  if (f.kpis.length) {
    t.push("CHỈ SỐ CHÍNH");
    for (const k of f.kpis) {
      t.push(`- ${k.title}: ${k.value ? k.value.text : "không có dữ liệu"}${k.prev ? ` (kỳ trước ${k.prev.text})` : ""}${k.growthText ? `, ${k.growthText}` : ""}`);
    }
    t.push("");
  }
  if (body?.highlights.length) t.push("ĐIỂM NỔI BẬT", ...body.highlights.map((x) => `- ${x}`), "");
  if (body?.concerns.length) t.push("ĐIỂM CẦN LƯU Ý", ...body.concerns.map((x) => `- ${x}`), "");
  if (f.movers.length) {
    t.push("NHÓM TĂNG, GIẢM NHIỀU NHẤT");
    for (const m of f.movers) {
      t.push(m.chart);
      if (m.up.length) t.push(`  Tăng: ${m.up.map((x) => `${x.name} (+${x.delta.text})`).join("; ")}`);
      if (m.down.length) t.push(`  Giảm: ${m.down.map((x) => `${x.name} (${x.delta.text})`).join("; ")}`);
    }
    t.push("");
  }
  if (i.images.length) t.push(`(Email có ${i.images.length} biểu đồ dạng ảnh; xem trong dashboard nếu không hiển thị.)`, "");
  if (body?.analysis) t.push("PHÂN TÍCH THEO YÊU CẦU", body.analysis, "");
  if (body?.actions.length) t.push("ĐỀ XUẤT HÀNH ĐỘNG", ...body.actions.map((x) => `- ${x}`), "");
  t.push(`Mở dashboard: ${i.dashboardUrl}`, "");
  for (const n of notes) t.push(`* ${n}`);
  t.push("", "Trân trọng,", app, "");
  if (updated) t.push(`Số liệu cập nhật lúc ${updated} (giờ Việt Nam).`);
  t.push(`Huỷ nhận email này: ${i.unsubscribeUrl}`);

  return { subject, html, text: t.join("\n") };
}
