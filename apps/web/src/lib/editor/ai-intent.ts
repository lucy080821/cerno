/**
 * Câu của người dùng có cần công cụ (vẽ biểu đồ / sửa dashboard) không?
 *
 * Định nghĩa công cụ và lời nhắc đi kèm tốn ~1.800 token mỗi yêu cầu, trong khi dịch vụ AI chỉ cho 8.000 token/phút. Câu hỏi
 * phân tích thuần tuý ("chỉ số này tốt chưa?", "video nào đang làm tốt?") không cần công cụ nên không gửi chúng: tiết kiệm
 * chỗ cho dữ liệu và tránh bị từ chối vì quá lớn. Nhận diện bằng từ khoá tiếng Việt/Anh; sai thì chỉ mất công cụ ở lượt đó
 * (người dùng nói rõ hơn là được), nên nghiêng về nhận diện rộng một chút.
 */

/** Động từ ra lệnh sửa/vẽ. Dùng ranh giới từ để "hiện tại", "tốt hơn"... không bị coi là lệnh. */
const VERBS = [
  "thêm", "tạo", "vẽ", "dựng", "show", "hiển thị", "đổi", "sửa", "chỉnh", "xoá", "xóa", "bỏ", "tắt", "bật", "lọc",
  "chỉ xem", "chuyển", "đặt", "cập nhật", "ẩn", "di chuyển", "căn", "phóng to", "thu nhỏ", "sắp xếp",
  "add", "remove", "delete", "change", "set", "draw", "plot", "create", "filter", "hide",
];

/** Tên loại chart: nhắc tới nghĩa là muốn xem/dựng chart dù không có động từ ("pie chart tỷ lệ view đi"). */
const CHART_WORDS = [
  "pie", "bar chart", "line chart", "area chart", "treemap", "funnel", "radar", "heatmap", "gauge", "scatter",
  "biểu đồ tròn", "biểu đồ cột", "biểu đồ đường", "biểu đồ vùng", "biểu đồ phễu", "biểu đồ nhiệt", "biểu đồ radar",
];

/** Câu xác nhận ngắn cho một đề xuất trước đó ("ok làm đi", "đồng ý"). */
const CONFIRM = /^(ok|oke|okay|được|đồng ý|ừ|ừm|vâng|có|yes|làm đi|thực hiện|tiến hành|go|làm luôn)(\b|\s|[.!]|$)/i;

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Ranh giới từ kiểu Unicode: lookbehind/lookahead thay cho \b (\b không hiểu chữ có dấu tiếng Việt).
const wordRe = (words: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "iu");
const VERB_RE = wordRe(VERBS);
const CHART_RE = wordRe(CHART_WORDS);

/** Cụm từ chứa âm tiết trùng với động từ lệnh nhưng nghĩa khác ("tóm tắt" ≠ "tắt", "nổi bật" ≠ "bật"). */
const NOT_COMMANDS = /(?<![\p{L}\p{N}])(?:tóm tắt|nổi bật|bật mí)(?![\p{L}\p{N}])/giu;

export function hasToolIntent(text: string): boolean {
  const t = text.replace(NOT_COMMANDS, " ").trim();
  return VERB_RE.test(t) || CHART_RE.test(t);
}

/**
 * `userMessages`: các câu của người dùng theo thứ tự, câu cuối là câu đang hỏi.
 * Câu xác nhận ngắn thì xét cả vài câu trước đó (người dùng đồng ý với việc AI vừa đề xuất).
 */
export function wantsTools(userMessages: string[]): boolean {
  const last = userMessages[userMessages.length - 1]?.trim() ?? "";
  if (!last) return false;
  if (hasToolIntent(last)) return true;
  if (last.length <= 40 && CONFIRM.test(last)) return userMessages.slice(-4, -1).some(hasToolIntent);
  return false;
}
