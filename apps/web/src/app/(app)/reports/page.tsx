import Link from "next/link";
import { Card } from "@/components/profit/Shared";
import { scheduleLabel } from "@/lib/notify/format";
import { AppShell } from "../AppShell";
import { ownDashboards, requirePageUser, vnTime, workspaceIds } from "../page-user";
import styles from "@/components/profit/profit.module.css";

export const dynamic = "force-dynamic";

interface SubRow {
  id: string; dashboard_id: string; recipient_email: string; recipient_name: string; enabled: boolean;
  frequency: "daily" | "weekly" | "monthly"; weekday: number | null; month_day: number | null; hour_vn: number;
  next_run_at: string | null; last_sent_at: string | null; last_error: string | null;
}

/** Báo cáo định kỳ qua email của mọi dashboard. Tạo/sửa trong hộp thoại Thông báo của từng dashboard. */
export default async function ReportsPage() {
  const { supabase, user, name } = await requirePageUser();
  const dashboards = await ownDashboards(supabase, await workspaceIds(supabase, user.id));
  const names = new Map(dashboards.map((d) => [d.id, d.name]));
  let subs: SubRow[] = [];
  let unavailable = false;
  if (dashboards.length) {
    const { data, error } = await supabase
      .from("report_subscriptions")
      .select("id, dashboard_id, recipient_email, recipient_name, enabled, frequency, weekday, month_day, hour_vn, next_run_at, last_sent_at, last_error")
      .in("dashboard_id", dashboards.map((d) => d.id))
      .order("created_at", { ascending: false });
    if (error) unavailable = true;
    else subs = (data ?? []) as SubRow[];
  }

  return (
    <AppShell userName={name} title="Báo cáo định kỳ" desc="Cerno gửi email tóm tắt số liệu theo lịch: chỉ số chính, nhóm tăng giảm, ảnh biểu đồ và link mở dashboard.">
      <div className={styles.stack}>
        {unavailable && <div className={styles.warn}><span>Chưa đọc được danh sách báo cáo: cần chạy migration <code>0012_reports_alerts.sql</code> trên Supabase.</span></div>}
        <Card title="Báo cáo đang gửi" aside={subs.length ? `${subs.length} người nhận` : undefined}>
          {subs.length === 0 ? (
            <p className={styles.small}>Chưa có báo cáo nào. Chọn một dashboard bên dưới để đặt lịch gửi báo cáo cho bạn hoặc đồng nghiệp.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Người nhận</th><th>Dashboard</th><th>Lịch gửi</th><th>Lần gửi gần nhất</th><th>Lần gửi tới</th><th /></tr></thead>
                <tbody>
                  {subs.map((r) => (
                    <tr key={r.id}>
                      <td><b data-i18n-skip>{r.recipient_name || r.recipient_email}</b>{r.recipient_name && <span className={styles.sub} data-i18n-skip>{r.recipient_email}</span>}</td>
                      <td data-i18n-skip>{names.get(r.dashboard_id) ?? "—"}</td>
                      <td>{r.enabled ? scheduleLabel(r) : <span className={styles.badge}>Đã tắt</span>}</td>
                      <td className={styles.muted}>{vnTime(r.last_sent_at)}{r.last_error && <span className={styles.sub} data-i18n-skip>{r.last_error}</span>}</td>
                      <td className={styles.muted}>{r.enabled ? vnTime(r.next_run_at) : "—"}</td>
                      <td className={styles.r}><Link href={`/editor/${r.dashboard_id}?open=reports`} className={styles.btn}>Mở</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Đặt lịch báo cáo mới" aside="chọn dashboard muốn gửi">
          {dashboards.length === 0 ? (
            <p className={styles.small}>Bạn chưa có dashboard nào. <Link href="/templates">Tạo dashboard từ mẫu</Link> trước.</p>
          ) : (
            <div className={styles.links}>
              {dashboards.map((d) => (
                <Link key={d.id} href={`/editor/${d.id}?open=reports`} className={styles.linkCard}><b data-i18n-skip>{d.name}</b><span>Đặt lịch báo cáo</span></Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
