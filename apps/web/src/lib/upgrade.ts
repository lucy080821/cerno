import { createElement, Fragment } from "react";
import type { DialogApi } from "@/components/ui/DialogProvider";

/** Trang so sánh gói + liên hệ nâng cấp (chưa có thanh toán trực tuyến). */
export const UPGRADE_PATH = "/upgrade";

/**
 * Hộp thoại khi chạm giới hạn của gói: nói rõ giới hạn, khuyên dùng thử gói Miễn phí trước, và có nút xem gói trả phí
 * (mở tab mới để không làm mất biểu mẫu đang nhập).
 */
export async function showPlanLimit(dialog: DialogApi, message: string): Promise<void> {
  const go = await dialog.confirm({
    title: "Đã chạm giới hạn của gói",
    // Hai đoạn riêng để từng đoạn được dịch bằng từ điển (đoạn đầu là thông báo giới hạn đã có bản dịch).
    message: createElement(
      Fragment,
      null,
      createElement("p", { style: { margin: "0 0 10px" } }, message),
      createElement("p", { style: { margin: 0 } }, "Bạn cứ dùng thử gói Miễn phí trước; khi thấy thật sự cần thêm thì hãy nâng cấp."),
    ),
    confirmText: "Xem gói trả phí",
    cancelText: "Để sau",
  });
  if (go) window.open(UPGRADE_PATH, "_blank", "noopener");
}
