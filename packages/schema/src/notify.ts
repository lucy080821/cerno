import { z } from "zod";
import { FieldBinding } from "./dashboard";

/**
 * Báo cáo định kỳ qua email và cảnh báo bất thường. Hình dạng khớp bảng `report_subscriptions` / `alert_rules`
 * (migration 0012). Phần "Input" là những gì client được gửi; phần còn lại do server đặt.
 */

const email = z.string().trim().toLowerCase().email().max(254);

// ---------------------------------------------------------------------------------------------
// Báo cáo định kỳ
// ---------------------------------------------------------------------------------------------

export const ReportFrequency = z.enum(["daily", "weekly", "monthly"]);
export const LinkMode = z.enum(["view_link", "login"]);
/** compare = so sánh kỳ này với kỳ trước; overview = tổng quan chỉ mô tả kỳ hiện tại. */
export const ReportType = z.enum(["compare", "overview"]);

/** Lịch gửi. Giờ theo múi giờ Việt Nam. `weekday` 1 = thứ Hai … 7 = Chủ nhật; `month_day` 31 = ngày cuối tháng nếu tháng ngắn hơn. */
export const ReportSchedule = z.object({
  frequency: ReportFrequency,
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  month_day: z.number().int().min(1).max(31).nullable().optional(),
  hour_vn: z.number().int().min(0).max(23),
});

/** Phần người dùng được sửa của một đăng ký nhận báo cáo (mỗi người nhận một dòng). */
export const ReportSubscriptionInput = ReportSchedule.extend({
  recipient_email: email,
  recipient_name: z.string().trim().max(80).default(""),
  /** Yêu cầu riêng của người nhận (trọng tâm, độ dài, giọng văn). Là DỮ LIỆU, không bao giờ là chỉ dẫn hệ thống. */
  prompt: z.string().max(1000).default(""),
  /** Rỗng = tự chọn widget đưa ảnh vào. */
  widget_ids: z.array(z.string().max(80)).max(6).default([]),
  include_images: z.boolean().default(true),
  link_mode: LinkMode.default("view_link"),
  report_type: ReportType.default("compare"),
  enabled: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if (v.frequency === "weekly" && v.weekday == null) ctx.addIssue({ code: "custom", path: ["weekday"], message: "Báo cáo hằng tuần cần chọn thứ." });
  if (v.frequency === "monthly" && v.month_day == null) ctx.addIssue({ code: "custom", path: ["month_day"], message: "Báo cáo hằng tháng cần chọn ngày." });
});

export const ReportSubscription = ReportSubscriptionInput.and(
  z.object({
    id: z.string().uuid(),
    dashboard_id: z.string().uuid(),
    created_by: z.string().uuid(),
    next_run_at: z.string().nullable(),
    last_sent_at: z.string().nullable(),
    last_error: z.string().nullable(),
    created_at: z.string(),
  }),
);

export type ReportFrequency = z.infer<typeof ReportFrequency>;
export type LinkMode = z.infer<typeof LinkMode>;
export type ReportType = z.infer<typeof ReportType>;
export type ReportSchedule = z.infer<typeof ReportSchedule>;
export type ReportSubscriptionInput = z.infer<typeof ReportSubscriptionInput>;
export type ReportSubscription = z.infer<typeof ReportSubscription>;

// ---------------------------------------------------------------------------------------------
// Giờ Việt Nam và lịch gửi
// ---------------------------------------------------------------------------------------------

/** Việt Nam là UTC+7 quanh năm (không có giờ mùa hè), nên tính bằng độ lệch cố định. */
export const VN_OFFSET_HOURS = 7;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/**
 * Lần gửi kế tiếp, LỚN HƠN HẲN `from` (đúng giờ gửi rồi thì tính sang kỳ sau). Trả về thời điểm UTC.
 * Hằng tuần: `weekday` 1..7 (T2..CN). Hằng tháng: `month_day` kẹp về ngày cuối tháng khi tháng ngắn hơn (31 → 28/29/30).
 */
export function nextRunAt(schedule: ReportSchedule, from: Date): Date {
  const s = ReportSchedule.parse(schedule);
  // "Đồng hồ treo tường" của Việt Nam, đọc bằng các hàm getUTC*.
  const wall = from.getTime() + VN_OFFSET_HOURS * HOUR;
  const toReal = (wallMs: number) => new Date(wallMs - VN_OFFSET_HOURS * HOUR);
  const now = new Date(wall);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const todayAt = Date.UTC(y, m, d, s.hour_vn);

  if (s.frequency === "daily") return toReal(todayAt > wall ? todayAt : todayAt + DAY);

  if (s.frequency === "weekly") {
    const target = s.weekday ?? 1;
    const isoDow = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
    let ahead = (target - isoDow + 7) % 7;
    if (ahead === 0 && todayAt <= wall) ahead = 7;
    return toReal(todayAt + ahead * DAY);
  }

  const wantDay = s.month_day ?? 1;
  for (let k = 0; k < 2; k++) {
    const mm = m + k;
    const yy = y + Math.floor(mm / 12);
    const mo = ((mm % 12) + 12) % 12;
    const cand = Date.UTC(yy, mo, Math.min(wantDay, daysIn(yy, mo)), s.hour_vn);
    if (cand > wall) return toReal(cand);
  }
  // Không thể tới đây (tháng sau luôn lớn hơn), giữ cho đủ kiểu trả về.
  throw new Error("nextRunAt: could not compute the next run");
}

// ---------------------------------------------------------------------------------------------
// Cảnh báo bất thường
// ---------------------------------------------------------------------------------------------

/** Bộ lọc của cảnh báo (cùng hình dạng RowFilter của chart-engine; schema không phụ thuộc chart-engine nên khai báo lại). */
export const AlertFilter = z.object({
  column: z.string().max(200),
  values: z.array(z.string().max(200)).max(200).default([]),
  range: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  dateRange: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
});

export const AlertWindow = z.enum(["today", "yesterday", "this_week", "this_month", "last_7d", "all"]);

/**
 * Chỉ số cần theo dõi. `metric` là số đo thường (cột + phép gộp) hoặc trường tính toán dạng tổng hợp.
 * `groupBy` (cột chiều) = báo theo TỪNG nhóm, chỉ dùng với điều kiện `per_group`.
 */
export const AlertMetric = z.object({
  sourceId: z.string().max(80),
  metric: FieldBinding,
  filters: z.array(AlertFilter).max(10).default([]),
  /** Cột ngày dùng để cắt `window`. Bắt buộc khi `window` khác "all". */
  dateColumn: z.string().max(200).optional(),
  window: AlertWindow.default("all"),
  groupBy: z.string().max(200).optional(),
  /**
   * Chỉ đánh giá khi giờ Việt Nam đã tới giờ này (0–23). Dành cho khoảng CHƯA KẾT THÚC (hôm nay, tuần này, tháng này):
   * lúc 9 giờ sáng doanh thu hôm nay chắc chắn thấp nên luật "dưới ngưỡng" sẽ báo sớm. Bỏ trống = đánh giá ngay.
   */
  settleHour: z.number().int().min(0).max(23).optional(),
}).superRefine((v, ctx) => {
  if (v.window !== "all" && !v.dateColumn) ctx.addIssue({ code: "custom", path: ["dateColumn"], message: "Cần chọn cột ngày để giới hạn thời gian." });
});

const Threshold = z.object({
  type: z.literal("threshold"),
  op: z.enum(["lt", "lte", "gt", "gte"]),
  value: z.number().finite(),
});
const Change = z.object({
  type: z.literal("change"),
  op: z.enum(["drop_pct", "rise_pct"]),
  /** Phần trăm, > 0 (vd 20 = 20%). */
  value: z.number().finite().positive().max(10_000),
  vs: z.enum(["prev_period", "prev_year"]),
});
const Anomaly = z.object({
  type: z.literal("anomaly"),
  sensitivity: z.enum(["low", "medium", "high"]),
  /** Số kỳ trước dùng làm mốc so sánh. */
  lookback: z.number().int().min(4).max(12),
  /** Chỉ báo khi lệch lên (up), lệch xuống (down) hay cả hai (both, mặc định). */
  direction: z.enum(["up", "down", "both"]).default("both"),
});
/** Điều kiện áp cho từng nhóm của `groupBy`. */
const PerGroupInner = z.discriminatedUnion("type", [Threshold, Change, Anomaly]);

export const AlertCondition = z.discriminatedUnion("type", [
  Threshold,
  Change,
  Anomaly,
  z.object({ type: z.literal("per_group"), inner: PerGroupInner }),
  /** Không có dòng mới trong `hours` giờ qua (kiểm bằng cron, không cần dữ liệu đổi). */
  z.object({ type: z.literal("stale"), hours: z.number().int().min(1).max(24 * 30) }),
]);

export const ALERT_CHANNELS = ["email", "telegram"] as const;

/** Kiểm chéo giữa chỉ số và điều kiện (dùng chung cho bản nháp và luật đầy đủ). */
function checkDraft(v: { metric: z.infer<typeof AlertMetric>; condition: z.infer<typeof AlertCondition> }, ctx: z.RefinementCtx) {
  const c = v.condition;
  if (c.type === "per_group" && !v.metric.groupBy) {
    ctx.addIssue({ code: "custom", path: ["metric", "groupBy"], message: "Báo theo từng nhóm cần chọn cột nhóm." });
  }
  if (c.type !== "per_group" && v.metric.groupBy) {
    ctx.addIssue({ code: "custom", path: ["metric", "groupBy"], message: "Chỉ điều kiện 'theo từng nhóm' mới dùng cột nhóm." });
  }
  const timed = c.type === "change" || c.type === "anomaly" || (c.type === "per_group" && c.inner.type !== "threshold");
  if (timed && v.metric.window === "all") {
    ctx.addIssue({ code: "custom", path: ["metric", "window"], message: "So sánh kỳ cần chọn khoảng thời gian (không phải 'tất cả')." });
  }
}

/** Bản nháp của luật: chỉ số + điều kiện (kết quả của AI dịch lời mô tả, hoặc dữ liệu để xem trước "bây giờ có báo không"). */
export const AlertDraft = z.object({ metric: AlertMetric, condition: AlertCondition }).superRefine(checkDraft);

/** Phần người dùng được sửa của một luật cảnh báo. */
export const AlertRuleInput = z.object({
  name: z.string().trim().min(1).max(120),
  /** Câu người dùng đã gõ để AI dịch ra luật (để hiện lại; không dùng để chạy). */
  source_prompt: z.string().max(1000).nullable().optional(),
  widget_id: z.string().max(80).nullable().optional(),
  metric: AlertMetric,
  condition: AlertCondition,
  recipients: z.array(email).min(1).max(20),
  channels: z.array(z.enum(ALERT_CHANNELS)).min(1).default(["email"]),
  cooldown_minutes: z.number().int().min(15).max(60 * 24 * 7).default(360),
  notify_recover: z.boolean().default(false),
  enabled: z.boolean().default(true),
}).superRefine(checkDraft);

/** Trạng thái đã lưu của một luật. 'insufficient' = chưa đủ dữ liệu để đánh giá. */
export const AlertState = z.enum(["ok", "firing", "error", "insufficient"]);

export type AlertFilter = z.infer<typeof AlertFilter>;
export type AlertWindow = z.infer<typeof AlertWindow>;
export type AlertMetric = z.infer<typeof AlertMetric>;
export type AlertCondition = z.infer<typeof AlertCondition>;
export type AlertRuleInput = z.infer<typeof AlertRuleInput>;
export type AlertDraft = z.infer<typeof AlertDraft>;
export type AlertState = z.infer<typeof AlertState>;
