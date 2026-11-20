import Link from "next/link";
import { Card } from "@/components/profit/Shared";
import { AppShell } from "../AppShell";
import { ownDashboards, requirePageUser, workspaceIds } from "../page-user";
import styles from "@/components/profit/profit.module.css";

export const dynamic = "force-dynamic";

const EXAMPLES = [
  "Sản phẩm nào đang lỗ nhiều nhất tháng này?",
  "Vẽ biểu đồ lãi theo ngày của Shopee và TikTok Shop",
  "Thêm bộ lọc theo kênh bán",
  "Vì sao doanh thu tuần này giảm so với tuần trước?",
];

/** Hỏi AI: trợ lý nằm trong editor của từng dashboard (đọc số liệu đã gộp của dashboard đó). Trang này chọn dashboard để hỏi. */
export default async function AiPage() {
  const { supabase, user, name } = await requirePageUser();
  const dashboards = await ownDashboards(supabase, await workspaceIds(supabase, user.id));
  return (
    <AppShell userName={name} title="Hỏi AI" desc="Hỏi bằng tiếng Việt về số liệu của bạn. AI trả lời, vẽ biểu đồ và sửa dashboard giúp bạn, mọi thay đổi đều hoàn tác được.">
      <div className={styles.stack}>
        <Card title="Chọn dashboard để hỏi" aside="AI đọc số liệu của dashboard đang mở">
          {dashboards.length === 0 ? (
            <div className={styles.empty}>
              <span>Bạn chưa có dashboard nào. Tạo một dashboard từ mẫu rồi quay lại hỏi AI.</span>
              <Link href="/templates" className={`${styles.btn} ${styles.primary}`}>Chọn mẫu dashboard</Link>
            </div>
          ) : (
            <div className={styles.links}>
              {dashboards.map((d) => (
                <Link key={d.id} href={`/editor/${d.id}?open=ai`} className={styles.linkCard}>
                  <b data-i18n-skip>{d.name}</b>
                  <span>Mở và hỏi AI</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <div className={styles.grid2}>
          <Card title="Bạn có thể hỏi">
            <ul className={styles.listPlain}>{EXAMPLES.map((q) => <li key={q}>{q}</li>)}</ul>
          </Card>
          <Card title="Dữ liệu gửi cho AI">
            <p className={styles.small} style={{ lineHeight: 1.6 }}>Cerno chỉ gửi bản tóm tắt đã gộp số liệu của dashboard và vài dòng mẫu, không gửi toàn bộ dữ liệu. Dữ liệu không được dùng để huấn luyện AI. Xem thêm ở <Link href="/privacy">Chính sách quyền riêng tư</Link>.</p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
