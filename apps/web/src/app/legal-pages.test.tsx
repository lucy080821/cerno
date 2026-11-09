import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MAX_PAGES } from "@dashboard/schema";
import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";
import { AUTO_SYNC_MINUTES } from "@/lib/google/constants";
import { MAX_CELLS, MAX_COLUMNS, MAX_ROWS } from "@/lib/google/sheet-data";
import { MAX_DASHBOARDS_PER_WORKSPACE, MAX_ROWS_PER_WORKSPACE, MAX_SOURCES_PER_WORKSPACE } from "@/lib/limits";
import { site } from "@/lib/site";

const privacy = renderToStaticMarkup(<PrivacyPage />);
const terms = renderToStaticMarkup(<TermsPage />);
// Bóc thẻ: thẻ khối thành khoảng trắng, thẻ nội tuyến (liên kết, in đậm...) bỏ hẳn để câu liền mạch như người đọc thấy.
const text = (html: string) =>
  html
    .replace(/<\/(p|li|h\d|td|th|div|section|tr|header|footer|nav|main)>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("Chính sách quyền riêng tư", () => {
  const t = text(privacy);

  it("có tuyên bố Limited Use của Google (bản gốc tiếng Anh) và liên kết chính sách Google", () => {
    expect(t).toContain("will adhere to the Google API Services User Data Policy, including the Limited Use requirements");
    expect(privacy).toContain("developers.google.com/terms/api-services-user-data-policy");
  });

  it("nói rõ phạm vi quyền Google, chỉ đọc, và không huấn luyện AI/không bán dữ liệu", () => {
    expect(t).toContain("drive.file");
    expect(t).toContain("chỉ đọc");
    expect(t).toContain("không bán");
    expect(t).toContain("không dùng dữ liệu của bạn");
    expect(t).toContain("huấn luyện mô hình AI");
  });

  it("công bố đúng những gì gửi cho AI (tối đa 3 dòng mẫu, không gửi toàn bộ bảng)", () => {
    expect(t).toContain("tối đa 3 dòng dữ liệu mẫu");
    expect(t).toContain("không gửi toàn bộ bảng dữ liệu");
  });

  it("chu kỳ tự cập nhật nêu trong chính sách khớp hằng số của code", () => {
    expect(t).toContain(`mỗi ${AUTO_SYNC_MINUTES / 60} giờ`);
  });

  it("nêu cách thu hồi quyền Google, xóa dữ liệu và email liên hệ", () => {
    expect(privacy).toContain("myaccount.google.com/permissions");
    expect(t).toContain("trong vòng 30 ngày");
    expect(privacy).toContain(`mailto:${site.legal.contactEmail}`);
  });

  it("mô tả cách tự xóa tài khoản trong ứng dụng, khớp với tính năng thật", () => {
    expect(t).toContain("Tự xóa tài khoản");
    expect(t).toContain("gõ lại email để xác nhận");
    expect(t).toContain("File Google Sheets gốc của bạn không bị ảnh hưởng");
  });

  it("có đủ 14 mục đánh số", () => {
    for (let i = 1; i <= 14; i++) expect(t).toContain(`${i}. `);
  });
});

describe("Điều khoản sử dụng", () => {
  const t = text(terms);

  it("hạn mức công bố khớp hằng số của code", () => {
    expect(t).toContain(`${MAX_DASHBOARDS_PER_WORKSPACE} dashboard`);
    expect(t).toContain(`${MAX_SOURCES_PER_WORKSPACE} nguồn dữ liệu`);
    expect(t).toContain(`${MAX_ROWS.toLocaleString("vi-VN")} dòng`);
    expect(t).toContain(`${MAX_COLUMNS} cột`);
    expect(t).toContain(`${MAX_CELLS.toLocaleString("vi-VN")}`);
    expect(t).toContain(`${MAX_ROWS_PER_WORKSPACE.toLocaleString("vi-VN")} dòng`);
    expect(t).toContain(`${MAX_PAGES} trang`);
    expect(t).toContain(`mỗi ${AUTO_SYNC_MINUTES / 60} giờ`);
  });

  it("người dùng giữ quyền sở hữu dữ liệu, có mục AI, giới hạn trách nhiệm và luật áp dụng", () => {
    expect(t).toContain("Bạn giữ toàn quyền sở hữu");
    expect(t).toContain("Trợ lý AI");
    expect(t).toContain("Giới hạn trách nhiệm");
    expect(t).toContain("pháp luật Việt Nam");
  });

  it("liên kết chéo sang Chính sách quyền riêng tư", () => {
    expect(terms).toContain('href="/privacy"');
  });
});

describe("thông tin pháp lý chưa đặt thì hiện dòng nhắc, không bỏ trống âm thầm", () => {
  it("email và đơn vị vận hành luôn có nội dung", () => {
    expect(site.legal.contactEmail.length).toBeGreaterThan(3);
    expect(site.legal.operator.length).toBeGreaterThan(3);
  });
});
