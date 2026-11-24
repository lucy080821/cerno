import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiChat } from "./AiChat";

describe("trang Hỏi AI", () => {
  it("vẽ được khung chat ban đầu (lịch sử, nút cuộc trò chuyện mới, chọn nguồn, ô nhập)", () => {
    const html = renderToStaticMarkup(<AiChat />);
    expect(html).toContain("Cuộc trò chuyện mới");
    expect(html).toContain("Nguồn dữ liệu");
    expect(html).toContain("<textarea");
    // Chưa chọn nguồn nào thì vẫn có câu gợi ý để bấm thử.
    expect(html).toContain("Tháng này lãi lỗ ra sao?");
  });
});
