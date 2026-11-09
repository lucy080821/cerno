import type { FieldBinding } from "@dashboard/schema";
import { aggregate, type AggregatedTable, type Cell, type Row } from "./aggregate";
import { applyFilters, type RowFilter } from "./filter";
import { compileCalcFields, materializeRows, type CalcFieldDef } from "./formula";
import { dateBounds, distinctValues, numberRange } from "./stats";

/**
 * Truy vấn dữ liệu một nguồn: chạy trên server khi nguồn có quá nhiều dòng để tải về trình duyệt.
 * Dùng ĐÚNG các hàm lọc/gộp/trường tính toán của trình duyệt (applyFilters, materializeRows, aggregate)
 * nên kết quả giống hệt khi tính tại máy, chỉ khác nơi chạy.
 */

/** Số nhóm tối đa trả về cho một truy vấn gộp (chart thật sự chỉ cần vài chục đến vài trăm). */
export const MAX_RESULT_GROUPS = 5000;
/** Số dòng thô tối đa cho bảng "dữ liệu thô". */
export const MAX_RAW_ROWS = 200;
export const STATS_DISTINCT_LIMIT = 200;

interface Common {
  filters: RowFilter[];
  /** Widget đang hỏi: bộ lọc do chính nó tạo (lọc chéo) hoặc không nhắm tới nó thì bị bỏ qua. */
  selfId?: string;
  /** Trường tính toán của dashboard, áp cho nguồn này. */
  calc: CalcFieldDef[];
}

export type QuerySpec =
  | ({ mode: "aggregate"; dims: FieldBinding[]; metrics: FieldBinding[] } & Common)
  | ({ mode: "raw"; limit: number } & Common)
  | ({ mode: "stats"; column: string } & Omit<Common, "filters" | "selfId">);

export type QueryResult =
  | { mode: "aggregate"; table: AggregatedTable; /** số nhóm đầy đủ trước khi cắt */ groups: number; truncated: boolean; matched: number }
  | { mode: "raw"; columns: string[]; rows: Cell[][]; matched: number }
  | {
      mode: "stats";
      distinct: string[];
      numeric: { min: number; max: number } | null;
      date: { min: string; max: string } | null;
    };

/** Chạy một truy vấn trên danh sách dòng (đã tải vào bộ nhớ). Thuần tuý, không đụng mạng/DB. */
export function runQuery(rows: Row[], spec: QuerySpec): QueryResult {
  const base = rows[0] ? Object.keys(rows[0]) : [];
  const set = compileCalcFields(spec.calc, base);

  // Chỉ tính các cột theo dòng khi truy vấn thật sự dùng tới chúng (tính cho 200.000 dòng không rẻ).
  const used = new Set<string>();
  if (spec.mode === "aggregate") {
    for (const b of [...spec.dims, ...spec.metrics]) {
      used.add(b.column);
      const agg = set.aggFields.get(b.column);
      if (agg) for (const r of agg.refs) used.add(r);
    }
  }
  if (spec.mode === "stats") used.add(spec.column);
  if (spec.mode !== "stats") for (const f of spec.filters) used.add(f.column);
  const needsCalc = spec.mode === "raw" ? set.rowFields.length > 0 : set.rowFields.some((f) => used.has(f.name));
  const data = needsCalc ? materializeRows(rows, set) : rows;

  if (spec.mode === "stats") {
    return {
      mode: "stats",
      distinct: distinctValues(data, spec.column, STATS_DISTINCT_LIMIT),
      numeric: numberRange(data, spec.column),
      date: dateBounds(data, spec.column),
    };
  }

  const filtered = applyFilters(data, spec.filters, spec.selfId);

  if (spec.mode === "raw") {
    const limit = Math.max(1, Math.min(spec.limit, MAX_RAW_ROWS));
    const columns = filtered[0] ? Object.keys(filtered[0]).slice(0, 60) : base.slice(0, 60);
    return {
      mode: "raw",
      columns,
      rows: filtered.slice(0, limit).map((r) => columns.map((c) => r[c] ?? null)),
      matched: filtered.length,
    };
  }

  const table = aggregate(filtered, spec.dims, spec.metrics, set);
  const groups = table.rows.length;
  const truncated = groups > MAX_RESULT_GROUPS;
  return {
    mode: "aggregate",
    table: truncated ? { ...table, rows: table.rows.slice(0, MAX_RESULT_GROUPS) } : table,
    groups,
    truncated,
    matched: filtered.length,
  };
}
