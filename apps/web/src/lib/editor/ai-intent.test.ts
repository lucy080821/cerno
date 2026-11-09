import { describe, expect, it } from "vitest";
import { hasToolIntent, wantsTools } from "./ai-intent";

describe("hasToolIntent: câu phân tích thuần tuý không cần công cụ", () => {
  it("câu hỏi phân tích (như trong ảnh lỗi) KHÔNG cần công cụ", () => {
    for (const q of [
      "chỉ số engaged view rate của các video short hiện tại tốt chưa? các video nào đang làm tốt",
      "Tóm tắt nhanh dashboard này.",
      "Có điểm bất thường nào trong dữ liệu không?",
      "Kênh nào đóng góp nhiều nhất?",
      "Doanh thu tháng này so với tháng trước thế nào?",
      "tại sao lượt xem giảm?",
      "video nổi bật nhất tuần này là gì?",
      "tóm tắt lại giúp mình",
    ]) {
      expect(hasToolIntent(q), q).toBe(false);
    }
  });

  it("lệnh vẽ/thêm/sửa/lọc cần công cụ", () => {
    for (const q of [
      "vẽ thử 1 pie chart trên khung chat show tỷ lệ view của các video theo từng tháng",
      "Thêm biểu đồ tròn doanh thu theo khu vực.",
      "Tắt đường lưới và bật nhãn dữ liệu cho chart đang chọn.",
      "Chỉ xem dữ liệu quý 2",
      "xoá widget này đi",
      "đổi màu cột sang đỏ",
      "lọc theo kênh Shorts",
      "pie chart tỷ lệ view theo tháng đi",
      "bar chart doanh thu theo khu vực",
      "Draw a pie chart of views per month",
    ]) {
      expect(hasToolIntent(q), q).toBe(true);
    }
  });

  it("không bắt nhầm từ chứa vần giống động từ", () => {
    // "hiện" không còn là động từ lệnh; "tốt hơn", "bỏ qua"... chỉ khớp khi là từ trọn vẹn.
    expect(hasToolIntent("hiện tại thế nào")).toBe(false);
    expect(hasToolIntent("thêmbớt")).toBe(false);
    expect(hasToolIntent("điểm đặc biệt")).toBe(false);
  });
});

describe("wantsTools: câu xác nhận ngắn", () => {
  it("'ok làm đi' sau một đề xuất vẽ/sửa thì cần công cụ", () => {
    expect(wantsTools(["vẽ pie chart view theo tháng", "ok làm đi"])).toBe(true);
    expect(wantsTools(["đồng ý"])).toBe(false); // không có gì để đồng ý
    expect(wantsTools(["video nào tốt nhất?", "ok"])).toBe(false);
  });

  it("câu dài không được coi là xác nhận", () => {
    const long = "ok " + "bạn nhận xét giúp mình kỹ hơn về xu hướng lượt xem của kênh này trong ba tháng gần nhất nhé";
    expect(wantsTools(["vẽ chart", long])).toBe(false);
  });

  it("rỗng thì không cần công cụ", () => {
    expect(wantsTools([])).toBe(false);
    expect(wantsTools(["   "])).toBe(false);
  });
});
