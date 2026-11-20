import { describe, expect, it } from "vitest";
import { categoryRate, searchCategories, tableInfo } from "./shopee";

describe("biểu Phí Cố Định theo ngành", () => {
  it("đủ số ngành của hai biểu (đã bỏ dòng lặp trong PDF)", () => {
    expect(tableInfo("non_mall").count).toBe(1435);
    expect(tableInfo("mall").count).toBe(1439);
    expect(tableInfo("non_mall").effectiveFrom).toBe("2026-05-23");
    expect(tableInfo("mall").effectiveFrom).toBe("2026-10-04");
  });

  it("khớp các mức đã đối chiếu với trang Shopee Uni", () => {
    expect(categoryRate("non_mall", "Điện Thoại & Phụ Kiện › Điện thoại")).toBe(2);
    expect(categoryRate("non_mall", "Máy tính & Laptop › Laptop")).toBe(2);
    expect(categoryRate("mall", "Điện Thoại & Phụ Kiện › Điện thoại")).toBe(2.5);
    expect(categoryRate("mall", "Máy tính & Laptop › Laptop")).toBe(3.8);
  });

  it("tra không phân biệt dấu/hoa thường; ngành lạ hoặc rỗng là null", () => {
    expect(categoryRate("non_mall", "dien thoai & phu kien › dien thoai")).toBe(2);
    expect(categoryRate("non_mall", "Ngành không có")).toBeNull();
    expect(categoryRate("non_mall", null)).toBeNull();
  });

  it("tìm ngành: mọi từ phải có, không cần dấu, ưu tiên ngành cấp cuối khớp từ đầu", () => {
    const r = searchCategories("non_mall", "tai nghe");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((c) => /tai nghe/i.test(c.path.normalize("NFD").replace(/\p{M}/gu, "")))).toBe(true);
    expect(r[0].path.toLowerCase()).toContain("tai nghe");
    expect(searchCategories("non_mall", "")).toEqual([]);
    expect(searchCategories("non_mall", "zzzzxx")).toEqual([]);
    expect(searchCategories("non_mall", "a", 5).length).toBeLessThanOrEqual(5);
  });

  it("mọi mức phí nằm trong khoảng hợp lý", () => {
    for (const t of ["non_mall", "mall"] as const) {
      const all = searchCategories(t, "a", 5000).concat(searchCategories(t, "e", 5000));
      expect(all.length).toBeGreaterThan(500);
      for (const c of all) {
        expect(c.ratePct).toBeGreaterThan(0);
        expect(c.ratePct).toBeLessThan(25);
      }
    }
  });
});
