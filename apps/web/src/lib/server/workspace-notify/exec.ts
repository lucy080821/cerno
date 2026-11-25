import "server-only";
import { runQuery, type Row } from "@dashboard/chart-engine";
import { buildOrders } from "@/lib/profit/order-profit";
import { countOrders, enrichOrderRows } from "@/lib/profit/notify-metrics";
import { loadFeeConfig, makeFeeEstimator, makeShipCostEstimator } from "@/lib/server/fees";
import { computeProfit, loadOrderRows } from "@/lib/server/profit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Executor } from "@/lib/server/alerts/compute";

/**
 * Truy vấn dữ liệu đơn hàng đã kèm cột lãi (xem `lib/profit/notify-metrics.ts`) cho cảnh báo và báo cáo theo cửa hàng.
 * Lãi tính bằng ĐÚNG `buildOrders` + cài đặt ước tính phí của các trang lãi (nhớ theo phiên bản dữ liệu), nên số khớp các trang đó.
 * Chỉ gọi SAU khi đã kiểm quyền workspace (đọc bằng service role).
 */

const cache = new WeakMap<Row[], Row[]>();

/** Dòng đã gắn cột lãi của nguồn đơn hàng; nhớ theo mảng dòng gốc nên tự hết hiệu lực khi dữ liệu đổi. */
export async function enrichedOrderRows(workspaceId: string, sourceId: string): Promise<Row[]> {
  const db = createAdminClient();
  const fees = await loadFeeConfig(db, workspaceId);
  const rows = await loadOrderRows(sourceId);
  const hit = cache.get(rows);
  if (hit) return hit;
  let { orders } = await computeProfit(sourceId, fees);
  // Phiên bản dữ liệu có thể vừa đổi giữa hai lần đọc: nếu số đơn lệch thì tính lại trực tiếp trên đúng các dòng đang dùng.
  if (orders.length !== countOrders(rows)) orders = buildOrders(rows, makeFeeEstimator(fees), makeShipCostEstimator(fees));
  const out = enrichOrderRows(rows, orders);
  cache.set(rows, out);
  return out;
}

/** Bộ truy vấn cho luật/báo cáo của một workspace: chỉ đọc nguồn đơn hàng `ordersSourceId` của chính workspace đó. */
export function ordersExecutor(workspaceId: string, ordersSourceId: string): Executor {
  return async (sourceId, spec) => {
    if (sourceId !== ordersSourceId) throw new Error("Nguồn dữ liệu không thuộc cửa hàng này.");
    return runQuery(await enrichedOrderRows(workspaceId, sourceId), spec);
  };
}
