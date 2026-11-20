import type { SourceRow } from "../dashboards/SourceItem";
import { AppShell } from "../AppShell";
import { requirePageUser, workspaceIds } from "../page-user";
import { TemplatesView } from "./TemplatesView";
import styles from "../dashboards/dashboards.module.css";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const { supabase, user, name } = await requirePageUser();
  const wsIds = await workspaceIds(supabase, user.id);
  const { data } = wsIds.length
    ? await supabase
        .from("data_sources")
        .select("id, name, sheet_name, spreadsheet_id, columns, row_count, last_synced_at, last_error")
        .in("workspace_id", wsIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  return (
    <AppShell userName={name} title="Mẫu dashboard" desc="Chọn một mẫu theo ngành, Cerno tự ghép cột với dữ liệu của bạn rồi tạo dashboard để chỉnh tiếp.">
      <main className={styles.page}>
        <TemplatesView sources={(data ?? []) as SourceRow[]} apiKey={process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? ""} appId={process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? ""} />
      </main>
    </AppShell>
  );
}
