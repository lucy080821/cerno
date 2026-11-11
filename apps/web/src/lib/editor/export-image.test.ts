import { describe, expect, it } from "vitest";
import { clampScale, exportFileName, planSheet } from "./export-image";

describe("planSheet", () => {
  it("cùng hướng: ảnh đúng bằng kích thước trang", () => {
    const p = planSheet(1440, 900, "landscape");
    expect(p).toMatchObject({ width: 1440, height: 900, x: 0, y: 0, exact: true });
  });

  it("khác hướng: đổi chỗ rộng/cao, thu trang vừa khung và đặt giữa", () => {
    const p = planSheet(1440, 900, "portrait");
    expect(p.width).toBe(900);
    expect(p.height).toBe(1440);
    expect(p.pageW).toBeCloseTo(900);
    expect(p.pageH).toBeCloseTo(562.5);
    expect(p.x).toBe(0);
    expect(p.y).toBeCloseTo((1440 - 562.5) / 2);
    expect(p.exact).toBe(false);
  });

  it("trang dọc xuất ngang cũng vừa khung", () => {
    const p = planSheet(800, 1200, "landscape");
    expect(p.width).toBe(1200);
    expect(p.height).toBe(800);
    expect(p.pageH).toBeCloseTo(800);
  });

  it("trang vuông không đổi", () => {
    expect(planSheet(1000, 1000, "portrait").exact).toBe(true);
  });
});

describe("clampScale", () => {
  it("giữ nguyên khi ảnh nhỏ, giảm khi quá lớn", () => {
    expect(clampScale(2, 1440, 900)).toBe(2);
    expect(clampScale(4, 4000, 2000)).toBeCloseTo(8192 / 4000);
  });
});

describe("exportFileName", () => {
  it("một trang: chỉ tên dashboard", () => {
    expect(exportFileName("Doanh thu", "Tổng quan", 0, 1, "png")).toBe("Doanh thu.png");
  });
  it("nhiều trang: đánh số và thêm tên trang, bỏ ký tự cấm", () => {
    expect(exportFileName('A/B: "x"', "Trang?1", 1, 3, "jpg")).toBe("A B x - 02 Trang 1.jpg");
  });
  it("tên trống dùng giá trị mặc định", () => {
    expect(exportFileName("", "", 0, 2, "png")).toBe("dashboard - 01 Trang 1.png");
  });
});
