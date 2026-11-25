/**
 * Thông báo khi hết lượt AI: nói rõ Claude (kèm tên model) và Groq mỗi bên bị gì, kèm lời mời liên hệ để nâng hạn mức. Hàm thuần dùng ở
 * server (bộ định tuyến AI) và để SINH bản dịch tiếng Anh trong từ điển (lib/i18n/en/ai.ts) nên hai bên luôn khớp nhau từng chữ.
 */
export type QuotaKind = "daily" | "monthly" | "budget";
/** Tình trạng của Groq (AI miễn phí dự phòng) lúc Claude bị từ chối: không dùng Groq / quá tải-hết hạn mức / yêu cầu quá lớn / lỗi khác. */
export type GroqState = null | "busy" | "toolarge" | "error";

export const QUOTA_KINDS: QuotaKind[] = ["daily", "monthly", "budget"];
export const GROQ_STATES: GroqState[] = [null, "busy", "toolarge", "error"];

/** Trạng thái Groq từ mã HTTP lỗi của Groq. */
export const groqStateOf = (status: number): Exclude<GroqState, null> => (status === 429 ? "busy" : status === 413 ? "toolarge" : "error");

/** "claude-haiku-5-5" → "Haiku 5.5" (câu thông báo đã có chữ "Claude" đứng trước); tên lạ thì giữ nguyên. */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/i.exec(model.trim());
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
}

const VI = {
  daily: (m: string) => `Đã hết lượt dùng Claude (${m}) hôm nay`,
  monthly: (m: string) => `Đã hết lượt dùng Claude (${m}) tháng này`,
  budget: (m: string) => `Claude (${m}) đã hết ngân sách của tháng này`,
  groq: { busy: " và Groq (miễn phí) đang quá tải hoặc hết hạn mức.", toolarge: " và Groq (miễn phí) không xử lý được câu hỏi này vì dữ liệu gửi kèm quá lớn.", error: " và Groq (miễn phí) đang gặp lỗi." },
  cta: " Liên hệ để nâng hạn mức hoặc nâng cấp gói.",
};
const EN = {
  daily: (m: string) => `You've used all your ${m} requests for today`,
  monthly: (m: string) => `You've used all your ${m} requests for this month`,
  budget: (m: string) => `${m} has used up this month's budget`,
  groq: { busy: " and Groq (free) is overloaded or out of quota.", toolarge: " and Groq (free) can't handle this question because the attached data is too large.", error: " and Groq (free) is having problems." },
  cta: " Contact us to raise your limit or upgrade your plan.",
};

/** `model` là tên hiển thị (xem `modelLabel`). `lang` mặc định tiếng Việt. */
export function quotaText(kind: QuotaKind, model: string, groq: GroqState, lang: "vi" | "en" = "vi"): string {
  const t = lang === "en" ? EN : VI;
  return `${t[kind](model)}${groq ? t.groq[groq] : "."}${t.cta}`;
}
