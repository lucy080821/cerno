import "server-only";
import { ORDERS_SHEET_NAME, ORDERS_SPREADSHEET_ID } from "@/lib/orders/canonical";
import { NOTIFY_CALC, NOTIFY_COLUMNS } from "@/lib/profit/notify-metrics";
import { shopName } from "@/lib/shell/sidebar";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/seo";
import type { AlertCtx } from "@/lib/server/alerts/evaluate";
import { ordersExecutor } from "./exec";

/** Cấu trúc cảnh báo theo cửa hàng: MỘT nguồn "Đơn hàng đa kênh" (cột chuẩn + cột lãi) và các trường tổng hợp dựng sẵn. */
export interface WorkspaceAlertCtx extends AlertCtx {
  workspaceId: string;
  ordersSourceId: string;
}

/** Nguồn đơn hàng của workspace (service role: chỉ gọi SAU khi đã kiểm quyền). null nếu workspace chưa có dữ liệu đơn hàng. */
export async function findOrdersSourceId(workspaceId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("data_sources")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("spreadsheet_id", ORDERS_SPREADSHEET_ID)
    .eq("sheet_name", ORDERS_SHEET_NAME)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function loadWorkspaceAlertCtx(workspaceId: string): Promise<WorkspaceAlertCtx | null> {
  const admin = createAdminClient();
  const { data: ws } = await admin.from("workspaces").select("name, owner_id").eq("id", workspaceId).maybeSingle();
  if (!ws) return null;
  const ordersSourceId = await findOrdersSourceId(workspaceId);
  if (!ordersSourceId) return null;
  return {
    workspaceId,
    ordersSourceId,
    dashboardName: shopName(ws.name as string | null, ""),
    openUrl: `${siteUrl()}/overview`,
    ownerId: ws.owner_id as string,
    sources: [{ id: ordersSourceId, columns: NOTIFY_COLUMNS }],
    calc: NOTIFY_CALC.map((c) => ({ name: c.name, sourceId: ordersSourceId })),
    calcDefs: (sourceId) => (sourceId === ordersSourceId ? NOTIFY_CALC : []),
    exec: ordersExecutor(workspaceId, ordersSourceId),
  };
}
