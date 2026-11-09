import { describe, expect, it } from "vitest";
import { buildInviteEmail, clean, escapeHtml } from "./invite-email";

const base = {
  inviterName: "Lan Nguyễn",
  inviterEmail: "lan@example.com",
  dashboardName: "Báo cáo Q3",
  role: "viewer" as const,
  url: "https://cerno.app/d/123e4567-e89b-12d3-a456-426614174000",
  appName: "Cerno",
  contactEmail: "hi@cerno.app",
};

describe("buildInviteEmail (thư song ngữ)", () => {
  it("tiêu đề: tiếng Việt trước, kèm chữ tiếng Anh nhận diện", () => {
    expect(buildInviteEmail(base).subject).toBe("Lan Nguyễn mời bạn xem dashboard “Báo cáo Q3” trên Cerno · Cerno invitation");
    expect(buildInviteEmail({ ...base, role: "editor" }).subject).toContain("chỉnh sửa");
  });

  it("tiếng Việt ở trên, có dòng English below, tiếng Anh ở dưới", () => {
    const m = buildInviteEmail(base);
    expect(m.html).toContain("English below ↓");
    const vi = m.html.indexOf("mời bạn cùng làm việc");
    const en = m.html.indexOf("invited you to a dashboard");
    expect(vi).toBeGreaterThan(-1);
    expect(en).toBeGreaterThan(vi);
    expect(m.html.indexOf("English below ↓")).toBeLessThan(vi);
    // bản chữ thuần cũng theo thứ tự đó
    expect(m.text.startsWith("English below ↓")).toBe(true);
    expect(m.text.indexOf("mời bạn cùng làm việc")).toBeLessThan(m.text.indexOf("invited you to a dashboard"));
  });

  it("phần tiếng Anh nêu đúng quyền xem/sửa", () => {
    expect(buildInviteEmail(base).html).toContain("Your access: View only");
    expect(buildInviteEmail({ ...base, role: "editor" }).html).toContain("Your access: Can edit");
    expect(buildInviteEmail({ ...base, role: "editor" }).html).toContain("Quyền của bạn: Được sửa");
  });

  it("cả hai nút đều mở cùng một link, và link có trong bản chữ thuần", () => {
    const m = buildInviteEmail(base);
    expect(m.html.split(`href="${base.url}"`).length - 1).toBeGreaterThanOrEqual(3); // 2 nút + link dự phòng
    expect(m.html).toContain("Mở dashboard");
    expect(m.html).toContain("Open dashboard");
    expect(m.text).toContain(base.url);
    expect(m.text).toContain("hi@cerno.app");
  });

  it("thoát HTML ở tên do người dùng đặt (không chèn được thẻ)", () => {
    const m = buildInviteEmail({ ...base, dashboardName: '<script>alert(1)</script>"x"', inviterName: "<b>Hack</b>" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>Hack</b>");
    expect(m.html).toContain("&lt;script&gt;");
  });

  it("tiêu đề không chứa ký tự xuống dòng (chống chèn header)", () => {
    const m = buildInviteEmail({ ...base, dashboardName: "A\r\nBcc: x@evil.com" });
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("tên quá dài bị cắt", () => {
    const m = buildInviteEmail({ ...base, dashboardName: "x".repeat(500) });
    expect(m.subject.length).toBeLessThan(200);
  });

  it("thiếu tên người mời thì dùng email", () => {
    expect(buildInviteEmail({ ...base, inviterName: "" }).subject).toContain("lan@example.com");
  });
});

describe("clean/escapeHtml", () => {
  it("clean gộp khoảng trắng và bỏ ký tự điều khiển", () => {
    expect(clean("  a \t\n b\u0000c ", 20)).toBe("a b c");
    expect(clean("abcdef", 4)).toBe("abc…");
  });
  it("escapeHtml thoát 5 ký tự", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
