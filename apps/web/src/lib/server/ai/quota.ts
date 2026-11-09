import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Hạn mức AI trả phí (Anthropic). Mỗi người có trần lượt/ngày và lượt/tháng, và cả hệ thống có trần chi phí tháng:
 * chạm trần thì AI trả phí tự dừng (Groq miễn phí vẫn chạy). Bộ đếm nằm ở DB (migration 0010) và kiểm tra nguyên tử.
 * Đổi giá trị bằng biến môi trường, không cần sửa code.
 */
export interface QuotaLimits {
  daily: number;
  monthly: number;
  /** Trần chi phí tháng của cả hệ thống, micro-USD. */
  budgetMicro: number;
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export function quotaLimits(): QuotaLimits {
  return {
    daily: Math.floor(num(process.env.AI_USER_DAILY_PAID, 5)),
    monthly: Math.floor(num(process.env.AI_USER_MONTHLY_PAID, 30)),
    // Mặc định 4 USD: chừa 1 USD trong ngân sách 5 USD/tháng cho sai số ước tính chi phí.
    budgetMicro: Math.round(num(process.env.AI_MONTHLY_BUDGET_USD, 4) * 1_000_000),
  };
}

export type ReserveResult = "ok" | "daily" | "monthly" | "budget" | "error";

export const QUOTA_MESSAGES: Record<Exclude<ReserveResult, "ok">, string> = {
  daily: "Bạn đã dùng hết lượt AI nâng cao của hôm nay, mai thử lại nhé.",
  monthly: "Bạn đã dùng hết lượt AI nâng cao của tháng này.",
  budget: "AI nâng cao đã hết ngân sách tháng này. Nó sẽ hoạt động lại vào đầu tháng sau.",
  error: "Không kiểm tra được hạn mức AI nâng cao, thử lại sau.",
};

/** Giữ chỗ một lượt trả phí (kiểm tra + tăng bộ đếm). Lỗi DB thì từ chối (đóng): thà không có AI trả phí còn hơn mất kiểm soát chi phí. */
export async function reservePaid(userId: string, limits: QuotaLimits = quotaLimits()): Promise<ReserveResult> {
  const { data, error } = await createAdminClient().rpc("ai_usage_reserve", {
    p_user: userId,
    p_daily: limits.daily,
    p_monthly: limits.monthly,
    p_budget_micro: limits.budgetMicro,
  });
  if (error) {
    console.error("[ai-quota] reserve lỗi:", error.message);
    return "error";
  }
  return data === "ok" || data === "daily" || data === "monthly" || data === "budget" ? data : "error";
}

/** Ghi token và chi phí thực tế sau khi gọi xong. Không ném lỗi: ghi hụt còn hơn làm hỏng câu trả lời đã gửi. */
export async function recordPaid(userId: string, inputTokens: number, outputTokens: number, costMicro: number): Promise<void> {
  const { error } = await createAdminClient().rpc("ai_usage_record", {
    p_user: userId,
    p_input: inputTokens,
    p_output: outputTokens,
    p_cost_micro: costMicro,
  });
  if (error) console.error("[ai-quota] record lỗi:", error.message);
}

/** Trả lại lượt đã giữ chỗ khi cuộc gọi thất bại trước khi sinh được gì (người dùng không mất lượt vì lỗi hệ thống). */
export async function releasePaid(userId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("ai_usage_release", { p_user: userId });
  if (error) console.error("[ai-quota] release lỗi:", error.message);
}
