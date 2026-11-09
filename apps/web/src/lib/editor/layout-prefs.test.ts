import { describe, expect, it } from "vitest";
import { clampRightWidth, RIGHT_DEFAULT, RIGHT_MAX, RIGHT_MIN } from "./layout-prefs";

describe("clampRightWidth", () => {
  it("giữ trong khoảng cho phép", () => {
    expect(clampRightWidth(100)).toBe(RIGHT_MIN);
    expect(clampRightWidth(5000)).toBe(RIGHT_MAX);
    expect(clampRightWidth(400)).toBe(400);
  });

  it("không vượt 60% cửa sổ nhưng không nhỏ hơn mức tối thiểu", () => {
    expect(clampRightWidth(700, 1000)).toBe(600);
    expect(clampRightWidth(700, 300)).toBe(RIGHT_MIN);
  });

  it("giá trị hỏng về mặc định", () => {
    expect(clampRightWidth(Number.NaN)).toBe(RIGHT_DEFAULT);
    expect(clampRightWidth(Number.POSITIVE_INFINITY)).toBe(RIGHT_DEFAULT);
  });
});
