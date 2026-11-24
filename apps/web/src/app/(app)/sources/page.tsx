import Link from "next/link";
import { ConnectSheet } from "../dashboards/ConnectSheet";
import { ConnectOrderSheet } from "../dashboards/ConnectOrderSheet";
import { ImportOrders } from "../dashboards/ImportOrders";
import { OrderSheetItem, type OrderSheetRow } from "../dashboards/OrderSheetItem";
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
  // Sheet đơn hàng (migration 0022): chưa chạy migration hoặc lỗi thì coi như chưa nối Sheet nào, trang vẫn dùng được.
  const { data: sheetData } = wsIds.length
    ? await supabase
        .from("order_sheets")
        .select("id, name, channel, sheet_name, last_synced_at, last_error, line_count, order_count, warnings")
        .in("workspace_id", wsIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  const orderSheets = (sheetData ?? []) as OrderSheetRow[];
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";

  return (
    <AppShell userName={name} title="Nguồn dữ liệu" desc={`Tải file đơn hàng từ Shopee, TikTok Shop hoặc nối Google Sheets. Tối đa ${MAX_SOURCES_PER_WORKSPACE} nguồn.`}>
      <main className={styles.page}>
        <section className={sectionClass("source")}>
          <SectionHead
            kind="source"
            title="Nguồn dữ liệu"
            count={sources.length + orderSheets.length}
            desc="Nơi lấy số liệu cho biểu đồ: chọn file Google Sheets (dòng đầu của tab là tên cột), nối Google Sheet đơn hàng của từng sàn (tự cập nhật, dùng cho các trang lãi) hoặc tải file đơn hàng Excel/CSV từ Shopee, TikTok Shop. Dữ liệu được sao về hệ thống, biểu đồ không gọi Google mỗi lần xem."
            actions={
              <div className={styles.row}>
                <ConnectSheet apiKey={apiKey} appId={appId} />
                <ConnectOrderSheet apiKey={apiKey} appId={appId} />
                <ImportOrders />
              </div>
            }
          />
          {sources.length === 0 && orderSheets.length === 0 ? (
            <p className={styles.empty}>Chưa có nguồn nào. Bấm "Chọn Google Sheet", "Nối Google Sheet đơn hàng" hoặc "Tải file đơn hàng" để bắt đầu.</p>
          ) : (
            <ul className={styles.list}>
              {orderSheets.map((s) => <OrderSheetItem key={s.id} sheet={s} />)}
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
