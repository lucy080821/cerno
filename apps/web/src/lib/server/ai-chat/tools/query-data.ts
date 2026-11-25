import { compileCalcFields, formatDay, type AggregatedRow, type CalcFieldDef, type MetricKind } from "@dashboard/chart-engine";
import type { FieldBinding } from "@dashboard/schema";
import { normalizeText } from "@dashboard/schema";
import type { SourceInfo } from "../sources";
import { QueryArgs } from "./args";
import { findColumn, findSource, toRowFilters, typeOf } from "./lookup";
import type { ToolDeps, ToolResult } from "./types";
import { num, r2, ToolError } from "./util";

/* ------------------------------ query_data ------------------------------ */

const AGG_VI: Record<string, string> = { sum: "Tổng", avg: "Trung bình", count: "Số dòng", min: "Nhỏ nhất", max: "Lớn nhất", count_distinct: "Số giá trị khác nhau" };

/** Số liệu thô của một truy vấn gộp, để công cụ vẽ hình dựng biểu đồ/thẻ từ CÙNG kết quả (không tính lại). */
export interface QueryCapture {
  source: SourceInfo;
  dims: FieldBinding[];
  labels: string[];
  kinds: MetricKind[] | undefined;
  /** Mọi nhóm đã sắp xếp (chưa cắt theo limit). */
  rows: AggregatedRow[];
  /** Tổng chung, đúng cả với trung bình/đếm khác biệt. Không có dòng nào khớp thì undefined. */
  total: number[] | undefined;
  groups: number;
  matched: number;
  dateDim: boolean;
  units: Array<string | null>;
}

export async function queryData(raw: unknown, sources: SourceInfo[], deps: ToolDeps, capture?: (c: QueryCapture) => void): Promise<ToolResult> {
  const a = QueryArgs.parse(raw);
  const source = findSource(sources, a.source);
  const calc: CalcFieldDef[] = [];
  const bindings: FieldBinding[] = [];
  const labels: string[] = [];
  const additive: boolean[] = [];
  a.metrics.forEach((m, i) => {
    if (m.formula) {
      const name = (m.name ?? "").trim() || `Công thức ${i + 1}`;
      calc.push({ id: `f${i}`, name, expression: m.formula });
      bindings.push({ column: name });
      labels.push(name);
      additive.push(false);
    } else if (m.column) {
      const column = findColumn(source, m.column);
      const agg = m.agg ?? "sum";
      const type = typeOf(source, column);
      if ((agg === "sum" || agg === "avg") && type !== "number") throw new ToolError(`Cột "${column}" kiểu ${type ?? "chưa rõ"} không tính ${AGG_VI[agg].toLowerCase()} được; dùng count hoặc count_distinct.`);
      const label = m.name?.trim() || `${AGG_VI[agg]} ${column}`;
      bindings.push({ column, aggregation: agg, label });
      labels.push(label);
      additive.push(agg === "sum" || agg === "count");
    } else {
      throw new ToolError("Mỗi số đo cần column (kèm agg) hoặc formula (kèm name).");
    }
  });
  if (calc.length) {
    const set = compileCalcFields(calc, source.columns.map((c) => c.name));
    if (set.errors.size) throw new ToolError(`Công thức lỗi: ${[...set.errors.entries()].map(([n, e]) => `${n}: ${e}`).join("; ")}`);
    const known = new Set(source.columns.map((c) => c.name));
    for (const c of calc) {
      const agg = set.aggFields.get(c.name);
      if (!agg) throw new ToolError(`Công thức "${c.name}" phải dùng hàm tổng hợp (SUM, AVG, COUNT, COUNT_DISTINCT, MIN, MAX), ví dụ SUM([A])/SUM([B]).`);
      const missing = agg.refs.filter((r) => !known.has(r));
      if (missing.length) throw new ToolError(`Công thức "${c.name}" dùng cột không có trong nguồn ${source.alias}: ${missing.map((m) => `[${m}]`).join(", ")}. Các cột có: ${[...known].slice(0, 60).join("; ")}.`);
    }
  }
  const dims: FieldBinding[] = (a.group_by ?? []).map((g) => {
    const column = findColumn(source, g.column);
    if (typeOf(source, column) === "date" && !g.grain) throw new ToolError(`Cột ngày "${column}" cần grain (day, week, month, quarter, year...) khi nhóm theo.`);
    return { column, ...(g.grain ? { grain: g.grain } : {}) };
  });
  const filters = toRowFilters(source, a.filters);

  const result = await deps.query(source.id, { mode: "aggregate", dims, metrics: bindings, filters, calc });
  if (result.mode !== "aggregate") throw new ToolError("Truy vấn không trả về bảng gộp.");
  const overall = dims.length
    ? await deps.query(source.id, { mode: "aggregate", dims: [], metrics: bindings, filters, calc })
    : result;
  if (overall.mode !== "aggregate") throw new ToolError("Truy vấn không trả về bảng gộp.");

  const kinds = result.table.metricKinds ?? [];
  const fmt = (v: number, i: number) => (kinds[i] === "date" ? formatDay(v) : num(v));
  const total = overall.table.rows[0]?.values.map(fmt) ?? labels.map(() => null);

  // Sắp xếp: mặc định theo số đo đầu tiên giảm dần; chiều ngày thì theo thời gian tăng dần.
  const dateDim = dims.length > 0 && dims.every((d) => typeOf(source, d.column) === "date");
  let sortIdx = 0;
  if (a.order_by !== undefined) {
    const byNum = typeof a.order_by === "number" ? a.order_by - 1 : /^\d$/.test(a.order_by) ? Number(a.order_by) - 1 : -1;
    const byName = typeof a.order_by === "string" ? labels.findIndex((l) => normalizeText(l) === normalizeText(a.order_by as string)) : -1;
    sortIdx = byNum >= 0 && byNum < labels.length ? byNum : byName >= 0 ? byName : 0;
  }
  const rows = [...result.table.rows];
  if (dims.length && a.order_by === undefined && dateDim) rows.sort((x, y) => String(x.keys[0]).localeCompare(String(y.keys[0])));
  else if (dims.length) {
    const dir = a.order === "asc" ? 1 : -1;
    rows.sort((x, y) => dir * ((x.values[sortIdx] ?? 0) - (y.values[sortIdx] ?? 0)));
  }
  const limit = a.limit ?? 20;
  const shown = rows.slice(0, limit);
  const out: Record<string, unknown> = {
    source: source.alias,
    matched_rows: result.matched,
    groups: result.groups,
    shown: shown.length,
    group_columns: dims.map((d) => (d.grain ? `${d.column} (${d.grain})` : d.column)),
    metrics: labels,
    rows: shown.map((r) => [...r.keys.map((k) => (k === null ? "(trống)" : k)), ...r.values.map(fmt)]),
    overall: total,
  };
  if (shown.length < result.groups) out.note = `Chỉ hiện ${shown.length}/${result.groups} nhóm; phần còn lại nằm trong overall.`;
  if (result.truncated) out.warning = "Số nhóm quá lớn nên bị cắt bớt; hãy thu hẹp bằng bộ lọc.";
  const units = bindings.map((b, i) => (calc.some((c) => c.name === b.column) ? null : source.columns.find((c) => c.name === b.column)?.unit ?? (b.aggregation === "count" || b.aggregation === "count_distinct" ? "dòng/giá trị" : null)));
  if (units.some(Boolean)) out.units = units;
  capture?.({ source, dims, labels, kinds: result.table.metricKinds, rows, total: overall.table.rows[0]?.values, groups: result.groups, matched: result.matched, dateDim, units });
  // Tỷ trọng của từng nhóm trong tổng (chỉ với số đo cộng được): AI khỏi tự chia.
  if (dims.length) {
    const shares = labels.map((_, i) => {
      const t = overall.table.rows[0]?.values[i];
      return additive[i] && typeof t === "number" && t !== 0 ? shown.map((r) => r2(((r.values[i] ?? 0) / t) * 100)) : null;
    });
    if (shares.some(Boolean)) out.share_pct = shares;
  }
  return { ok: true, content: JSON.stringify(out), status: `Đang tính ${labels.slice(0, 2).join(", ")}${dims.length ? ` theo ${dims.map((d) => d.column).join(", ")}` : ""}…` };
}
