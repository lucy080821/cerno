import { formatDay, compileCalcFields, type CalcFieldDef, type QueryResult, type QuerySpec, type RowFilter } from "@dashboard/chart-engine";
import { FieldBinding, normalizeText, z } from "@dashboard/schema";
import { summarize, type OrderProfit, type ProfitSummary } from "@/lib/profit/order-profit";
import { isIsoDay } from "@/lib/profit/period";
import type { ToolDef } from "../ai/types";
import type { SourceInfo } from "./sources";

/**
 * Công cụ để AI TỰ TRA CỨU số liệu thay vì đoán: mọi con số trong câu trả lời phải đến từ các công cụ này. Chỉ ĐỌC, không sửa gì.
 * Kết quả luôn gọn (tối đa vài chục dòng) và kèm tổng chung để AI tự kiểm tra các phần cộng lại có khớp không.
 * Phụ thuộc bên ngoài (chạy truy vấn, tính lãi) được tiêm vào nên test được mà không cần DB.
 */

export interface ProfitData {
  /** Đơn trong khoảng ngày đã chọn. */
  orders: OrderProfit[];
  summary: ProfitSummary;
  /** Khoảng ngày của TOÀN BỘ dữ liệu. */
  dataMin: string | null;
  dataMax: string | null;
}

export interface ToolDeps {
  query: (sourceId: string, spec: QuerySpec) => Promise<QueryResult>;
  /** Có khi nguồn đơn hàng được chọn; `range` null = toàn bộ thời gian. */
  profit?: (source: SourceInfo, range: { from: string; to: string } | null) => Promise<ProfitData>;
}

export interface ToolResult {
  ok: boolean;
  /** Nội dung trả cho model (JSON gọn hoặc câu báo lỗi bắt đầu bằng "LỖI"). */
  content: string;
  /** Dòng trạng thái ngắn cho người dùng ("Đang tính doanh thu theo kênh..."). */
  status: string;
}

const MAX_CONTENT_CHARS = 9000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : r2(n));

/* ------------------------------ định nghĩa công cụ ------------------------------ */

const SOURCE_PARAM = { type: "string", description: "Tên ngắn của nguồn dữ liệu (s1, s2...) trong danh sách nguồn." };

const FILTER_SCHEMA = {
  type: "array",
  description: "Điều kiện lọc dòng (AND). Cột chữ: values. Cột số: min/max. Cột ngày: from/to dạng yyyy-mm-dd (gồm cả hai đầu).",
  items: {
    type: "object",
    properties: {
      column: { type: "string" },
      values: { type: "array", items: { type: "string" }, description: "Giữ các dòng có giá trị chính xác trong danh sách." },
      min: { type: "number" },
      max: { type: "number" },
      from: { type: "string" },
      to: { type: "string" },
    },
    required: ["column"],
  },
};

export const QUERY_DATA_DEF: ToolDef = {
  type: "function",
  function: {
    name: "query_data",
    description:
      "Tính số liệu gộp từ nguồn dữ liệu: nhóm theo 0-2 cột rồi tính tổng/trung bình/đếm... Trả về bảng kết quả, TỔNG CHUNG đã tính đúng (kể cả trung bình/đếm khác biệt) và số dòng khớp. " +
      "Cột ngày phải kèm grain (day/week/month/quarter/year/weekday...). Muốn tỷ số (ví dụ doanh thu trên mỗi đơn) dùng metric dạng formula, đừng tự chia.",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        group_by: {
          type: "array",
          description: "Tối đa 2 cột nhóm. Bỏ trống = chỉ tính tổng chung.",
          items: { type: "object", properties: { column: { type: "string" }, grain: { type: "string", enum: ["day", "week", "month", "quarter", "year", "month_of_year", "weekday", "hour", "hour_of_day"] } }, required: ["column"] },
        },
        metrics: {
          type: "array",
          description: "1-5 số đo. Mỗi số đo là {column, agg} HOẶC {formula, name}. agg: sum, avg, count, min, max, count_distinct. formula ví dụ SUM([Doanh thu thực])/SUM([Số đơn]) (tên cột trong [ ]).",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              agg: { type: "string", enum: ["sum", "avg", "count", "min", "max", "count_distinct"] },
              formula: { type: "string" },
              name: { type: "string", description: "Tên hiển thị (bắt buộc với formula)." },
            },
          },
        },
        filters: FILTER_SCHEMA,
        order_by: { type: "string", description: "Tên số đo (hoặc số thứ tự 1-5) để sắp xếp; mặc định theo số đo đầu tiên. Cột ngày thì sắp theo thời gian." },
        order: { type: "string", enum: ["desc", "asc"] },
        limit: { type: "integer", description: "Số dòng tối đa trả về (1-50, mặc định 20)." },
      },
      required: ["source", "metrics"],
    },
  },
};

export const COLUMN_INFO_DEF: ToolDef = {
  type: "function",
  function: {
    name: "column_info",
    description: "Xem một cột: các giá trị khác nhau (tối đa 200), khoảng giá trị số, hoặc ngày sớm nhất/muộn nhất. Dùng trước khi lọc để biết giá trị chính xác.",
    parameters: { type: "object", properties: { source: SOURCE_PARAM, column: { type: "string" } }, required: ["source", "column"] },
  },
};

export const SAMPLE_ROWS_DEF: ToolDef = {
  type: "function",
  function: {
    name: "sample_rows",
    description: "Xem tối đa 10 dòng dữ liệu thô (sau khi lọc) để hiểu cấu trúc. Chỉ dùng khi cần, và chọn đúng các cột cần xem.",
    parameters: {
      type: "object",
      properties: { source: SOURCE_PARAM, columns: { type: "array", items: { type: "string" }, description: "Tối đa 10 cột." }, filters: FILTER_SCHEMA, limit: { type: "integer" } },
      required: ["source"],
    },
  },
};

export const PROFIT_REPORT_DEF: ToolDef = {
  type: "function",
  function: {
    name: "profit_report",
    description:
      "Báo cáo LÃI THẬT từ nguồn đơn hàng (đã trừ giá vốn, phí sàn, quảng cáo, ship shop chịu; cùng cách tính với trang Lãi lỗ). Trả tổng (đơn, doanh thu thực, các khoản chi phí, lãi, biên lãi, đơn lỗ, đơn hoàn/hủy) kèm số đơn CHƯA tính được lãi do thiếu giá vốn, và bảng chia theo nhóm.",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        from: { type: "string", description: "Ngày bắt đầu yyyy-mm-dd (gồm cả ngày này). Bỏ trống = từ đầu." },
        to: { type: "string", description: "Ngày kết thúc yyyy-mm-dd (gồm cả ngày này). Bỏ trống = đến cuối." },
        channel: { type: "string", description: "Chỉ tính một kênh (ví dụ Shopee, TikTok Shop). Bỏ trống = mọi kênh." },
        group_by: { type: "string", enum: ["none", "channel", "product", "day", "month", "loss_reason"], description: "Cách chia bảng chi tiết (mặc định none = chỉ tổng)." },
        sort: { type: "string", enum: ["profit_desc", "profit_asc", "revenue_desc"], description: "Sắp xếp khi chia theo product hoặc channel. profit_asc = lỗ nhiều nhất trước." },
        limit: { type: "integer", description: "Số dòng tối đa của bảng chi tiết (1-30, mặc định 15)." },
      },
      required: ["source"],
    },
  },
};

export function toolDefs(sources: SourceInfo[]): ToolDef[] {
  if (!sources.length) return [];
  const defs = [QUERY_DATA_DEF, COLUMN_INFO_DEF, SAMPLE_ROWS_DEF];
  if (sources.some((s) => s.kind === "orders")) defs.push(PROFIT_REPORT_DEF);
  return defs;
}

/* ------------------------------ kiểm tra tham số ------------------------------ */

const Filter = z.object({
  column: z.string().min(1).max(100),
  values: z.array(z.string().max(200)).max(200).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});
type FilterArg = z.infer<typeof Filter>;

const Metric = z.object({
  column: z.string().max(100).optional(),
  agg: z.enum(["sum", "avg", "count", "min", "max", "count_distinct"]).optional(),
  formula: z.string().max(500).optional(),
  name: z.string().max(80).optional(),
});

const QueryArgs = z.object({
  source: z.string().max(100),
  group_by: z.array(z.object({ column: z.string().max(100), grain: z.enum(["day", "week", "month", "quarter", "year", "month_of_year", "weekday", "hour", "hour_of_day"]).optional() })).max(2).optional(),
  metrics: z.array(Metric).min(1).max(5),
  filters: z.array(Filter).max(8).optional(),
  order_by: z.union([z.string().max(100), z.number()]).optional(),
  order: z.enum(["desc", "asc"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const ColumnArgs = z.object({ source: z.string().max(100), column: z.string().min(1).max(100) });
const SampleArgs = z.object({
  source: z.string().max(100),
  columns: z.array(z.string().max(100)).max(10).optional(),
  filters: z.array(Filter).max(8).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});
const ProfitArgs = z.object({
  source: z.string().max(100),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  channel: z.string().max(60).optional(),
  group_by: z.enum(["none", "channel", "product", "day", "month", "loss_reason"]).optional(),
  sort: z.enum(["profit_desc", "profit_asc", "revenue_desc"]).optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

class ToolError extends Error {}
const fail = (message: string, status: string): ToolResult => ({ ok: false, content: `LỖI: ${message}`, status });

/* ------------------------------ tra nguồn và cột ------------------------------ */

function findSource(sources: SourceInfo[], ref: string): SourceInfo {
  const s = sources.find((x) => x.alias === ref.trim().toLowerCase()) ?? sources.find((x) => x.id === ref) ?? sources.find((x) => normalizeText(x.name) === normalizeText(ref));
  if (!s) throw new ToolError(`Không có nguồn "${ref}". Các nguồn đang chọn: ${sources.map((x) => `${x.alias} (${x.name})`).join(", ")}.`);
  return s;
}

/** Tên cột đúng chữ; nếu AI gõ lệch hoa/thường/dấu thì tự sửa; không có thì báo kèm gợi ý để AI thử lại. */
function findColumn(source: SourceInfo, name: string, extra: string[] = []): string {
  const all = [...source.columns.map((c) => c.name), ...extra];
  if (all.includes(name)) return name;
  const key = normalizeText(name);
  const hit = all.find((c) => normalizeText(c) === key);
  if (hit) return hit;
  throw new ToolError(`Nguồn ${source.alias} không có cột "${name}". Các cột có: ${all.slice(0, 60).join("; ")}.`);
}

const typeOf = (source: SourceInfo, column: string) => source.columns.find((c) => c.name === column)?.type;

function toRowFilters(source: SourceInfo, filters: FilterArg[] | undefined): RowFilter[] {
  return (filters ?? []).map((f) => {
    const column = findColumn(source, f.column);
    const type = typeOf(source, column);
    if (f.from !== undefined || f.to !== undefined) {
      if ((f.from && !isIsoDay(f.from)) || (f.to && !isIsoDay(f.to))) throw new ToolError(`Ngày lọc của cột "${column}" phải dạng yyyy-mm-dd.`);
      return { column, values: [], dateRange: { from: f.from, to: f.to } };
    }
    if (f.min !== undefined || f.max !== undefined) {
      if (type !== "number") throw new ToolError(`Cột "${column}" không phải cột số nên không lọc min/max được (kiểu: ${type ?? "chưa rõ"}).`);
      return { column, values: [], range: { min: f.min, max: f.max } };
    }
    if (!f.values?.length) throw new ToolError(`Bộ lọc cột "${column}" cần values, hoặc min/max, hoặc from/to.`);
    return { column, values: f.values };
  });
}

/* ------------------------------ query_data ------------------------------ */

const AGG_VI: Record<string, string> = { sum: "Tổng", avg: "Trung bình", count: "Số dòng", min: "Nhỏ nhất", max: "Lớn nhất", count_distinct: "Số giá trị khác nhau" };

async function queryData(raw: unknown, sources: SourceInfo[], deps: ToolDeps): Promise<ToolResult> {
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

/* ------------------------------ column_info / sample_rows ------------------------------ */

async function columnInfo(raw: unknown, sources: SourceInfo[], deps: ToolDeps): Promise<ToolResult> {
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

async function sampleRows(raw: unknown, sources: SourceInfo[], deps: ToolDeps): Promise<ToolResult> {
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

/* ------------------------------ profit_report ------------------------------ */

interface Agg {
  orders: number;
  valid: number;
  computable: number;
  revenue: number;
  fee: number;
  cost: number;
  ad: number;
  ship: number;
  profit: number;
  loss: number;
}
const emptyAgg = (): Agg => ({ orders: 0, valid: 0, computable: 0, revenue: 0, fee: 0, cost: 0, ad: 0, ship: 0, profit: 0, loss: 0 });

function add(a: Agg, o: OrderProfit) {
  a.orders++;
  if (o.valid) {
    a.valid++;
    a.revenue += o.revenue;
  }
  if (o.profit !== null) {
    a.computable++;
    a.fee += o.fee;
    a.cost += o.cost;
    a.ad += o.adCost;
    a.ship += o.shipCost;
    a.profit += o.profit;
    if (o.profit < 0) a.loss++;
  }
}
const aggRow = (key: string, a: Agg) => ({
  key,
  orders: a.orders,
  valid_orders: a.valid,
  computable_orders: a.computable,
  revenue_net: num(a.revenue),
  fee: num(a.fee),
  cost: num(a.cost),
  ad: num(a.ad),
  ship_cost: num(a.ship),
  profit: num(a.profit),
  loss_orders: a.loss,
});

async function profitReport(raw: unknown, sources: SourceInfo[], deps: ToolDeps): Promise<ToolResult> {
  const a = ProfitArgs.parse(raw);
  const source = findSource(sources, a.source);
  if (source.kind !== "orders") throw new ToolError(`Nguồn ${source.alias} không phải nguồn đơn hàng nên không có báo cáo lãi. Chỉ nguồn "Đơn hàng đa kênh" dùng được profit_report.`);
  if (!deps.profit) throw new ToolError("Báo cáo lãi chưa sẵn sàng.");
  if ((a.from && !isIsoDay(a.from)) || (a.to && !isIsoDay(a.to))) throw new ToolError("from/to phải dạng yyyy-mm-dd.");
  if (a.from && a.to && a.from > a.to) throw new ToolError("from phải trước hoặc bằng to.");
  const range = a.from || a.to ? { from: a.from ?? "2000-01-01", to: a.to ?? "2100-12-31" } : null;
  const data = await deps.profit(source, range);

  let orders = data.orders;
  let summary = data.summary;
  if (a.channel) {
    const ch = normalizeText(a.channel);
    const channels = [...new Set(orders.map((o) => o.channel))];
    const hit = channels.find((c) => normalizeText(c) === ch);
    if (!hit) throw new ToolError(`Không có kênh "${a.channel}" trong khoảng này. Các kênh có: ${channels.join(", ") || "(không có đơn)"}.`);
    orders = orders.filter((o) => o.channel === hit);
    summary = summarize(orders);
  }

  const s = summary;
  const totals = {
    orders: s.orders,
    computable_orders: s.computable,
    missing_cost_orders: s.missingCost,
    revenue_net: num(s.revenue),
    fee: num(s.fee),
    cost: num(s.cost),
    ad: num(s.adCost),
    ship_cost: num(s.shipCost),
    ship_paid_by_customer: num(s.shippingIn),
    profit: num(s.profit),
    margin_pct: s.margin === null ? null : r2(s.margin * 100),
    avg_profit_per_order: num(s.avgProfit),
    profitable_orders: s.profitable,
    loss_orders: s.loss,
    loss_amount: num(s.lossAmount),
    thin_orders: s.thin,
    returned_orders: s.returned,
    cancelled_orders: s.cancelled,
    return_loss: num(s.returnLoss),
    cancel_loss: num(s.cancelLoss),
    fee_estimated_orders: s.feeEstimated,
    ship_estimated_orders: s.shipEstimated,
  };

  const notes: string[] = [
    "Lãi = doanh thu thực + ship khách trả − phí sàn − giá vốn − quảng cáo − ship shop chịu, chỉ tính trên các đơn đủ giá vốn (computable_orders).",
  ];
  if (s.missingCost > 0) notes.push(`${s.missingCost} đơn hợp lệ chưa có giá vốn nên KHÔNG nằm trong tổng lãi: lãi thật có thể khác.`);
  if (s.feeEstimated > 0) notes.push(`${s.feeEstimated} đơn dùng phí sàn ƯỚC TÍNH theo biểu phí (file đơn không có phí).`);
  if (s.shipEstimated > 0) notes.push(`${s.shipEstimated} đơn dùng phí ship shop chịu ƯỚC TÍNH theo mức trung bình người dùng nhập.`);

  const by = a.group_by ?? "none";
  const limit = a.limit ?? 15;
  const sort = a.sort ?? (by === "product" || by === "channel" ? "profit_desc" : undefined);
  let breakdown: unknown = null;
  if (by === "channel" || by === "day" || by === "month") {
    const groups = new Map<string, Agg>();
    for (const o of orders) {
      const key = by === "channel" ? o.channel : o.date ? o.date.slice(0, by === "day" ? 10 : 7) : "(không có ngày)";
      const g = groups.get(key) ?? emptyAgg();
      add(g, o);
      groups.set(key, g);
    }
    let rows = [...groups.entries()].map(([k, g]) => aggRow(k, g));
    if (by === "channel") {
      if (sort === "profit_asc") rows.sort((x, y) => (x.profit ?? 0) - (y.profit ?? 0));
      else if (sort === "revenue_desc") rows.sort((x, y) => (y.revenue_net ?? 0) - (x.revenue_net ?? 0));
      else rows.sort((x, y) => (y.profit ?? 0) - (x.profit ?? 0));
    } else {
      rows.sort((x, y) => x.key.localeCompare(y.key));
      const cap = by === "day" ? 62 : 36;
      if (rows.length > cap) {
        notes.push(`Chỉ hiện ${cap} ${by === "day" ? "ngày" : "tháng"} gần nhất trong ${rows.length}.`);
        rows = rows.slice(-cap);
      }
    }
    breakdown = { by, rows: rows.slice(0, by === "channel" ? 30 : 62) };
  } else if (by === "product") {
    const rows = [...summary.products];
    if (sort === "profit_asc") rows.sort((x, y) => (x.profit ?? Infinity) - (y.profit ?? Infinity));
    else if (sort === "revenue_desc") rows.sort((x, y) => y.revenue - x.revenue);
    else rows.sort((x, y) => (y.profit ?? -Infinity) - (x.profit ?? -Infinity));
    breakdown = {
      by,
      total_products: rows.length,
      rows: rows.slice(0, limit).map((p) => ({
        name: p.name,
        sku: p.sku,
        channels: p.channels,
        quantity: p.quantity,
        orders: p.orders,
        revenue_net: num(p.revenue),
        cost: num(p.cost),
        fee: num(p.fee),
        ad: num(p.adCost),
        ship_cost: num(p.shipCost),
        profit: num(p.profit),
        profit_per_order: num(p.profitPerOrder),
        avg_price: num(p.avgPrice),
        unit_cost: num(p.unitCost),
        break_even_price: num(p.breakEvenPrice),
        cost_missing: p.costMissing,
        orders_waiting_cost: p.missingCostOrders,
      })),
    };
    if (rows.some((p) => p.profit === null)) notes.push("Sản phẩm có profit = null là chưa đủ giá vốn để tính lãi (không phải lãi bằng 0).");
  } else if (by === "loss_reason") {
    breakdown = { by, rows: summary.reasons.map((r) => ({ reason: r.reason, orders: r.orders, amount: num(r.amount) })) };
    notes.push("Lý do lỗ: return = đơn hoàn, cancel = đơn hủy (mất tiền quảng cáo), discount = giảm giá sâu, ads = quảng cáo ăn hết lãi, cost = giá vốn và phí cao hơn giá bán.");
  }

  const out = {
    source: source.alias,
    period: { from: a.from ?? null, to: a.to ?? null, data_first_day: data.dataMin, data_last_day: data.dataMax },
    scope: { channel: a.channel ? orders[0]?.channel ?? a.channel : "tất cả kênh" },
    totals,
    breakdown,
    notes,
  };
  return { ok: true, content: JSON.stringify(out), status: `Đang tính lãi${a.channel ? ` kênh ${a.channel}` : ""}${by !== "none" ? ` theo ${by === "channel" ? "kênh" : by === "product" ? "sản phẩm" : by === "day" ? "ngày" : by === "month" ? "tháng" : "lý do lỗ"}` : ""}…` };
}

/* ------------------------------ chạy công cụ ------------------------------ */

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
