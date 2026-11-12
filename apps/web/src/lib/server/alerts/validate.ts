import type { AlertCondition, AlertMetric } from "@dashboard/schema";

/**
 * Kiểm một luật cảnh báo với cấu trúc thật của dashboard: nguồn có trong dashboard, mọi cột được dùng có thật, đúng kiểu.
 * Dùng khi tạo/sửa luật và khi kiểm kết quả AI dịch lời mô tả (AI có thể bịa tên cột).
 * Trả danh sách lỗi (rỗng = hợp lệ); lỗi viết cho người dùng đọc.
 */

export interface SourceInfo {
  id: string;
  columns: { name: string; type: string }[];
}

export interface CalcInfo {
  name: string;
  sourceId: string;
}

const NUMERIC_AGG = new Set(["sum", "avg"]);

export function checkRule(
  rule: { metric: AlertMetric; condition: AlertCondition },
  sources: SourceInfo[],
  calc: CalcInfo[],
): string[] {
  const { metric: m, condition } = rule;
  const src = sources.find((s) => s.id === m.sourceId);
  if (!src) return ["Nguồn dữ liệu không thuộc dashboard này."];

  const errors: string[] = [];
  const cols = new Map(src.columns.map((c) => [c.name, c.type]));
  const calcNames = new Set(calc.filter((c) => c.sourceId === m.sourceId).map((c) => c.name));
  const exists = (name: string) => cols.has(name) || calcNames.has(name);

  // Luật "không có dữ liệu mới" chỉ cần nguồn.
  if (condition.type === "stale") return errors;

  const mc = m.metric.column;
  if (!mc) errors.push("Chưa chọn cột cho chỉ số.");
  else if (!exists(mc)) errors.push(`Cột "${mc}" không có trong nguồn dữ liệu.`);
  else if (cols.has(mc)) {
    // Cột thật phải là số khi tính tổng/trung bình (trường tính toán thì engine tự xử lý).
    if (NUMERIC_AGG.has(m.metric.aggregation ?? "sum") && cols.get(mc) !== "number") {
      errors.push(`Cột "${mc}" không phải cột số nên không thể tính tổng hoặc trung bình.`);
    }
  }

  if (m.dateColumn) {
    if (!exists(m.dateColumn)) errors.push(`Cột ngày "${m.dateColumn}" không có trong nguồn dữ liệu.`);
    else if (cols.has(m.dateColumn) && cols.get(m.dateColumn) !== "date") errors.push(`Cột "${m.dateColumn}" không phải cột ngày.`);
  }
  if (m.groupBy && !exists(m.groupBy)) errors.push(`Cột nhóm "${m.groupBy}" không có trong nguồn dữ liệu.`);
  for (const f of m.filters) {
    if (!exists(f.column)) errors.push(`Cột lọc "${f.column}" không có trong nguồn dữ liệu.`);
  }
  return errors;
}

/** Số cột của một nguồn mà luật dùng, để phát hiện khi cột bị đổi tên/xoá sau này (luật chuyển sang trạng thái lỗi). */
export function columnsUsed(m: AlertMetric): string[] {
  return [...new Set([m.metric.column, m.dateColumn, m.groupBy, ...m.filters.map((f) => f.column)].filter((x): x is string => !!x))];
}
