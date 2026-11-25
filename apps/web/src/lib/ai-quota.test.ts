import { describe, expect, it } from "vitest";
import { translateToEnglish } from "@/lib/i18n";
import { GROQ_STATES, QUOTA_KINDS, groqStateOf, modelLabel, quotaText } from "./ai-quota";

describe("thông báo hết lượt AI", () => {
  it("tên model hiển thị gọn", () => {
    expect(modelLabel("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelLabel("mô-hình-lạ")).toBe("mô-hình-lạ");
  });
  it("tình trạng Groq theo mã lỗi", () => {
    expect([429, 413, 502].map(groqStateOf)).toEqual(["busy", "toolarge", "error"]);
  });
  it("mọi tổ hợp đều nêu Claude + tên model và lời mời liên hệ; có Groq thì nêu cả Groq", () => {
    for (const k of QUOTA_KINDS) for (const g of GROQ_STATES) {
      const t = quotaText(k, "Haiku 5.5", g);
      expect(t).toContain("Claude");
      expect(t).toContain("Haiku 5.5");
      expect(t).toContain("Liên hệ để nâng hạn mức hoặc nâng cấp gói.");
      expect(t.includes("Groq")).toBe(g !== null);
    }
  });
  it("mọi tổ hợp đều có bản dịch tiếng Anh trong từ điển (khớp mẫu với tên model bất kỳ)", () => {
    for (const k of QUOTA_KINDS) for (const g of GROQ_STATES) {
      expect(translateToEnglish(quotaText(k, "Haiku 5.5", g))).toBe(quotaText(k, "Haiku 5.5", g, "en"));
    }
  });
});
