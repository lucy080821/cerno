/**
 * Hình ảnh AI hiện NGAY TRONG tin trả lời của trang Hỏi AI (biểu đồ và thẻ KPI). Dùng chung cho server (dựng từ kết quả truy vấn)
 * và trình duyệt (vẽ). Chỉ chứa số liệu ĐÃ GỘP (vài chục dòng), nên lưu cùng tin nhắn trong `meta.visuals` rất nhẹ.
 */

export const VISUAL_CHART_TYPES = ["bar", "hbar", "stackedbar", "line", "area", "pie"] as const;
export type VisualChartType = (typeof VISUAL_CHART_TYPES)[number];

export type VisualCell = string | number | null;

export interface ChartVisual {
  kind: "chart";
  chartType: VisualChartType;
  title: string;
  dimLabels: string[];
  metricLabels: string[];
  rows: Array<{ keys: VisualCell[]; values: number[] }>;
  /** Có khi số đo là ngày (giá trị = số ngày kể từ 1970), cùng quy ước với bảng gộp của chart-engine. */
  metricKinds?: Array<"date" | "number">;
  /** Tổng số nhóm trước khi cắt, để ghi chú "chỉ hiện N/M nhóm". */
  groups: number;
}

export interface KpiCard {
  label: string;
  value: number | null;
  /** Chữ đã định dạng sẵn (số + đơn vị) để trình duyệt chỉ việc hiện. */
  text: string;
}

export interface KpiVisual {
  kind: "kpi";
  title?: string;
  cards: KpiCard[];
}

export type Visual = ChartVisual | KpiVisual;

/** Mỗi câu trả lời hiện tối đa bấy nhiêu hình (giữ tin nhắn gọn và chi phí thấp). */
export const MAX_VISUALS = 3;
export const MAX_VISUAL_ROWS = 20;

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCell = (v: unknown): v is VisualCell => v === null || isStr(v) || isNum(v);

function parseOne(raw: unknown): Visual | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (v.kind === "kpi") {
    if (!Array.isArray(v.cards) || v.cards.length === 0 || v.cards.length > 6) return null;
    const cards: KpiCard[] = [];
    for (const c of v.cards) {
      const o = c as Record<string, unknown>;
      if (!o || !isStr(o.label) || !isStr(o.text) || !(o.value === null || isNum(o.value))) return null;
      cards.push({ label: o.label.slice(0, 80), value: o.value as number | null, text: o.text.slice(0, 40) });
    }
    return { kind: "kpi", title: isStr(v.title) ? v.title.slice(0, 120) : undefined, cards };
  }
  if (v.kind === "chart") {
    if (!isStr(v.chartType) || !(VISUAL_CHART_TYPES as readonly string[]).includes(v.chartType)) return null;
    if (!isStr(v.title) || !Array.isArray(v.dimLabels) || !Array.isArray(v.metricLabels) || !Array.isArray(v.rows)) return null;
    if (!v.dimLabels.every(isStr) || !v.metricLabels.every(isStr) || v.metricLabels.length === 0 || v.metricLabels.length > 6) return null;
    if (v.rows.length > MAX_VISUAL_ROWS * 3) return null;
    const rows: ChartVisual["rows"] = [];
    for (const r of v.rows) {
      const o = r as Record<string, unknown>;
      if (!o || !Array.isArray(o.keys) || !Array.isArray(o.values)) return null;
      if (!o.keys.every(isCell) || !o.values.every(isNum)) return null;
      rows.push({ keys: o.keys as VisualCell[], values: o.values as number[] });
    }
    const kinds = Array.isArray(v.metricKinds) && v.metricKinds.every((k) => k === "date" || k === "number") ? (v.metricKinds as Array<"date" | "number">) : undefined;
    return {
      kind: "chart",
      chartType: v.chartType as VisualChartType,
      title: v.title.slice(0, 120),
      dimLabels: v.dimLabels as string[],
      metricLabels: v.metricLabels as string[],
      rows,
      ...(kinds ? { metricKinds: kinds } : {}),
      groups: isNum(v.groups) ? v.groups : rows.length,
    };
  }
  return null;
}

/** Đọc `meta.visuals` của một tin nhắn đã lưu: bỏ qua phần không hợp lệ thay vì làm hỏng cả cuộc trò chuyện. */
export function visualsOf(meta: Record<string, unknown> | undefined | null): Visual[] {
  const list = meta?.visuals;
  if (!Array.isArray(list)) return [];
  return list.map(parseOne).filter((v): v is Visual => v !== null).slice(0, MAX_VISUALS);
}

export const parseVisual = parseOne;
