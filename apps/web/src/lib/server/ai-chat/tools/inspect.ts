import type { SourceInfo } from "../sources";
import { ColumnArgs, SampleArgs } from "./args";
import { findColumn, findSource, toRowFilters, typeOf } from "./lookup";
import type { ToolDeps, ToolResult } from "./types";
import { ToolError } from "./util";

/* ------------------------------ column_info / sample_rows ------------------------------ */

export async function columnInfo(raw: unknown, sources: SourceInfo[], deps: ToolDeps): Promise<ToolResult> {
  const a = ColumnArgs.parse(raw);
  const source = findSource(sources, a.source);
  const column = findColumn(source, a.column);
  const r = await deps.query(source.id, { mode: "stats", column, calc: [] });
  if (r.mode !== "stats") throw new ToolError("Không đọc được thống kê cột.");
  const out: Record<string, unknown> = { source: source.alias, column, type: typeOf(source, column), distinct_values: r.distinct.slice(0, 200) };
  if (r.distinct.length >= 200) out.distinct_note = "Có thể còn nhiều giá trị hơn 200.";
  if (r.numeric) out.number_range = r.numeric;
  if (r.date) out.date_range = r.date;
  return { ok: true, content: JSON.stringify(out), status: `Đang xem các giá trị của cột ${column}…` };
}

export async function sampleRows(raw: unknown, sources: SourceInfo[], deps: ToolDeps): Promise<ToolResult> {
  const a = SampleArgs.parse(raw);
  const source = findSource(sources, a.source);
  const filters = toRowFilters(source, a.filters);
  const want = (a.columns ?? []).map((c) => findColumn(source, c));
  const r = await deps.query(source.id, { mode: "raw", limit: a.limit ?? 5, filters, calc: [] });
  if (r.mode !== "raw") throw new ToolError("Không đọc được dòng mẫu.");
  const idx = want.length ? want.map((c) => r.columns.indexOf(c)).filter((i) => i >= 0) : r.columns.slice(0, 10).map((_, i) => i);
  const out = { source: source.alias, matched_rows: r.matched, columns: idx.map((i) => r.columns[i]), rows: r.rows.slice(0, 10).map((row) => idx.map((i) => row[i] ?? null)) };
  return { ok: true, content: JSON.stringify(out), status: "Đang xem vài dòng dữ liệu mẫu…" };
}
