import type { ChartConfig, FieldBinding, TextStyle } from "@dashboard/schema";
import { aggregate, bindingLabel, type AggregatedTable, type Row } from "./aggregate";
import type { CalcSet } from "./formula";
import { formatByKind, formatCompact, formatCompactByKind, formatDay, formatNumber, type MetricKind } from "./format";
import { CHART_SPECS, hasEnoughFields } from "./chartTypes";
import { linearRegression, trendOf } from "./trend";
import { planChartForecast } from "./forecastChart";

export interface ChartTheme {
  palette: string[];
  mode: "light" | "dark";
  fontFamily?: string;
}

export const DEFAULT_PALETTE = ["#4f7cff", "#22c3a6", "#f5a524", "#a06cf5", "#f0568a", "#34b6e6"];

export type EChartsOptionLike = Record<string, unknown>;

export function themeColors(theme: ChartTheme) {
  const dark = theme.mode === "dark";
  return {
    text: dark ? "#e6eaf4" : "#1f2937",
    muted: dark ? "#93a0bb" : "#6b7280",
    grid: dark ? "rgba(255,255,255,0.1)" : "rgba(15,23,42,0.08)",
    palette: theme.palette.length ? theme.palette : DEFAULT_PALETTE,
  };
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Danh sách tên series (cột/đường/vùng) hoặc tên lát (biểu đồ tròn) theo thứ tự vẽ, dùng làm khoá màu. */
function colorKeysOf(config: ChartConfig, table: ReturnType<typeof aggregate>): string[] {
  const uniq = (xs: string[]) => [...new Set(xs)];
  const t = config.chartType;
  // Lát / ô / vùng: mỗi giá trị của chiều đầu một màu.
  if (CHART_SPECS[t].sliceLike || t === "radar") return uniq(table.rows.map((r) => String(r.keys[0] ?? "")));
  if (t === "heatmap") return [];
  if (t === "gauge") return table.metricLabels.slice(0, 1);
  if (t === "scatter") return table.metricLabels.slice(1, 2);
  if (config.dimensions.length >= 2) return uniq(table.rows.map((r) => String(r.keys[1] ?? "")));
  return table.metricLabels;
}

/** Như chartColorKeys nhưng từ bảng đã gộp (nguồn dữ liệu lớn do server tính). */
export function chartColorKeysFromTable(config: ChartConfig, table: AggregatedTable): string[] {
  return config.chartType === "table" ? [] : colorKeysOf(config, table);
}

/** Các mục có thể đổi màu của chart này (rỗng với bảng hoặc khi chưa chọn đủ trường). */
export function chartColorKeys(config: ChartConfig, rows: Row[], calc?: CalcSet): string[] {
  if (config.chartType === "table" || config.chartType === "heatmap") return [];
  if (!hasEnoughFields(config.chartType, config.dimensions.length, config.metrics.length)) return [];
  const f = chartFields(config);
  return f ? colorKeysOf(config, aggregate(rows, f.dimensions, f.metrics, calc)) : [];
}

/** Màu hiệu lực của từng khoá: màu người dùng chọn, nếu không có thì theo thứ tự palette. */
export function resolveSeriesColors(keys: string[], palette: string[], overrides?: Record<string, string>): string[] {
  const pal = palette.length ? palette : DEFAULT_PALETTE;
  return keys.map((k, i) => (overrides && hasOwn(overrides, k) && overrides[k]) || pal[i % pal.length]);
}

/** Giá trị hiệu lực của các công tắc hiện/ẩn (áp mặc định). */
export function resolveFormat(config: ChartConfig) {
  const f = config.format ?? {};
  return {
    showXAxis: f.showXAxis ?? true,
    showYAxis: f.showYAxis ?? true,
    showGrid: f.showGrid ?? true,
    showLegend: f.showLegend ?? true,
    // Biểu đồ tròn mặc định hiện nhãn %; các loại khác mặc định tắt cho gọn.
    showDataLabels: f.showDataLabels ?? ["pie", "funnel", "treemap"].includes(config.chartType),
  };
}

/** Tên trục mặc định của từng loại (hiện chỉ phân tán có: tên hai số đo đầu). */
export function defaultAxisTitles(config: ChartConfig): { x?: string; y?: string } {
  if (config.chartType !== "scatter") return {};
  const [mx, my] = config.metrics;
  return { x: mx ? bindingLabel(mx, true) : undefined, y: my ? bindingLabel(my, true) : undefined };
}

/** Tên trục sẽ hiển thị: giá trị người dùng đặt (chuỗi rỗng = ẩn), chưa đặt thì dùng mặc định. */
export function resolveAxisTitles(config: ChartConfig, def: { x?: string; y?: string } = defaultAxisTitles(config)) {
  const f = config.format ?? {};
  const pick = (v: string | undefined, d: string | undefined) => (v === undefined ? d ?? "" : v).trim();
  return { x: pick(f.xAxisTitle, def.x), y: pick(f.yAxisTitle, def.y) };
}

export interface TitleCss {
  fontFamily?: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  textDecoration: "none" | "underline";
  color: string;
}

/**
 * Kiểu chữ của tiêu đề dưới dạng CSS. Tiêu đề được vẽ bằng HTML (không phải trong ECharts)
 * vì ECharts không hỗ trợ gạch chân; web và mobile đều dùng lại kiểu này.
 */
export function titleCss(config: ChartConfig, theme: ChartTheme): TitleCss {
  const t = config.format?.title ?? {};
  return {
    fontFamily: t.fontFamily ?? theme.fontFamily,
    fontSize: t.fontSize ?? 14,
    fontWeight: (t.bold ?? true) ? 600 : 400,
    fontStyle: t.italic ? "italic" : "normal",
    textDecoration: t.underline ? "underline" : "none",
    color: t.color ?? themeColors(theme).text,
  };
}

/** Kiểu chữ ECharts (không có gạch chân: ECharts không hỗ trợ cho nhãn). */
function echText(style: TextStyle | undefined, theme: ChartTheme, def: { color: string; size: number }) {
  const family = style?.fontFamily ?? theme.fontFamily;
  return {
    color: style?.color ?? def.color,
    fontSize: style?.fontSize ?? def.size,
    fontWeight: style?.bold ? 700 : 400,
    fontStyle: style?.italic ? "italic" : "normal",
    ...(family ? { fontFamily: family } : {}),
  };
}

/**
 * Chiều và số đo thực sự dùng để vẽ chart này (đã bỏ phần thừa so với loại chart), hoặc null nếu chưa đủ trường.
 * Dùng chung cho việc tính ở trình duyệt và việc gửi truy vấn lên server (cả hai phải cùng một bộ trường).
 */
export function chartFields(config: ChartConfig): { dimensions: FieldBinding[]; metrics: FieldBinding[] } | null {
  const { chartType } = config;
  if (chartType === "table") return null; // bảng được render bằng HTML
  if (!hasEnoughFields(chartType, config.dimensions.length, config.metrics.length)) return null;
  // Thừa chiều/số đo so với loại chart này (ví dụ vừa đổi từ cột sang tròn) thì bỏ phần thừa.
  const spec = CHART_SPECS[chartType];
  const dimensions = config.dimensions.slice(0, spec.dims[1]);
  if (chartType === "histogram") {
    // Histogram luôn đếm số dòng của chính cột số được chọn; không có số đo do người dùng đặt.
    const f = config.format ?? {};
    const col = dimensions[0].column;
    return {
      dimensions: [{ column: col, bins: f.histBins ?? 10, binWidth: f.histBinWidth, binStart: f.histBinStart }],
      metrics: [{ column: col, aggregation: "count", label: "Số dòng" }],
    };
  }
  return { dimensions, metrics: config.metrics.slice(0, spec.metrics[1]) };
}

/**
 * Chuyển cấu hình chart + dữ liệu thành option của ECharts (object thuần, không import echarts
 * để cả web và mobile dùng chung). Trả về null khi chưa chọn đủ trường dữ liệu.
 */
export function buildChartOption(
  config: ChartConfig,
  rows: Row[],
  theme: ChartTheme,
  /** Các giá trị (của dimension đầu) đang được chọn; những cột/lát còn lại sẽ mờ đi. */
  highlight: string[] = [],
  /** Trường tính toán dạng tổng hợp, nếu chart có dùng. */
  calc?: CalcSet,
): EChartsOptionLike | null {
  const f = chartFields(config);
  if (!f) return null;
  return buildChartOptionFromTable(config, aggregate(rows, f.dimensions, f.metrics, calc), theme, highlight);
}

/** Như buildChartOption nhưng nhận bảng ĐÃ GỘP (ví dụ do server tính khi nguồn dữ liệu lớn). */
export function buildChartOptionFromTable(
  config: ChartConfig,
  table: AggregatedTable,
  theme: ChartTheme,
  highlight: string[] = [],
  /** Ngày hôm nay (yyyy-mm-dd) để nhận ra kỳ cuối chưa trọn khi dự báo; bỏ trống = lấy từ đồng hồ. Chủ yếu để test. */
  today?: string,
): EChartsOptionLike | null {
  const dim = (v: unknown) => highlight.length > 0 && !highlight.includes(String(v ?? ""));
  const DIMMED = { itemStyle: { opacity: 0.3 } };
  const { chartType } = config;
  if (chartType === "table") return null;

  const c = themeColors(theme);

  const fmt = resolveFormat(config);
  // Số đo là ngày (MIN/MAX của cột ngày) thì tooltip/trục/nhãn hiện dd/mm/yyyy.
  const dk: MetricKind | undefined = table.metricKinds?.every((k) => k === "date") ? "date" : undefined;
  const axisText = echText(config.format?.axis, theme, { color: c.muted, size: 12 });
  const legendText = echText(config.format?.legend, theme, { color: c.muted, size: 12 });
  const labelText = echText(config.format?.dataLabel, theme, { color: c.muted, size: 12 });
  const topPad = 20;
  const colors = resolveSeriesColors(colorKeysOf(config, table), c.palette, config.format?.colors);

  if (chartType === "pie") {
    return {
      color: colors,
      tooltip: {
        trigger: "item",
        valueFormatter: (v: unknown) => formatByKind(Number(v), dk),
      },
      legend: fmt.showLegend ? { bottom: 0, textStyle: legendText } : { show: false },
      series: [
        {
          type: "pie",
          radius: ["46%", "70%"],
          center: ["50%", fmt.showLegend ? "46%" : "50%"],
          itemStyle: { borderRadius: 6, borderColor: "transparent", borderWidth: 2 },
          label: {
            show: fmt.showDataLabels,
            ...labelText,
            formatter: (p: { percent?: number }) => `${Math.round(p.percent ?? 0)}%`,
          },
          data: table.rows.map((r) => ({
            name: String(r.keys[0] ?? ""),
            value: r.values[0],
            ...(dim(r.keys[0]) ? DIMMED : {}),
          })),
        },
      ],
    };
  }

  const special = buildSpecialOption(chartType, { config, table, theme, c, fmt, colors, highlight, legendText, labelText, axisText });
  if (special) return special;

  // Biểu đồ cartesian: bar / hbar / stackedbar / line / area
  const isHist = chartType === "histogram";
  const isBar = chartType === "bar" || chartType === "hbar" || chartType === "stackedbar" || isHist;
  const horizontal = chartType === "hbar";
  const stacked = chartType === "stackedbar";
  const categories: string[] = [];
  const catIndex = new Map<string, number>();
  for (const r of table.rows) {
    const k = String(r.keys[0] ?? "");
    if (!catIndex.has(k)) {
      catIndex.set(k, categories.length);
      categories.push(k);
    }
  }

  const seriesType = isBar ? "bar" : "line";
  const base = (name: string, data: Array<number | null>) => ({
    name,
    type: seriesType,
    // Chỉ cột (bar) được làm mờ theo lựa chọn; đường/vùng giữ nguyên.
    data: isBar && highlight.length > 0
      ? data.map((v, i) => (dim(categories[i]) ? { value: v, ...DIMMED } : v))
      : data,
    smooth: seriesType === "line",
    showSymbol: false,
    // Có đặt độ rộng thì cột đúng bằng số đó; không thì tự co giãn nhưng không quá 36px.
    // Histogram: các cột sát nhau (chỉ chừa khe mảnh) vì là các khoảng liền kề của cùng một trục số.
    ...(isHist ? { barCategoryGap: "4%" } : config.format?.barWidth ? { barWidth: config.format.barWidth } : { barMaxWidth: 36 }),
    label: {
      show: fmt.showDataLabels,
      position: stacked ? "inside" : horizontal ? "right" : "top",
      ...labelText,
      formatter: (p: { value?: unknown }) => formatCompactByKind(Number(p.value ?? 0), dk),
    },
    ...(stacked ? { stack: "total" } : {}),
    ...(isBar ? { itemStyle: { borderRadius: stacked || isHist ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } } : {}),
    ...(chartType === "area" ? { areaStyle: { opacity: 0.18 } } : {}),
    ...(seriesType === "line" ? { lineStyle: { width: 2.5 } } : {}),
  });

  let series: ReturnType<typeof base>[];
  if (table.dimLabels.length >= 2) {
    // Chiều thứ hai tách thành nhiều series, dùng metric đầu tiên.
    const bySeries = new Map<string, Array<number | null>>();
    for (const r of table.rows) {
      const name = String(r.keys[1] ?? "");
      if (!bySeries.has(name)) bySeries.set(name, categories.map(() => null));
      bySeries.get(name)![catIndex.get(String(r.keys[0] ?? ""))!] = r.values[0];
    }
    series = [...bySeries.entries()].map(([name, data]) => base(name, data));
  } else {
    series = table.metricLabels.map((label, mi) => {
      const data: Array<number | null> = categories.map(() => null);
      for (const r of table.rows) data[catIndex.get(String(r.keys[0] ?? ""))!] = r.values[mi];
      return base(label, data);
    });
  }

  const showLegend = fmt.showLegend && series.length > 1;

  // Đường xu hướng (nét đứt cùng màu series). Cột chồng: một đường cho tổng. Cột ngang chưa hỗ trợ.
  const trendMode = config.format?.trendline ?? "none";
  const trendSeries: Array<Record<string, unknown>> = [];
  if (trendMode !== "none" && !horizontal) {
    const win = config.format?.trendWindow ?? 3;
    const suffix = trendMode === "linear" ? "xu hướng" : `TB trượt ${win}`;
    const make = (name: string, data: Array<number | null>, color: string) => ({
      name: `${name} · ${suffix}`,
      type: "line",
      data,
      symbol: "none",
      smooth: false,
      silent: true,
      z: 5,
      lineStyle: { type: "dashed", width: 2, color },
      itemStyle: { color },
    });
    if (stacked) {
      const totals = categories.map((_, i) =>
        series.reduce((sum, s) => sum + (typeof s.data[i] === "number" ? (s.data[i] as number) : 0), 0),
      );
      trendSeries.push(make("Tổng", trendOf(totals, trendMode, win), c.text));
    } else {
      series.forEach((s, i) => {
        const vals = (s.data as unknown[]).map((v) =>
          typeof v === "number" ? v : v && typeof v === "object" && typeof (v as { value?: unknown }).value === "number" ? (v as { value: number }).value : null,
        );
        trendSeries.push(make(s.name, trendOf(vals, trendMode, win), colors[i % colors.length] ?? c.text));
      });
    }
  }
  // Dự báo (chart đường/vùng): kéo dài trục, thêm đường nét đứt + dải tin cậy.
  const fc = chartType === "line" || chartType === "area" ? forecastParts(config, categories, series, colors, c, dk, today) : null;
  const cats = fc ? fc.categories : categories;
  const titles = resolveAxisTitles(config);
  const xName = fmt.showXAxis ? titles.x : "";
  const yName = fmt.showYAxis ? titles.y : "";
  return {
    color: colors,
    tooltip: fc
      ? { trigger: "axis", formatter: fc.formatter }
      : {
          trigger: "axis",
          valueFormatter: (v: unknown) => formatByKind(Number(v), dk),
        },
    legend: showLegend
      ? { top: 2, left: 4, itemWidth: 12, itemHeight: 8, textStyle: legendText, data: series.map((s) => s.name) }
      : { show: false },
    grid: {
      left: 8,
      right: 16,
      top: topPad + (showLegend ? 22 : 0) + (fmt.showDataLabels ? 10 : 0) + (yName ? 18 : 0),
      bottom: xName ? 26 : 8,
      containLabel: true,
    },
    ...(() => {
      const catAxis = {
        type: "category",
        // Cột ngang: trục nhóm nằm dọc (Y), nhóm đầu tiên ở trên cùng.
        show: horizontal ? fmt.showYAxis : fmt.showXAxis,
        data: cats,
        inverse: horizontal,
        boundaryGap: isBar,
        axisLine: { lineStyle: { color: c.grid } },
        axisTick: { show: false },
        axisLabel: axisText,
        ...(horizontal ? nameYProps(yName, axisText) : nameXProps(xName, axisText)),
      };
      const valAxis = {
        type: "value",
        show: horizontal ? fmt.showXAxis : fmt.showYAxis,
        splitLine: { show: fmt.showGrid, lineStyle: { color: c.grid } },
        axisLabel: { ...axisText, formatter: (v: number) => formatCompactByKind(v, dk) },
        ...(horizontal ? nameXProps(xName, axisText) : nameYProps(yName, axisText)),
      };
      return horizontal ? { xAxis: valAxis, yAxis: catAxis } : { xAxis: catAxis, yAxis: valAxis };
    })(),
    series: fc ? [...fc.series, ...trendSeries, ...fc.extra] : [...series, ...trendSeries],
  };
}

/** Hậu tố tên series dự báo. Tách riêng khỏi chuỗi ghép để tooltip dịch được phần chữ ("· dự báo") độc lập với tên series. */
const FC_WORD = "· dự báo";
const FC_SUFFIX_RE = / · dự báo$/;

/** Phần dự báo của chart cartesian. Null khi chart không bật dự báo hoặc không dự báo được. */
function forecastParts(
  config: ChartConfig,
  categories: string[],
  series: Array<{ name: string; data: unknown[] } & Record<string, unknown>>,
  colors: string[],
  c: ReturnType<typeof themeColors>,
  dk: MetricKind | undefined,
  today?: string,
) {
  const numeric = (data: unknown[]) =>
    data.map((v) =>
      typeof v === "number" ? v : v && typeof v === "object" && typeof (v as { value?: unknown }).value === "number" ? (v as { value: number }).value : null,
    );
  const plan = planChartForecast(config, categories, series.map((s) => ({ name: s.name, values: numeric(s.data) })), today);
  if (!plan || plan.items.length === 0) return null;

  const cats = [...categories, ...plan.extraLabels];
  const at = new Map(cats.map((l, i) => [l, i]));
  const blanks = () => cats.map(() => null as number | null);
  const padded = series.map((s) => ({ ...s, data: [...s.data, ...plan.extraLabels.map(() => null)] }));
  const showBand = config.format?.forecast?.showBand !== false;
  const pct = Math.round(plan.options.level * 100);
  // Tên series dự báo → (nhãn kỳ → khoảng), để tooltip hiện "dự báo (95%: lo – hi)".
  const info = new Map<string, Map<number, { lo: number; hi: number }>>();
  const extra: Array<Record<string, unknown>> = [];

  plan.items.forEach((it, n) => {
    const r = it.result;
    const color = colors[it.index % colors.length] ?? c.text;
    const anchor = at.get(r.anchorLabel);
    if (anchor === undefined) return;
    const actual = numeric(series[it.index].data)[categories.indexOf(r.anchorLabel)];
    if (actual === null || actual === undefined) return;
    const name = `${it.name} · dự báo`;
    const line = blanks();
    const lo = blanks();
    const width = blanks();
    line[anchor] = actual;
    lo[anchor] = actual;
    width[anchor] = 0;
    const ranges = new Map<number, { lo: number; hi: number }>();
    r.labels.forEach((l, j) => {
      const i = at.get(l);
      if (i === undefined) return;
      line[i] = r.mean[j];
      lo[i] = r.lo[j];
      width[i] = Math.max(0, r.hi[j] - r.lo[j]);
      ranges.set(i, { lo: r.lo[j], hi: r.hi[j] });
    });
    info.set(name, ranges);
    const stack = `fcband${n}`;
    if (showBand) {
      const hidden = { opacity: 0 };
      extra.push(
        { name: `__lo${n}`, type: "line", data: lo, stack, symbol: "none", silent: true, z: 1, lineStyle: hidden, tooltip: { show: false } },
        { name: `__bd${n}`, type: "line", data: width, stack, symbol: "none", silent: true, z: 1, lineStyle: hidden, areaStyle: { color, opacity: 0.16 }, tooltip: { show: false } },
      );
    }
    extra.push({
      name,
      type: "line",
      data: line,
      symbol: "none",
      smooth: true,
      silent: true,
      z: 4,
      lineStyle: { type: "dashed", width: 2.5, color },
      itemStyle: { color },
      // Vạch đứng mờ ngăn "đã có" và "dự báo" (chỉ vẽ một lần).
      ...(n === 0
        ? { markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { type: "dotted", color: c.muted, width: 1 }, data: [{ xAxis: anchor }] } }
        : {}),
    });
  });
  if (info.size === 0) return null;

  // Tooltip tự viết: ẩn các series của dải, và hiện khoảng tin cậy cho điểm dự báo. Tên/giá trị đều thoát HTML.
  const formatter = (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as Array<{
      seriesName?: string;
      value?: unknown;
      dataIndex?: number;
      axisValueLabel?: string;
      name?: string;
      marker?: string;
    }>;
    if (list.length === 0) return "";
    const rows: string[] = [`<div>${esc(list[0].axisValueLabel ?? list[0].name)}</div>`];
    for (const p of list) {
      const sn = String(p.seriesName ?? "");
      if (sn.startsWith("__") || typeof p.value !== "number") continue;
      const forecast = info.get(sn);
      const range = forecast?.get(p.dataIndex ?? -1);
      if (forecast && !range) continue; // điểm nối: đã có giá trị thật ở series gốc
      const label = forecast ? `<span>${esc(sn.replace(FC_SUFFIX_RE, ""))}</span> <span>${FC_WORD}</span>` : `<span>${esc(sn)}</span>`;
      const tail = range ? ` <span style="opacity:.7">(${pct}%: ${esc(formatByKind(range.lo, dk))} – ${esc(formatByKind(range.hi, dk))})</span>` : "";
      rows.push(`<div>${p.marker ?? ""}${label}: <b>${esc(formatByKind(p.value, dk))}</b>${tail}</div>`);
    }
    return rows.join("");
  };
  return { categories: cats, series: padded, extra, formatter };
}

// ---------------------------------------------------------------------------------------------
// Các loại chart không theo khuôn trục category: phễu, treemap, phân tán, radar, đồng hồ, bản đồ nhiệt
// ---------------------------------------------------------------------------------------------

type EchText = ReturnType<typeof echText>;

interface SpecialCtx {
  config: ChartConfig;
  table: ReturnType<typeof aggregate>;
  theme: ChartTheme;
  c: ReturnType<typeof themeColors>;
  fmt: ReturnType<typeof resolveFormat>;
  colors: string[];
  highlight: string[];
  legendText: EchText;
  labelText: EchText;
  axisText: EchText;
}

const HTML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape cho tooltip HTML của ECharts: tên/giá trị lấy từ dữ liệu người dùng nên không được tin. */
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (ch) => HTML_ESC[ch]);

/** Số tròn lớn hơn giá trị một chút, để mặt đồng hồ không bị đầy kịch. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 1.5, 2, 3, 4, 5, 7.5, 10]) if (m * pow >= value * 1.05) return m * pow;
  return 10 * pow;
}

function buildSpecialOption(type: ChartConfig["chartType"], x: SpecialCtx): EChartsOptionLike | null {
  const { config, table, theme, c, fmt, colors, highlight, legendText, labelText, axisText } = x;
  const dimmed = (v: unknown) => highlight.length > 0 && !highlight.includes(String(v ?? ""));
  const DIM = { opacity: 0.3 };
  const dark = theme.mode === "dark";
  const key0 = (r: { keys: unknown[] }) => String(r.keys[0] ?? "");
  // Số đo là ngày (MIN/MAX của cột ngày) thì hiện dd/mm/yyyy [hh:mm]; `i` = vị trí số đo.
  const kd = (i: number) => table.metricKinds?.[i];
  const fv = (n: unknown, i = 0) => formatByKind(Number(n), kd(i));
  const fc = (n: unknown, i = 0) => formatCompactByKind(Number(n), kd(i));
  const allDate = !!table.metricKinds?.length && table.metricKinds.every((k) => k === "date");

  if (type === "funnel") {
    const inside = echText(config.format?.dataLabel, theme, { color: "#ffffff", size: 12 });
    return {
      color: colors,
      tooltip: { trigger: "item", valueFormatter: (v: unknown) => fv(v) },
      legend: fmt.showLegend ? { bottom: 0, textStyle: legendText } : { show: false },
      series: [{
        type: "funnel",
        left: "6%", width: "88%", top: 8, bottom: fmt.showLegend ? 34 : 8,
        sort: "descending", gap: 2,
        itemStyle: { borderWidth: 0 },
        label: {
          show: fmt.showDataLabels, position: "inside", ...inside,
          formatter: (p: { name?: string; value?: unknown }) => `${p.name ?? ""} · ${fc(p.value ?? 0)}`,
        },
        data: table.rows.map((r) => ({ name: key0(r), value: r.values[0], ...(dimmed(r.keys[0]) ? { itemStyle: DIM } : {}) })),
      }],
    };
  }

  if (type === "treemap") {
    const inside = echText(config.format?.dataLabel, theme, { color: "#ffffff", size: 12 });
    const two = config.dimensions.length >= 2;
    const names = [...new Set(table.rows.map(key0))];
    const colorOf = (name: string) => colors[Math.max(0, names.indexOf(name)) % Math.max(1, colors.length)];
    let data: unknown[];
    if (two) {
      const groups = new Map<string, Array<{ name: string; value: number }>>();
      for (const r of table.rows) {
        const g = key0(r);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push({ name: String(r.keys[1] ?? ""), value: r.values[0] });
      }
      data = [...groups.entries()].map(([name, kids]) => ({
        name,
        itemStyle: { color: colorOf(name), ...(dimmed(name) ? DIM : {}) },
        children: kids.map((k) => ({ ...k, itemStyle: { color: colorOf(name) } })),
      }));
    } else {
      data = table.rows.map((r) => ({
        name: key0(r), value: r.values[0],
        itemStyle: { color: colorOf(key0(r)), ...(dimmed(r.keys[0]) ? DIM : {}) },
      }));
    }
    return {
      tooltip: { trigger: "item", valueFormatter: (v: unknown) => fv(v) },
      series: [{
        type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false },
        left: 4, right: 4, top: 4, bottom: 4,
        itemStyle: { borderColor: dark ? "#0b0f1a" : "#ffffff", borderWidth: 2, gapWidth: 2 },
        label: { show: fmt.showDataLabels, ...inside },
        ...(two ? { upperLabel: { show: fmt.showDataLabels, height: 20, ...inside }, levels: [{ itemStyle: { gapWidth: 3 } }, {}] } : {}),
        data,
      }],
    };
  }

  if (type === "scatter") {
    const [lx, ly, ls] = table.metricLabels;
    const sizes = table.rows.map((r) => r.values[2]).filter((v): v is number => typeof v === "number");
    const maxS = sizes.length ? Math.max(...sizes) : 0;
    const hasSize = table.metricLabels.length >= 3 && maxS > 0;
    // Cỡ bong bóng theo DIỆN TÍCH (căn bậc hai), nằm giữa bubbleMin và bubbleMax; không có số đo thứ 3 thì cỡ cố định.
    const bMin = config.format?.bubbleMin ?? 8;
    const bMax = Math.max(bMin + 2, config.format?.bubbleMax ?? 38);
    const fixedSize = config.format?.pointSize ?? 11;
    // Đường xu hướng của phân tán luôn là đường thẳng hồi quy qua mọi điểm (trung bình trượt không có nghĩa ở đây).
    const fit = (config.format?.trendline ?? "none") === "none"
      ? null
      : linearRegression(table.rows.map((r) => [Number(r.values[0]), Number(r.values[1])] as const));
    const xs0 = table.rows.map((r) => Number(r.values[0])).filter(Number.isFinite);
    const graphic: Array<Record<string, unknown>> = [];
    if (hasSize) {
      graphic.push({ type: "text", right: 6, top: 2, silent: true, style: { text: `Cỡ bong bóng: ${ls}`, fill: c.muted, font: "11px sans-serif" } });
    }
    if (fit && config.format?.showTrendInfo) {
      const sign = fit.intercept < 0 ? "−" : "+";
      graphic.push({
        type: "text", right: 8, bottom: 2, silent: true,
        style: {
          text: `y = ${formatNumber(fit.slope)}x ${sign} ${formatNumber(Math.abs(fit.intercept))}   R² = ${formatNumber(fit.r2)}`,
          fill: c.muted, font: "11px sans-serif",
        },
      });
    }
    const at = resolveAxisTitles(config, { x: lx, y: ly });
    const sxName = fmt.showXAxis ? at.x : "";
    const syName = fmt.showYAxis ? at.y : "";
    return {
      color: colors,
      tooltip: {
        trigger: "item",
        formatter: (p: { name?: string; value?: unknown[] }) => {
          const v = p.value ?? [];
          const lines = [`<b>${esc(p.name)}</b>`, `${esc(lx)}: ${fv(v[0], 0)}`, `${esc(ly)}: ${fv(v[1], 1)}`];
          if (hasSize) lines.push(`${esc(ls)}: ${fv(v[2], 2)}`);
          return lines.join("<br/>");
        },
      },
      legend: { show: false },
      // Chú thích số đo quyết định cỡ bong bóng, đặt góc trên phải
      ...(graphic.length ? { graphic } : {}),
      grid: { left: 8, right: 20, top: 20 + (syName ? 4 : 0), bottom: sxName ? 26 : 8, containLabel: true },
      xAxis: {
        type: "value", show: fmt.showXAxis, ...nameXProps(sxName, axisText),
        scale: true,
        splitLine: { show: fmt.showGrid, lineStyle: { color: c.grid } },
        axisLine: { lineStyle: { color: c.grid } }, axisTick: { show: false },
        axisLabel: { ...axisText, formatter: (v: number) => fc(v, 0) },
      },
      yAxis: {
        type: "value", show: fmt.showYAxis, ...nameYProps(syName, axisText),
        scale: true,
        splitLine: { show: fmt.showGrid, lineStyle: { color: c.grid } },
        axisLabel: { ...axisText, formatter: (v: number) => fc(v, 1) },
      },
      series: [{
        type: "scatter",
        symbolSize: hasSize ? (v: number[]) => bMin + (bMax - bMin) * Math.sqrt(Math.max(0, v[2] ?? 0) / maxS) : fixedSize,
        itemStyle: { opacity: 0.78, borderColor: "rgba(255,255,255,0.55)", borderWidth: 1 },
        label: { show: fmt.showDataLabels, position: "top", ...labelText, formatter: (p: { name?: string }) => p.name ?? "" },
        data: table.rows.map((r) => ({
          name: key0(r), value: r.values,
          ...(dimmed(r.keys[0]) ? { itemStyle: DIM } : {}),
        })),
      },
      ...(fit && xs0.length >= 2
        ? [{
            name: "Xu hướng",
            type: "line",
            data: [Math.min(...xs0), Math.max(...xs0)].map((x) => [x, fit.slope * x + fit.intercept]),
            symbol: "none",
            silent: true,
            z: 1,
            lineStyle: { type: "dashed", width: 2, color: c.text, opacity: 0.75 },
            itemStyle: { color: c.text },
          }]
        : [])],
    };
  }

  if (type === "radar") {
    const rows = table.rows.slice(0, 8);
    const names = rows.map(key0);
    const maxes = table.metricLabels.map((_, i) => {
      const m = Math.max(0, ...rows.map((r) => Number(r.values[i]) || 0));
      return m > 0 ? m * 1.15 : 1;
    });
    const multi = fmt.showLegend && rows.length > 1;
    return {
      color: colors,
      tooltip: { trigger: "item", valueFormatter: (v: unknown) => (allDate ? formatDay(Number(v)) : formatNumber(Number(v))) },
      legend: multi ? { bottom: 0, textStyle: legendText } : { show: false },
      radar: {
        indicator: table.metricLabels.map((name, i) => ({ name, max: maxes[i] })),
        radius: "62%",
        center: ["50%", multi ? "46%" : "52%"],
        axisName: { ...axisText },
        axisLine: { lineStyle: { color: c.grid } },
        splitLine: { lineStyle: { color: c.grid } },
        splitArea: { show: false },
      },
      series: [{
        type: "radar",
        symbol: "circle", symbolSize: 5,
        label: { show: fmt.showDataLabels, ...labelText, formatter: (p: { value?: unknown }) => (allDate ? formatDay(Number(p.value ?? 0)) : formatCompact(Number(p.value ?? 0))) },
        data: rows.map((r, i) => ({
          name: names[i], value: r.values,
          lineStyle: { width: 2, color: colors[i % colors.length] },
          itemStyle: { color: colors[i % colors.length], ...(dimmed(names[i]) ? DIM : {}) },
          areaStyle: { color: colors[i % colors.length], opacity: dimmed(names[i]) ? 0.05 : 0.15 },
        })),
      }],
    };
  }

  if (type === "gauge") {
    const value = Number(table.rows[0]?.values[0] ?? 0);
    const max = config.format?.gaugeMax ?? niceMax(value);
    const valueText = echText(config.format?.dataLabel, theme, { color: c.text, size: 28 });
    return {
      series: [{
        type: "gauge",
        startAngle: 210, endAngle: -30, min: 0, max,
        radius: "92%", center: ["50%", "60%"],
        progress: { show: true, width: 14, roundCap: true, itemStyle: { color: colors[0] } },
        axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, c.grid]] } },
        pointer: { show: false },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: {
          show: fmt.showYAxis, distance: 20,
          ...echText(config.format?.axis, theme, { color: c.muted, size: 11 }),
          formatter: (v: number) => fc(v),
        },
        anchor: { show: false },
        title: { show: true, offsetCenter: [0, "-30%"], ...echText(config.format?.legend, theme, { color: c.muted, size: 12 }) },
        detail: {
          valueAnimation: false, offsetCenter: [0, "8%"], ...valueText,
          fontWeight: config.format?.dataLabel?.bold === false ? 400 : 700,
          formatter: (v: number) => fv(v),
        },
        data: [{ value, name: table.metricLabels[0] }],
      }],
    };
  }

  if (type === "heatmap") {
    const xs: string[] = [];
    const ys: string[] = [];
    for (const r of table.rows) {
      const a = String(r.keys[0] ?? "");
      const b = String(r.keys[1] ?? "");
      if (!xs.includes(a)) xs.push(a);
      if (!ys.includes(b)) ys.push(b);
    }
    const vals = table.rows.map((r) => r.values[0]);
    const lo = Math.min(0, ...vals);
    const hi = Math.max(1, ...vals);
    const ht = resolveAxisTitles(config);
    const hxName = fmt.showXAxis ? ht.x : "";
    const hyName = fmt.showYAxis ? ht.y : "";
    return {
      tooltip: {
        trigger: "item",
        formatter: (p: { value?: unknown[] }) => {
          const v = p.value ?? [];
          return `${esc(xs[Number(v[0])])} · ${esc(ys[Number(v[1])])}<br/>${esc(table.metricLabels[0])}: ${fv(v[2])}`;
        },
      },
      grid: { left: 8, right: 16, top: 8 + (hyName ? 18 : 0), bottom: (fmt.showLegend ? 46 : 8) + (hxName ? 18 : 0), containLabel: true },
      xAxis: { type: "category", show: fmt.showXAxis, data: xs, splitArea: { show: false }, axisLine: { lineStyle: { color: c.grid } }, axisTick: { show: false }, axisLabel: axisText, ...nameXProps(hxName, axisText) },
      yAxis: { type: "category", show: fmt.showYAxis, data: ys, splitArea: { show: false }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: axisText, ...nameYProps(hyName, axisText) },
      visualMap: {
        show: fmt.showLegend, type: "continuous", min: lo, max: hi, calculable: false,
        orient: "horizontal", left: "center", bottom: 4, itemWidth: 12, itemHeight: 120,
        text: [fc(hi), fc(lo)], textStyle: legendText,
        inRange: { color: [dark ? "#1b2233" : "#eaf0fb", c.palette[0]] },
      },
      series: [{
        type: "heatmap",
        itemStyle: { borderColor: dark ? "#0b0f1a" : "#ffffff", borderWidth: 2, borderRadius: 3 },
        label: { show: fmt.showDataLabels, ...labelText, formatter: (p: { value?: unknown[] }) => fc((p.value ?? [])[2] ?? 0) },
        data: table.rows.map((r) => [xs.indexOf(String(r.keys[0] ?? "")), ys.indexOf(String(r.keys[1] ?? "")), r.values[0]]),
      }],
    };
  }

  return null;
}

/** Thuộc tính ECharts cho tên trục ngang: căn giữa, nằm dưới nhãn. Rỗng = không có tên. */
function nameXProps(name: string, style: EchText) {
  return name ? { name, nameLocation: "middle", nameGap: 26, nameTextStyle: style } : {};
}

/** Tên trục dọc: nằm ngang ở đầu trên của trục (dễ đọc hơn chữ xoay). Rỗng = không có tên. */
function nameYProps(name: string, style: EchText) {
  return name ? { name, nameLocation: "end", nameGap: 10, nameTextStyle: { ...style, align: "left" } } : {};
}
