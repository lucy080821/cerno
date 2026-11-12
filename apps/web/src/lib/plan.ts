import type { AlertCondition } from "@dashboard/schema";
import { PLAN_LIMITS, type Plan, type PlanLimits } from "./limits";

/**
 * Kiểm hạn mức theo gói cho báo cáo định kỳ và cảnh báo. Hàm thuần: dùng chung cho API (chặn thật) và giao diện (báo trước),
 * để hai nơi không bao giờ lệch nhau. Mọi vi phạm có `code: "plan_limit"` để giao diện hiện hộp thoại "nâng cấp".
 */

export type { Plan, PlanLimits };

export interface PlanViolation {
  code: "plan_limit";
  message: string;
}

export const normalizePlan = (v: unknown): Plan => (v === "paid" ? "paid" : "free");

export const limitsOf = (plan: Plan): PlanLimits => PLAN_LIMITS[plan];

const violation = (message: string): PlanViolation => ({ code: "plan_limit", message });

const FREQ_NAME = { daily: "hằng ngày", weekly: "hằng tuần", monthly: "hằng tháng" } as const;
const KIND_NAME = {
  threshold: "vượt ngưỡng", change: "thay đổi so với kỳ trước", anomaly: "bất thường", per_group: "theo từng nhóm", stale: "không có dữ liệu mới",
} as const;

/**
 * Kiểm một đăng ký báo cáo. `existing` = số đăng ký hiện có của dashboard; `isNew` = đang TẠO mới (chỉ lúc tạo mới mới đếm hạn mức,
 * để workspace bị hạ gói vẫn sửa/tắt/xoá được các đăng ký cũ).
 */
export function reportViolation(plan: Plan, input: { frequency: "daily" | "weekly" | "monthly" }, existing: number, isNew: boolean): PlanViolation | null {
  const l = limitsOf(plan);
  if (!l.reportFrequencies.includes(input.frequency)) {
    return violation(`Gói ${l.label} chỉ gửi báo cáo ${l.reportFrequencies.map((f) => FREQ_NAME[f]).join(", ")}. Hãy nâng cấp để gửi báo cáo ${FREQ_NAME[input.frequency]}.`);
  }
  if (isNew && existing >= l.reportSubscriptions) {
    return violation(`Gói ${l.label} chỉ có tối đa ${l.reportSubscriptions} người nhận báo cáo cho mỗi dashboard. Hãy nâng cấp để thêm người nhận.`);
  }
  return null;
}

/** Loại điều kiện của một luật (per_group tính là loại riêng, bất kể điều kiện bên trong). */
export const alertKindOf = (c: AlertCondition): keyof typeof KIND_NAME => c.type;

/** Kiểm một luật cảnh báo (loại điều kiện, kênh gửi, số luật). */
export function alertViolation(plan: Plan, input: { condition: AlertCondition; channels: readonly string[] }, existing: number, isNew: boolean): PlanViolation | null {
  const l = limitsOf(plan);
  const kind = alertKindOf(input.condition);
  if (!l.alertTypes.includes(kind)) {
    return violation(`Gói ${l.label} chưa có cảnh báo loại “${KIND_NAME[kind]}”. Hãy nâng cấp để dùng loại này.`);
  }
  const bad = input.channels.find((c) => !(l.channels as readonly string[]).includes(c));
  if (bad) return violation(`Gói ${l.label} chỉ gửi cảnh báo qua email. Hãy nâng cấp để gửi qua ${bad === "telegram" ? "Telegram" : bad}.`);
  if (isNew && existing >= l.alertRules) {
    return violation(`Gói ${l.label} chỉ có tối đa ${l.alertRules} cảnh báo cho mỗi dashboard. Hãy nâng cấp để tạo thêm.`);
  }
  return null;
}

/** Lỗi khi hết lượt tạo cảnh báo bằng AI trong tháng. */
export function aiParseViolation(plan: Plan): PlanViolation {
  const l = limitsOf(plan);
  return violation(`Gói ${l.label} chỉ được tạo cảnh báo bằng AI tối đa ${l.aiAlertParsePerMonth} lần mỗi tháng và bạn đã dùng hết. Bạn vẫn có thể dùng “Tự cài”, hoặc nâng cấp để không giới hạn.`);
}

/** Đã hết hạn mức email trong ngày của workspace. */
export function mailLimitMessage(plan: Plan): string {
  return `Đã đạt giới hạn ${limitsOf(plan).mailsPerDay} email mỗi ngày của gói ${limitsOf(plan).label}; email này bị bỏ qua.`;
}

/** Tháng theo giờ Việt Nam (yyyy-mm) làm khoá bộ đếm theo tháng. */
export function monthKeyVn(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);
}

/** Đầu ngày hôm nay theo giờ Việt Nam, dạng ISO UTC (mốc đếm email trong ngày). */
export function startOfDayVn(now: Date): string {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - 7 * 3_600_000).toISOString();
}
