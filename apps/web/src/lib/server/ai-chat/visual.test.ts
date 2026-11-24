import { describe, expect, it } from "vitest";
import { wantsVisual } from "./visual";

describe("wantsVisual", () => {
  it("nhận ra yêu cầu biểu đồ và thẻ KPI, có dấu hoặc không dấu", () => {
    for (const q of [
      "Vẽ biểu đồ doanh thu theo tháng",
      "ve bieu do doanh thu theo kenh",
      "Cho tôi xem doanh thu theo kênh dạng biểu đồ tròn",
      "Hiện thẻ KPI: tổng doanh thu, lãi, số đơn",
      "show me a chart of revenue by channel",
      "plot profit per day",
      "Vẽ giúp tôi lãi theo ngày",
      "đồ thị lãi lỗ 30 ngày gần nhất",
    ]) expect(wantsVisual(q), q).toBe(true);
  });

  it("câu phân tích thường KHÔNG bật công cụ vẽ, kể cả có chữ 'về' (bỏ dấu trùng với 'vẽ')", () => {
    for (const q of [
      "Tháng này lãi lỗ ra sao? Phân tích chi tiết theo từng kênh.",
      "Nói về doanh thu của Shopee",
      "So sánh doanh thu và lãi tháng này với tháng trước.",
      "Sản phẩm nào đang lỗ và nguyên nhân chính là gì?",
      "Báo cáo về chi phí quảng cáo",
      "Tại sao đơn hoàn tăng?",
    ]) expect(wantsVisual(q), q).toBe(false);
  });
});
