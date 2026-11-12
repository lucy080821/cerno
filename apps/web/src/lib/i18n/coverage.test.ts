import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { translateToEnglish } from "./index";

/**
 * Giữ từ điển Việt → Anh luôn đủ: quét mã nguồn (bằng cây cú pháp TypeScript) lấy mọi chữ tiếng Việt hiển thị được
 * (text JSX, chuỗi, template) và đòi mỗi chuỗi phải dịch được. Thêm chữ mới ở giao diện mà quên dịch thì test này
 * fail và in ra đúng chuỗi còn thiếu: thêm vào một file trong `en/`.
 *
 * Những thứ KHÔNG hiển thị cho người dùng (lời nhắc gửi cho AI, nhật ký server, từ khoá nhận ý định, SEO) nằm ở
 * `IGNORE_FILES` / `IGNORE_TEXT`, để khỏi phải dịch.
 */
// Chữ có dấu, cộng vài cụm tiếng Việt KHÔNG dấu hay gặp (vd "doanh thu") mà nếu chỉ dựa vào dấu sẽ bị sót.
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]|\b(doanh thu|don hang|khu vuc)\b/i;

const IGNORE_FILES = [
  /\.test\.tsx?$/,
  /\.d\.ts$/,
  /api\/chat\/route\.ts$/, // lời nhắc hệ thống gửi cho AI
  /ai-tools\.ts$/, // mô tả công cụ gửi cho AI
  /ai-context\.ts$/, // ngữ cảnh gửi cho AI
  /ai-intent\.ts$/, // từ khoá nhận ý định
  /templates\/ai-match\.ts$/, // lời nhắc + mô tả công cụ gửi cho AI
  /api\/templates\/match\/route\.ts$/, // lỗi server, giao diện không hiển thị
  /content\/templates\/[^/]*\.ts$/, // dữ liệu mẫu + từ đồng nghĩa để khớp cột; chữ hiển thị của mẫu dịch ở en/templates.ts
  /app\/layout\.tsx$/, // metadata SEO tiếng Việt
  /lib\/seo\.ts$/,
  /lib\/site\.ts$/, // slogan/mô tả SEO
  /opengraph-image\.tsx$/,
  /\/i18n\//, // chính từ điển
  /lib\/plan\.ts$/, // thông báo giới hạn ghép động: lib/plan-i18n.test.ts kiểm từng thông báo có bản dịch
  /lib\/alerts\/describe\.ts$/, // câu mô tả điều kiện ghép động (hiện trong email và danh sách luật), không dịch bằng từ điển
  /server\/alerts\//, // nhãn khoảng thời gian trong email cảnh báo (luôn tiếng Việt)
  /server\/reports\//, // báo cáo email luôn bằng tiếng Việt (người nhận không đổi ngôn ngữ giao diện)
  /server\/mail\//, // nội dung email mời tự có hai ngôn ngữ trong bộ soạn thư (chọn theo ngôn ngữ người mời)
];

const IGNORE_TEXT: RegExp[] = [
  /^\[(api|ai-quota)/, // nhật ký server
  /^(tạo dashboard|phần mềm làm dashboard|báo cáo trực quan|biểu đồ từ Google Sheets|nhúng dashboard vào website|công cụ BI)$/, // từ khoá SEO
  /\{0\} \| Tạo dashboard từ Google Sheets/, // tiêu đề SEO
  /^(thêm|tạo|vẽ|dựng|hiển thị|đổi|sửa|chỉnh|xoá|xóa|bỏ|tắt|bật|lọc|chỉ xem|chuyển|đặt|cập nhật|ẩn|di chuyển|phóng to|thu nhỏ|sắp xếp)$/, // từ khoá ý định
  /^(LỖI|không rõ|gốc|\(đã dừng\))$/, // nội bộ AI
  /^\[Đã (sửa|vẽ)/, // dấu vết nội bộ gửi lại cho AI
  /^(Người dùng chưa bật|Tham số không phải JSON|Đã hiển thị biểu đồ cho người dùng|Số liệu của biểu đồ:|Widget đang bị người dùng khoá vị trí)/, // kết quả công cụ trả cho AI
  /TOKEN_ENCRYPTION_KEY|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_|CRON_SECRET/, // thông báo cấu hình cho người vận hành
  /^createOther /,
  /^Cách \{0\} thu thập/, // mô tả SEO của trang
  /^(Việc|sử dụng và chuyển giao thông tin nhận được từ các API của Google)/, // bản dịch tiếng Việt của tuyên bố Google (ẩn khi xem bản tiếng Anh)
  /^Thiếu SUPABASE/,
  /^Không lưu được refresh token/,
  /^Lỗi truy vấn/,
  /^Không tìm thấy nguồn dữ liệu$/,
];

function walk(dir: string, out: string[]) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (n === "node_modules" || n === ".next") continue;
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function collect(): Map<string, string> {
  const root = path.resolve(__dirname, "../../../../.."); // repo root
  const files: string[] = [];
  walk(path.join(root, "apps/web/src"), files);
  walk(path.join(root, "packages/chart-engine/src"), files);
  walk(path.join(root, "packages/schema/src"), files);
  const found = new Map<string, string>();
  const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const add = (raw: string, file: string) => {
    // Chuỗi có thẻ <b> (đưa vào dangerouslySetInnerHTML) hiện ra thành nhiều text node: dịch từng đoạn.
    for (const piece of decode(raw).split(/<\/?b>/)) {
      const t = norm(piece);
      if (t && VI.test(t) && !IGNORE_TEXT.some((r) => r.test(t)) && !found.has(t)) found.set(t, file);
    }
  };
  for (const file of files) {
    const rel = file.replace(/\\/g, "/");
    if (IGNORE_FILES.some((r) => r.test(rel))) continue;
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isJsxText(n)) add(n.getText(sf), rel);
      else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text, rel);
      else if (ts.isTemplateExpression(n)) {
        let s = n.head.text;
        n.templateSpans.forEach((sp, i) => (s += `{${i}}${sp.literal.text}`));
        add(s, rel);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return found;
}

describe("i18n coverage", () => {
  it("mọi chữ tiếng Việt hiển thị được đều có bản dịch tiếng Anh", () => {
    const missing = [...collect()].filter(([text]) => translateToEnglish(text) === null);
    const report = missing.map(([t, f]) => `${f.split("/src/").pop()}: ${t}`).join("\n");
    expect(missing.length, `Thiếu bản dịch cho ${missing.length} chuỗi:\n${report}`).toBe(0);
  });
});
