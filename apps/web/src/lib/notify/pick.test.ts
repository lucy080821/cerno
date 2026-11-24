import { describe, expect, it } from "vitest";
import { pickDashboard } from "./pick";

const list = [{ id: "a", name: "A" }, { id: "b", name: "B" }];

describe("chọn dashboard ở trang cảnh báo / báo cáo", () => {
  it("ưu tiên địa chỉ, rồi lựa chọn lần trước", () => {
    expect(pickDashboard(list, "b", "a")).toBe("b");
    expect(pickDashboard(list, null, "a")).toBe("a");
  });
  it("id không còn tồn tại thì bỏ qua", () => {
    expect(pickDashboard(list, "zzz", "yyy")).toBeNull();
    expect(pickDashboard(list, "zzz", "b")).toBe("b");
  });
  it("chỉ có một dashboard thì chọn luôn; nhiều hơn thì để người dùng chọn", () => {
    expect(pickDashboard([list[0]], null, null)).toBe("a");
    expect(pickDashboard(list, null, null)).toBeNull();
    expect(pickDashboard([], null, null)).toBeNull();
  });
});
