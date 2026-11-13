import type { AlertCondition, AlertMetric } from "@dashboard/schema";
import { formatNumber } from "@dashboard/chart-engine";

/**
 * Mô tả luật bằng chữ cho email và giao diện: "Tổng Doanh thu hôm nay (13/11/2025) thấp hơn 10.000.000".
 * Mặc định tiếng Việt; truyền `lang: "en"` cho phần tiếng Anh của email song ngữ ("Total Doanh thu today (13/11/2025) is below 10.000.000").
 */

export type DescribeLang = "vi" | "en";

const AGG: Record<DescribeLang, Record<string, string>> = {
  vi: { sum: "Tổng", avg: "Trung bình", count: "Số dòng", min: "Nhỏ nhất", max: "Lớn nhất", count_distinct: "Số giá trị khác nhau" },
  en: { sum: "Total", avg: "Average", count: "Row count", min: "Minimum", max: "Maximum", count_distinct: "Distinct count" },
};

/** Tên chỉ số: "Tổng Doanh thu"; trường tính toán (đã tự có phép gộp) chỉ dùng tên. */
export function metricLabel(m: AlertMetric, calcNames: string[] = [], lang: DescribeLang = "vi"): string {
  const b = m.metric;
  if (b.label) return b.label;
  if (calcNames.includes(b.column)) return b.column;
  return `${AGG[lang][b.aggregation ?? "sum"] ?? AGG[lang].sum} ${b.column}`;
}

type Leaf = Exclude<AlertCondition, { type: "per_group" } | { type: "stale" }>;

const OP_TEXT = {
  vi: { lt: "thấp hơn", lte: "thấp hơn hoặc bằng", gt: "cao hơn", gte: "cao hơn hoặc bằng" },
  en: { lt: "below", lte: "at or below", gt: "above", gte: "at or above" },
} as const;
const DIR_TEXT = { vi: { up: "tăng", down: "giảm", both: "tăng hoặc giảm" }, en: { up: "rose", down: "fell", both: "rose or fell" } } as const;

function leafSentence(c: Leaf, label: string, windowLabel: string, lang: DescribeLang, prevLabel?: string): string {
  const subject = `${label} ${windowLabel}`;
  if (lang === "en") {
    if (c.type === "threshold") return `${subject} is ${OP_TEXT.en[c.op]} ${formatNumber(c.value)}`;
    if (c.type === "change") {
      const base = prevLabel ?? (c.vs === "prev_year" ? "the same period last year" : "the previous period");
      return `${subject} ${c.op === "drop_pct" ? "fell" : "rose"} by ${formatNumber(c.value)}% or more compared with ${base}`;
    }
    return `${subject} ${DIR_TEXT.en[c.direction ?? "both"]} unusually compared with previous periods of the same kind`;
  }
  if (c.type === "threshold") return `${subject} ${OP_TEXT.vi[c.op]} ${formatNumber(c.value)}`;
  if (c.type === "change") {
    const base = prevLabel ?? (c.vs === "prev_year" ? "cùng kỳ năm ngoái" : "kỳ trước");
    return `${subject} ${c.op === "drop_pct" ? "giảm" : "tăng"} từ ${formatNumber(c.value)}% trở lên so với ${base}`;
  }
  return `${subject} ${DIR_TEXT.vi[c.direction ?? "both"]} bất thường so với các kỳ trước cùng loại`;
}

/** Câu mô tả điều kiện của luật. `windowLabel` lấy từ `spanLabel` (vd "hôm nay (13/11/2025)"). */
export function conditionSentence(
  c: AlertCondition, metric: AlertMetric, windowLabel: string,
  opts: { calcNames?: string[]; prevLabel?: string; lang?: DescribeLang } = {},
): string {
  const lang = opts.lang ?? "vi";
  if (c.type === "stale") return lang === "en" ? `No new data for ${formatNumber(c.hours)} hours` : `Không có dữ liệu mới trong ${formatNumber(c.hours)} giờ`;
  const label = metricLabel(metric, opts.calcNames, lang);
  if (c.type === "per_group") {
    return `${lang === "en" ? "Per" : "Theo từng"} ${metric.groupBy ?? (lang === "en" ? "group" : "nhóm")}: ${leafSentence(c.inner, label, windowLabel, lang, opts.prevLabel)}`;
  }
  return leafSentence(c, label, windowLabel, lang, opts.prevLabel);
}

/** Ngưỡng dạng chữ để hiện cạnh giá trị hiện tại (null với luật không có một ngưỡng đơn lẻ). */
export function thresholdText(c: AlertCondition, lang: DescribeLang = "vi"): string | null {
  const leaf = c.type === "per_group" ? c.inner : c;
  if (leaf.type === "threshold") return `${OP_TEXT[lang][leaf.op]} ${formatNumber(leaf.value)}`;
  if (leaf.type === "change") {
    const drop = leaf.op === "drop_pct";
    return lang === "en" ? `${drop ? "drop" : "rise"} of ${formatNumber(leaf.value)}% or more` : `${drop ? "giảm" : "tăng"} từ ${formatNumber(leaf.value)}%`;
  }
  return null;
}
