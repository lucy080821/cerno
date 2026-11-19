import Link from "next/link";
import { Card } from "@/components/profit/Shared";
import { AppShell } from "../AppShell";
import { ownDashboards, requirePageUser, workspaceIds } from "../page-user";
import styles from "@/components/profit/profit.module.css";

export const dynamic = "force-dynamic";

/** Đọc tập dashboard_id của một bảng chia sẻ; bảng chưa có (chưa chạy migration) thì trả null. */
async function idsOf(q: PromiseLike<{ data: { dashboard_id: string }[] | null; error: unknown }>): Promise<string[] | null> {
  const { data, error } = await q;
  if (error) return null;
  return (data ?? []).map((r) => r.dashboard_id);
}

/** Chia sẻ và nhúng: dashboard nào đang có link xem, mã nhúng, người được mời. Bật/tắt trong hộp thoại Chia sẻ của editor. */
export default async function SharingPage() {
  const { supabase, user, name } = await requirePageUser();
  const dashboards = await ownDashboards(supabase, await workspaceIds(supabase, user.id));
  const ids = dashboards.map((d) => d.id);
  const [links, embeds, invites] = ids.length
    ? await Promise.all([
        idsOf(supabase.from("dashboard_links").select("dashboard_id").in("dashboard_id", ids)),
        idsOf(supabase.from("dashboard_shares").select("dashboard_id").in("dashboard_id", ids)),
        idsOf(supabase.from("dashboard_access").select("dashboard_id").in("dashboard_id", ids)),
      ])
    : [[], [], []];
  const invited = new Map<string, number>();
  for (const id of invites ?? []) invited.set(id, (invited.get(id) ?? 0) + 1);
  const unavailable = links === null || embeds === null || invites === null;

  return (
    <AppShell active="sharing" userName={name} title="Chia sẻ và nhúng" desc="Gửi link xem không cần đăng nhập, mời đồng nghiệp theo email (xem hoặc sửa), hoặc nhúng dashboard vào website.">
      <div className={styles.stack}>
        {unavailable && <div className={styles.warn}><span>Một số thông tin chia sẻ chưa đọc được: cần chạy migration <code>0007_embed.sql</code> và <code>0008_dashboard_access.sql</code> trên Supabase.</span></div>}
        <Card title="Dashboard của bạn" aside="bấm Chia sẻ để bật link, mời người hoặc lấy mã nhúng">
          {dashboards.length === 0 ? (
            <p className={styles.small}>Bạn chưa có dashboard nào. <Link href="/templates">Tạo dashboard từ mẫu</Link> trước.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Dashboard</th><th>Link xem</th><th>Nhúng website</th><th className={styles.r}>Người được mời</th><th /></tr></thead>
                <tbody>
                  {dashboards.map((d) => (
                    <tr key={d.id}>
                      <td><b data-i18n-skip>{d.name}</b></td>
                      <td>{links?.includes(d.id) ? <span className={`${styles.badge} ${styles.bPos}`}>Đang bật</span> : <span className={styles.badge}>Tắt</span>}</td>
                      <td>{embeds?.includes(d.id) ? <span className={`${styles.badge} ${styles.bPos}`}>Đang bật</span> : <span className={styles.badge}>Tắt</span>}</td>
                      <td className={styles.r}>{invited.get(d.id) ?? 0}</td>
                      <td className={styles.r}><Link href={`/editor/${d.id}?open=share`} className={styles.btn}>Chia sẻ</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className={styles.grid2}>
          <Card title="Link xem">
            <p className={styles.small} style={{ lineHeight: 1.6 }}>Ai có link cũng xem và đổi bộ lọc được, không cần tài khoản, không sửa được. Bạn đổi hoặc tắt link bất kỳ lúc nào, link cũ ngừng hoạt động ngay.</p>
          </Card>
          <Card title="Mời theo email và nhúng website">
            <p className={styles.small} style={{ lineHeight: 1.6 }}>Người được mời đăng nhập bằng Google đúng email để xem hoặc sửa đúng dashboard đó. Mã nhúng chỉ chạy trên các tên miền bạn khai báo.</p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
