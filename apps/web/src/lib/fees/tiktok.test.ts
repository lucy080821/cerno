import { describe, expect, it } from "vitest";
import { TIKTOK_DEFAULT_RATE_PCT } from "./constants";
import { categoryRate, defaultRate, searchCategories, tableInfo } from "./tiktok";

describe("biểu Phí Hoa Hồng Nền Tảng của TikTok Shop", () => {
  it("đủ số ngành, ngày hiệu lực", () => {
    expect(tableInfo("non_mall").count).toBe(2039);
    expect(tableInfo("mall").count).toBe(2039);
    expect(tableInfo("mall").effectiveFrom).toBe("2026-10-20");
    expect(tableInfo("non_mall").effectiveFrom).toBe("2026-07-03");
  });

  it("mức đã đối chiếu với file PDF", () => {
    expect(categoryRate("non_mall", "Thiết bị gia dụng › Đồ gia dụng lớn › Bình nước nóng")).toBe(9);
    expect(categoryRate("mall", "Thiết bị gia dụng › Đồ gia dụng lớn › Bình nước nóng")).toBe(9.3);
    expect(categoryRate("non_mall", "Trang phục nam & Đồ lót › Áo nam › Áo thun")).toBe(15);
    expect(categoryRate("mall", "Trang phục nam & Đồ lót › Áo nam › Áo thun")).toBe(17.1);
    expect(categoryRate("non_mall", "Ngành không có")).toBeNull();
  });

  it("mức mặc định khớp hằng số dùng để ước tính", () => {
    expect(defaultRate("non_mall")).toBe(TIKTOK_DEFAULT_RATE_PCT.non_mall);
    expect(defaultRate("mall")).toBe(TIKTOK_DEFAULT_RATE_PCT.mall);
  });

  it("tìm ngành không cần dấu", () => {
    const r = searchCategories("non_mall", "kem chong nang");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].path.toLowerCase()).toContain("kem chống nắng");
  });

  it("mọi mức phí nằm trong khoảng hợp lý", () => {
    for (const t of ["non_mall", "mall"] as const) {
      const all = searchCategories(t, "a", 5000).concat(searchCategories(t, "e", 5000));
      expect(all.length).toBeGreaterThan(1000);
      for (const c of all) {
        expect(c.ratePct).toBeGreaterThan(0);
        expect(c.ratePct).toBeLessThan(25);
      }
    }
  });
});
