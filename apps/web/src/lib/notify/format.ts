import type { Dashboard, ReportFrequency, ReportSubscriptionInput } from "@dashboard/schema";

/** Phần thuần của giao diện báo cáo định kỳ: nhãn lịch, giá trị mặc định của biểu mẫu, chuyển biểu mẫu thành dữ liệu gửi API. */

export const WEEKDAY_LABELS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"] as const;
export const FREQUENCY_LABELS: Record<ReportFrequency, string> = { daily: "Hằng ngày", weekly: "Hằng tuần", monthly: "Hằng tháng" };

/** 4 mẫu gợi ý bấm để chèn vào ô yêu cầu riêng. */
export const PROMPT_SUGGESTIONS = [
  { label: "Tập trung khu vực…", text: "Tập trung phân tích theo khu vực: " },
  { label: "So cùng kỳ năm ngoái", text: "So sánh với cùng kỳ năm ngoái nếu có số liệu." },
  { label: "Chỉ ra 3 điểm yếu nhất", text: "Chỉ ra 3 điểm yếu nhất và nguyên nhân có thể." },
  { label: "Ngắn gọn dưới 150 chữ", text: "Viết ngắn gọn, dưới 150 chữ." },
] as const;

export const MAX_PROMPT = 1000;
export const MAX_WIDGETS = 6;

export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export interface ReportForm {
  /** Có = đang sửa một đăng ký đã lưu. */
  id?: string;
  recipient_email: string;
  recipient_name: string;
  frequency: ReportFrequency;
  weekday: number;
  month_day: number;
  hour_vn: number;
  prompt: string;
  widget_ids: string[];
  include_images: boolean;
  link_mode: "view_link" | "login";
  report_type: "compare" | "overview";
  enabled: boolean;
}

/** Biểu mẫu mới: người không phải chủ chỉ đăng ký cho email của chính mình. */
/**
 * Tách ô "Email người nhận" thành nhiều email (ngăn bằng dấu phẩy, chấm phẩy, khoảng trắng hoặc xuống dòng).
 * Email viết thường, bỏ trùng; chuỗi không phải email nằm ở `invalid`.
 */
export function parseRecipients(text: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) || t.length > 254) invalid.push(raw.trim());
    else if (!emails.includes(t)) emails.push(t);
  }
  return { emails, invalid };
}

export function emptyForm(me: string): ReportForm {
  return {
    recipient_email: me, recipient_name: "", frequency: "weekly", weekday: 1, month_day: 1, hour_vn: 8,
    prompt: "", widget_ids: [], include_images: true, link_mode: "view_link", report_type: "compare", enabled: true,
  };
}

/** Dòng đã lưu (từ API) thành biểu mẫu để sửa. */
export function formFromRow(r: {
  id: string; recipient_email: string; recipient_name: string; frequency: ReportFrequency; weekday: number | null; month_day: number | null;
  hour_vn: number; prompt: string; widget_ids: string[]; include_images: boolean; link_mode: "view_link" | "login"; report_type?: "compare" | "overview"; enabled: boolean;
}): ReportForm {
  return {
    id: r.id, recipient_email: r.recipient_email, recipient_name: r.recipient_name, frequency: r.frequency,
    weekday: r.weekday ?? 1, month_day: r.month_day ?? 1, hour_vn: r.hour_vn, prompt: r.prompt, widget_ids: r.widget_ids,
    include_images: r.include_images, link_mode: r.link_mode, report_type: r.report_type ?? "compare", enabled: r.enabled,
  };
}

/** Dữ liệu gửi API: chỉ gửi thứ/ngày của đúng tần suất. */
export function formToInput(f: ReportForm): ReportSubscriptionInput {
  return {
    recipient_email: f.recipient_email.trim().toLowerCase(),
    recipient_name: f.recipient_name.trim(),
    frequency: f.frequency,
    weekday: f.frequency === "weekly" ? f.weekday : null,
    month_day: f.frequency === "monthly" ? f.month_day : null,
    hour_vn: f.hour_vn,
    prompt: f.prompt.slice(0, MAX_PROMPT),
    widget_ids: f.widget_ids.slice(0, MAX_WIDGETS),
    include_images: f.include_images,
    link_mode: f.link_mode,
    report_type: f.report_type,
    enabled: f.enabled,
  };
}

/** Các phần của nhãn lịch, để giao diện vẽ từng phần riêng (mỗi phần tự dịch được): ["Hằng tuần", "Thứ Hai", "08:00"]. */
export function scheduleParts(s: { frequency: ReportFrequency; weekday: number | null; month_day: number | null; hour_vn: number }): string[] {
  const parts: string[] = [FREQUENCY_LABELS[s.frequency]];
  if (s.frequency === "weekly") parts.push(WEEKDAY_LABELS[Math.min(7, Math.max(1, s.weekday ?? 1)) - 1]);
  if (s.frequency === "monthly") parts.push(`Ngày ${s.month_day ?? 1}`);
  parts.push(hourLabel(s.hour_vn));
  return parts;
}

/** "Hằng tuần · Thứ Hai · 08:00" */
export const scheduleLabel = (s: Parameters<typeof scheduleParts>[0]): string => scheduleParts(s).join(" · ");

/** Chèn gợi ý vào ô yêu cầu: nối thêm (ngăn cách bằng dấu cách), không vượt giới hạn, không chèn trùng. */
export function appendSuggestion(prompt: string, text: string): string {
  if (prompt.includes(text)) return prompt;
  const next = prompt.trim() ? `${prompt.trim()} ${text}` : text;
  return next.length > MAX_PROMPT ? prompt : next;
}

export interface ReportableWidget {
  id: string;
  label: string;
  kind: "chart" | "kpi";
}

/** Widget có thể đưa vào email dưới dạng ảnh (biểu đồ không phải bảng, thẻ KPI), theo thứ tự đọc, bỏ widget ẩn. */
export function reportableWidgets(doc: Dashboard): ReportableWidget[] {
  const out: ReportableWidget[] = [];
  for (const w of [...doc.widgets].filter((x) => !x.hidden).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const c = w.config;
    if (c.kind === "kpi") out.push({ id: w.id, kind: "kpi", label: c.title?.trim() || `KPI ${c.metric.column}` });
    else if (c.kind === "chart" && c.chartType !== "table") out.push({ id: w.id, kind: "chart", label: c.title?.trim() || `Biểu đồ ${c.chartType}` });
  }
  return out;
}
