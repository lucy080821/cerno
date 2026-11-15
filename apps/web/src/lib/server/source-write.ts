import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Row } from "@dashboard/chart-engine";

const CHUNK = 2000;
/** Số lần ghi song song khi nạp nguồn lớn (đủ nhanh, không dồn dập lên DB). */
const WRITE_CONCURRENCY = 4;

/**
 * Ghi `rows` làm toàn bộ nội dung của nguồn: upsert TẠI CHỖ theo (source_id, row_index) rồi xoá phần dôi ở cuối.
 * Không xoá hết trước nên người đang xem không thấy bảng trống giữa chừng. `db` phải là client service role
 * (bảng source_rows chỉ ghi bằng service role). Ném lỗi nếu có đoạn nào ghi thất bại.
 */
export async function writeSourceRows(db: SupabaseClient, sourceId: string, rows: Row[]): Promise<void> {
  // Ghi từng đoạn, vài đoạn song song (nguồn 200.000 dòng = 100 đoạn: tuần tự sẽ quá chậm).
  const starts: number[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) starts.push(i);
  let next = 0;
  let failure: string | null = null;
  await Promise.all(
    Array.from({ length: Math.min(WRITE_CONCURRENCY, starts.length) }, async () => {
      while (!failure && next < starts.length) {
        const i = starts[next++];
        const chunk = rows.slice(i, i + CHUNK).map((data, j) => ({ source_id: sourceId, row_index: i + j, data }));
        const up = await db.from("source_rows").upsert(chunk, { onConflict: "source_id,row_index" });
        if (up.error) failure = up.error.message;
      }
    }),
  );
  if (failure) throw new Error(failure);
  // Nguồn ngắn lại: bỏ các dòng thừa ở cuối.
  const trim = await db.from("source_rows").delete().eq("source_id", sourceId).gte("row_index", rows.length);
  if (trim.error) throw new Error(trim.error.message);
}
