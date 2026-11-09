/**
 * Các thao tác AI được phép làm lên dashboard (function calling).
 *
 * Mọi tham số từ model đều là dữ liệu không đáng tin: được kiểm bằng zod, kiểm tra cột có tồn tại,
 * giới hạn số lượng/kích thước. Các hàm ở đây thuần tuý (không đụng store) nên test được; việc áp vào
 * store (một bước undo cho cả lượt AI) làm ở chat-store.
 */
import {
  Aggregation,
  ChartFormat,
  Widget,
  resolvePageId,
  widgetsOnPage,
  z,
  type ChartConfig,
  type Dashboard,
  type FieldBinding,
  type Filter,
} from "@dashboard/schema";
import { CHART_SPECS, CHART_TYPE_ORDER, clampFields, hasEnoughFields } from "@dashboard/chart-engine";
import { columnsWithCalc } from "./calc";
import { createWidget, newId, widgetLabel } from "./defaults";
import type { FilterValue } from "./store";

const MAX_WIDGETS = 60;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "màu phải dạng #rrggbb");
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ngày phải dạng yyyy-mm-dd");
const pos = z.number().finite().min(0).max(8000);
const size = z.number().finite().min(24).max(4000);
const Binding = z.object({ column: z.string().max(100), aggregation: Aggregation.optional() });
const ChartKind = z.enum(CHART_TYPE_ORDER as [ChartConfig["chartType"], ...ChartConfig["chartType"][]]);

export const TOOL_SCHEMAS = {
  add_widget: z.object({
    kind: z.union([ChartKind, z.enum(["kpi", "text"])]),
    title: z.string().max(120).optional(),
    dimensions: z.array(z.string().max(100)).max(3).optional(),
    metrics: z.array(Binding).max(6).optional(),
    text: z.string().max(500).optional(),
    x: pos.optional(), y: pos.optional(), w: size.optional(), h: size.optional(),
  }),
  update_widget: z.object({
    id: z.string(),
    title: z.string().max(120).optional(),
    chartType: ChartKind.optional(),
    dimensions: z.array(z.string().max(100)).max(3).optional(),
    metrics: z.array(Binding).max(6).optional(),
    text: z.string().max(500).optional(),
    fontSize: z.number().min(8).max(200).optional(),
    bold: z.boolean().optional(),
    x: pos.optional(), y: pos.optional(), w: size.optional(), h: size.optional(),
    background: hex.optional(),
    radius: z.number().min(0).max(200).optional(),
    border: z.boolean().optional(),
    borderWidth: z.number().min(0).max(20).optional(),
    borderColor: hex.optional(),
    hidden: z.boolean().optional(),
    format: ChartFormat.optional(),
  }),
  delete_widget: z.object({ id: z.string() }),
  add_filter: z.object({
    column: z.string().max(100),
    control: z.enum(["dropdown", "multiselect", "slider", "date_range"]).optional(),
    label: z.string().max(60).optional(),
  }),
  remove_filter: z.object({ id: z.string().optional(), column: z.string().optional() }),
  set_filter_value: z.object({
    column: z.string().max(100),
    values: z.array(z.string().max(200)).max(100).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    from: iso.optional(),
    to: iso.optional(),
    clear: z.boolean().optional(),
  }),
  update_dashboard: z.object({
    name: z.string().max(120).optional(),
    width: z.number().min(320).max(8000).optional(),
    height: z.number().min(240).max(8000).optional(),
    background: hex.optional(),
    themeMode: z.enum(["light", "dark"]).optional(),
  }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export const isToolName = (n: string): n is ToolName => Object.prototype.hasOwnProperty.call(TOOL_SCHEMAS, n);

export interface FilterOp {
  id: string;
  value: FilterValue | null;
}

export interface ActionResult {
  ok: boolean;
  /** Trả lại cho model (có id mới tạo, lý do lỗi). */
  message: string;
  /** Hiện cho người dùng trong khung chat. */
  label: string;
  doc: Dashboard;
  filterOps: FilterOp[];
}

const fail = (doc: Dashboard, label: string, message: string): ActionResult => ({ ok: false, label, message, doc, filterOps: [] });
const ok = (doc: Dashboard, label: string, message: string, filterOps: FilterOp[] = []): ActionResult => ({
  ok: true, label, message, doc, filterOps,
});

const NUMBER_AGG_FREE = new Set(["count", "count_distinct"]);

/** Kiểm tra cột tồn tại (và là cột số nếu dùng làm số đo tổng/TB/min/max). Trả về thông báo lỗi hoặc null. */
function checkColumns(doc: Dashboard, sourceId: string, dims: string[], metrics: FieldBinding[]): string | null {
  const cols = columnsWithCalc(doc, sourceId);
  const names = cols.map((c) => c.name);
  const list = `Các cột có sẵn: ${names.join(", ")}.`;
  for (const d of dims) {
    if (!names.includes(d)) return `Cột "${d}" không tồn tại. ${list}`;
    if (cols.find((c) => c.name === d)?.aggregate) return `"${d}" là trường tổng hợp, chỉ dùng làm số đo, không dùng làm chiều dữ liệu.`;
  }
  for (const m of metrics) {
    const col = cols.find((c) => c.name === m.column);
    if (!col) return `Cột "${m.column}" không tồn tại. ${list}`;
    if (col.type !== "number" && !NUMBER_AGG_FREE.has(m.aggregation ?? "sum")) {
      return `Cột "${m.column}" không phải cột số nên không dùng được với phép "${m.aggregation ?? "sum"}"; chỉ dùng count hoặc count_distinct.`;
    }
  }
  return null;
}

const toBindings = (dims: string[] | undefined): FieldBinding[] | undefined => dims?.map((column) => ({ column }));
const toMetrics = (ms: Array<{ column: string; aggregation?: FieldBinding["aggregation"] }> | undefined): FieldBinding[] | undefined =>
  ms?.map((m) => ({ column: m.column, aggregation: m.aggregation ?? "sum" }));

const AGG_VN: Record<string, string> = {
  sum: "Tổng", avg: "Trung bình", count: "Số dòng", min: "Nhỏ nhất", max: "Lớn nhất", count_distinct: "Số giá trị khác nhau",
};
const autoTitle = (dims: FieldBinding[], metrics: FieldBinding[]) =>
  metrics.length ? `${AGG_VN[metrics[0].aggregation ?? "sum"]} ${metrics[0].column}${dims.length ? ` theo ${dims[0].column}` : ""}` : "";

/** Cắt bớt chiều/số đo thừa theo giới hạn của từng loại chart (bảng không giới hạn chặt). */
const clampFor = (type: ChartConfig["chartType"], dims: FieldBinding[], metrics: FieldBinding[]) => clampFields(type, dims, metrics);

/** Báo lỗi dễ hiểu cho model khi chart chưa đủ ô dữ liệu để vẽ. */
const missingFields = (type: ChartConfig["chartType"], dims: number, metrics: number): string | null => {
  if (hasEnoughFields(type, dims, metrics)) return null;
  const s = CHART_SPECS[type];
  return `Biểu đồ ${s.label} cần ${s.dims[0]} dimension và ít nhất ${s.metrics[0]} metric (đang có ${dims} dimension, ${metrics} metric).`;
};

const bottom = (ws: Widget[]) => ws.reduce((m, w) => Math.max(m, w.y + w.h), 0);
const kindLabel = (t: string) => (CHART_SPECS as Record<string, { label: string }>)[t]?.label.toLowerCase() ?? t;

function addWidget(doc: Dashboard, a: z.infer<typeof TOOL_SCHEMAS.add_widget>, pageId?: string): ActionResult {
  // Widget mới nằm ở trang người dùng đang xem (AI không tự chọn trang).
  const pid = resolvePageId(doc, pageId);
  const onPage = widgetsOnPage(doc, pid);
  if (doc.widgets.length >= MAX_WIDGETS) return fail(doc, "Thêm widget", `Đã đạt giới hạn ${MAX_WIDGETS} widget.`);
  const source = doc.sources[0];
  if (!source && a.kind !== "text") return fail(doc, "Thêm widget", "Dashboard chưa có nguồn dữ liệu.");

  const at = { x: a.x ?? 24, y: a.y ?? (onPage.length ? bottom(onPage) + 24 : 24) };
  const w = createWidget(a.kind, at, source?.id, source?.columns);
  const z = doc.widgets.reduce((m, x) => Math.max(m, x.z), -1) + 1;
  let widget: Widget = { ...w, z, pageId: pid, w: a.w ?? w.w, h: a.h ?? w.h };

  if (a.kind === "text") {
    if (widget.config.kind === "text") widget = { ...widget, config: { ...widget.config, text: a.text ?? a.title ?? "Văn bản" } };
  } else {
    const metrics = toMetrics(a.metrics) ?? [];
    const dims = toBindings(a.dimensions) ?? [];
    if (metrics.length === 0) return fail(doc, "Thêm widget", "Cần chỉ định metrics (cột số + phép tính) cho biểu đồ/bảng/KPI.");
    const err = checkColumns(doc, source.id, dims.map((d) => d.column), metrics);
    if (err) return fail(doc, "Thêm widget", err);

    if (a.kind === "kpi" && widget.config.kind === "kpi") {
      widget = { ...widget, config: { ...widget.config, metric: metrics[0], title: a.title ?? autoTitle([], metrics) } };
    } else if (widget.config.kind === "chart") {
      const c = clampFor(a.kind as ChartConfig["chartType"], dims, metrics);
      const missing = missingFields(a.kind as ChartConfig["chartType"], c.dims.length, c.metrics.length);
      if (missing) return fail(doc, "Thêm widget", missing);
      widget = {
        ...widget,
        config: { ...widget.config, dimensions: c.dims, metrics: c.metrics, title: a.title ?? autoTitle(c.dims, c.metrics) },
      };
    }
  }

  const parsed = Widget.safeParse(widget);
  if (!parsed.success) return fail(doc, "Thêm widget", `Widget không hợp lệ: ${parsed.error.issues[0]?.message}`);

  const needH = widget.y + widget.h + 24;
  const canvas = needH > doc.canvas.height ? { ...doc.canvas, height: Math.min(8000, needH) } : doc.canvas;
  const next = { ...doc, canvas, widgets: [...doc.widgets, parsed.data] };
  const name = widgetLabel(parsed.data);
  return ok(next, `Thêm ${a.kind === "kpi" ? "KPI" : a.kind === "text" ? "văn bản" : `biểu đồ ${kindLabel(a.kind)}`} «${name}»`,
    `Đã thêm widget id="${parsed.data.id}" tại (${widget.x}, ${widget.y}) cỡ ${widget.w}×${widget.h}.`);
}

function updateWidget(doc: Dashboard, a: z.infer<typeof TOOL_SCHEMAS.update_widget>): ActionResult {
  const w = doc.widgets.find((x) => x.id === a.id);
  if (!w) return fail(doc, "Sửa widget", `Không có widget id="${a.id}".`);
  const label = `Sửa «${widgetLabel(w)}»`;
  const geometry = a.x !== undefined || a.y !== undefined || a.w !== undefined || a.h !== undefined;
  if (w.locked && geometry) return fail(doc, label, "Widget đang bị người dùng khoá vị trí, không đổi vị trí/kích thước được.");

  let next: Widget = {
    ...w,
    x: a.x ?? w.x, y: a.y ?? w.y, w: a.w ?? w.w, h: a.h ?? w.h,
    hidden: a.hidden ?? w.hidden,
  };
  if (a.background !== undefined || a.radius !== undefined || a.border !== undefined ||
      a.borderWidth !== undefined || a.borderColor !== undefined) {
    next = {
      ...next,
      style: {
        radius: 12, border: false, ...w.style,
        ...(a.background !== undefined ? { background: a.background } : {}),
        ...(a.radius !== undefined ? { radius: a.radius } : {}),
        ...(a.border !== undefined ? { border: a.border } : {}),
        ...(a.borderWidth !== undefined ? { borderWidth: a.borderWidth } : {}),
        ...(a.borderColor !== undefined ? { borderColor: a.borderColor } : {}),
      },
    };
  }

  const cfg = w.config;
  const chartOnly = a.chartType !== undefined || a.format !== undefined;
  const dataTouched = a.dimensions !== undefined || a.metrics !== undefined;

  if (cfg.kind === "chart") {
    const type = a.chartType ?? cfg.chartType;
    let dims = toBindings(a.dimensions) ?? cfg.dimensions;
    let metrics = toMetrics(a.metrics) ?? cfg.metrics;
    if (dataTouched) {
      const err = checkColumns(doc, cfg.sourceId, dims.map((d) => d.column), metrics);
      if (err) return fail(doc, label, err);
    }
    ({ dims, metrics } = clampFor(type, dims, metrics));
    if (type !== "table" && (dataTouched || a.chartType !== undefined)) {
      const missing = missingFields(type, dims.length, metrics.length);
      if (missing) return fail(doc, label, missing);
    }
    const format: ChartConfig["format"] =
      a.format === undefined ? cfg.format : mergeFormat(cfg.format, a.format);
    // Đổi dữ liệu mà không nói tiêu đề thì tiêu đề cũ dễ sai nghĩa; để nguyên nếu người dùng/AI đã chỉ định.
    next = {
      ...next,
      config: { ...cfg, chartType: type, dimensions: dims, metrics, title: a.title ?? cfg.title, format },
    };
  } else if (cfg.kind === "kpi") {
    if (chartOnly || a.dimensions) return fail(doc, label, "KPI không có loại biểu đồ/định dạng trục/dimension.");
    const m = toMetrics(a.metrics)?.[0];
    if (m) {
      const err = checkColumns(doc, cfg.sourceId, [], [m]);
      if (err) return fail(doc, label, err);
    }
    next = { ...next, config: { ...cfg, metric: m ?? cfg.metric, title: a.title ?? cfg.title } };
  } else if (cfg.kind === "text") {
    if (chartOnly || dataTouched) return fail(doc, label, "Widget văn bản chỉ đổi được text, fontSize, bold, vị trí, khung.");
    next = {
      ...next,
      config: { ...cfg, text: a.text ?? cfg.text, fontSize: a.fontSize ?? cfg.fontSize, bold: a.bold ?? cfg.bold },
    };
  } else if (chartOnly || dataTouched || a.text !== undefined) {
    return fail(doc, label, "Widget ảnh chỉ đổi được vị trí, kích thước, khung.");
  }

  const parsed = Widget.safeParse(next);
  if (!parsed.success) return fail(doc, label, `Giá trị không hợp lệ: ${parsed.error.issues[0]?.message}`);
  return ok({ ...doc, widgets: doc.widgets.map((x) => (x.id === w.id ? parsed.data : x)) }, label, `Đã sửa widget id="${w.id}".`);
}

function mergeFormat(cur: ChartConfig["format"], patch: NonNullable<ChartConfig["format"]>): ChartConfig["format"] {
  const out = { ...cur, ...patch };
  for (const k of ["title", "axis", "dataLabel", "legend"] as const) {
    if (patch[k]) out[k] = { ...cur?.[k], ...patch[k] };
  }
  // Màu series: gộp theo tên, chỉ màu hợp lệ #rrggbb (AI không được nhét chuỗi tuỳ ý vào config).
  if (patch.colors) {
    const valid = Object.fromEntries(Object.entries(patch.colors).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v)));
    out.colors = { ...cur?.colors, ...valid };
  }
  return out;
}

function deleteWidget(doc: Dashboard, a: z.infer<typeof TOOL_SCHEMAS.delete_widget>): ActionResult {
  const w = doc.widgets.find((x) => x.id === a.id);
  if (!w) return fail(doc, "Xoá widget", `Không có widget id="${a.id}".`);
  const label = `Xoá «${widgetLabel(w)}»`;
  if (w.locked) return fail(doc, label, "Widget đang bị người dùng khoá, không xoá được.");
  return ok({ ...doc, widgets: doc.widgets.filter((x) => x.id !== a.id) }, label, `Đã xoá widget id="${a.id}".`);
}

const defaultControl = (type: string | undefined): Filter["control"] =>
  type === "number" ? "slider" : type === "date" ? "date_range" : "multiselect";

function ensureFilter(doc: Dashboard, column: string, control?: Filter["control"], label?: string): { doc: Dashboard; filter: Filter } | string {
  const source = doc.sources[0];
  const cols = source ? columnsWithCalc(doc, source.id) : [];
  const col = cols.find((c) => c.name === column);
  if (!source || !col) return `Cột "${column}" không tồn tại. Các cột có sẵn: ${cols.map((c) => c.name).join(", ")}.`;
  if (col.aggregate) return `"${column}" là trường tổng hợp nên không lọc được.`;
  const existing = doc.filters.find((f) => f.column === column);
  if (existing) return { doc, filter: existing };
  const filter: Filter = { id: `f_${newId().slice(2)}`, sourceId: source.id, column, control: control ?? defaultControl(col.type), ...(label ? { label } : {}) };
  return { doc: { ...doc, filters: [...doc.filters, filter] }, filter };
}

function addFilter(doc: Dashboard, a: z.infer<typeof TOOL_SCHEMAS.add_filter>): ActionResult {
  if (doc.filters.some((f) => f.column === a.column)) return fail(doc, `Thêm bộ lọc ${a.column}`, `Đã có bộ lọc cho cột "${a.column}".`);
  const r = ensureFilter(doc, a.column, a.control, a.label);
  if (typeof r === "string") return fail(doc, `Thêm bộ lọc ${a.column}`, r);
  return ok(r.doc, `Thêm bộ lọc «${a.label || a.column}»`, `Đã thêm bộ lọc id="${r.filter.id}" (${r.filter.control}) cho cột "${a.column}".`);
}

function removeFilter(doc: Dashboard, a: z.infer<typeof TOOL_SCHEMAS.remove_filter>): ActionResult {
  const f = doc.filters.find((x) => x.id === a.id || (a.column !== undefined && x.column === a.column));
  if (!f) return fail(doc, "Xoá bộ lọc", "Không tìm thấy bộ lọc.");
  return ok({ ...doc, filters: doc.filters.filter((x) => x.id !== f.id) }, `Xoá bộ lọc «${f.label || f.column}»`,
    `Đã xoá bộ lọc cột "${f.column}".`, [{ id: f.id, value: null }]);
}

function setFilterValue(doc: Dashboard, a: z.infer<typeof TOOL_SCHEMAS.set_filter_value>): ActionResult {
  const label = `Đặt bộ lọc «${a.column}»`;
  const r = ensureFilter(doc, a.column);
  if (typeof r === "string") return fail(doc, label, r);
  const { filter } = r;

  let value: FilterValue | null = null;
  let desc = "đã bỏ lọc";
  if (!a.clear) {
    if (filter.control === "date_range") {
      if (!a.from && !a.to) return fail(doc, label, 'Bộ lọc ngày cần "from" và/hoặc "to" (yyyy-mm-dd).');
      if (a.from && a.to && a.from > a.to) return fail(doc, label, '"from" phải nhỏ hơn hoặc bằng "to".');
      value = { from: a.from, to: a.to };
      desc = `${a.from ?? "…"} đến ${a.to ?? "…"}`;
    } else if (filter.control === "slider") {
      if (a.min === undefined && a.max === undefined) return fail(doc, label, 'Bộ lọc khoảng số cần "min" và/hoặc "max".');
      value = { min: a.min, max: a.max };
      desc = `${a.min ?? "…"} – ${a.max ?? "…"}`;
    } else {
      if (!a.values?.length) return fail(doc, label, 'Cần "values" (danh sách giá trị) hoặc clear=true.');
      value = { values: filter.control === "dropdown" ? a.values.slice(0, 1) : a.values };
      desc = value.values!.join(", ");
    }
  }
  return ok(r.doc, `${label}: ${desc}`, `Bộ lọc cột "${a.column}": ${desc}.`, [{ id: filter.id, value }]);
}

function updateDashboard(doc: Dashboard, a: z.infer<typeof TOOL_SCHEMAS.update_dashboard>): ActionResult {
  const next: Dashboard = {
    ...doc,
    name: a.name ?? doc.name,
    canvas: {
      ...doc.canvas,
      width: a.width ?? doc.canvas.width,
      height: a.height ?? doc.canvas.height,
      background: a.background ?? doc.canvas.background,
    },
    theme: { ...doc.theme, mode: a.themeMode ?? doc.theme.mode },
  };
  return ok(next, "Sửa cài đặt dashboard", "Đã cập nhật dashboard.");
}

/** Thực thi một lệnh. Không bao giờ ném lỗi: lỗi trả về dưới dạng ok=false để model tự sửa. */
export function applyAiAction(doc: Dashboard, name: string, rawArgs: unknown, pageId?: string): ActionResult {
  if (!isToolName(name)) return fail(doc, name, `Không có công cụ "${name}".`);
  const parsed = TOOL_SCHEMAS[name].safeParse(rawArgs);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(doc, name, `Tham số không hợp lệ (${i?.path.join(".") || "gốc"}): ${i?.message}`);
  }
  const a = parsed.data as never;
  switch (name) {
    case "add_widget": return addWidget(doc, a, pageId);
    case "update_widget": return updateWidget(doc, a);
    case "delete_widget": return deleteWidget(doc, a);
    case "add_filter": return addFilter(doc, a);
    case "remove_filter": return removeFilter(doc, a);
    case "set_filter_value": return setFilterValue(doc, a);
    case "update_dashboard": return updateDashboard(doc, a);
  }
}

export const MAX_TOOL_CALLS_PER_TURN = 15;

/** Áp nhiều lệnh tuần tự lên cùng một bản dashboard. */
export function applyAiActions(doc: Dashboard, calls: Array<{ name: string; args: unknown }>, pageId?: string) {
  let cur = doc;
  const results: ActionResult[] = [];
  calls.slice(0, MAX_TOOL_CALLS_PER_TURN).forEach((c) => {
    const r = applyAiAction(cur, c.name, c.args, pageId);
    cur = r.doc;
    results.push(r);
  });
  for (const c of calls.slice(MAX_TOOL_CALLS_PER_TURN)) {
    results.push(fail(cur, c.name, `Bỏ qua: vượt giới hạn ${MAX_TOOL_CALLS_PER_TURN} lệnh mỗi lượt.`));
  }
  return { doc: cur, results, filterOps: results.flatMap((r) => r.filterOps) };
}
