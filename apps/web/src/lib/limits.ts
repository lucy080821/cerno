/**
 * Hạn mức mềm của bản miễn phí. Dùng chung cho code kiểm tra và trang Điều khoản, để con số công bố
 * luôn khớp thực tế. (Số dashboard tối đa còn được ép ở DB bằng trigger trong migration 0004: nhớ đổi cả hai.)
 */
export const MAX_DASHBOARDS_PER_WORKSPACE = 20;
export const MAX_SOURCES_PER_WORKSPACE = 10;
/**
 * Tổng số dòng dữ liệu đã đồng bộ tối đa của MỘT workspace (cộng mọi nguồn). Giữ cơ sở dữ liệu miễn phí (500 MB) không bị
 * vài nguồn lớn chiếm hết. Nguồn vượt hạn mức bị cắt bớt khi đồng bộ và có thông báo.
 */
export const MAX_ROWS_PER_WORKSPACE = 300_000;

/**
 * Gói của workspace (cột `workspaces.plan`, migration 0014). Chưa có thanh toán: đổi gói bằng tay trong DB.
 * Đây là NGUỒN DUY NHẤT của mọi hạn mức báo cáo/cảnh báo: API kiểm theo bảng này và giao diện đọc cùng bảng (qua `lib/plan.ts`).
 */
export type Plan = "free" | "paid";

export interface PlanLimits {
  label: string;
  /** Số người nhận báo cáo email tối đa cho MỘT dashboard. */
  reportSubscriptions: number;
  /** Tần suất báo cáo được phép. */
  reportFrequencies: readonly ("daily" | "weekly" | "monthly")[];
  /** AI viết phân tích trong báo cáo (kèm yêu cầu riêng của người nhận). Không có thì báo cáo chỉ gồm bảng số và ảnh. */
  aiReports: boolean;
  /** Số luật cảnh báo tối đa cho MỘT dashboard. */
  alertRules: number;
  /** Loại điều kiện cảnh báo được phép (per_group = theo từng nhóm). */
  alertTypes: readonly ("threshold" | "change" | "anomaly" | "per_group" | "stale")[];
  channels: readonly ("email" | "telegram")[];
  /** Số lần tạo luật bằng AI mỗi THÁNG cho mỗi người; null = không giới hạn. */
  aiAlertParsePerMonth: number | null;
  /** Số email báo cáo + cảnh báo tối đa mỗi NGÀY cho một workspace. */
  mailsPerDay: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    label: "Miễn phí",
    reportSubscriptions: 1,
    reportFrequencies: ["weekly"],
    aiReports: false,
    alertRules: 2,
    alertTypes: ["threshold", "change"],
    channels: ["email"],
    aiAlertParsePerMonth: 5,
    mailsPerDay: 30,
  },
  paid: {
    label: "Trả phí",
    reportSubscriptions: 20,
    reportFrequencies: ["daily", "weekly", "monthly"],
    aiReports: true,
    alertRules: 30,
    alertTypes: ["threshold", "change", "anomaly", "per_group", "stale"],
    channels: ["email", "telegram"],
    aiAlertParsePerMonth: null,
    mailsPerDay: 200,
  },
};
