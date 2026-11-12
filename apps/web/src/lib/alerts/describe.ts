import type { AlertCondition, AlertMetric } from "@dashboard/schema";
import { formatNumber } from "@dashboard/chart-engine";

/** Mô tả luật bằng tiếng Việt cho email và giao diện: "Tổng Doanh thu hôm nay (13/11/2025) thấp hơn 10.000.000". */

const AGG: Record<string, string> = {
  sum: "Tổng", avg: "Trung bình", count: "Số dòng", min: "Nhỏ nhất", max: "Lớn nhất", count_distinct: "Số giá trị khác nhau",
};

/** Tên chỉ số: "Tổng Doanh thu"; trường tính toán (đã tự có phép gộp) chỉ dùng tên. */
export function metricLabel(m: AlertMetric, calcNames: string[] = []): string {
  const b = m.metric;
  if (b.label) return b.label;
  if (calcNames.includes(b.column)) return b.column;
  return `${AGG[b.aggregation ?? "sum"] ?? "Tổng"} ${b.column}`;
}

type Leaf = Exclude<AlertCondition, { type: "per_group" } | { type: "stale" }>;

const OP_TEXT = { lt: "thấp hơn", lte: "thấp hơn hoặc bằng", gt: "cao hơn", gte: "cao hơn hoặc bằng" } as const;
const DIR_TEXT = { up: "tăng", down: "giảm", both: "tăng hoặc giảm" } as const;

function leafSentence(c: Leaf, label: string, windowLabel: string, prevLabel?: string): string {
  const subject = `${label} ${windowLabel}`;
  if (c.type === "threshold") return `${subject} ${OP_TEXT[c.op]} ${formatNumber(c.value)}`;
  if (c.type === "change") {
    const base = prevLabel ?? (c.vs === "prev_year" ? "cùng kỳ năm ngoái" : "kỳ trước");
    return `${subject} ${c.op === "drop_pct" ? "giảm" : "tăng"} từ ${formatNumber(c.value)}% trở lên so với ${base}`;
  }
  return `${subject} ${DIR_TEXT[c.direction ?? "both"]} bất thường so với các kỳ trước cùng loại`;
}

/** Câu mô tả điều kiện của luật. `windowLabel` lấy từ `spanLabel` (vd "hôm nay (13/11/2025)"). */
export function conditionSentence(c: AlertCondition, metric: AlertMetric, windowLabel: string, opts: { calcNames?: string[]; prevLabel?: string } = {}): string {
  if (c.type === "stale") return `Không có dữ liệu mới trong ${formatNumber(c.hours)} giờ`;
  const label = metricLabel(metric, opts.calcNames);
  if (c.type === "per_group") return `Theo từng ${metric.groupBy ?? "nhóm"}: ${leafSentence(c.inner, label, windowLabel, opts.prevLabel)}`;
  return leafSentence(c, label, windowLabel, opts.prevLabel);
}

/** Ngưỡng dạng chữ để hiện cạnh giá trị hiện tại (null với luật không có một ngưỡng đơn lẻ). */
export function thresholdText(c: AlertCondition): string | null {
  const leaf = c.type === "per_group" ? c.inner : c;
  if (leaf.type === "threshold") return `${OP_TEXT[leaf.op]} ${formatNumber(leaf.value)}`;
  if (leaf.type === "change") return `${leaf.op === "drop_pct" ? "giảm" : "tăng"} từ ${formatNumber(leaf.value)}%`;
  return null;
}
