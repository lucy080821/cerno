/**
 * Làm nổi chỉ số chính trong câu trả lời của AI. AI bao các con số/kết luận quan trọng nhất bằng cặp ⟦ ⟧ (lời nhắc dặn tối đa ~8 chỗ);
 * trình duyệt vẽ phần đó bằng nét bút dạ quang. Bản gốc (đã lưu, sao chép) vẫn là chữ thuần: `stripHighlights` bỏ dấu khi sao chép.
 * Tin cũ hoặc AI quên đánh dấu thì `autoHighlight` tự nổi các con số kèm đơn vị trong mục TÓM TẮT. Mọi hàm thuần.
 */

export const HL_OPEN = "⟦";
export const HL_CLOSE = "⟧";

export interface Segment {
  text: string;
  hot: boolean;
}

const PAIR = /⟦([^⟦⟧\n]{1,80})⟧/g;

/** AI có dùng dấu đánh dấu trong câu này không (kể cả dấu mở đang chờ dấu đóng khi còn stream). */
export const usesHighlights = (text: string): boolean => text.includes(HL_OPEN);

/** Bỏ mọi dấu ⟦ ⟧ (kể cả dấu mở đang chờ dấu đóng khi câu trả lời còn đang chạy), giữ nguyên chữ bên trong. */
export const stripHighlights = (text: string): string => text.replaceAll(HL_OPEN, "").replaceAll(HL_CLOSE, "");

/** Cắt một dòng thành các đoạn thường/nổi theo cặp ⟦ ⟧. Dấu lẻ không đủ cặp bị bỏ để không hiện ký tự lạ. */
export function splitHighlights(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(PAIR)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: stripHighlights(text.slice(last, at)), hot: false });
    out.push({ text: m[1], hot: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: stripHighlights(text.slice(last)), hot: false });
  return out.filter((s) => s.text);
}

/** Số có thể kèm đơn vị: 18.382.974 đồng, 46,59%, 64 đơn, 1.234,5 VND, -3,3 triệu. */
const NUMBER = /[-+−]?\d[\d.,]*(?:\s?(?:%|đồng|VND|đ(?![\p{L}])|triệu|nghìn|tỷ|đơn|cái|sản phẩm|orders|items|million|billion|k\b|M\b))?/giu;

/** Số nào đáng nổi: có đơn vị hoặc từ 5 chữ số trở lên (bỏ qua số thứ tự, ngày tháng, mã như "1." "CHAO-006"). */
function worthy(token: string, before: string): boolean {
  if (/[\p{L}-]$/u.test(before) && !/\s$/.test(before)) return false; // dính chữ/mã: SKU12, CHAO-006
  const digits = token.replace(/\D/g, "").length;
  const hasUnit = /[%a-zA-Zà-ỹđ]/u.test(token.replace(/[\d.,\s+\-−]/g, ""));
  return hasUnit || digits >= 5;
}

/** Tự làm nổi các con số kèm đơn vị trong một dòng (dùng khi AI không đánh dấu). */
export function autoHighlight(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(NUMBER)) {
    const at = m.index ?? 0;
    const token = m[0].trimEnd();
    if (!worthy(token, text.slice(0, at))) continue;
    // Dấu chấm/phẩy cuối là dấu câu, không thuộc số.
    const clean = token.replace(/[.,]+$/, "");
    if (at > last) out.push({ text: text.slice(last, at), hot: false });
    out.push({ text: clean, hot: true });
    last = at + clean.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hot: false });
  return out.length ? out.filter((s) => s.text) : [{ text, hot: false }];
}
