import { describe, expect, it } from "vitest";
import { timeAgo } from "./time";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();

describe("timeAgo", () => {
  it("dưới 45 giây là vừa xong", () => {
    expect(timeAgo(ago(0), NOW)).toBe("vừa xong");
    expect(timeAgo(ago(44), NOW)).toBe("vừa xong");
  });
  it("tính theo phút rồi theo giờ", () => {
    expect(timeAgo(ago(60), NOW)).toBe("1 phút trước");
    expect(timeAgo(ago(5 * 60), NOW)).toBe("5 phút trước");
    expect(timeAgo(ago(59 * 60), NOW)).toBe("59 phút trước");
    expect(timeAgo(ago(2 * 3600 + 120), NOW)).toBe("2 giờ trước");
  });
  it("quá 24 giờ thì hiện ngày giờ", () => {
    expect(timeAgo(ago(30 * 3600), NOW)).toMatch(/\d{2}\/\d{2}/);
  });
  it("giờ tương lai (lệch đồng hồ) coi như vừa xong; rỗng/sai thì 'chưa có'", () => {
    expect(timeAgo(ago(-120), NOW)).toBe("vừa xong");
    expect(timeAgo(null, NOW)).toBe("chưa có");
    expect(timeAgo("không phải ngày", NOW)).toBe("chưa có");
  });
});
