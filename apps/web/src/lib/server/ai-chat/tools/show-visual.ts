import { CHART_SPECS, hasEnoughFields } from "@dashboard/chart-engine";
import { formatDay } from "@dashboard/chart-engine";
import { z } from "@dashboard/schema";
import { MAX_VISUAL_ROWS, VISUAL_CHART_TYPES, type KpiCard, type Visual } from "@/lib/ai-chat/visual";
import type { SourceInfo } from "../sources";
import { Filter, GroupArg, Metric, QueryArgs } from "./args";
import { queryData, type QueryCapture } from "./query-data";
import type { ToolDeps, ToolResult } from "./types";
import { num, r2, ToolError } from "./util";

/* ------------------------------ show_chart / show_kpi ------------------------------ */

const CHART_DEFAULT_ROWS = 12;
const CHART_MAX_ROWS = 40;

const ShowChartArgs = QueryArgs.extend({
  chart_type: z.enum(VISUAL_CHART_TYPES),
  title: z.string().max(120).optional(),
  group_by: z.array(GroupArg).min(1).max(2),
  limit: z.number().int().min(1).max(CHART_MAX_ROWS).optional(),
});
const ShowKpiArgs = z.object({
  source: z.string().max(100),
  title: z.string().max(120).optional(),
  metrics: z.array(Metric).min(1).max(4),
  filters: z.array(Filter).max(8).optional(),
});

const fmtNum = (v: number, lang: "vi" | "en") => new Intl.NumberFormat(lang === "en" ? "en-US" : "vi-VN", { maximumFractionDigits: 2 }).format(v);
const cell = (k: unknown): string | number | null => (k === null || k === undefined ? null : typeof k === "number" || typeof k === "string" ? k : String(k));
const finite = (n: number | undefined): number => (typeof n === "number" && Number.isFinite(n) ? r2(n) : 0);

/** Bảng rút gọn cho model nhận xét (không trả cả JSON dài): tối đa MAX_VISUAL_ROWS dòng. */
function tableText(labels: string[], dimNames: string[], rows: Array<{ keys: unknown[]; values: number[] }>, total: Array<string | number | null> | undefined): string {
  const head = `Cột: ${[...dimNames, ...labels].join(" | ")}`;
  const lines = rows.slice(0, MAX_VISUAL_ROWS).map((r) => `${r.keys.map((k) => (k === null ? "(trống)" : String(k))).join(" / ")}: ${r.values.map((v) => num(v)).join(" | ")}`);
  const more = rows.length > MAX_VISUAL_ROWS ? `\n…(còn ${rows.length - MAX_VISUAL_ROWS} dòng)` : "";
  return `${head}\n${lines.join("\n")}${more}${total ? `\nTổng chung: ${total.join(" | ")}` : ""}`;
}

export async function showChart(raw: unknown, sources: SourceInfo[], deps: ToolDeps): Promise<ToolResult> {
  const a = ShowChartArgs.parse(raw);
  const type = a.chart_type;
  const specDims = a.group_by.length;
  const spec = CHART_SPECS[type];
  const clamped = { dims: a.group_by.slice(0, spec.dims[1]), metrics: a.metrics.slice(0, spec.metrics[1]) };
  if (!hasEnoughFields(type, clamped.dims.length, clamped.metrics.length)) throw new ToolError(`Biểu đồ ${type} cần ít nhất 1 cột nhóm và 1 số đo.`);
  // Có 2 chiều thì chiều thứ hai tách thành nhiều đường/cột nên chỉ dùng số đo đầu tiên.
  const metrics = clamped.dims.length === 2 ? clamped.metrics.slice(0, 1) : clamped.metrics;
  const limit = a.limit ?? CHART_DEFAULT_ROWS;
  let cap: QueryCapture | undefined;
  await queryData({ source: a.source, group_by: clamped.dims, metrics, filters: a.filters, order_by: a.order_by, order: a.order, limit: CHART_MAX_ROWS }, sources, deps, (c) => (cap = c));
  if (!cap) throw new ToolError("Không tính được số liệu cho biểu đồ.");
  const c: QueryCapture = cap;
  if (c.rows.length === 0) throw new ToolError("Không có dữ liệu khớp điều kiện nên không vẽ được biểu đồ. Hãy bỏ bớt bộ lọc hoặc đổi khoảng ngày.");
  // Chuỗi thời gian dài hơn limit: lấy các mốc GẦN NHẤT (dữ liệu đã sắp theo thời gian tăng dần), còn lại lấy các nhóm đứng đầu.
  const shown = c.dateDim ? c.rows.slice(-limit) : c.rows.slice(0, limit);
  const dimLabels = c.dims.map((d) => (d.grain ? `${d.column} (${d.grain})` : d.column));
  const title = a.title?.trim() || `${c.labels[0]}${dimLabels.length ? ` theo ${dimLabels[0]}` : ""}`;
  const visual: Visual = {
    kind: "chart",
    chartType: type,
    title,
    dimLabels: c.dims.map((d) => d.column),
    metricLabels: c.labels,
    rows: shown.map((r) => ({ keys: r.keys.map(cell), values: r.values.map((v) => finite(v)) })),
    ...(c.kinds?.some((k) => k === "date") ? { metricKinds: c.kinds as Array<"date" | "number"> } : {}),
    groups: c.groups,
  };
  const note = specDims > clamped.dims.length || metrics.length < a.metrics.length ? " (loại biểu đồ này chỉ dùng được một phần số đo/chiều đã yêu cầu)" : "";
  const cut = c.groups > shown.length ? ` Chỉ hiện ${shown.length}/${c.groups} nhóm.` : "";
  return {
    ok: true,
    status: "Đang vẽ biểu đồ…",
    visual,
    content: `Đã hiển thị biểu đồ "${title}" cho người dùng trong khung chat${note}.${cut} Số liệu để bạn nhận xét (đừng chép lại cả bảng):\n${tableText(c.labels, dimLabels, shown, c.total?.map((v) => num(v)))}`,
  };
}

export async function showKpi(raw: unknown, sources: SourceInfo[], deps: ToolDeps): Promise<ToolResult> {
  const a = ShowKpiArgs.parse(raw);
  let cap: QueryCapture | undefined;
  await queryData({ source: a.source, metrics: a.metrics, filters: a.filters }, sources, deps, (c) => (cap = c));
  if (!cap) throw new ToolError("Không tính được số liệu cho thẻ KPI.");
  const c: QueryCapture = cap;
  const lang = deps.lang ?? "vi";
  const cards: KpiCard[] = c.labels.map((label, i) => {
    const v = c.total?.[i];
    // Không dòng nào khớp: trung bình/nhỏ nhất... không có nghĩa, hiện "—" thay vì số 0 dễ gây hiểu lầm.
    const value = c.matched > 0 && typeof v === "number" && Number.isFinite(v) ? r2(v) : null;
    const unit = c.units[i];
    const text = value === null ? "—" : c.kinds?.[i] === "date" ? formatDay(value) : `${fmtNum(value, lang)}${unit ? ` ${unit}` : ""}`;
    return { label, value, text };
  });
  const title = a.title?.trim() || undefined;
  return {
    ok: true,
    status: "Đang dựng thẻ KPI…",
    visual: { kind: "kpi", title, cards },
    content: `Đã hiển thị ${cards.length} thẻ KPI cho người dùng trong khung chat (${c.matched} dòng khớp). Giá trị: ${cards.map((k) => `${k.label} = ${k.text}`).join("; ")}. Chỉ nhận xét ngắn, đừng chép lại.`,
  };
}
