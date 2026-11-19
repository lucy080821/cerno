/**
 * Liên kết từ các trang của ứng dụng vào editor kèm việc cần mở sẵn: `/editor/<id>?open=ai|alerts|reports|share`
 * (trang Hỏi AI, Cảnh báo, Báo cáo định kỳ, Chia sẻ và nhúng). Đọc một lần khi mở editor rồi bỏ khỏi địa chỉ để
 * tải lại trang không mở lại hộp thoại.
 */
export type OpenTarget = "ai" | "alerts" | "reports" | "share";
const TARGETS: readonly OpenTarget[] = ["ai", "alerts", "reports", "share"];

export function parseOpenParam(search: string): OpenTarget | null {
  const v = new URLSearchParams(search).get("open");
  return v && (TARGETS as readonly string[]).includes(v) ? (v as OpenTarget) : null;
}

/** Đọc `?open=` của trang hiện tại (chỉ ở trình duyệt). */
export function readOpenParam(): OpenTarget | null {
  if (typeof window === "undefined") return null;
  return parseOpenParam(window.location.search);
}

/** Bỏ `?open=` khỏi địa chỉ mà không tải lại trang. */
export function clearOpenParam(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("open")) return;
    url.searchParams.delete("open");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    /* bỏ qua */
  }
}
