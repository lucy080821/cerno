import { AppShell } from "../AppShell";
import { requirePageUser, workspaceIds } from "../page-user";
import { SourcesView } from "./SourcesView";
import type { OrderSheetRow, SourceRow } from "./types";

export const dynamic = "force-dynamic";

/** Trang Nguồn dữ liệu: đọc nguồn và Sheet đơn hàng của workspace (qua RLS) rồi hiển thị bằng SourcesView. */
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
  // Sheet đơn hàng (migration 0022): chưa chạy migration hoặc lỗi thì coi như chưa nối Sheet nào, trang vẫn dùng được.
  const { data: sheetData } = wsIds.length
    ? await supabase
        .from("order_sheets")
        .select("id, name, channel, sheet_name, last_synced_at, last_error, line_count, order_count, warnings")
        .in("workspace_id", wsIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  return (
    <AppShell userName={name} title="Nguồn dữ liệu">
      <SourcesView
        sources={(data ?? []) as SourceRow[]}
        orderSheets={(sheetData ?? []) as OrderSheetRow[]}
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? ""}
        appId={process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? ""}
      />
    </AppShell>
  );
}
