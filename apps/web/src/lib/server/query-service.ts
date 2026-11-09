import "server-only";
import { runQuery, type QueryResult, type QuerySpec } from "@dashboard/chart-engine";
import { getSourceRows, type SourceMeta } from "./row-cache";

/** Kết quả truy vấn đã tính, nhớ theo (nguồn, phiên bản, truy vấn): nhiều người xem cùng dashboard không tính lại. */
const RESULT_CACHE_MAX = 500;
const results = new Map<string, QueryResult>();

/**
 * Chạy truy vấn trên nguồn lớn. Phải gọi SAU khi đã xác thực quyền truy cập `sourceId`
 * (người dùng qua RLS, hoặc mã chia sẻ công khai) vì hàm này đọc bằng service role.
 */
export async function executeQuery(sourceId: string, meta: SourceMeta, spec: QuerySpec): Promise<QueryResult> {
  const key = `${sourceId}|${meta.version}|${JSON.stringify(spec)}`;
  const hit = results.get(key);
  if (hit) {
    // Đưa lên cuối thứ tự (LRU): Map giữ thứ tự chèn.
    results.delete(key);
    results.set(key, hit);
    return hit;
  }
  const rows = await getSourceRows(sourceId, meta);
  const out = runQuery(rows, spec);
  results.set(key, out);
  if (results.size > RESULT_CACHE_MAX) results.delete(results.keys().next().value as string);
  return out;
}
