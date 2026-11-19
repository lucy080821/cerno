import Link from "next/link";
import { ConnectSheet } from "../dashboards/ConnectSheet";
import { ImportOrders } from "../dashboards/ImportOrders";
import { SourceItem, type SourceRow } from "../dashboards/SourceItem";
import { SectionHead, sectionClass } from "../dashboards/SectionHead";
import { MAX_SOURCES_PER_WORKSPACE } from "@/lib/limits";
import { AppShell } from "../AppShell";
import { requirePageUser, workspaceIds } from "../page-user";
import styles from "../dashboards/dashboards.module.css";

export const dynamic = "force-dynamic";

/** Trang Nguồn dữ liệu: file đơn hàng tải lên và Google Sheets đã nối (trước đây nằm cuối trang Dashboard). */
export default async function SourcesPage() {
  const { supabase, user, name } = await requirePageUser();
  const wsIds = await workspaceIds(supabase, user.id);
  const { data } = wsIds.length
    ? await supabase
        .from("data_sources")
        .select("id, name, sheet_name, spreadsheet_id, columns, row_count, last_synced_at, last_error")
        .in("workspace_id", wsIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  const sources = (data ?? []) as SourceRow[];

  return (
    <AppShell active="sources" userName={name} title="Nguồn dữ liệu" desc={`Tải file đơn hàng từ Shopee, TikTok Shop hoặc nối Google Sheets. Tối đa ${MAX_SOURCES_PER_WORKSPACE} nguồn.`}>
      <main className={styles.page}>
        <section className={sectionClass("source")}>
          <SectionHead
            kind="source"
            title="Nguồn dữ liệu"
            count={sources.length}
            desc="Nơi lấy số liệu cho biểu đồ: chọn file Google Sheets (dòng đầu của tab là tên cột) hoặc tải file đơn hàng Excel/CSV từ Shopee, TikTok Shop. Dữ liệu được sao về hệ thống, biểu đồ không gọi Google mỗi lần xem."
            actions={
              <div className={styles.row}>
                <ConnectSheet apiKey={process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? ""} appId={process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? ""} />
                <ImportOrders />
              </div>
            }
          />
          {sources.length === 0 ? (
            <p className={styles.empty}>Chưa có nguồn nào. Bấm "Chọn Google Sheet" hoặc "Tải file đơn hàng" để bắt đầu.</p>
          ) : (
            <ul className={styles.list}>
              {sources.map((s) => <SourceItem key={s.id} source={s} />)}
            </ul>
          )}
        </section>
        <footer className={styles.legalFoot}>
          <Link href="/privacy">Quyền riêng tư</Link> · <Link href="/terms">Điều khoản</Link>
        </footer>
      </main>
    </AppShell>
  );
}
