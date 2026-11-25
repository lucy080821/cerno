import "server-only";
import { ORDERS_SHEET_NAME, ORDERS_SPREADSHEET_ID } from "@/lib/orders/canonical";
import type { ProfitSummary } from "@/lib/profit/order-profit";
import { shopName } from "@/lib/shell/sidebar";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadFeeConfig } from "@/lib/server/fees";
import { computeProfitRange } from "@/lib/server/profit";
import type { StoreInfo } from "./report-compose";

/** Dữ liệu thật cho báo cáo theo cửa hàng (service role: chỉ gọi từ cron hoặc SAU khi đã kiểm quyền). */

async function ordersSource(workspaceId: string): Promise<{ id: string; lastSyncedAt: string | null } | null> {
  const { data } = await createAdminClient()
    .from("data_sources")
    .select("id, last_synced_at")
    .eq("workspace_id", workspaceId)
    .eq("spreadsheet_id", ORDERS_SPREADSHEET_ID)
    .eq("sheet_name", ORDERS_SHEET_NAME)
    .maybeSingle();
  return data ? { id: data.id as string, lastSyncedAt: (data.last_synced_at as string | null) ?? null } : null;
}

export async function loadStoreInfo(workspaceId: string): Promise<StoreInfo | null> {
  const admin = createAdminClient();
  const { data: ws } = await admin.from("workspaces").select("name, owner_id").eq("id", workspaceId).maybeSingle();
  if (!ws) return null;
  const src = await ordersSource(workspaceId);
  return { id: workspaceId, name: shopName(ws.name as string | null, ""), ownerId: ws.owner_id as string, updatedAt: src?.lastSyncedAt ?? null, hasOrders: !!src };
}

/** Tổng hợp lãi (cùng cách tính và cài đặt ước tính phí với các trang lãi) cho các đơn đặt trong khoảng ngày. */
export async function storeSummarize(workspaceId: string, range: { from: string; to: string }): Promise<ProfitSummary> {
  const src = await ordersSource(workspaceId);
  if (!src) throw new Error("Cửa hàng chưa có dữ liệu đơn hàng.");
  const fees = await loadFeeConfig(createAdminClient(), workspaceId);
  return (await computeProfitRange(src.id, fees, range)).summary;
}
