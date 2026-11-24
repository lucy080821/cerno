import { describe, expect, it } from "vitest";
import { vnDateTime } from "./vn-time";

describe("vnDateTime", () => {
  it("đổi sang giờ Việt Nam (UTC+7)", () => {
    expect(vnDateTime("2026-11-24T08:30:00Z")).toBe("24/11/2026 15:30");
    expect(vnDateTime("2026-12-31T20:00:00Z")).toBe("01/01/2027 03:00");
  });
  it("trống hoặc sai thì dấu gạch", () => {
    expect(vnDateTime(null)).toBe("—");
    expect(vnDateTime("")).toBe("—");
    expect(vnDateTime("không phải ngày")).toBe("—");
  });
});
