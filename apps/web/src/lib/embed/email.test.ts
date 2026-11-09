import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("chuẩn hoá chữ hoa và khoảng trắng", () => {
    expect(normalizeEmail("  Ten.Ho@Gmail.com ")).toBe("ten.ho@gmail.com");
    expect(normalizeEmail("a+tag@cong-ty.com.vn")).toBe("a+tag@cong-ty.com.vn");
  });
  it("từ chối giá trị sai dạng hoặc nguy hiểm", () => {
    for (const bad of [
      "", "abc", "a@b", "a@@b.com", "a b@c.com", "a@b.com, c@d.com", "<a@b.com>", "a@b.com;x", "a@b..com",
      "a@-b.com".replace("-", "_"), `${"a".repeat(250)}@b.com`, "a@b.com\nbcc:x@y.com", "'a'@b.com",
    ]) {
      expect(normalizeEmail(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
