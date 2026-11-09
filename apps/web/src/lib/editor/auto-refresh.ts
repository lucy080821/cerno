import { ATTEMPT_COOLDOWN_MINUTES, AUTO_SYNC_MINUTES } from "@/lib/google/constants";
import { useData } from "./data-store";
import { fetchSources, loadRows, syncNow } from "./remote-data";
import { useEditor } from "./store";

const CHECK_EVERY_MS = 5 * 60_000;
const FIRST_CHECK_MS = 4000; // chờ editor tải xong dữ liệu ban đầu

/**
 * Giữ dữ liệu luôn mới khi đang mở dashboard, không phụ thuộc bộ hẹn giờ phía server:
 * - Nguồn đã quá chu kỳ (2 giờ) chưa cập nhật: bảo server đọc lại Google Sheets rồi tải về.
 * - Nguồn đã được nơi khác cập nhật (bộ hẹn giờ, tab khác): chỉ tải dòng mới về.
 * Kiểm tra sau khi mở, mỗi 5 phút, và khi quay lại tab. Nguồn vừa lỗi thì chờ 15 phút mới thử lại.
 */
export function startAutoRefresh(): () => void {
  let busy = false;
  let stopped = false;
  const failedAt = new Map<string, number>();

  async function check() {
    if (busy || stopped || document.visibilityState === "hidden") return;
    busy = true;
    try {
      const mine = new Set(useEditor.getState().doc.sources.filter((s) => s.type === "google_sheets").map((s) => s.id));
      if (mine.size === 0) return;
      const list = await fetchSources();
      if (!list) return;
      for (const r of list) {
        if (!mine.has(r.id) || stopped) continue;
        const now = Date.now();
        const stale = !r.last_synced_at || now - Date.parse(r.last_synced_at) >= AUTO_SYNC_MINUTES * 60_000;
        const cooled = now - (failedAt.get(r.id) ?? 0) >= ATTEMPT_COOLDOWN_MINUTES * 60_000;
        if (stale && cooled) {
          const out = await syncNow(r.id);
          if (!out.ok) failedAt.set(r.id, now);
        } else if (r.last_synced_at !== useData.getState().syncedAt[r.id]) {
          await loadRows(r.id, r.row_count);
        }
      }
    } finally {
      busy = false;
    }
  }

  const first = window.setTimeout(() => void check(), FIRST_CHECK_MS);
  const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void check();
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    stopped = true;
    window.clearTimeout(first);
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
