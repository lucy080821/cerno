/** Lỗi do chạm giới hạn của gói (API trả `code: "plan_limit"`): giao diện hiện hộp thoại riêng thay vì dòng lỗi thường. */
export class PlanLimitError extends Error {
  readonly planLimit = true;
}

export const isPlanLimit = (e: unknown): e is PlanLimitError => e instanceof PlanLimitError;

/** Đổi phản hồi lỗi của API thành Error (PlanLimitError nếu là giới hạn của gói). */
export function errorFrom(json: { error?: string; code?: string } | null | undefined, fallback = "Có lỗi xảy ra, thử lại sau."): Error {
  const msg = json?.error ?? fallback;
  return json?.code === "plan_limit" ? new PlanLimitError(msg) : new Error(msg);
}
