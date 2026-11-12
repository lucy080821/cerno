import { describe, expect, it } from "vitest";
import { AlertCondition } from "@dashboard/schema";
import { PLAN_LIMITS } from "./limits";
import { aiParseViolation, alertViolation, limitsOf, mailLimitMessage, monthKeyVn, normalizePlan, reportViolation, startOfDayVn } from "./plan";

const cond = (c: unknown) => AlertCondition.parse(c);
const threshold = cond({ type: "threshold", op: "lt", value: 1 });
const change = cond({ type: "change", op: "drop_pct", value: 10, vs: "prev_period" });
const anomaly = cond({ type: "anomaly", sensitivity: "low", lookback: 4 });
const perGroup = cond({ type: "per_group", inner: { type: "threshold", op: "lt", value: 1 } });
const stale = cond({ type: "stale", hours: 24 });

describe("bảng gói", () => {
  it("gói miễn phí đúng đặc tả", () => {
    const f = PLAN_LIMITS.free;
    expect(f).toMatchObject({ reportSubscriptions: 1, aiReports: false, alertRules: 2, aiAlertParsePerMonth: 5 });
    expect(f.reportFrequencies).toEqual(["weekly"]);
    expect(f.alertTypes).toEqual(["threshold", "change"]);
    expect(f.channels).toEqual(["email"]);
  });
  it("gói trả phí đúng đặc tả", () => {
    const p = PLAN_LIMITS.paid;
    expect(p).toMatchObject({ reportSubscriptions: 20, aiReports: true, alertRules: 30, aiAlertParsePerMonth: null });
    expect(p.alertTypes).toEqual(["threshold", "change", "anomaly", "per_group", "stale"]);
    expect(p.channels).toEqual(["email", "telegram"]);
    expect(p.reportFrequencies).toEqual(["daily", "weekly", "monthly"]);
  });
  it("trả phí luôn rộng hơn miễn phí", () => {
    expect(PLAN_LIMITS.paid.mailsPerDay).toBeGreaterThan(PLAN_LIMITS.free.mailsPerDay);
  });
  it("normalizePlan: giá trị lạ/thiếu là miễn phí", () => {
    expect(normalizePlan("paid")).toBe("paid");
    for (const v of ["free", "", null, undefined, "PAID", "enterprise", 1]) expect(normalizePlan(v), String(v)).toBe("free");
    expect(limitsOf("free").label).toBe("Miễn phí");
  });
});

describe("reportViolation", () => {
  it("miễn phí: chỉ hằng tuần; daily/monthly bị chặn kèm thông báo", () => {
    expect(reportViolation("free", { frequency: "weekly" }, 0, true)).toBeNull();
    const d = reportViolation("free", { frequency: "daily" }, 0, true);
    expect(d).toMatchObject({ code: "plan_limit" });
    expect(d?.message).toMatch(/hằng tuần/);
    expect(d?.message).toMatch(/hằng ngày/);
    expect(reportViolation("free", { frequency: "monthly" }, 0, true)?.code).toBe("plan_limit");
  });
  it("miễn phí: 1 người nhận mỗi dashboard (tạo thứ hai bị chặn)", () => {
    expect(reportViolation("free", { frequency: "weekly" }, 0, true)).toBeNull();
    expect(reportViolation("free", { frequency: "weekly" }, 1, true)?.message).toMatch(/tối đa 1 người nhận/);
  });
  it("sửa đăng ký đã có không bị tính hạn mức số lượng (workspace bị hạ gói vẫn sửa được)", () => {
    expect(reportViolation("free", { frequency: "weekly" }, 5, false)).toBeNull();
    // nhưng đổi sang tần suất không được phép thì vẫn bị chặn
    expect(reportViolation("free", { frequency: "daily" }, 5, false)?.code).toBe("plan_limit");
  });
  it("trả phí: đủ tần suất, tối đa 20", () => {
    for (const f of ["daily", "weekly", "monthly"] as const) expect(reportViolation("paid", { frequency: f }, 3, true)).toBeNull();
    expect(reportViolation("paid", { frequency: "daily" }, 19, true)).toBeNull();
    expect(reportViolation("paid", { frequency: "daily" }, 20, true)?.message).toMatch(/tối đa 20/);
  });
});

describe("alertViolation", () => {
  const email = ["email"];
  it("miễn phí: chỉ ngưỡng và thay đổi; anomaly, theo nhóm, stale bị chặn", () => {
    expect(alertViolation("free", { condition: threshold, channels: email }, 0, true)).toBeNull();
    expect(alertViolation("free", { condition: change, channels: email }, 0, true)).toBeNull();
    for (const c of [anomaly, perGroup, stale]) {
      const v = alertViolation("free", { condition: c, channels: email }, 0, true);
      expect(v?.code, c.type).toBe("plan_limit");
      expect(v?.message).toMatch(/nâng cấp/);
    }
  });
  it("miễn phí: tối đa 2 luật mỗi dashboard", () => {
    expect(alertViolation("free", { condition: threshold, channels: email }, 1, true)).toBeNull();
    expect(alertViolation("free", { condition: threshold, channels: email }, 2, true)?.message).toMatch(/tối đa 2 cảnh báo/);
    expect(alertViolation("free", { condition: threshold, channels: email }, 9, false)).toBeNull(); // sửa luật cũ
  });
  it("miễn phí: chỉ email (Telegram bị chặn); trả phí: có Telegram", () => {
    expect(alertViolation("free", { condition: threshold, channels: ["email", "telegram"] }, 0, true)?.message).toMatch(/Telegram/);
    expect(alertViolation("paid", { condition: threshold, channels: ["email", "telegram"] }, 0, true)).toBeNull();
  });
  it("trả phí: đủ 5 loại, tối đa 30 luật", () => {
    for (const c of [threshold, change, anomaly, perGroup, stale]) expect(alertViolation("paid", { condition: c, channels: email }, 5, true), c.type).toBeNull();
    expect(alertViolation("paid", { condition: threshold, channels: email }, 29, true)).toBeNull();
    expect(alertViolation("paid", { condition: threshold, channels: email }, 30, true)?.message).toMatch(/tối đa 30/);
  });
  it("luật theo nhóm tính là loại riêng bất kể điều kiện bên trong (không lách bằng ngưỡng)", () => {
    expect(alertViolation("free", { condition: perGroup, channels: email }, 0, true)?.code).toBe("plan_limit");
  });
  it("kênh lạ bị chặn", () => {
    expect(alertViolation("paid", { condition: threshold, channels: ["sms"] }, 0, true)?.code).toBe("plan_limit");
  });
});

describe("thông báo khác", () => {
  it("hết lượt AI trong tháng nêu số lượt và gợi ý 'Tự cài'", () => {
    const v = aiParseViolation("free");
    expect(v.code).toBe("plan_limit");
    expect(v.message).toMatch(/5 lần mỗi tháng/);
    expect(v.message).toMatch(/Tự cài/);
  });
  it("hết hạn mức email trong ngày nêu số email", () => {
    expect(mailLimitMessage("free")).toContain("30 email");
    expect(mailLimitMessage("paid")).toContain("200 email");
  });
});

describe("khoá thời gian theo giờ VN", () => {
  it("monthKeyVn: sau 17:00Z cuối tháng đã sang tháng mới theo giờ VN", () => {
    expect(monthKeyVn(new Date("2025-11-13T10:00:00Z"))).toBe("2025-11");
    expect(monthKeyVn(new Date("2025-11-30T17:30:00Z"))).toBe("2025-12");
    expect(monthKeyVn(new Date("2025-12-31T16:59:00Z"))).toBe("2025-12");
    expect(monthKeyVn(new Date("2025-12-31T17:00:00Z"))).toBe("2026-01");
  });
  it("startOfDayVn: 00:00 giờ VN của hôm nay, dạng UTC", () => {
    expect(startOfDayVn(new Date("2025-11-13T10:00:00Z"))).toBe("2025-11-12T17:00:00.000Z");
    expect(startOfDayVn(new Date("2025-11-12T17:00:00Z"))).toBe("2025-11-12T17:00:00.000Z"); // đúng nửa đêm VN
    expect(startOfDayVn(new Date("2025-11-12T16:59:59Z"))).toBe("2025-11-11T17:00:00.000Z");
  });
});
