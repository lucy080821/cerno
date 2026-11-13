import { translateToEnglish } from "@/lib/i18n";

/**
 * Hỗ trợ email song ngữ: MỘT thư có phần tiếng Việt ở trên, phần tiếng Anh ở dưới (cùng cách với thư mời).
 * Người nhận không phải chọn ngôn ngữ, và thư vẫn đủ nghĩa khi chỉ đọc một nửa.
 */

/** Tiếng Anh của một câu cố định hoặc có mẫu ({0}) trong từ điển; không có thì giữ nguyên chữ gốc. */
export const toEn = (s: string): string => translateToEnglish(s) ?? s;

/** Chữ tăng trưởng đã định dạng ("+6 ngày", "+25,4%", "+3,2 pp") sang tiếng Anh: chỉ đơn vị "ngày" cần đổi. */
export const growthEn = (s: string): string => s.replace(/\s*ngày$/, " days");

const FONT = "font-family:Arial,Helvetica,sans-serif;";

/** Dải ngăn cách hai phần ngôn ngữ trong thư (có nhãn để người đọc biết đang ở phần nào). */
export function languageBand(label: string): string {
  return (
    `<div style="margin:26px 0 6px;padding:8px 12px;background:#f3f4f8;border-radius:8px;${FONT}font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.5px;color:#4b5563">` +
    `${label}</div>`
  );
}
