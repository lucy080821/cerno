/**
 * Biểu đồ AI vẽ NGAY TRONG KHUNG CHAT (công cụ `show_chart`), rồi người dùng bấm "Thêm vào dashboard" mới thành widget thật.
 *
 * `show_chart` chỉ ĐỌC dữ liệu và tính một bảng đã gộp để hiển thị: không sửa dashboard, nên luôn dùng được kể cả khi tắt
 * "Cho phép AI sửa dashboard". Mọi tham số từ model đều là dữ liệu không đáng tin: kiểm bằng zod, kiểm cột tồn tại,
 * công thức tạm chạy trong trình thông dịch an toàn (không eval) và có giới hạn như trường tính toán thường.
 */
import {
  Aggregation,
  resolvePageId,
  z,
  type ChartConfig,
  type Dashboard,
  type FieldBinding,
} from "@dashboard/schema";
import {
  CHART_SPECS,
  CHART_TYPE_ORDER,
  clampFields,
  compileCalcFields,
  hasEnoughFields,
  inferCalcType,
  materializeRows,
  runQuery,
  type AggregatedTable,
  type CalcFieldDef,
  type QueryResult,
  type QuerySpec,
} from "@dashboard/chart-engine";
import { applyAiAction } from "./ai-actions";
import { newCalcId } from "./calc";
import { isRemoteSource, useData } from "./data-store";
import { toRowFilters } from "./filters";
import { fetchQuery } from "./remote-query";
import { getRawRows } from "./sample-data";
import { useEditor, type FilterValue } from "./store";

const MAX_PREVIEW_GROUPS = 60;
const MAX_TEMP_FIELDS = 3;
const MAX_CALC_FIELDS = 50;

/** Các loại chart vẽ được trong khung chat (bảng thì không: bảng không phải biểu đồ). */
const SHOW_TYPES = CHART_TYPE_ORDER.filter((t) => t !== "table") as [string, ...string[]];

export const ShowChartSchema = z.object({
  chartType: z.enum(SHOW_TYPES),
  title: z.string().max(120).optional(),
  dimensions: z.array(z.string().max(100)).max(2).optional(),
  metrics: z.array(z.object({ column: z.string().max(100), aggregation: Aggregation.optional() })).min(1).max(6),
  /** Trường tính toán TẠM cho biểu đồ này (ví dụ "Tháng" = YEAR_MONTH([Ngày])). Chỉ thành trường thật khi thêm vào dashboard. */
  calculated_fields: z
    .array(z.object({ name: z.string().min(1).max(80), expression: z.string().min(1).max(1000) }))
    .max(MAX_TEMP_FIELDS)
    .optional(),
});
export type ShowChartArgs = z.infer<typeof ShowChartSchema>;

/** Một biểu đồ hiển thị trong khung chat (lưu cùng tin nhắn). */
export interface ChartPreview {
  id: string;
  config: ChartConfig;
  /** Bảng đã gộp (tối đa MAX_PREVIEW_GROUPS nhóm). */
  table: AggregatedTable;
  /** Trường tính toán cần tạo kèm khi thêm vào dashboard (chưa có trong dashboard). */
  newFields: Array<{ name: string; expression: string }>;
  /** Tổng số nhóm trước khi cắt. */
  groups: number;
  /** Có bộ lọc dashboard đang áp lên số liệu này không (để ghi chú dưới biểu đồ). */
  filtered: boolean;
  /** Đã thêm vào dashboard (hiện nút trạng thái thay cho nút thêm). */
  added?: boolean;
}

export interface ShowChartResult {
  ok: boolean;
  /** Trả lại cho model (kèm số liệu rút gọn để nó nhận xét, hoặc lý do lỗi). */
  message: string;
  /** Hiện cho người dùng trong danh sách việc đã làm. */
  label: string;
  chart?: ChartPreview;
}

const fail = (label: string, message: string): ShowChartResult => ({ ok: false, label, message });
let seq = 0;
const chartId = () => `ch${Date.now().toString(36)}${seq++}`;

const AGG_VN: Record<string, string> = {
  sum: "Tổng", avg: "Trung bình", count: "Số dòng", min: "Nhỏ nhất", max: "Lớn nhất", count_distinct: "Số giá trị khác nhau",
};
const autoTitle = (dims: FieldBinding[], metrics: FieldBinding[]) =>
  `${AGG_VN[metrics[0].aggregation ?? "sum"]} ${metrics[0].column}${dims.length ? ` theo ${dims[0].column}` : ""}`;

const round = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100);

/** Bản rút gọn của bảng cho model đọc (để nó nhận xét): tối đa 20 dòng. */
function tableForModel(t: AggregatedTable): string {
  const rows = t.rows.slice(0, 20).map((r) => `${r.keys.map(String).join(" / ")}: ${r.values.map(round).join(" | ")}`);
  const more = t.rows.length > 20 ? `\n…(còn ${t.rows.length - 20} dòng)` : "";
  return `Cột: ${[...t.dimLabels, ...t.metricLabels].join(" | ")}\n${rows.join("\n")}${more}`;
}

/**
 * Tính dữ liệu và dựng biểu đồ xem trước. Không bao giờ ném lỗi: lỗi trả về ok=false để model tự sửa tham số.
 */
export async function runShowChart(
  doc: Dashboard,
  rawArgs: unknown,
  filterValues: Record<string, FilterValue>,
): Promise<ShowChartResult> {
  const label = "Vẽ biểu đồ";
  const parsed = ShowChartSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(label, `Tham số không hợp lệ (${i?.path.join(".") || "gốc"}): ${i?.message}`);
  }
  const a = parsed.data;
  const source = doc.sources[0];
  if (!source) return fail(label, "Dashboard chưa có nguồn dữ liệu.");
  const chartType = a.chartType as ChartConfig["chartType"];

  // Trường tính toán: những trường đã có trong dashboard + trường tạm AI đề xuất.
  const existing = doc.calculatedFields.filter((f) => f.sourceId === source.id);
  const newFields: ChartPreview["newFields"] = [];
  for (const t of a.calculated_fields ?? []) {
    const name = t.name.trim();
    const expression = t.expression.trim();
    const cur = existing.find((f) => f.name.trim() === name);
    if (cur) {
      if (cur.expression.trim() !== expression) {
        return fail(label, `Đã có trường tính toán «${name}» với công thức khác (${cur.expression}). Hãy dùng đúng tên đó hoặc đặt tên khác.`);
      }
      continue;
    }
    if (newFields.some((f) => f.name === name)) return fail(label, `Trùng tên trường tạm «${name}».`);
    newFields.push({ name, expression });
  }
  if (existing.length + newFields.length > MAX_CALC_FIELDS) return fail(label, `Đã đạt giới hạn ${MAX_CALC_FIELDS} trường tính toán.`);

  const calc: CalcFieldDef[] = [
    ...existing.map((f) => ({ id: f.id, name: f.name, expression: f.expression })),
    ...newFields.map((f, i) => ({ id: `tmp_${i}`, name: f.name, expression: f.expression })),
  ];
  const baseNames = source.columns.map((c) => c.name);
  const set = compileCalcFields(calc, baseNames);
  for (const f of newFields) {
    const err = set.errors.get(f.name);
    if (err) return fail(label, `Công thức của «${f.name}» lỗi: ${err} (Tên cột phải viết trong [ ], ví dụ [Ngày].)`);
  }

  // Cột có thể dùng: cột gốc + trường tính toán hợp lệ (kiểu suy ra từ dữ liệu mẫu).
  const raw = getRawRows(source.id);
  const sample = materializeRows(raw.slice(0, 200), set);
  const cols = new Map<string, { type: string; aggregate: boolean }>();
  for (const c of source.columns) cols.set(c.name, { type: c.type, aggregate: false });
  for (const f of [...set.rowFields, ...set.aggFields.values()]) {
    cols.set(f.name, { type: inferCalcType(f, sample), aggregate: f.kind === "agg" });
  }
  const names = [...cols.keys()];
  const list = `Các cột có sẵn: ${names.join(", ")}.`;

  const dims: FieldBinding[] = (a.dimensions ?? []).map((column) => ({ column }));
  const metrics: FieldBinding[] = a.metrics.map((m) => ({ column: m.column, aggregation: m.aggregation ?? "sum" }));
  for (const d of dims) {
    const c = cols.get(d.column);
    if (!c) return fail(label, `Cột "${d.column}" không tồn tại. ${list}`);
    if (c.aggregate) return fail(label, `"${d.column}" là trường tổng hợp, chỉ dùng làm số đo.`);
  }
  for (const m of metrics) {
    const c = cols.get(m.column);
    if (!c) return fail(label, `Cột "${m.column}" không tồn tại. ${list}`);
    if (!c.aggregate && c.type !== "number" && m.aggregation !== "count" && m.aggregation !== "count_distinct") {
      return fail(label, `Cột "${m.column}" không phải cột số nên chỉ dùng được với count hoặc count_distinct.`);
    }
  }
  const c = clampFields(chartType, dims, metrics);
  if (!hasEnoughFields(chartType, c.dims.length, c.metrics.length)) {
    const s = CHART_SPECS[chartType];
    return fail(label, `Biểu đồ ${s.label} cần ${s.dims[0]} dimension và ít nhất ${s.metrics[0]} metric (đang có ${c.dims.length} dimension, ${c.metrics.length} metric).`);
  }

  // Số liệu: chịu bộ lọc dashboard đang bật (giống các widget), không áp lọc chéo.
  const filters = toRowFilters(doc.filters, filterValues, source.id);
  const spec: QuerySpec = { mode: "aggregate", dims: c.dims, metrics: c.metrics, filters, calc };
  let result: QueryResult;
  try {
    result = isRemoteSource(source.id)
      ? await fetchQuery(source.id, spec, useData.getState().epoch[source.id] ?? 0)
      : runQuery(raw, spec);
  } catch (e) {
    return fail(label, `Không lấy được số liệu: ${e instanceof Error ? e.message : "lỗi không rõ"}.`);
  }
  if (result.mode !== "aggregate") return fail(label, "Không tính được số liệu.");

  const table: AggregatedTable = { ...result.table, rows: result.table.rows.slice(0, MAX_PREVIEW_GROUPS) };
  const title = a.title?.trim() || autoTitle(c.dims, c.metrics);
  const chart: ChartPreview = {
    id: chartId(),
    config: { kind: "chart", chartType, sourceId: source.id, dimensions: c.dims, metrics: c.metrics, title },
    table,
    newFields,
    groups: result.groups,
    filtered: filters.length > 0,
  };
  const note = result.groups > MAX_PREVIEW_GROUPS ? ` (chỉ hiện ${MAX_PREVIEW_GROUPS}/${result.groups} nhóm)` : "";
  return {
    ok: true,
    label: `Vẽ biểu đồ ${CHART_SPECS[chartType].label.toLowerCase()} «${title}»`,
    message:
      `Đã hiển thị biểu đồ cho người dùng trong khung chat${note}; người dùng có nút "Thêm vào dashboard". ` +
      `Số liệu của biểu đồ:\n${tableForModel(table)}`,
    chart,
  };
}

/**
 * Thêm biểu đồ đã xem trước vào dashboard: tạo kèm các trường tính toán tạm (nếu có) rồi thêm widget, gộp thành MỘT bước
 * hoàn tác. Trả về thông báo lỗi, hoặc null nếu thành công.
 */
export function addChartToDashboard(preview: ChartPreview): string | null {
  const ed = useEditor.getState();
  const doc = ed.doc;
  const source = doc.sources.find((s) => s.id === preview.config.sourceId);
  if (!source) return "Nguồn dữ liệu của biểu đồ này không còn trong dashboard.";

  let withFields = doc;
  for (const f of preview.newFields) {
    const cur = doc.calculatedFields.find((x) => x.sourceId === source.id && x.name.trim() === f.name);
    if (cur) {
      if (cur.expression.trim() !== f.expression) return `Đã có trường «${f.name}» với công thức khác, không thêm được biểu đồ này.`;
      continue;
    }
    if (withFields.calculatedFields.length >= MAX_CALC_FIELDS) return `Đã đạt giới hạn ${MAX_CALC_FIELDS} trường tính toán.`;
    withFields = {
      ...withFields,
      calculatedFields: [...withFields.calculatedFields, { id: newCalcId(), sourceId: source.id, name: f.name, expression: f.expression }],
    };
  }

  // Cùng một khoá: hai lần mutate dưới đây (trường tính toán, rồi widget) gộp thành một bước Ctrl+Z.
  const key = `ai-chart:${preview.id}`;
  if (withFields !== doc) ed.mutate(() => withFields, key);

  const cfg = preview.config;
  const r = applyAiAction(
    useEditor.getState().doc,
    "add_widget",
    {
      kind: cfg.chartType,
      title: cfg.title,
      dimensions: cfg.dimensions.map((d) => d.column),
      metrics: cfg.metrics.map((m) => ({ column: m.column, aggregation: m.aggregation ?? "sum" })),
    },
    resolvePageId(useEditor.getState().doc, useEditor.getState().pageId),
  );
  if (!r.ok) {
    if (withFields !== doc) useEditor.getState().undo(); // bỏ trường tính toán vừa thêm
    return r.message;
  }
  useEditor.getState().mutate(() => r.doc, key);
  const added = r.doc.widgets[r.doc.widgets.length - 1];
  if (added) useEditor.getState().select([added.id]);
  return null;
}
