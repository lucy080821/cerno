import Link from "next/link";
import { Card } from "@/components/profit/Shared";
import { NotifyManager } from "@/components/notify/NotifyManager";
import { STATE_LABELS, stateKey } from "@/lib/notify/alert-form";
import { AppShell } from "../AppShell";
import { ownDashboards, requirePageUser, vnTime, workspaceIds } from "../page-user";
import styles from "@/components/profit/profit.module.css";

export const dynamic = "force-dynamic";

interface RuleRow {
  id: string; name: string; dashboard_id: string | null; enabled: boolean; snooze_until: string | null;
  last_state: "ok" | "firing" | "error" | "insufficient"; last_triggered_at: string | null; last_error: string | null;
}

const TONE: Record<string, string> = { firing: "bNeg", error: "bWarn", ok: "bPos" };

const COLS = "id, name, dashboard_id, enabled, snooze_until, last_state, last_triggered_at, last_error";

/**
 * Cảnh báo của cửa hàng (đọc dữ liệu bán hàng đa kênh, không gắn dashboard) và các cảnh báo gắn dashboard đã tạo trước đó (vẫn chạy).
 * Cài đặt ngay tại trang, không cần mở editor hay chọn dashboard.
 */
export default async function AlertsPage() {
  const { supabase, user, name } = await requirePageUser();
  const wsIds = await workspaceIds(supabase, user.id);
  const dashboards = await ownDashboards(supabase, wsIds);
  const names = new Map(dashboards.map((d) => [d.id, d.name]));
  let rules: RuleRow[] = [];
  let unavailable = false;
  const all = wsIds.length ? await supabase.from("alert_rules").select(COLS).in("workspace_id", wsIds).order("created_at", { ascending: false }) : { data: [], error: null };
  if (!all.error) rules = (all.data ?? []) as RuleRow[];
  else if (dashboards.length) {
    // Chưa chạy migration 0025 (chưa có cột workspace_id): đọc các cảnh báo gắn dashboard như trước.
    const old = await supabase.from("alert_rules").select(COLS).in("dashboard_id", dashboards.map((d) => d.id)).order("created_at", { ascending: false });
    if (old.error) unavailable = true;
    else rules = (old.data ?? []) as RuleRow[];
  } else unavailable = true;
  const now = new Date();
  const firing = rules.filter((r) => stateKey(r, now) === "firing").length;

  return (
    <AppShell userName={name} title="Cảnh báo" desc="Nhận email khi doanh thu, lãi, tỷ lệ hủy hoặc hoàn trả của cửa hàng vượt ngưỡng, thay đổi bất thường hoặc không có dữ liệu mới. Cerno kiểm tra sau mỗi lần dữ liệu cập nhật.">
      <div className={styles.stack}>
        {unavailable && <div className={styles.warn}><span>Chưa đọc được danh sách cảnh báo: cần chạy migration <code>0012_reports_alerts.sql</code> và <code>0025_workspace_notify.sql</code> trên Supabase.</span></div>}
        <Card title="Cảnh báo của bạn" aside={rules.length ? `${rules.length} cảnh báo · ${firing} đang báo` : undefined}>
          {rules.length === 0 ? (
            <p className={styles.small}>Chưa có cảnh báo nào. Ở phần cài đặt bên dưới, mô tả điều bạn muốn được báo (ví dụ "báo khi lãi hôm nay dưới 500 nghìn"), AI sẽ dựng luật để bạn xác nhận.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Cảnh báo</th><th>Phạm vi</th><th>Trạng thái</th><th>Lần báo gần nhất</th><th /></tr></thead>
                <tbody>
                  {rules.map((r) => {
                    const key = stateKey(r, now);
                    return (
                      <tr key={r.id} className={key === "firing" ? styles.lossRow : ""}>
                        <td><b data-i18n-skip>{r.name}</b>{r.last_error && <span className={styles.sub} data-i18n-skip>{r.last_error}</span>}</td>
                        <td data-i18n-skip>{r.dashboard_id ? (names.get(r.dashboard_id) ?? "Dashboard") : "Cả cửa hàng"}</td>
                        <td><span className={`${styles.badge} ${TONE[key] ? styles[TONE[key]] : ""}`}>{STATE_LABELS[key]}</span></td>
                        <td className={styles.muted}>{vnTime(r.last_triggered_at)}</td>
                        <td className={styles.r}><Link href={r.dashboard_id ? `/editor/${r.dashboard_id}?open=alerts` : "/alerts#manage"} className={styles.btn}>{r.dashboard_id ? "Mở dashboard" : "Quản lý"}</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <NotifyManager kind="alerts" />
      </div>
    </AppShell>
  );
}
