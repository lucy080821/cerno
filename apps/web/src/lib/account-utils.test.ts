import { describe, expect, it } from "vitest";
import { confirmMatches, sameOrigin } from "./account-utils";

describe("confirmMatches (xác nhận xóa tài khoản bằng email)", () => {
  it("khớp không phân biệt hoa thường và khoảng trắng thừa", () => {
    expect(confirmMatches("Tuan@Gmail.com", "  tuan@gmail.COM ")).toBe(true);
  });
  it("sai email, rỗng, không phải chuỗi, hoặc tài khoản không có email thì từ chối", () => {
    expect(confirmMatches("a@b.com", "x@b.com")).toBe(false);
    expect(confirmMatches("a@b.com", "")).toBe(false);
    expect(confirmMatches("a@b.com", undefined)).toBe(false);
    expect(confirmMatches("a@b.com", 123)).toBe(false);
    expect(confirmMatches(undefined, "a@b.com")).toBe(false);
    expect(confirmMatches("", "")).toBe(false);
  });
});

describe("sameOrigin (chặn yêu cầu từ trang khác)", () => {
  it("cùng host thì cho qua, kể cả có cổng", () => {
    expect(sameOrigin("https://app.example.com", "app.example.com")).toBe(true);
    expect(sameOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
  });
  it("khác host hoặc khác cổng thì chặn", () => {
    expect(sameOrigin("https://evil.example", "app.example.com")).toBe(false);
    expect(sameOrigin("http://localhost:4000", "localhost:3000")).toBe(false);
    expect(sameOrigin("https://app.example.com.evil.io", "app.example.com")).toBe(false);
  });
  it("Origin hỏng thì chặn; không có Origin thì không chặn ở bước này", () => {
    expect(sameOrigin("không phải url", "app.example.com")).toBe(false);
    expect(sameOrigin(null, "app.example.com")).toBe(true);
    expect(sameOrigin("https://app.example.com", null)).toBe(false);
  });
});
