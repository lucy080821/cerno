import type { SupabaseClient } from "@supabase/supabase-js";

/** Số dòng tối đa trả về (khớp giới hạn 20.000 dòng lúc đồng bộ, dư một chút). */
export const MAX_SOURCE_ROWS = 25_000;
const PAGE = 1000; // Supabase giới hạn mặc định 1000 dòng mỗi truy vấn

/** Đọc các dòng đã đồng bộ của một nguồn theo từng trang 1000 dòng. Quyền truy cập do client được truyền vào quyết định. */
export async function fetchSourceRows(
  supabase: SupabaseClient,
  sourceId: string,
  limit: number = MAX_SOURCE_ROWS,
): Promise<{ rows: unknown[]; error?: string }> {
  const rows: unknown[] = [];
  for (let from = 0; from < limit; from += PAGE) {
    const { data, error } = await supabase
      .from("source_rows")
      .select("data")
      .eq("source_id", sourceId)
      .order("row_index")
      .range(from, Math.min(from + PAGE, limit) - 1);
    if (error) return { rows: [], error: error.message };
    for (const r of data) rows.push(r.data);
    if (data.length < Math.min(PAGE, limit - from)) break;
  }
  return { rows };
}
