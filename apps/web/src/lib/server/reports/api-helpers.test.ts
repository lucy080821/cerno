import { describe, expect, it } from "vitest";
import { ReportSubscriptionInput } from "@dashboard/schema";
import { inlineCidImages, scheduleFor, subscriptionColumns, testSubject } from "./api-helpers";

const parse = (o: Record<string, unknown>) =>
  ReportSubscriptionInput.parse({ recipient_email: "A@x.com", frequency: "daily", hour_vn: 8, ...o });

describe("inlineCidImages", () => {
  it("thay mọi cid: bằng data URI đúng ảnh", () => {
    const html = '<img src="cid:a@x"><img src="cid:b@x"><img src="cid:a@x">';
    const out = inlineCidImages(html, [
      { filename: "a.png", content: Buffer.from("AAA"), cid: "a@x", contentType: "image/png" },
      { filename: "b.png", content: Buffer.from("BBB"), cid: "b@x", contentType: "image/png" },
    ]);
    expect(out).toBe(`<img src="data:image/png;base64,${Buffer.from("AAA").toString("base64")}"><img src="data:image/png;base64,${Buffer.from("BBB").toString("base64")}"><img src="data:image/png;base64,${Buffer.from("AAA").toString("base64")}">`);
    expect(out).not.toContain("cid:");
  });
  it("không có ảnh thì giữ nguyên", () => {
    expect(inlineCidImages("<p>x</p>", [])).toBe("<p>x</p>");
  });
});

describe("subscriptionColumns", () => {
  it("chỉ giữ thứ/ngày của đúng tần suất, bỏ các trường không thuộc cột cấu hình", () => {
    const d = subscriptionColumns(parse({ frequency: "daily", weekday: 3, month_day: 15 }));
    expect(d).toMatchObject({ weekday: null, month_day: null, recipient_email: "a@x.com" });
    expect(subscriptionColumns(parse({ frequency: "weekly", weekday: 3, month_day: 15 }))).toMatchObject({ weekday: 3, month_day: null });
    expect(subscriptionColumns(parse({ frequency: "monthly", weekday: 3, month_day: 15 }))).toMatchObject({ weekday: null, month_day: 15 });
    expect(Object.keys(d).sort()).toEqual([
      "enabled", "frequency", "hour_vn", "include_images", "link_mode", "month_day", "prompt", "recipient_email", "recipient_name", "report_type", "weekday", "widget_ids",
    ]);
  });
});

describe("scheduleFor", () => {
  const NOW = new Date("2025-11-03T00:00:00Z"); // 07:00 VN
  it("đang bật: lần gửi kế tiếp theo giờ VN, xoá lỗi cũ", () => {
    expect(scheduleFor(parse({ hour_vn: 8 }), NOW)).toEqual({ next_run_at: "2025-11-03T01:00:00.000Z", last_error: null });
  });
  it("đang tắt: không có lịch", () => {
    expect(scheduleFor(parse({ enabled: false }), NOW).next_run_at).toBeNull();
  });
});

describe("testSubject", () => {
  it("đánh dấu thư thử và giới hạn độ dài", () => {
    expect(testSubject("[Cerno] A")).toBe("[Thư thử] [Cerno] A");
    expect(testSubject("x".repeat(500)).length).toBe(160);
  });
});
