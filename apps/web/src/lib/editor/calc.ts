import type { CalculatedField, Dashboard, DataSource } from "@dashboard/schema";
import { compileCalcFields, inferCalcType, type CalcSet } from "@dashboard/chart-engine";
import { useData } from "./data-store";
import { getRows } from "./sample-data";

/** Cột hiển thị trong UI: cột gốc của nguồn, hoặc trường tính toán (`calc` = true). */
export type ColumnInfo = DataSource["columns"][number] & { calc?: boolean; aggregate?: boolean };

let lastKey = "";

/** Nhóm trường tính toán theo nguồn rồi biên dịch; chỉ đẩy vào kho khi có gì đó thật sự đổi. */
export function syncCalc(doc: Pick<Dashboard, "sources" | "calculatedFields">) {
  const sets: Record<string, CalcSet> = {};
  for (const src of doc.sources) {
    const defs = doc.calculatedFields.filter((f) => f.sourceId === src.id);
    if (defs.length) sets[src.id] = compileCalcFields(defs, src.columns.map((c) => c.name));
  }
  const key = JSON.stringify([
    doc.sources.map((s) => [s.id, s.columns.map((c) => c.name)]),
    doc.calculatedFields,
  ]);
  if (key === lastKey) return;
  lastKey = key;
  useData.getState().setCalc(sets);
}

/** Dùng khi mở dashboard khác: đảm bảo lần đồng bộ đầu luôn chạy. */
export function resetCalcSync() {
  lastKey = "";
}

/** Cột của nguồn kèm các trường tính toán hợp lệ (kiểu suy ra từ dữ liệu). Không reactive: kèm useDataVersion(). */
export function columnsWithCalc(doc: Pick<Dashboard, "sources"> & Partial<Pick<Dashboard, "calculatedFields">>, sourceId: string): ColumnInfo[] {
  const src = doc.sources.find((s) => s.id === sourceId);
  if (!src) return [];
  const base: ColumnInfo[] = src.columns;
  const set = useData.getState().calc[sourceId];
  if (!set) return base;
  const rows = getRows(sourceId);
  const extra: ColumnInfo[] = [];
  for (const f of doc.calculatedFields ?? []) {
    if (f.sourceId !== sourceId) continue;
    const name = f.name.trim();
    const compiled = set.aggFields.get(name) ?? set.rowFields.find((x) => x.name === name);
    if (!compiled) continue;
    extra.push({ name, type: inferCalcType(compiled, rows), calc: true, aggregate: compiled.kind === "agg" });
  }
  return [...base, ...extra];
}

/** Cột có thể làm chiều dữ liệu / bộ lọc: loại bỏ trường tổng hợp (chỉ làm số đo được). */
export const nonAggregateColumns = (cols: ColumnInfo[]) => cols.filter((c) => !c.aggregate);

/** Số widget và bộ lọc đang dùng một cột (để cảnh báo trước khi xoá/đổi tên). */
export function countUsage(doc: Dashboard, sourceId: string, column: string): { widgets: number; filters: number } {
  let widgets = 0;
  for (const w of doc.widgets) {
    const c = w.config;
    if (c.kind === "chart" && c.sourceId === sourceId && [...c.dimensions, ...c.metrics].some((b) => b.column === column)) widgets++;
    else if (c.kind === "kpi" && c.sourceId === sourceId && c.metric.column === column) widgets++;
  }
  const filters = doc.filters.filter((f) => f.sourceId === sourceId && f.column === column).length;
  return { widgets, filters };
}

/** Đổi tên cột trong mọi widget và bộ lọc dùng nó (khi người dùng đổi tên trường tính toán). */
export function renameColumnEverywhere(doc: Dashboard, sourceId: string, from: string, to: string): Dashboard {
  if (from === to) return doc;
  const re = (b: { column: string }) => (b.column === from ? { ...b, column: to } : b);
  return {
    ...doc,
    widgets: doc.widgets.map((w) => {
      const c = w.config;
      if (c.kind === "chart" && c.sourceId === sourceId) {
        return { ...w, config: { ...c, dimensions: c.dimensions.map(re), metrics: c.metrics.map(re) } };
      }
      if (c.kind === "kpi" && c.sourceId === sourceId) return { ...w, config: { ...c, metric: re(c.metric) } };
      return w;
    }),
    filters: doc.filters.map((f) => (f.sourceId === sourceId && f.column === from ? { ...f, column: to } : f)),
  };
}

/** Xoá trường khỏi danh sách. Widget/bộ lọc đang dùng nó được giữ nguyên (chart hiện trống cho tới khi đổi trường khác). */
export function removeCalcField(doc: Dashboard, id: string): Dashboard {
  return { ...doc, calculatedFields: doc.calculatedFields.filter((f) => f.id !== id) };
}

export const newCalcId = () => `calc_${Math.random().toString(36).slice(2, 9)}`;

export type { CalculatedField };
