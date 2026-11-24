import { describe, expect, it } from "vitest";
import { sideVisible } from "./store";

describe("thanh bên ẩn/hiện", () => {
  it("chế độ tự động: máy tính hiện, điện thoại ẩn", () => {
    expect(sideVisible("auto", false)).toBe(true);
    expect(sideVisible("auto", true)).toBe(false);
  });
  it("người dùng đã chọn thì theo lựa chọn, bất kể màn hình", () => {
    expect(sideVisible("open", true)).toBe(true);
    expect(sideVisible("closed", false)).toBe(false);
  });
});
