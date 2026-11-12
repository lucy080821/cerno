/** Quyết định của các link không cần đăng nhập trong email cảnh báo (phần thuần, có test). */

/** Tạm hoãn: số giờ cố định của link "Tạm hoãn 24 giờ". */
export const SNOOZE_HOURS = 24;

export const snoozeUntil = (now: Date): string => new Date(now.getTime() + SNOOZE_HOURS * 3_600_000).toISOString();

/**
 * "Tắt cảnh báo này": người TẠO luật (hoặc người nhận duy nhất) tắt cả luật; một người nhận khác chỉ ngừng nhận phần của mình
 * (nếu không, ai được thêm vào danh sách nhận cũng tắt được luật của người khác).
 */
export function decideMute(recipients: string[], clickerEmail: string, creatorEmail: string | null): "disable" | "optout" {
  const who = clickerEmail.toLowerCase();
  const list = [...new Set(recipients.map((r) => r.toLowerCase()))];
  if (creatorEmail && who === creatorEmail.toLowerCase()) return "disable";
  if (list.length <= 1 && list.includes(who)) return "disable";
  return "optout";
}
