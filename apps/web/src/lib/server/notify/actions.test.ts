import { describe, expect, it } from "vitest";
import { SNOOZE_HOURS, decideMute, snoozeUntil } from "./actions";

describe("snoozeUntil", () => {
  it("24 giờ sau", () => {
    expect(SNOOZE_HOURS).toBe(24);
    expect(snoozeUntil(new Date("2025-11-13T10:00:00Z"))).toBe("2025-11-14T10:00:00.000Z");
  });
});

describe("decideMute", () => {
  it("người tạo luật tắt cả luật", () => {
    expect(decideMute(["a@x.com", "b@x.com"], "A@x.com", "a@x.com")).toBe("disable");
  });
  it("người nhận duy nhất tắt cả luật", () => {
    expect(decideMute(["b@x.com"], "b@x.com", "a@x.com")).toBe("disable");
  });
  it("người nhận khác (có nhiều người nhận) chỉ ngừng nhận phần của mình", () => {
    expect(decideMute(["a@x.com", "b@x.com"], "b@x.com", "a@x.com")).toBe("optout");
  });
  it("không biết người tạo thì người nhận (không phải duy nhất) chỉ ngừng nhận", () => {
    expect(decideMute(["a@x.com", "b@x.com"], "b@x.com", null)).toBe("optout");
  });
  it("email trùng khác hoa/thường vẫn tính là một người", () => {
    expect(decideMute(["B@x.com", "b@x.com"], "b@x.com", null)).toBe("disable");
  });
  it("người bấm không có trong danh sách nhận và không phải người tạo: chỉ ngừng nhận", () => {
    expect(decideMute(["a@x.com"], "ke-la@x.com", "a@x.com")).toBe("optout");
  });
});
