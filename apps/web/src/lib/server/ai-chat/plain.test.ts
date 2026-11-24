import { describe, expect, it } from "vitest";
import { stripMarkdown } from "./plain";

describe("bỏ markdown khỏi câu trả lời của AI", () => {
  it("in đậm, in nghiêng, tiêu đề, mã trong dòng", () => {
    expect(stripMarkdown("## 1. TÓM TẮT\nDoanh thu **tăng 12%** so với *tuần trước*, mã `SP-01`.")).toBe("1. TÓM TẮT\nDoanh thu tăng 12% so với tuần trước, mã SP-01.");
  });

  it("gạch đầu dòng * và • thành gạch ngang, giữ nguyên gạch ngang sẵn có", () => {
    expect(stripMarkdown("* Shopee: 10\n• TikTok: 5\n- Lazada: 1")).toBe("- Shopee: 10\n- TikTok: 5\n- Lazada: 1");
  });

  it("bảng markdown thành từng dòng, bỏ dòng ngăn cách", () => {
    const t = "| Kênh | Doanh thu |\n|---|---:|\n| Shopee | 10.000 |\n| TikTok | 5.000 |";
    expect(stripMarkdown(t)).toBe("Kênh; Doanh thu\nShopee; 10.000\nTikTok; 5.000");
  });

  it("liên kết, đường kẻ ngang, trích dẫn, khối mã", () => {
    expect(stripMarkdown("Xem [báo cáo](https://x.com/a) nhé.\n---\n> ghi chú\n```\nGiá = 5 * 2\n```")).toBe("Xem báo cáo nhé.\nghi chú\nGiá = 5 * 2");
  });

  it("không làm hỏng phép nhân và dấu sao đứng một mình trong câu", () => {
    expect(stripMarkdown("Thành tiền = 3 * 40.000 = 120.000; ghi chú * không dùng")).toBe("Thành tiền = 3 * 40.000 = 120.000; ghi chú * không dùng");
  });

  it("chữ thường giữ nguyên, bớt dòng trống thừa", () => {
    expect(stripMarkdown("Dòng 1\n\n\n\nDòng 2\r\n")).toBe("Dòng 1\n\nDòng 2");
    expect(stripMarkdown("")).toBe("");
  });
});
