import type { Row } from "@dashboard/chart-engine";
import { COL } from "./canonical";

/**
 * Gộp file mới vào dữ liệu đã có của nguồn "Đơn hàng đa kênh".
 * - Có mã đơn: đơn nào có trong file mới thì bản cũ bị thay hết (trạng thái đơn đổi sau vài ngày nên bản mới đúng hơn),
 *   đơn khác giữ nguyên. Tải chồng khoảng thời gian không bị trùng.
 * - Không có mã đơn: không biết dòng nào trùng dòng nào, nên dữ liệu cũ của CÙNG kênh bị thay bằng file mới.
 * Dữ liệu của kênh khác luôn giữ nguyên.
 */
export function mergeOrders(existing: Row[], incoming: Row[], keyed: boolean): Row[] {
  if (incoming.length === 0) return existing;
  const channels = new Set(incoming.map((r) => r[COL.channel]));
  let kept: Row[];
  if (keyed) {
    const replaced = new Set<string>();
    for (const r of incoming) if (r[COL.orderId] !== null) replaced.add(`${r[COL.channel]}\u0000${r[COL.orderId]}`);
    kept = existing.filter((r) => r[COL.orderId] === null || !replaced.has(`${r[COL.channel]}\u0000${r[COL.orderId]}`));
  } else {
    kept = existing.filter((r) => !channels.has(r[COL.channel]));
  }
  return [...kept, ...incoming];
}
