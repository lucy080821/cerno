/**
 * Câu trả lời của trang Hỏi AI là CHỮ THƯỜNG, không markdown: lời nhắc đã cấm, và đây là lớp bảo hiểm khi model vẫn lỡ dùng
 * (**in đậm**, # tiêu đề, bảng |...|, `mã`, liên kết...). Đổi sang chữ thường giữ nguyên nội dung và xuống dòng. Hàm thuần.
 */
export function stripMarkdown(input: string): string {
  const out: string[] = [];
  let inFence = false;
  for (let line of input.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    // Đường kẻ ngang (---, ***, ___) và dòng ngăn cách bảng (|---|---|).
    if (/^\s*([-*_]\s*){3,}$/.test(line)) continue;
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes("|")) continue;
    // Hàng của bảng: bỏ gạch đứng, các ô cách nhau bằng dấu chấm phẩy.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()).filter(Boolean).join("; ");
    }
    line = line.replace(/^\s{0,3}#{1,6}\s+/, ""); // # tiêu đề
    line = line.replace(/^\s*>\s?/, ""); // trích dẫn
    line = line.replace(/^(\s*)[*•]\s+/, "$1- "); // gạch đầu dòng * hoặc •
    line = line.replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)\s]+\)/g, "$1"); // [chữ](liên kết)
    line = line.replace(/\*\*([^*\n]+?)\*\*/g, "$1").replace(/__([^_\n]+?)__/g, "$1"); // in đậm
    line = line.replace(/(^|[\s(])\*([^\s*][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, "$1$2"); // in nghiêng *chữ*
    line = line.replace(/`([^`\n]+)`/g, "$1"); // mã trong dòng
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
