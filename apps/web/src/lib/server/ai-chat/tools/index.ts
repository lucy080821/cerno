import { z } from "@dashboard/schema";
import type { SourceInfo } from "../sources";
import { columnInfo, sampleRows } from "./inspect";
import { profitReport } from "./profit-report";
import { queryData } from "./query-data";
import { showChart, showKpi } from "./show-visual";
import type { ToolDeps, ToolResult } from "./types";
import { fail, ToolError } from "./util";

/**
 * Công cụ để AI TỰ TRA CỨU số liệu thay vì đoán: mọi con số trong câu trả lời phải đến từ các công cụ này. Chỉ ĐỌC, không sửa gì.
 * Kết quả luôn gọn (tối đa vài chục dòng) và kèm tổng chung để AI tự kiểm tra các phần cộng lại có khớp không.
 * Phụ thuộc bên ngoài (chạy truy vấn, tính lãi) được tiêm vào nên test được mà không cần DB.
 *
 * Mỗi công cụ một file: defs (mô tả cho AI), args (kiểm tham số), lookup (tra nguồn/cột), query-data, inspect, profit-report, show-visual.
 */
export { toolDefs, QUERY_DATA_DEF, COLUMN_INFO_DEF, SAMPLE_ROWS_DEF, PROFIT_REPORT_DEF } from "./defs";
export type { ProfitData, ToolDeps, ToolResult } from "./types";

const MAX_CONTENT_CHARS = 9000;
const clip = (s: string) => (s.length > MAX_CONTENT_CHARS ? `${s.slice(0, MAX_CONTENT_CHARS)}…(đã cắt bớt; hãy thu hẹp bằng bộ lọc hoặc giảm limit)` : s);

/** Chạy một công cụ do AI gọi. Không bao giờ ném lỗi: lỗi trả về dạng "LỖI: ..." để AI sửa tham số rồi gọi lại. */
export async function runTool(name: string, rawArgs: string, sources: SourceInfo[], deps: ToolDeps): Promise<ToolResult> {
  let args: unknown;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return fail("Tham số không phải JSON hợp lệ.", "Công cụ nhận tham số sai, đang thử lại…");
  }
  try {
    let res: ToolResult;
    if (name === "query_data") res = await queryData(args, sources, deps);
    else if (name === "column_info") res = await columnInfo(args, sources, deps);
    else if (name === "sample_rows") res = await sampleRows(args, sources, deps);
    else if (name === "profit_report") res = await profitReport(args, sources, deps);
    else if (name === "show_chart") res = await showChart(args, sources, deps);
    else if (name === "show_kpi") res = await showKpi(args, sources, deps);
    else return fail(`Không có công cụ "${name}".`, "Công cụ không tồn tại.");
    return { ...res, content: clip(res.content) };
  } catch (e) {
    if (e instanceof z.ZodError) {
      const first = e.issues[0];
      return fail(`Tham số sai ở "${first?.path.join(".") || "gốc"}": ${first?.message ?? "không hợp lệ"}.`, "Công cụ nhận tham số sai, đang thử lại…");
    }
    if (e instanceof ToolError) return fail(e.message, "Đang chỉnh lại truy vấn…");
    console.error("[ai-chat] công cụ lỗi:", name, e instanceof Error ? e.message : e);
    return fail("Không tính được số liệu lúc này.", "Không tính được số liệu.");
  }
}
