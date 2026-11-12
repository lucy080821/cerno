import { describe, expect, it } from "vitest";
import type { FactNumber, ReportFacts } from "@/lib/server/reports/facts";
import type { ReportBody } from "@/lib/server/reports/write-report";
import { buildReportEmail, formatVnTime, type ReportEmailInput } from "./report-email";

const n = (value: number, text: string, short: string): FactNumber => ({ value, text, short });
const facts: ReportFacts = {
  period: { from: "2025-10-01", to: "2025-10-31", label: "Tháng 10/2025" },
  prevPeriod: { from: "2025-09-01", to: "2025-09-30", label: "Tháng 09/2025" },
  updatedAt: "2025-11-03T02:30:00Z",
  kpis: [
    { widgetId: "a", title: "Doanh thu", value: n(125_430_000, "125.430.000", "125,4 triệu"), prev: n(100_000_000, "100.000.000", "100 triệu"),
      diff: n(25_430_000, "25.430.000", "25,4 triệu"), growthPct: 25.4, growthText: "+25,4%", dir: "up", tone: "good", kind: "number" },
    { widgetId: "b", title: "Số đơn", value: n(1234, "1.234", "1.234"), prev: n(1500, "1.500", "1.500"),
      diff: n(-266, "-266", "-266"), growthPct: -17.7, growthText: "−17,7%", dir: "down", tone: "bad", kind: "number" },
    { widgetId: "c", title: "Biên", value: null, prev: null, diff: null, growthPct: null, growthText: "", dir: null, tone: "neutral", kind: "number" },
  ],
  movers: [{
    chart: "Doanh thu theo tỉnh", dimension: "Tỉnh", metric: "Doanh thu",
    up: [{ name: "Hà Nội", value: n(60, "60", "60"), delta: n(20, "20", "20") }],
    down: [{ name: "Đà Nẵng", value: n(10, "10", "10"), delta: n(-5, "-5", "-5") }],
  }],
  notes: ["Ghi chú từ số liệu."],
};
const body: ReportBody = {
  executiveSummary: "Doanh thu đạt 125,4 triệu.\nTăng 25,4% so với kỳ trước.",
  highlights: ["Hà Nội tăng mạnh nhất."],
  concerns: ["Số đơn giảm 17,7%."],
  analysis: "Tập trung miền Bắc: Hà Nội dẫn đầu.",
  actions: ["Đẩy mạnh Hà Nội."],
};
const base: ReportEmailInput = {
  appName: "Cerno", dashboardName: "Báo cáo bán hàng", recipientName: "Nguyễn Văn An", facts, body,
  images: [{ cid: "chart-1@cerno.report", title: "Doanh thu theo tháng" }],
  dashboardUrl: "https://cerno.cloud/view/abc", unsubscribeUrl: "https://cerno.cloud/unsubscribe?t=xyz", notes: ["Đã bỏ 1 ảnh."],
};

describe("formatVnTime", () => {
  it("đổi sang giờ Việt Nam", () => {
    expect(formatVnTime("2025-11-03T02:30:00Z")).toBe("03/11/2025 09:30");
    expect(formatVnTime("2025-12-31T18:00:00Z")).toBe("01/01/2026 01:00");
  });
  it("không hợp lệ/không có thì null", () => {
    expect(formatVnTime(null)).toBeNull();
    expect(formatVnTime("không phải ngày")).toBeNull();
  });
});

describe("buildReportEmail: có phần AI", () => {
  const m = buildReportEmail(base);

  it("tiêu đề gọn có tên dashboard và kỳ", () => {
    expect(m.subject).toBe("[Cerno] Báo cáo bán hàng · Tháng 10/2025");
  });

  it("đủ các phần theo đúng thứ tự bố cục", () => {
    const order = ["Kính gửi anh/chị Nguyễn Văn An,", "Tóm tắt điều hành", "Chỉ số chính", "Điểm nổi bật", "Điểm cần lưu ý",
      "Nhóm tăng, giảm nhiều nhất", "Biểu đồ", "Phân tích theo yêu cầu", "Đề xuất hành động", "Mở dashboard", "Huỷ nhận email này"];
    let pos = -1;
    for (const s of order) {
      const at = m.html.indexOf(s, pos + 1);
      expect(at, s).toBeGreaterThan(pos);
      pos = at;
    }
  });

  it("bảng KPI có ▲▼ và màu theo sắc thái; KPI thiếu số hiện dấu —", () => {
    expect(m.html).toMatch(/color:#16a34a;font-weight:700">▲ \+25,4%/);
    expect(m.html).toMatch(/color:#dc2626;font-weight:700">▼ −17,7%/);
    expect(m.html).toContain("125.430.000");
    expect(m.html).toContain("100.000.000");
    expect(m.html).toContain(">—</td>");
  });

  it("ảnh đính kèm nội tuyến, mỗi ảnh bọc trong link mở dashboard", () => {
    expect(m.html).toContain('<a href="https://cerno.cloud/view/abc" style="text-decoration:none"><img src="cid:chart-1@cerno.report"');
    expect(m.html).toContain('alt="Doanh thu theo tháng"');
  });

  it("có nút mở dashboard, link huỷ nhận, 'cập nhật lúc' theo giờ VN, ghi chú", () => {
    expect(m.html).toContain('href="https://cerno.cloud/view/abc"');
    expect(m.html).toContain('href="https://cerno.cloud/unsubscribe?t=xyz"');
    expect(m.html).toContain("Số liệu cập nhật lúc 03/11/2025 09:30");
    expect(m.html).toContain("Đã bỏ 1 ảnh.");
    expect(m.html).toContain("Ghi chú từ số liệu.");
  });

  it("xuống dòng trong bài AI thành <br>", () => {
    expect(m.html).toContain("125,4 triệu.<br>Tăng 25,4%");
  });

  it("KHÔNG có iframe, script, form, thẻ nhúng", () => {
    expect(m.html).not.toMatch(/<(script|iframe|form|object|embed|link|style)\b/i);
    expect(m.html).not.toMatch(/\son\w+=/i);
    expect(m.html).not.toContain("javascript:");
  });

  it("bản chữ thuần đủ nội dung chính, có link mở và huỷ nhận", () => {
    expect(m.text).toContain("Kính gửi anh/chị Nguyễn Văn An,");
    expect(m.text).toContain("TÓM TẮT ĐIỀU HÀNH");
    expect(m.text).toContain("- Doanh thu: 125.430.000 (kỳ trước 100.000.000), +25,4%");
    expect(m.text).toContain("- Biên: không có dữ liệu");
    expect(m.text).toContain("Mở dashboard: https://cerno.cloud/view/abc");
    expect(m.text).toContain("Huỷ nhận email này: https://cerno.cloud/unsubscribe?t=xyz");
    expect(m.text).not.toMatch(/<[a-z]/i);
  });
});

describe("buildReportEmail: không có phần AI", () => {
  const m = buildReportEmail({ ...base, body: null, notes: ["Phần phân tích bằng AI tạm thời không có."] });
  it("chỉ có số liệu, biểu đồ và nút; không có các mục do AI viết", () => {
    expect(m.html).toContain("Chỉ số chính");
    expect(m.html).toContain("Nhóm tăng, giảm nhiều nhất");
    expect(m.html).toContain("cid:chart-1@cerno.report");
    for (const s of ["Tóm tắt điều hành", "Điểm nổi bật", "Điểm cần lưu ý", "Phân tích theo yêu cầu", "Đề xuất hành động"]) {
      expect(m.html).not.toContain(s);
    }
    expect(m.html).toContain("Phần phân tích bằng AI tạm thời không có.");
    expect(m.text).not.toContain("TÓM TẮT ĐIỀU HÀNH");
  });
});

describe("buildReportEmail: an toàn", () => {
  const evil = `<script>alert(1)</script><img src=x onerror=alert(1)>"'&`;
  const m = buildReportEmail({
    ...base,
    recipientName: evil,
    dashboardName: evil,
    body: { executiveSummary: evil, highlights: [evil], concerns: [evil], analysis: evil, actions: [evil] },
    facts: {
      ...facts,
      kpis: [{ ...facts.kpis[0], title: evil, growthText: evil }],
      movers: [{ ...facts.movers[0], chart: evil, up: [{ ...facts.movers[0].up[0], name: evil }] }],
      notes: [evil],
    },
    images: [{ cid: "c@x", title: evil }],
    notes: [evil],
  });
  it("mọi chữ do AI/người dùng/dữ liệu bị thoát HTML, không chèn được thẻ hay thuộc tính", () => {
    expect(m.html).not.toContain("<script>alert");
    expect(m.html).not.toMatch(/<img src=x/i);
    // "onerror=" chỉ còn là chữ bên trong giá trị thuộc tính (đã thoát), không bao giờ là thuộc tính thật.
    expect(m.html).not.toMatch(/["']\sonerror=/i);    expect(m.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(m.html).not.toMatch(/<(script|iframe)\b/i);
  });
  it("tiêu đề thư không chứa ký tự xuống dòng (chống chèn header)", () => {
    const s = buildReportEmail({ ...base, dashboardName: "A\r\nBcc: x@evil.com" }).subject;
    expect(s).not.toMatch(/[\r\n]/);
    expect(s.length).toBeLessThanOrEqual(150);
  });
  it("URL chứa dấu nháy không thoát khỏi thuộc tính href", () => {
    const x = buildReportEmail({ ...base, dashboardUrl: 'https://x/"><script>1</script>' });
    expect(x.html).not.toContain('"><script>');
  });
  it("không có tên người nhận thì chào chung", () => {
    expect(buildReportEmail({ ...base, recipientName: "  " }).html).toContain("Kính gửi anh/chị,");
  });
});
