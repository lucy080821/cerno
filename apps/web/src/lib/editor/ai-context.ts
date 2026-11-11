import { getPages, pageIdOf, resolvePageId, widgetsOnPage, type ChartConfig, type Dashboard, type FieldBinding, type Widget } from "@dashboard/schema";
import {
  aggregate, applyFilters, bindingLabel, forecastFailText, formatDay, pivotSeries, planChartForecast, summarizeForecast,
  type AggregatedTable, type MetricKind, type Row,
} from "@dashboard/chart-engine";
import { getRows } from "./sample-data";
import { isRemoteSource, useData } from "./data-store";
import { calcDefsFor, fetchQuery, specForWidget } from "./remote-query";
import { columnsWithCalc } from "./calc";
import { toRowFilters, withGrainOverride } from "./filters";
import type { CrossFilter, FilterValue } from "./store";

/**
 * Ngân sách ngữ cảnh gửi AI. Dịch vụ AI (Groq, gói miễn phí) chỉ cho 8.000 token/phút MỖI MODEL và tính CẢ lời nhắc,
 * định nghĩa công cụ lẫn câu trả lời: một yêu cầu quá lớn bị từ chối hẳn (lỗi 413), không phải chậm đi. Vì vậy ngữ cảnh phải
 * vừa với ngân sách; càng xuống cấp cao càng gọn. Cấp 0 dùng khi không gửi công cụ; cấp cao hơn dùng khi có công cụ
 * (tốn ~1.400 token) hoặc sau khi bị báo quá lớn. Đo thực tế: ~2,4 ký tự mỗi token với ngữ cảnh tiếng Việt (11.000 ký tự ≈ 4.600 token).
 */
export interface ContextBudget {
  /** Số dòng đã gộp tối đa cho mỗi chart. */
  aggRows: number;
  /** Số dòng mẫu của mỗi nguồn / bảng thô. */
  sampleRows: number;
  /** Có thống kê từng cột số không. */
  stats: boolean;
  /** Có gửi cấu hình định dạng chart không (chỉ cần khi AI sắp sửa định dạng). */
  format: boolean;
  /** Giới hạn cứng số ký tự của toàn bộ ngữ cảnh. */
  maxChars: number;
}

export const CONTEXT_LEVELS: ContextBudget[] = [
  { aggRows: 30, sampleRows: 3, stats: true, format: true, maxChars: 11_000 },
  { aggRows: 15, sampleRows: 2, stats: true, format: false, maxChars: 7_500 },
  { aggRows: 8, sampleRows: 1, stats: false, format: false, maxChars: 5_000 },
  { aggRows: 4, sampleRows: 0, stats: false, format: false, maxChars: 3_000 },
];
export const MAX_CONTEXT_LEVEL = CONTEXT_LEVELS.length - 1;

/** Đoán đơn vị từ tên cột khi dữ liệu chưa khai báo. AI vẫn được dặn tự suy luận nếu không khớp. */
function guessUnit(name: string): string | undefined {
  const n = name.toLowerCase();
  if (/%|tỉ lệ|tỷ lệ|rate|ratio/.test(n)) return "%";
  if (/doanh thu|doanh số|revenue|sales|giá|price|chi phí|cost|lợi nhuận|profit|tiền|amount|vnd|đồng/.test(n)) return "đồng";
  if (/đơn|order/.test(n)) return "đơn";
  if (/lượt|view|click|visit|truy cập|impression/.test(n)) return "lượt";
  if (/khách|customer|user|người dùng/.test(n)) return "người";
  return undefined;
}

const unitOf = (col: { name: string; unit?: string } | undefined, column: string) =>
  col?.unit ?? guessUnit(column);

const round = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100);
/** Giá trị số đo cho AI: số đo là ngày (MIN/MAX của cột ngày) thì đưa chuỗi dd/mm/yyyy thay vì số ngày kể từ 1970. */
const val = (n: number, kind?: MetricKind) => (kind === "date" ? formatDay(n) : round(n));

/**
 * Số liệu dự báo cho AI diễn giải (chỉ khi chart bật dự báo). Số do thuật toán thống kê tính sẵn: AI chỉ mô tả, không tính lại.
 * Chỉ gửi đường đầu tiên + tối đa 12 kỳ để tiết kiệm token.
 */
function forecastFacts(cfg: ChartConfig, t: AggregatedTable): Record<string, unknown> | null {
  if (!cfg.format?.forecast) return null;
  const { categories, series } = pivotSeries(t);
  const plan = planChartForecast(cfg, categories, series);
  if (!plan) return null;
  if (!plan.items.length) return { khongDuBaoDuoc: forecastFailText(plan.failures[0] ?? "too_few") };
  const info = summarizeForecast(plan);
  const it = plan.items[0];
  const actual = series[it.index].values.filter((v): v is number => typeof v === "number");
  return {
    ghiChu: "dự báo do thuật toán thống kê tính sẵn; chỉ diễn giải, KHÔNG tự tính lại hay sửa số",
    duong: it.name,
    phuongPhap: plan.options.method,
    mucTinCayPhanTram: Math.round(plan.options.level * 100),
    saiSoKiemChungNguocPhanTram: info.wape === null ? "chưa đủ dữ liệu để kiểm chứng" : Math.round(info.wape * 1000) / 10,
    coMuaVu: info.seasonal,
    kyCuoiChuaTronDaBo: it.result.droppedLast,
    ...(plan.items.length > 1 ? { soDuongDuocDuBao: plan.items.length } : {}),
    ganDay: actual.slice(-6).map(round),
    duBao: it.result.labels.slice(0, 12).map((ky, i) => ({ ky, giaTri: round(it.result.mean[i]), tu: round(it.result.lo[i]), den: round(it.result.hi[i]) })),
  };
}

function widgetRows(doc: Dashboard, w: Widget, fv: Record<string, FilterValue>, cross: CrossFilter[]): Row[] {
  if (w.config.kind !== "chart" && w.config.kind !== "kpi") return [];
  const sourceId = w.config.sourceId;
  const rf = toRowFilters(doc.filters, fv, sourceId);
  return applyFilters(applyFilters(getRows(sourceId), rf, w.id), cross, w.id);
}

/** Đơn vị của một số đo: đếm thì là "dòng"/"giá trị khác nhau", còn lại theo đơn vị của cột. */
function metricUnit(doc: Dashboard, sourceId: string, b: FieldBinding): string | undefined {
  if (b.aggregation === "count") return "dòng";
  if (b.aggregation === "count_distinct") return "giá trị khác nhau";
  const col = columnsWithCalc(doc, sourceId).find((c) => c.name === b.column);
  return unitOf(col, b.column);
}

/**
 * Mô tả widget dùng nguồn LỚN: số liệu do server tính (cùng truy vấn mà widget đang dùng nên thường đã có sẵn trong bộ nhớ).
 * Trình duyệt chỉ có ~500 dòng mẫu của nguồn này, nên tuyệt đối không tính từ dòng mẫu.
 */
async function describeRemoteWidget(
  doc: Dashboard,
  w: Widget,
  base: Record<string, unknown>,
  fv: Record<string, FilterValue>,
  cross: CrossFilter[],
  b: ContextBudget,
) {
  const cfg = w.config;
  if (cfg.kind !== "chart" && cfg.kind !== "kpi") return base;
  const filters = [...toRowFilters(doc.filters, fv, cfg.sourceId), ...cross];
  const q = specForWidget(w, filters, calcDefsFor(doc.calculatedFields, cfg.sourceId));
  if (!q) return { ...base, loai: `chart ${cfg.kind === "chart" ? cfg.chartType : "kpi"}`, tieuDe: cfg.title, ghiChu: "chưa chọn đủ trường dữ liệu" };
  let result;
  try {
    result = await fetchQuery(q.sourceId, q.spec, useData.getState().epoch[q.sourceId] ?? 0);
  } catch {
    return { ...base, loai: cfg.kind === "kpi" ? "KPI" : `chart ${cfg.chartType}`, tieuDe: cfg.title, ghiChu: "chưa lấy được số liệu từ máy chủ" };
  }
  if (cfg.kind === "kpi") {
    const v = result.mode === "aggregate" ? result.table.rows[0]?.values[0] ?? 0 : 0;
    const kind = result.mode === "aggregate" ? result.table.metricKinds?.[0] : undefined;
    return { ...base, loai: "KPI", tieuDe: cfg.title, soDo: bindingLabel(cfg.metric, true), donVi: metricUnit(doc, cfg.sourceId, cfg.metric), giaTri: val(v, kind) };
  }
  if (result.mode === "raw") {
    const cols = result.columns.slice(0, 8);
    return { ...base, loai: "bảng (dữ liệu thô)", tieuDe: cfg.title, soDong: result.matched, cot: cols, dongDau: result.rows.slice(0, b.sampleRows).map((r) => r.slice(0, 8)) };
  }
  if (result.mode !== "aggregate") return base;
  const t = result.table;
  const cut = t.rows.length > b.aggRows;
  const fc = forecastFacts(cfg, t);
  return {
    ...base,
    loai: cfg.chartType === "table" ? "bảng" : `chart ${cfg.chartType}`,
    tieuDe: cfg.title,
    cauHinh: {
      chartType: cfg.chartType,
      dimensions: cfg.dimensions.map((d) => d.column),
      metrics: cfg.metrics.map((m) => ({ column: m.column, aggregation: m.aggregation ?? "sum" })),
      ...(b.format && cfg.format ? { format: cfg.format } : {}),
    },
    cot: [...t.dimLabels, ...t.metricLabels],
    donViSoDo: cfg.metrics.map((m) => `${bindingLabel(m, true)}: ${metricUnit(doc, cfg.sourceId, m) ?? "không rõ"}`),
    dong: t.rows.slice(0, b.aggRows).map((r) => [...r.keys.map(String), ...r.values.map((x, i) => val(x, t.metricKinds?.[i]))]),
    ...(cut || result.truncated ? { ghiChu: `chỉ hiện ${Math.min(t.rows.length, b.aggRows)}/${result.groups} dòng đầu` } : {}),
    ...(fc ? { duBao: fc } : {}),
  };
}

function describeWidget(doc: Dashboard, w0: Widget, selected: boolean, fv: Record<string, FilterValue>, cross: CrossFilter[], b: ContextBudget): Promise<unknown> | unknown {
  const w = withGrainOverride(w0, doc.filters, fv);
  const base = {
    id: w.id,
    ...(selected ? { dangChon: true } : {}),
    viTri: { x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h) },
    ...(w.locked ? { daKhoa: true } : {}),
    ...(w.hidden ? { dangAn: true } : {}),
  };
  const cfg = w.config;
  if (cfg.kind === "text") return { ...base, loai: "văn bản", noiDung: cfg.text.slice(0, 200) };
  if (cfg.kind === "image") return { ...base, loai: "ảnh" };

  if (isRemoteSource(cfg.sourceId)) return describeRemoteWidget(doc, w, base, fv, cross, b);

  const rows = widgetRows(doc, w, fv, cross);
  if (cfg.kind === "kpi") {
    const t = aggregate(rows, [], [cfg.metric], useData.getState().calc[cfg.sourceId]);
    return { ...base, loai: "KPI", tieuDe: cfg.title, soDo: bindingLabel(cfg.metric, true), donVi: metricUnit(doc, cfg.sourceId, cfg.metric), giaTri: val(t.rows[0]?.values[0] ?? 0, t.metricKinds?.[0]) };
  }

  const isRawTable = cfg.chartType === "table" && cfg.dimensions.length === 0 && cfg.metrics.length === 0;
  if (isRawTable) {
    const cols = rows[0] ? Object.keys(rows[0]).slice(0, 8) : [];
    return { ...base, loai: "bảng (dữ liệu thô)", tieuDe: cfg.title, soDong: rows.length, cot: cols, dongDau: rows.slice(0, b.sampleRows).map((r) => cols.map((c) => r[c])) };
  }
  if (cfg.dimensions.length === 0 || cfg.metrics.length === 0) {
    return { ...base, loai: `chart ${cfg.chartType}`, tieuDe: cfg.title, ghiChu: "chưa chọn đủ trường dữ liệu" };
  }
  const t = aggregate(rows, cfg.dimensions, cfg.metrics, useData.getState().calc[cfg.sourceId]);
  const cut = t.rows.length > b.aggRows;
  const fc = forecastFacts(cfg, t);
  return {
    ...base,
    loai: cfg.chartType === "table" ? "bảng" : `chart ${cfg.chartType}`,
    tieuDe: cfg.title,
    cauHinh: {
      chartType: cfg.chartType,
      dimensions: cfg.dimensions.map((d) => d.column),
      metrics: cfg.metrics.map((m) => ({ column: m.column, aggregation: m.aggregation ?? "sum" })),
      ...(b.format && cfg.format ? { format: cfg.format } : {}),
    },
    cot: [...t.dimLabels, ...t.metricLabels],
    donViSoDo: cfg.metrics.map((m) => `${bindingLabel(m, true)}: ${metricUnit(doc, cfg.sourceId, m) ?? "không rõ"}`),
    dong: t.rows.slice(0, b.aggRows).map((r) => [...r.keys.map(String), ...r.values.map((x, i) => val(x, t.metricKinds?.[i]))]),
    ...(cut ? { ghiChu: `chỉ hiện ${b.aggRows}/${t.rows.length} dòng đầu` } : {}),
    ...(fc ? { duBao: fc } : {}),
  };
}

/**
 * Tóm tắt dashboard thành văn bản để gửi cho AI: cấu trúc, bộ lọc đang bật, số liệu đã gộp của từng widget
 * và thống kê từng cột. Cố ý KHÔNG gửi toàn bộ dòng dữ liệu, chỉ vài dòng mẫu.
 */
export async function buildAiContext(
  doc: Dashboard,
  selection: string[],
  filterValues: Record<string, FilterValue>,
  crossFilters: CrossFilter[],
  pageId?: string,
  /** Cấp ngân sách (0 = đầy đủ nhất, cao hơn = gọn hơn). Xem CONTEXT_LEVELS. */
  level = 0,
): Promise<string> {
  const b = CONTEXT_LEVELS[Math.max(0, Math.min(level, MAX_CONTEXT_LEVEL))];
  const sources = doc.sources.map((src) => {
    const rows = getRows(src.id);
    const columns = columnsWithCalc(doc, src.id);
    // Nguồn lớn: ở trình duyệt chỉ có dòng mẫu nên không thống kê cột (sẽ sai); AI dùng số liệu đã gộp của từng widget.
    const remote = isRemoteSource(src.id);
    const stats = (remote || !b.stats ? [] : columns)
      .filter((c) => c.type === "number" && !c.aggregate)
      .map((c) => {
        const vals = rows.map((r) => Number(r[c.name])).filter(Number.isFinite);
        const sum = vals.reduce((a, b) => a + b, 0);
        return { cot: c.name, donVi: unitOf(c, c.name), tong: round(sum), trungBinh: round(vals.length ? sum / vals.length : 0), min: round(Math.min(...vals)), max: round(Math.max(...vals)) };
      });
    return {
      ten: src.type === "sample" ? src.name : src.sheetName,
      soDong: remote ? useData.getState().meta[src.id]?.rowCount ?? rows.length : rows.length,
      ...(remote ? { ghiChu: "nguồn lớn: không có thống kê từng cột, chỉ có số liệu đã gộp của từng widget và vài dòng mẫu" } : {}),
      cot: columns.map((c) => {
        const u = unitOf(c, c.name);
        const f = c.calc ? doc.calculatedFields.find((x) => x.sourceId === src.id && x.name.trim() === c.name) : undefined;
        return `${c.name} (${c.type}${f ? `, trường tính toán = ${f.expression}` : ""}${u ? `, đơn vị: ${u}${c.unit ? "" : " - suy từ tên cột"}` : ""})`;
      }),
      ...(stats.length ? { thongKeCotSo: stats } : {}),
      ...(b.sampleRows > 0 ? { dongMau: rows.slice(0, b.sampleRows) } : {}),
    };
  });

  const activeFilters = [
    ...doc.filters.flatMap((f) => {
      const v = filterValues[f.id];
      if (!v) return [];
      const label = f.label || f.column;
      if (f.control === "date_range") return [`${label}: ${v.from ?? "…"} đến ${v.to ?? "…"}`];
      if (f.control === "grain") return v.values?.length ? [`${label}: xem theo ${v.values[0]}`] : [];
      return f.control === "slider" ? [`${label}: ${v.min ?? "…"} – ${v.max ?? "…"}`] : v.values?.length ? [`${label} = ${v.values.join(", ")}`] : [];
    }),
    ...crossFilters.map((f) => `${f.column} = ${f.values.join(", ")} (lọc chéo)`),
  ];

  // Chỉ mô tả widget của trang đang xem (giữ ngữ cảnh gọn); các trang khác chỉ liệt kê tên và số widget.
  const pid = resolvePageId(doc, pageId);
  const pages = getPages(doc);
  const ordered = widgetsOnPage(doc, pid).filter((w) => !w.hidden).sort((a, b) => a.y - b.y || a.x - b.x);
  const widgets = await Promise.all(ordered.map((w) => describeWidget(doc, w, selection.includes(w.id), filterValues, crossFilters, b)));

  // JSON nén (không thụt dòng) để tốn ít token: hạn mức token/phút của API rất hạn chế.
  const out = JSON.stringify(
    {
      dashboard: doc.name,
      cacTrang: pages.map((p) => ({ ten: p.name, soWidget: doc.widgets.filter((w) => pageIdOf(doc, w) === p.id).length, ...(p.id === pid ? { dangXem: true } : {}) })),
      ghiChuTrang: "widgets bên dưới là của trang đang xem; widget mới luôn được thêm vào trang này",
      trang: { rong: doc.canvas.width, cao: doc.canvas.height, nen: doc.canvas.background, chuDeChart: doc.theme.mode },
      boLocCoSan: doc.filters.map((f) => ({ id: f.id, cot: f.column, kieu: f.control, ...(f.label ? { nhan: f.label } : {}), ...(f.targets?.length ? { apDungCho: f.targets } : {}) })),
      nguonDuLieu: sources, boLocDangBat: activeFilters.length ? activeFilters : "không có", widgets },
  );
  return out.length > b.maxChars ? out.slice(0, b.maxChars) + "\n…(đã cắt bớt vì quá dài)" : out;
}
