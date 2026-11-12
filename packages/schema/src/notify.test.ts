import { describe, expect, it } from "vitest";
import {
  AlertCondition, AlertMetric, AlertRuleInput, ReportSubscriptionInput, nextRunAt,
  type ReportSchedule,
} from "./notify";

/** Giờ Việt Nam (UTC+7) → ISO UTC, cho dễ đọc test. */
const vn = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h - 7)).toISOString();
const at = (iso: string) => new Date(iso);
const next = (s: ReportSchedule, from: string) => nextRunAt(s, at(from)).toISOString();

describe("nextRunAt: hằng ngày", () => {
  const s: ReportSchedule = { frequency: "daily", hour_vn: 8 };
  it("trước giờ gửi thì gửi hôm nay, sau giờ gửi thì gửi ngày mai", () => {
    expect(next(s, vn(2025, 1, 10, 7))).toBe(vn(2025, 1, 10, 8));
    expect(next(s, vn(2025, 1, 10, 9))).toBe(vn(2025, 1, 11, 8));
  });
  it("đúng giờ gửi rồi thì tính sang kỳ sau (lớn hơn hẳn)", () => {
    expect(next(s, vn(2025, 1, 10, 8))).toBe(vn(2025, 1, 11, 8));
  });
  it("ngày theo giờ VN khác ngày UTC: 03:00 VN ngày 11 vẫn là ngày 11", () => {
    expect(next(s, "2025-01-10T20:00:00Z")).toBe(vn(2025, 1, 11, 8));
  });
  it("giờ 0 (nửa đêm VN = 17:00Z hôm trước), qua cuối tháng và cuối năm", () => {
    expect(next({ frequency: "daily", hour_vn: 0 }, vn(2025, 12, 31, 12))).toBe(vn(2026, 1, 1, 0));
    expect(nextRunAt({ frequency: "daily", hour_vn: 0 }, at(vn(2025, 12, 31, 12))).toISOString()).toBe("2025-12-31T17:00:00.000Z");
  });
});

describe("nextRunAt: hằng tuần (1 = thứ Hai … 7 = Chủ nhật)", () => {
  const mon: ReportSchedule = { frequency: "weekly", weekday: 1, hour_vn: 9 };
  it("từ giữa tuần tới thứ Hai kế tiếp", () => {
    expect(next(mon, vn(2025, 1, 8, 10))).toBe(vn(2025, 1, 13, 9)); // thứ Tư 8/1 → thứ Hai 13/1
  });
  it("cùng thứ: trước giờ gửi thì hôm nay, đúng/sau giờ gửi thì tuần sau", () => {
    expect(next(mon, vn(2025, 1, 13, 8))).toBe(vn(2025, 1, 13, 9));
    expect(next(mon, vn(2025, 1, 13, 9))).toBe(vn(2025, 1, 20, 9));
    expect(next(mon, vn(2025, 1, 13, 15))).toBe(vn(2025, 1, 20, 9));
  });
  it("Chủ nhật (7) và quanh ranh giới ngày UTC/VN", () => {
    expect(next({ frequency: "weekly", weekday: 7, hour_vn: 9 }, vn(2025, 1, 8, 10))).toBe(vn(2025, 1, 12, 9));
    // 18:00Z Chủ nhật 12/1 = 01:00 thứ Hai 13/1 giờ VN
    expect(next(mon, "2025-01-12T18:00:00Z")).toBe(vn(2025, 1, 13, 9));
  });
  it("thứ Hai sau cuối năm", () => {
    expect(next(mon, vn(2025, 12, 31, 10))).toBe(vn(2026, 1, 5, 9));
  });
});

describe("nextRunAt: hằng tháng", () => {
  const d31: ReportSchedule = { frequency: "monthly", month_day: 31, hour_vn: 9 };
  it("ngày 31 kẹp về cuối tháng ngắn: tháng 2 thường, tháng 2 nhuận, tháng 30 ngày", () => {
    expect(next(d31, vn(2025, 1, 31, 10))).toBe(vn(2025, 2, 28, 9));
    expect(next(d31, vn(2024, 1, 31, 10))).toBe(vn(2024, 2, 29, 9));
    expect(next(d31, vn(2025, 3, 31, 10))).toBe(vn(2025, 4, 30, 9));
  });
  it("chưa tới ngày thì gửi trong tháng này, kể cả tháng ngắn", () => {
    expect(next(d31, vn(2025, 2, 10, 10))).toBe(vn(2025, 2, 28, 9));
    expect(next(d31, vn(2025, 1, 10, 10))).toBe(vn(2025, 1, 31, 9));
  });
  it("qua cuối năm", () => {
    expect(next(d31, vn(2025, 12, 31, 10))).toBe(vn(2026, 1, 31, 9));
    expect(next({ frequency: "monthly", month_day: 15, hour_vn: 9 }, vn(2025, 12, 20, 10))).toBe(vn(2026, 1, 15, 9));
  });
  it("đúng giờ gửi rồi thì tính sang tháng sau", () => {
    expect(next({ frequency: "monthly", month_day: 1, hour_vn: 0 }, vn(2025, 2, 1, 0))).toBe(vn(2025, 3, 1, 0));
    expect(next({ frequency: "monthly", month_day: 15, hour_vn: 9 }, vn(2025, 1, 15, 9))).toBe(vn(2025, 2, 15, 9));
  });
  it("ngày VN khác ngày UTC: 01:00 VN ngày 1/2 vẫn là tháng 2", () => {
    expect(next({ frequency: "monthly", month_day: 1, hour_vn: 9 }, "2025-01-31T18:00:00Z")).toBe(vn(2025, 2, 1, 9));
  });
});

describe("nextRunAt: đầu vào sai", () => {
  it("giờ ngoài 0..23 bị từ chối", () => {
    expect(() => nextRunAt({ frequency: "daily", hour_vn: 24 }, new Date())).toThrow();
    expect(() => nextRunAt({ frequency: "weekly", weekday: 0, hour_vn: 8 }, new Date())).toThrow();
  });
});

describe("ReportSubscriptionInput", () => {
  const base = { recipient_email: "  An@Example.COM ", frequency: "daily", hour_vn: 8 };
  it("chuẩn hoá email chữ thường, đặt mặc định", () => {
    const r = ReportSubscriptionInput.parse(base);
    expect(r.recipient_email).toBe("an@example.com");
    expect(r).toMatchObject({ prompt: "", widget_ids: [], include_images: true, link_mode: "view_link", enabled: true });
  });
  it("hằng tuần cần thứ, hằng tháng cần ngày", () => {
    expect(ReportSubscriptionInput.safeParse({ ...base, frequency: "weekly" }).success).toBe(false);
    expect(ReportSubscriptionInput.safeParse({ ...base, frequency: "weekly", weekday: 3 }).success).toBe(true);
    expect(ReportSubscriptionInput.safeParse({ ...base, frequency: "monthly" }).success).toBe(false);
    expect(ReportSubscriptionInput.safeParse({ ...base, frequency: "monthly", month_day: 31 }).success).toBe(true);
  });
  it("giới hạn: yêu cầu ≤ 1000 ký tự, ≤ 6 widget, email hợp lệ", () => {
    expect(ReportSubscriptionInput.safeParse({ ...base, prompt: "x".repeat(1001) }).success).toBe(false);
    expect(ReportSubscriptionInput.safeParse({ ...base, widget_ids: Array(7).fill("w") }).success).toBe(false);
    expect(ReportSubscriptionInput.safeParse({ ...base, recipient_email: "khong-phai-email" }).success).toBe(false);
  });
});

const metric = { sourceId: "s", metric: { column: "DT", aggregation: "sum" as const }, dateColumn: "Ngày", window: "yesterday" as const };

describe("AlertMetric / AlertCondition", () => {
  it("window khác 'all' cần cột ngày", () => {
    expect(AlertMetric.safeParse({ ...metric, dateColumn: undefined }).success).toBe(false);
    expect(AlertMetric.safeParse({ ...metric, window: "all", dateColumn: undefined }).success).toBe(true);
  });
  it("5 loại điều kiện hợp lệ", () => {
    for (const c of [
      { type: "threshold", op: "lt", value: 10_000_000 },
      { type: "change", op: "drop_pct", value: 20, vs: "prev_period" },
      { type: "anomaly", sensitivity: "medium", lookback: 8 },
      { type: "per_group", inner: { type: "threshold", op: "gt", value: 5 } },
      { type: "stale", hours: 24 },
    ]) expect(AlertCondition.safeParse(c).success, JSON.stringify(c)).toBe(true);
  });
  it("giá trị sai bị từ chối: lookback ngoài 4..12, phần trăm ≤ 0, stale 0 giờ, per_group lồng per_group", () => {
    expect(AlertCondition.safeParse({ type: "anomaly", sensitivity: "low", lookback: 3 }).success).toBe(false);
    expect(AlertCondition.safeParse({ type: "anomaly", sensitivity: "low", lookback: 13 }).success).toBe(false);
    expect(AlertCondition.safeParse({ type: "change", op: "drop_pct", value: 0, vs: "prev_period" }).success).toBe(false);
    expect(AlertCondition.safeParse({ type: "threshold", op: "lt", value: Number.NaN }).success).toBe(false);
    expect(AlertCondition.safeParse({ type: "stale", hours: 0 }).success).toBe(false);
    expect(AlertCondition.safeParse({ type: "per_group", inner: { type: "per_group", inner: { type: "stale", hours: 1 } } }).success).toBe(false);
    expect(AlertCondition.safeParse({ type: "loai_la" }).success).toBe(false);
  });
});

describe("settleHour", () => {
  it("tuỳ chọn, 0–23, số nguyên", () => {
    expect(AlertMetric.safeParse(metric).success).toBe(true);
    expect(AlertMetric.safeParse({ ...metric, settleHour: 21 }).success).toBe(true);
    expect(AlertMetric.safeParse({ ...metric, settleHour: 0 }).success).toBe(true);
    expect(AlertMetric.safeParse({ ...metric, settleHour: 24 }).success).toBe(false);
    expect(AlertMetric.safeParse({ ...metric, settleHour: 20.5 }).success).toBe(false);
  });
});

describe("AlertRuleInput", () => {
  const rule = {
    name: "Doanh thu thấp", metric, condition: { type: "threshold", op: "lt", value: 10_000_000 }, recipients: ["A@x.com"],
  };
  it("đặt mặc định và chuẩn hoá người nhận", () => {
    const r = AlertRuleInput.parse(rule);
    expect(r).toMatchObject({ channels: ["email"], cooldown_minutes: 360, notify_recover: false, enabled: true, recipients: ["a@x.com"] });
  });
  it("per_group bắt buộc có groupBy; loại khác không được có groupBy", () => {
    const pg = { type: "per_group", inner: { type: "threshold", op: "lt", value: 1 } };
    expect(AlertRuleInput.safeParse({ ...rule, condition: pg }).success).toBe(false);
    expect(AlertRuleInput.safeParse({ ...rule, condition: pg, metric: { ...metric, groupBy: "Tỉnh" } }).success).toBe(true);
    expect(AlertRuleInput.safeParse({ ...rule, metric: { ...metric, groupBy: "Tỉnh" } }).success).toBe(false);
  });
  it("change/anomaly (kể cả trong per_group) không dùng window 'all'", () => {
    const m = { ...metric, window: "all" as const, dateColumn: undefined };
    expect(AlertRuleInput.safeParse({ ...rule, metric: m, condition: { type: "anomaly", sensitivity: "low", lookback: 4 } }).success).toBe(false);
    expect(AlertRuleInput.safeParse({
      ...rule, metric: { ...m, groupBy: "Tỉnh" },
      condition: { type: "per_group", inner: { type: "change", op: "rise_pct", value: 10, vs: "prev_period" } },
    }).success).toBe(false);
    expect(AlertRuleInput.safeParse({ ...rule, metric: m }).success).toBe(true); // ngưỡng + all: được
  });
  it("cần ít nhất một người nhận, cooldown 15 phút trở lên, kênh hợp lệ", () => {
    expect(AlertRuleInput.safeParse({ ...rule, recipients: [] }).success).toBe(false);
    expect(AlertRuleInput.safeParse({ ...rule, cooldown_minutes: 5 }).success).toBe(false);
    expect(AlertRuleInput.safeParse({ ...rule, channels: ["sms"] }).success).toBe(false);
    expect(AlertRuleInput.safeParse({ ...rule, channels: ["email", "telegram"] }).success).toBe(true);
  });
});
