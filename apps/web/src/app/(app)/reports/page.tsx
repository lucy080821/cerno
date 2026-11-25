import Link from "next/link";
import { Card } from "@/components/profit/Shared";
import { NotifyManager } from "@/components/notify/NotifyManager";
import { scheduleLabel } from "@/lib/notify/format";
import { AppShell } from "../AppShell";
import { ownDashboards, requirePageUser, vnTime, workspaceIds } from "../page-user";
import styles from "@/components/profit/profit.module.css";

export const dynamic = "force-dynamic";

interface SubRow {
  id: string; dashboard_id: string | null; recipient_email: string; recipient_name: string; enabled: boolean;
  frequency: "daily" | "weekly" | "monthly"; weekday: number | null; month_day: number | null; hour_vn: number;
  next_run_at: string | null; last_sent_at: string | null; last_error: string | null;
}

const COLS = "id, dashboard_id, recipient_email, recipient_name, enabled, frequency, weekday, month_day, hour_vn, next_run_at, last_sent_at, last_error";

/**
 * Báo cáo định kỳ qua email của cửa hàng (số liệu bán hàng đa kênh, không gắn dashboard) và các báo cáo gắn dashboard đã tạo trước đó (vẫn chạy).
 * Đặt lịch/sửa ngay tại trang, không cần mở editor hay chọn dashboard.
 */
export default async function ReportsPage() {
  const { supabase, user, name } = await requirePageUser();
  const wsIds = await workspaceIds(supabase, user.id);
  const dashboards = await ownDashboards(supabase, wsIds);
  const names = new Map(dashboards.map((d) => [d.id, d.name]));
  let subs: SubRow[] = [];
  let unavailable = false;
  const all = wsIds.length ? await supabase.from("report_subscriptions").select(COLS).in("workspace_id", wsIds).order("created_at", { ascending: false }) : { data: [], error: null };
  if (!all.error) subs = (all.data ?? []) as SubRow[];
  else if (dashboards.length) {
    // Chưa chạy migration 0025 (chưa có cột workspace_id): đọc các báo cáo gắn dashboard như trước.
    const old = await supabase.from("report_subscriptions").select(COLS).in("dashboard_id", dashboards.map((d) => d.id)).order("created_at", { ascending: false });
    if (old.error) unavailable = true;
    else subs = (old.data ?? []) as SubRow[];
  } else unavailable = true;

  return (
    <AppShell userName={name} title="Báo cáo định kỳ" desc="Cerno gửi email tóm tắt kết quả bán hàng theo lịch: doanh thu, lãi, hủy/hoàn, kênh và sản phẩm tăng giảm, kèm biểu đồ.">
      <div className={styles.stack}>
        {unavailable && <div className={styles.warn}><span>Chưa đọc được danh sách báo cáo: cần chạy migration <code>0012_reports_alerts.sql</code> và <code>0025_workspace_notify.sql</code> trên Supabase.</span></div>}
        <Card title="Báo cáo đang gửi" aside={subs.length ? `${subs.length} người nhận` : undefined}>
          {subs.length === 0 ? (
            <p className={styles.small}>Chưa có báo cáo nào. Ở phần cài đặt bên dưới, đặt lịch gửi báo cáo cho bạn hoặc đồng nghiệp.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Người nhận</th><th>Phạm vi</th><th>Lịch gửi</th><th>Lần gửi gần nhất</th><th>Lần gửi tới</th><th /></tr></thead>
                <tbody>
                  {subs.map((r) => (
                    <tr key={r.id}>
                      <td><b data-i18n-skip>{r.recipient_name || r.recipient_email}</b>{r.recipient_name && <span className={styles.sub} data-i18n-skip>{r.recipient_email}</span>}</td>
                      <td data-i18n-skip>{r.dashboard_id ? (names.get(r.dashboard_id) ?? "Dashboard") : "Cả cửa hàng"}</td>
                      <td>{r.enabled ? scheduleLabel(r) : <span className={styles.badge}>Đã tắt</span>}</td>
                      <td className={styles.muted}>{vnTime(r.last_sent_at)}{r.last_error && <span className={styles.sub} data-i18n-skip>{r.last_error}</span>}</td>
                      <td className={styles.muted}>{r.enabled ? vnTime(r.next_run_at) : "—"}</td>
                      <td className={styles.r}><Link href={r.dashboard_id ? `/editor/${r.dashboard_id}?open=reports` : "/reports#manage"} className={styles.btn}>{r.dashboard_id ? "Mở dashboard" : "Quản lý"}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <NotifyManager kind="reports" />
      </div>
    </AppShell>
  );
}
