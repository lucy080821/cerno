import { describe, expect, it } from "vitest";
import { pageContext } from "./page-context";

describe("mô tả trang cho khung chat AI", () => {
  it("trang lãi lỗ kèm khoảng thời gian đang chọn", () => {
    expect(pageContext("/profit", { from: "2026-11-01", to: "2026-11-24" })).toBe('Người dùng đang xem trang "Lãi lỗ" của Cerno. Khoảng thời gian đang chọn trên trang: 01/11/2026 đến 24/11/2026.');
  });
  it("chưa lọc thì ghi là tất cả", () => {
    expect(pageContext("/orders", null)).toContain("tất cả");
  });
  it("trang không có chọn kỳ thì không nhắc khoảng thời gian", () => {
    const c = pageContext("/sources", { from: "2026-11-01", to: "2026-11-24" });
    expect(c).toBe('Người dùng đang xem trang "Nguồn dữ liệu" của Cerno.');
  });
  it("trang ngoài thanh bên hoặc rỗng thì không có mô tả", () => {
    expect(pageContext("/editor/abc", null)).toBeUndefined();
    expect(pageContext(null, null)).toBeUndefined();
  });
});
