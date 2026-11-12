import type { CalculatedField, Widget } from "@dashboard/schema";
import type { RowFilter } from "./filter";
import type { CalcFieldDef } from "./formula";
import { chartFields } from "./option";
import type { QuerySpec } from "./query";

/**
 * Phần thuần của việc biến một widget thành truy vấn gộp. Dùng chung cho editor (nguồn lớn, hỏi server),
 * báo cáo email và cảnh báo (server tự tính) để số liệu mọi nơi khớp đúng số trên dashboard.
 */

/** Trường tính toán của một nguồn, ở dạng gửi lên server. */
export function calcDefsFor(fields: CalculatedField[], sourceId: string): CalcFieldDef[] {
  return fields.filter((f) => f.sourceId === sourceId).map((f) => ({ id: f.id, name: f.name, expression: f.expression }));
}

/** Truy vấn gộp mà widget này cần, hoặc null nếu widget không có số liệu từ nguồn (chưa chọn đủ trường, văn bản, ảnh). */
export function specForWidget(
  widget: Widget,
  filters: RowFilter[],
  calc: CalcFieldDef[],
): { sourceId: string; spec: QuerySpec } | null {
  const cfg = widget.config;
  if (cfg.kind === "kpi") {
    return {
      sourceId: cfg.sourceId,
      spec: { mode: "aggregate", dims: [], metrics: [cfg.metric], filters, selfId: widget.id, calc, ...(cfg.compare ? { compare: cfg.compare } : {}) },
    };
  }
  if (cfg.kind !== "chart") return null;
  if (cfg.chartType === "table") {
    if (cfg.dimensions.length === 0 && cfg.metrics.length === 0) {
      return { sourceId: cfg.sourceId, spec: { mode: "raw", limit: 100, filters, selfId: widget.id, calc } };
    }
    return { sourceId: cfg.sourceId, spec: { mode: "aggregate", dims: cfg.dimensions, metrics: cfg.metrics, filters, selfId: widget.id, calc } };
  }
  const f = chartFields(cfg);
  if (!f) return null;
  return { sourceId: cfg.sourceId, spec: { mode: "aggregate", dims: f.dimensions, metrics: f.metrics, filters, selfId: widget.id, calc } };
}
