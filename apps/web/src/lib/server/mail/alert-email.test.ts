import { describe, expect, it } from "vitest";
import type { ComputationSummary } from "@/lib/server/alerts/compute";
import { buildAlertEmail, type AlertEmailInput } from "./alert-email";

const summary: ComputationSummary = { kind: "single", verdict: "firing", label: "hôm nay (13/11/2025)", value: 7_000_000, prev: null, changePct: null };
const base: AlertEmailInput = {
  appName: "Cerno", kind: "fire", ruleName: "Doanh thu thấp", dashboardName: "Báo cáo bán hàng", dashboardUrl: "https://cerno.cloud/view/abc",
  sentence: "Tổng Doanh thu hôm nay (13/11/2025) thấp hơn 10.000.000", summary, thresholdText: "thấp hơn 10.000.000",
  snoozeUrl: "https://cerno.cloud/unsubscribe?t=snooze", muteUrl: "https://cerno.cloud/unsubscribe?t=mute", unsubscribeUrl: "https://cerno.cloud/unsubscribe?t=unsub",
};

describe("buildAlertEmail: cảnh báo bật lên", () => {
  const m = buildAlertEmail(base);
  it("tiêu đề [Cảnh báo] <tên luật>", () => expect(m.subject).toBe("[Cảnh báo · Alert] Doanh thu thấp"));
  it("nêu chuyện gì xảy ra, giá trị so với ngưỡng, khoảng đo", () => {
    expect(m.html).toContain("Điều kiện cảnh báo đã xảy ra");
    expect(m.html).toContain("Tổng Doanh thu hôm nay (13/11/2025) thấp hơn 10.000.000.");
    expect(m.html).toContain("Giá trị hiện tại");
    expect(m.html).toContain("7.000.000");
    expect(m.html).toContain("thấp hơn 10.000.000");
    expect(m.html).toContain("hôm nay (13/11/2025)");
  });
  it("có nút mở dashboard và 3 link không cần đăng nhập: tạm hoãn, tắt, huỷ nhận", () => {
    expect(m.html).toContain('href="https://cerno.cloud/view/abc"');
    expect(m.html).toMatch(/href="https:\/\/cerno\.cloud\/unsubscribe\?t=snooze"[^>]*>Tạm hoãn 24 giờ/);
    expect(m.html).toMatch(/href="https:\/\/cerno\.cloud\/unsubscribe\?t=mute"[^>]*>Tắt cảnh báo này/);
    expect(m.html).toMatch(/href="https:\/\/cerno\.cloud\/unsubscribe\?t=unsub"[^>]*>Huỷ nhận email này/);
  });
  it("bản chữ thuần có đủ nội dung và 3 link", () => {
    expect(m.text).toContain("CẢNH BÁO · ALERT: Doanh thu thấp");
    expect(m.text).toContain("- Giá trị hiện tại: 7.000.000");
    expect(m.text).toContain("Tạm hoãn 24 giờ / Snooze 24 hours: https://cerno.cloud/unsubscribe?t=snooze");
    expect(m.text).toContain("Tắt cảnh báo này / Turn off this alert: https://cerno.cloud/unsubscribe?t=mute");
    expect(m.text).toContain("Huỷ nhận email này / Unsubscribe from this email: https://cerno.cloud/unsubscribe?t=unsub");
    expect(m.text).not.toMatch(/<[a-z]/i);
  });
  it("không iframe/script/form", () => {
    expect(m.html).not.toMatch(/<(script|iframe|form|object|embed|style)\b/i);
  });
});

describe("buildAlertEmail: các loại thư", () => {
  it("nhắc lại, đã bình thường, lỗi có tiêu đề và màu riêng", () => {
    expect(buildAlertEmail({ ...base, kind: "remind" }).subject).toBe("[Cảnh báo · Alert] Doanh thu thấp (nhắc lại · reminder)");
    expect(buildAlertEmail({ ...base, kind: "remind" }).html).toContain("Vẫn đang vi phạm điều kiện");
    const rec = buildAlertEmail({ ...base, kind: "recover" });
    expect(rec.subject).toBe("[Đã bình thường · Back to normal] Doanh thu thấp");
    expect(rec.html).toContain("Chỉ số đã trở lại bình thường");
    const err = buildAlertEmail({ ...base, kind: "error", summary: null, errorText: 'Cột "Doanh thu" không còn trong nguồn dữ liệu.' });
    expect(err.subject).toBe("[Lỗi cảnh báo · Alert error] Doanh thu thấp");
    expect(err.html).toContain('Cột &quot;Doanh thu&quot; không còn trong nguồn dữ liệu.');
    expect(err.text).toContain('Cột "Doanh thu" không còn trong nguồn dữ liệu.');
  });
});

describe("buildAlertEmail: nội dung theo loại luật", () => {
  it("so sánh kỳ: kỳ so sánh và % thay đổi có dấu", () => {
    const s: ComputationSummary = { kind: "single", verdict: "firing", label: "hôm qua (12/11/2025)", prevLabel: "hôm qua (11/11/2025)", value: 700, prev: 1000, changePct: -30 };
    const m = buildAlertEmail({ ...base, summary: s, thresholdText: "giảm từ 20%" });
    expect(m.html).toContain("Kỳ so sánh (hôm qua (11/11/2025))");
    expect(m.html).toContain("−30%");
    expect(m.text).toContain("- Thay đổi: −30%");
  });
  it("bất thường: mức bình thường", () => {
    const s: ComputationSummary = { kind: "single", verdict: "firing", label: "hôm qua (12/11/2025)", value: 300, z: 6, mean: 100.456, n: 8 };
    const m = buildAlertEmail({ ...base, summary: s, thresholdText: null });
    expect(m.html).toContain("Mức bình thường (trung bình các kỳ trước)");
    expect(m.html).toContain("100,46");
    expect(m.html).not.toContain("Điều kiện báo");
  });
  it("theo từng nhóm: liệt kê nhóm, 'và N nhóm khác'", () => {
    const s: ComputationSummary = { kind: "groups", verdict: "firing", label: "hôm nay (13/11/2025)", groupBy: "Tỉnh", evaluated: 30, insufficient: 0, violatingCount: 22 };
    const m = buildAlertEmail({
      ...base, summary: s, groups: { groupBy: "Tỉnh", items: [{ name: "Hà Nội", detail: "5" }, { name: "Huế", detail: "1" }], more: 20 },
    });
    expect(m.html).toContain("Các Tỉnh vi phạm");
    expect(m.html).toContain("Hà Nội: <strong>5</strong>");
    expect(m.html).toContain("và 20 nhóm khác");
    expect(m.html).toContain("22/30");
    expect(m.text).toContain("- Hà Nội: 5");
    expect(m.text).toContain("- và 20 nhóm khác");
  });
  it("không có dữ liệu mới", () => {
    const m = buildAlertEmail({ ...base, summary: null, thresholdText: null, sentence: "Không có dữ liệu mới trong 24 giờ", stale: { hoursAgo: 30.26, sinceText: "12/11/2025 03:00" } });
    expect(m.html).toContain("Dữ liệu đổi lần cuối");
    expect(m.html).toContain("12/11/2025 03:00");
    expect(m.html).toContain("30,3 giờ");
  });
  it("đo chưa đánh giá (deferred) không có bảng giá trị", () => {
    const m = buildAlertEmail({ ...base, summary: { kind: "deferred", verdict: "deferred", label: "x", settleHour: 21 } });
    expect(m.html).not.toContain("Giá trị hiện tại");
  });
});

describe("buildAlertEmail: ảnh, AI, link thiếu", () => {
  it("mini chart đính kèm nội tuyến, bọc link mở dashboard", () => {
    const m = buildAlertEmail({ ...base, chart: { cid: "alert@cerno.report", alt: "Doanh thu 14 ngày" } });
    expect(m.html).toContain('<a href="https://cerno.cloud/view/abc" style="text-decoration:none"><img src="cid:alert@cerno.report"');
    expect(m.text).toContain("biểu đồ dạng ảnh");
  });
  it("câu AI giải thích chỉ hiện khi có", () => {
    expect(buildAlertEmail({ ...base, explain: "Doanh thu thấp vì cuối tuần." }).html).toContain("Nhận định:</strong> Doanh thu thấp vì cuối tuần.");
    expect(buildAlertEmail({ ...base, explain: null }).html).not.toContain("Nhận định");
  });
  it("thiếu link tạm hoãn/tắt thì không hiện, vẫn có huỷ nhận", () => {
    const m = buildAlertEmail({ ...base, snoozeUrl: null, muteUrl: null });
    expect(m.html).not.toContain("Tạm hoãn");
    expect(m.html).not.toContain("Tắt cảnh báo");
    expect(m.html).toContain("Huỷ nhận email này");
  });
});

describe("buildAlertEmail: an toàn", () => {
  const evil = `<script>alert(1)</script><img src=x onerror=alert(1)>"'&`;
  const m = buildAlertEmail({
    ...base, ruleName: evil, dashboardName: evil, sentence: evil, explain: evil, errorText: evil, kind: "error",
    groups: { groupBy: evil, items: [{ name: evil, detail: evil }], more: 0 }, chart: { cid: "c@x", alt: evil },
    summary: { ...summary, label: evil, prevLabel: evil, prev: 1, mean: 2 },
  });
  it("mọi chữ bị thoát HTML", () => {
    expect(m.html).not.toContain("<script>alert");
    expect(m.html).not.toMatch(/<img src=x/i);
    expect(m.html).not.toMatch(/["']\sonerror=/i);
    expect(m.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(m.html).not.toMatch(/<(script|iframe)\b/i);
  });
  it("tiêu đề không chứa ký tự xuống dòng", () => {
    const s = buildAlertEmail({ ...base, ruleName: "A\r\nBcc: x@evil.com" }).subject;
    expect(s).not.toMatch(/[\r\n]/);
  });
  it("URL chứa dấu nháy không thoát khỏi thuộc tính href", () => {
    const x = buildAlertEmail({ ...base, dashboardUrl: 'https://x/"><script>1</script>', snoozeUrl: '"><b>' });
    expect(x.html).not.toContain('"><script>');
    expect(x.html).not.toContain('"><b>');
  });
});

describe("buildAlertEmail: song ngữ", () => {
  const m = buildAlertEmail({
    ...base,
    explain: "Doanh thu thấp vì cuối tuần.",
    en: { sentence: "Total Doanh thu today (13/11/2025) is below 10.000.000", thresholdText: "below 10.000.000", label: "today (13/11/2025)", explain: "Revenue is low because of the weekend." },
  });
  it("có phần tiếng Việt, dải ENGLISH VERSION rồi phần tiếng Anh", () => {
    const vi = m.html.indexOf("Điều kiện cảnh báo đã xảy ra");
    const band = m.html.indexOf("ENGLISH VERSION");
    const en = m.html.indexOf("The alert condition has occurred");
    expect(vi).toBeGreaterThan(-1);
    expect(band).toBeGreaterThan(vi);
    expect(en).toBeGreaterThan(band);
    expect(m.html).toContain("English version below");
  });
  it("câu điều kiện, nhãn, nhận định bằng tiếng Anh lấy từ `en`", () => {
    for (const s of ["is below 10.000.000", "Current value", "Alert condition", "today (13/11/2025)", "Revenue is low because of the weekend.", "Insight:", "Open dashboard"]) {
      expect(m.html, s).toContain(s);
    }
  });
  it("3 link hành động có cả hai ngôn ngữ", () => {
    for (const s of ["Tạm hoãn 24 giờ · Snooze 24 hours", "Tắt cảnh báo này · Turn off this alert", "Huỷ nhận email này · Unsubscribe from this email"]) {
      expect(m.html, s).toContain(s);
    }
  });
  it("ảnh chỉ đặt một lần; phần tiếng Anh trỏ lên trên", () => {
    const c = buildAlertEmail({ ...base, chart: { cid: "alert-chart@cerno.report", alt: "x" } });
    expect(c.html.match(/cid:alert-chart@cerno\.report/g)).toHaveLength(1);
    expect(c.html).toContain("shown in the Vietnamese section above");
  });
  it("bản chữ thuần có cả hai phần", () => {
    expect(m.text).toContain("----- ENGLISH VERSION -----");
    expect(m.text).toContain("Insight: Revenue is low because of the weekend.");
  });
  it("thiếu `en` vẫn dựng được thư (giữ chữ tiếng Việt cho câu động)", () => {
    const r = buildAlertEmail(base);
    expect(r.html).toContain("Alert condition");
    expect(r.html).toContain(base.sentence);
  });
});
