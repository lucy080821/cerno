// Không import "server-only": file này dùng cả ở server (cron) lẫn trình duyệt (tự làm mới khi đang mở editor).

/** Chu kỳ tự cập nhật dữ liệu từ Google Sheets (phút). */
export const AUTO_SYNC_MINUTES = 120;

/** Giữa hai lần bấm "Cập nhật ngay" của cùng một nguồn (giây), chỉ áp dụng ở production. */
export const MANUAL_MIN_SECONDS = 60;

/** Nguồn vừa thử mà thất bại thì chờ ít nhất bấy nhiêu phút mới thử lại. */
export const ATTEMPT_COOLDOWN_MINUTES = 15;

export interface SyncState {
  last_synced_at: string | null;
  last_attempt_at: string | null;
  sync_interval_minutes: number;
}

/**
 * Nguồn có đến hạn tự cập nhật chưa: đã quá chu kỳ kể từ lần đồng bộ thành công, VÀ không vừa mới thử
 * (tránh gọi Google dồn dập với nguồn đang lỗi).
 */
export function isDue(s: SyncState, now: number): boolean {
  const last = s.last_synced_at ? Date.parse(s.last_synced_at) : 0;
  const attempt = s.last_attempt_at ? Date.parse(s.last_attempt_at) : 0;
  return now - last >= s.sync_interval_minutes * 60_000 && now - attempt >= ATTEMPT_COOLDOWN_MINUTES * 60_000;
}
