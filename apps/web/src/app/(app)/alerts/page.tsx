import Link from "next/link";
import { Card } from "@/components/profit/Shared";
import { STATE_LABELS, stateKey } from "@/lib/notify/alert-form";
import { AppShell } from "../AppShell";
import { ownDashboards, requirePageUser, vnTime, workspaceIds } from "../page-user";
import styles from "@/components/profit/profit.module.css";

export const dynamic = "force-dynamic";

interface RuleRow {
  id: string; name: string; dashboard_id: string; enabled: boolean; snooze_until: string | null;
  last_state: "ok" | "firing" | "error" | "insufficient"; last_triggered_at: string | null; last_error: string | null;
}

const TONE: Record<string, string> = { firing: "bNeg", error: "bWarn", ok: "bPos" };

/** Cảnh báo của mọi dashboard: trạng thái, lần báo gần nhất. Tạo/sửa trong hộp thoại Thông báo của từng dashboard. */
export default async function AlertsPage() {
  const { supabase, user, name } = await requirePageUser();
  const dashboards = await ownDashboards(supabase, await workspaceIds(supabase, user.id));
  const names = new Map(dashboards.map((d) => [d.id, d.name]));
  let rules: RuleRow[] = [];
  let unavailable = false;
  if (dashboards.length) {
    const { data, error } = await supabase
      .from("alert_rules")
      .select("id, name, dashboard_id, enabled, snooze_until, last_state, last_triggered_at, last_error")
      .in("dashboard_id", dashboards.map((d) => d.id))
      .order("created_at", { ascending: false });
    if (error) unavailable = true;
    else rules = (data ?? []) as RuleRow[];
  }
  const now = new Date();
  const firing = rules.filter((r) => stateKey(r, now) === "firing").length;

  return (
    <AppShell active="alerts" userName={name} title="Cảnh báo" desc="Nhận email khi số liệu vượt ngưỡng, thay đổi bất thường hoặc không có dữ liệu mới. Cerno kiểm tra sau mỗi lần dữ liệu cập nhật.">
      <div className={styles.stack}>
        {unavailable && <div className={styles.warn}><span>Chưa đọc được danh sách cảnh báo: cần chạy migration <code>0012_reports_alerts.sql</code> trên Supabase.</span></div>}
        <Card title="Cảnh báo của bạn" aside={rules.length ? `${rules.length} cảnh báo · ${firing} đang báo` : undefined}>
          {rules.length === 0 ? (
            <p className={styles.small}>Chưa có cảnh báo nào. Chọn một dashboard bên dưới, mô tả điều bạn muốn được báo (ví dụ "báo khi doanh thu hôm nay dưới 2 triệu"), AI sẽ dựng luật để bạn xác nhận.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Cảnh báo</th><th>Dashboard</th><th>Trạng thái</th><th>Lần báo gần nhất</th><th /></tr></thead>
                <tbody>
                  {rules.map((r) => {
                    const key = stateKey(r, now);
                    return (
                      <tr key={r.id} className={key === "firing" ? styles.lossRow : ""}>
                        <td><b data-i18n-skip>{r.name}</b>{r.last_error && <span className={styles.sub} data-i18n-skip>{r.last_error}</span>}</td>
                        <td data-i18n-skip>{names.get(r.dashboard_id) ?? "—"}</td>
                        <td><span className={`${styles.badge} ${TONE[key] ? styles[TONE[key]] : ""}`}>{STATE_LABELS[key]}</span></td>
                        <td className={styles.muted}>{vnTime(r.last_triggered_at)}</td>
                        <td className={styles.r}><Link href={`/editor/${r.dashboard_id}?open=alerts`} className={styles.btn}>Mở</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Tạo cảnh báo mới" aside="chọn dashboard chứa số liệu cần theo dõi">
          {dashboards.length === 0 ? (
            <p className={styles.small}>Bạn chưa có dashboard nào. <Link href="/templates">Tạo dashboard từ mẫu</Link> trước.</p>
          ) : (
            <div className={styles.links}>
              {dashboards.map((d) => (
                <Link key={d.id} href={`/editor/${d.id}?open=alerts`} className={styles.linkCard}><b data-i18n-skip>{d.name}</b><span>Tạo cảnh báo</span></Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
