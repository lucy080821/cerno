import { describe, expect, it } from "vitest";
import { SEARCH_ENTRIES } from "./entries";
import { searchEntries, suggestedEntries } from "./match";

const top = (q: string, n = 3) => searchEntries(q, n).map((e) => e.id);

describe("tìm trang và hành động", () => {
  it("gõ không dấu vẫn ra trang có dấu", () => {
    expect(top("loi nhuan")[0]).toBe("page:profit");
    expect(top("don hang")[0]).toBe("page:orders");
    expect(top("gia von")).toContain("page:products");
  });
  it("gõ dở chữ (đầu từ) vẫn gợi ý", () => {
    expect(top("canh")[0]).toBe("page:alerts");
    expect(top("quang c")).toContain("act:ads");
  });
  it("hiểu từ đồng nghĩa và tiếng Anh", () => {
    expect(top("ship")).toContain("act:ship");
    expect(top("refund")).toContain("act:returns");
    expect(top("upload")).toContain("act:import-orders");
    expect(top("language")).toContain("act:lang");
  });
  it("chịu được gõ sai một ký tự", () => {
    expect(top("dashbord")).toContain("page:dashboards");
    expect(top("bao caoo")).toContain("page:reports");
  });
  it("nhiều từ phải khớp đủ", () => {
    expect(top("nhap gia von")[0]).toBe("act:costs");
    expect(searchEntries("nhap gia von xyzxyz")).toEqual([]);
  });
  it("chuỗi trống hoặc không khớp thì không có kết quả", () => {
    expect(searchEntries("")).toEqual([]);
    expect(searchEntries("   ")).toEqual([]);
    expect(searchEntries("qqqqqq")).toEqual([]);
  });
  it("không bị lỗi với ký tự đặc biệt và chuỗi rất dài", () => {
    expect(() => searchEntries("<script>alert(1)</script>")).not.toThrow();
    expect(() => searchEntries("a".repeat(10_000))).not.toThrow();
  });
  it("mọi mục có đích đến hoặc hành động, id không trùng", () => {
    const ids = new Set<string>();
    for (const e of SEARCH_ENTRIES) {
      expect(e.href || e.run, e.id).toBeTruthy();
      expect(ids.has(e.id), e.id).toBe(false);
      ids.add(e.id);
      if (e.href) expect(e.href.startsWith("/"), e.id).toBe(true);
    }
  });
  it("gợi ý mặc định đều tồn tại", () => {
    expect(suggestedEntries().length).toBeGreaterThanOrEqual(5);
  });
});
