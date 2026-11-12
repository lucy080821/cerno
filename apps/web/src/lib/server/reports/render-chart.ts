import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import * as echarts from "echarts/core";
import { BarChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, PieChart, RadarChart, ScatterChart, TreemapChart } from "echarts/charts";
import { GraphicComponent, GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { Dashboard, Widget } from "@dashboard/schema";
import { DEFAULT_PALETTE, buildChartOptionFromTable, calcDefsFor, specForWidget, type ChartTheme } from "@dashboard/chart-engine";
import { dateColumnFor, periodFilter, type Executor, type KpiFact, type ReportFacts } from "./facts";
import type { ReportPeriods } from "./period";

/**
 * Ảnh biểu đồ và thẻ KPI cho email báo cáo. KHÔNG nhúng dashboard sống (Gmail/Outlook chặn iframe và JavaScript):
 * vẽ bằng ECharts phía server (SSR → SVG) rồi đổi sang PNG bằng resvg, rộng 600px, đính kèm nội tuyến (CID).
 * Dùng đúng `buildChartOptionFromTable` của dashboard nên biểu đồ giống hệt trên web (chỉ khác nền sáng, không hoạt ảnh).
 * Mũi tên tăng/giảm của thẻ KPI vẽ bằng hình tam giác SVG vì font Noto Sans không có ký tự ▲▼.
 */

export const IMAGE_WIDTH = 600;
export const MAX_IMAGES = 6;
export const MAX_TOTAL_BYTES = 1_500_000;
const FONT_FAMILY = "Noto Sans";
const FONT_FILES = ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"];

echarts.use([
  BarChart, LineChart, PieChart, ScatterChart, TreemapChart, FunnelChart, RadarChart, GaugeChart, HeatmapChart,
  GraphicComponent, GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent, VisualMapComponent, SVGRenderer,
]);

export interface RenderedImage {
  widgetId: string;
  /** Content-ID để đính kèm nội tuyến (`<img src="cid:...">`). */
  cid: string;
  /** Tên hiển thị / văn bản thay thế (alt). */
  title: string;
  png: Buffer;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------------------------
// Font và PNG
// ---------------------------------------------------------------------------------------------

let fontCache: string[] | null = null;

/** Đường dẫn font đã đóng gói trong repo. Tìm theo thư mục chạy (apps/web hoặc gốc repo, kể cả bản standalone). */
export function fontFiles(): string[] {
  if (fontCache) return fontCache;
  const cwd = process.cwd();
  for (const dir of [path.join(cwd, "assets", "fonts"), path.join(cwd, "apps", "web", "assets", "fonts")]) {
    const files = FONT_FILES.map((f) => path.join(dir, f));
    if (files.every((f) => fs.existsSync(f))) return (fontCache = files);
  }
  throw new Error("Không tìm thấy font Noto Sans (assets/fonts) để vẽ ảnh báo cáo.");
}

/** Đổi SVG sang PNG nền trắng, rộng IMAGE_WIDTH px. Chỉ dùng font đã đóng gói (không phụ thuộc font của máy chủ). */
export function svgToPng(svg: string): { png: Buffer; width: number; height: number } {
  const r = new Resvg(svg, {
    background: "#ffffff",
    fitTo: { mode: "width", value: IMAGE_WIDTH },
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
  }).render();
  return { png: r.asPng(), width: r.width, height: r.height };
}

export const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Bỏ ký tự điều khiển (không hợp lệ trong XML) và cắt độ dài. */
const clip = (s: string, n: number) => {
  const t = s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

// ---------------------------------------------------------------------------------------------
// Thẻ KPI
// ---------------------------------------------------------------------------------------------

const TONE_COLOR = { good: "#16a34a", bad: "#dc2626", neutral: "#6b7280" } as const;

/** SVG của một thẻ KPI (600×132). Mọi chữ đều được thoát XML. */
export function kpiCardSvg(k: KpiFact): string {
  const color = TONE_COLOR[k.tone];
  const value = k.value ? (k.value.text.length <= 13 ? k.value.text : k.value.short) : "—";
  const arrow =
    k.dir === "up" ? `<polygon points="24,117 36,117 30,105" fill="${color}"/>`
    : k.dir === "down" ? `<polygon points="24,105 36,105 30,117" fill="${color}"/>`
    : k.dir === "flat" ? `<rect x="24" y="109" width="12" height="3" fill="${color}"/>`
    : "";
  let line: string;
  if (k.growthText) {
    const prev = k.prev ? `·  kỳ trước ${k.prev.short}` : "";
    line = `<text x="44" y="116" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="${color}">${escapeXml(k.growthText)}<tspan dx="8" font-weight="400" fill="#6b7280">${escapeXml(prev)}</tspan></text>`;
  } else {
    line = `<text x="24" y="116" font-family="${FONT_FAMILY}" font-size="14" fill="#6b7280">${k.value ? "Chưa có số kỳ trước để so sánh" : "Không có dữ liệu trong kỳ"}</text>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="132" viewBox="0 0 ${IMAGE_WIDTH} 132">` +
    `<rect x="1" y="1" width="598" height="130" rx="14" fill="#f5f7fb" stroke="#e3e8f0"/>` +
    `<text x="24" y="36" font-family="${FONT_FAMILY}" font-size="15" fill="#6b7280">${escapeXml(clip(k.title, 46))}</text>` +
    `<text x="24" y="84" font-family="${FONT_FAMILY}" font-size="40" font-weight="700" fill="#14162b">${escapeXml(value)}</text>` +
    `${arrow}${line}</svg>`
  );
}

// ---------------------------------------------------------------------------------------------
// Biểu đồ
// ---------------------------------------------------------------------------------------------

/** SVG của một biểu đồ ECharts (SSR). */
export function chartSvg(option: Record<string, unknown>, width: number, height: number): string {
  const chart = echarts.init(null as unknown as HTMLElement, undefined, { renderer: "svg", ssr: true, width, height });
  try {
    chart.setOption({ ...option, animation: false, backgroundColor: "#ffffff" } as Parameters<typeof chart.setOption>[0]);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

/** Thêm dải tiêu đề phía trên biểu đồ (tiêu đề của widget nằm ngoài ECharts trên web nên phải tự vẽ). */
export function withTitle(chart: string, title: string, width: number, height: number): string {
  const t = clip(title, 60);
  if (!t) return chart;
  const band = 38;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + band}" viewBox="0 0 ${width} ${height + band}">` +
    `<rect width="${width}" height="${height + band}" fill="#ffffff"/>` +
    `<text x="16" y="26" font-family="${FONT_FAMILY}" font-size="16" font-weight="700" fill="#14162b">${escapeXml(t)}</text>` +
    `<svg x="0" y="${band}" width="${width}" height="${height}">${chart.replace(/^<?xml[^>]*>/, "")}</svg></svg>`
  );
}

/** Chừa lề phải cho nhãn trục cuối (vd "2025-10") khỏi bị cắt khi vẽ ở bề ngang email. */
function padGrid(option: Record<string, unknown>): Record<string, unknown> {
  const g = option.grid;
  if (!g || typeof g !== "object" || Array.isArray(g)) return option;
  const right = (g as { right?: unknown }).right;
  return { ...option, grid: { ...g, right: typeof right === "number" ? Math.max(right, 32) : 32 } };
}

/** Chart có chiều là ngày (đường thời gian): hiện cả lịch sử đến hết kỳ, không cắt ở đầu kỳ. */
function isTimeSeries(w: Widget, doc: Dashboard): boolean {
  const c = w.config;
  if (c.kind !== "chart") return false;
  const cols = doc.sources.find((s) => s.id === c.sourceId)?.columns ?? [];
  return c.dimensions.some((d) => !!d.grain || cols.find((x) => x.name === d.column)?.type === "date");
}

const readingOrder = (a: Widget, b: Widget) => a.y - b.y || a.x - b.x;
const isRenderableChart = (w: Widget) => w.config.kind === "chart" && w.config.chartType !== "table";

/**
 * Chọn các widget sẽ thành ảnh (tối đa MAX_IMAGES). `widgetIds` rỗng = tự chọn: các biểu đồ (không phải bảng) theo thứ tự đọc.
 * Có `widgetIds` = đúng các widget đó theo thứ tự đã chọn (biểu đồ hoặc thẻ KPI); id không còn tồn tại hoặc đang ẩn thì bỏ qua.
 */
export function pickImageWidgets(doc: Dashboard, widgetIds: string[]): Widget[] {
  const visible = doc.widgets.filter((w) => !w.hidden);
  if (widgetIds.length === 0) return visible.filter(isRenderableChart).sort(readingOrder).slice(0, MAX_IMAGES);
  const byId = new Map(visible.map((w) => [w.id, w]));
  const out: Widget[] = [];
  for (const id of widgetIds) {
    const w = byId.get(id);
    if (w && (w.config.kind === "kpi" || isRenderableChart(w)) && !out.includes(w)) out.push(w);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

/** Giữ các ảnh đầu cho tới khi tổng dung lượng chạm trần; bỏ phần còn lại. */
export function fitImageBudget<T extends { png: Buffer }>(images: T[], maxBytes = MAX_TOTAL_BYTES): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let total = 0;
  for (const img of images) {
    if (total + img.png.length > maxBytes) break;
    kept.push(img);
    total += img.png.length;
  }
  return { kept, dropped: images.length - kept.length };
}

export function reportTheme(doc: Dashboard): ChartTheme {
  return { palette: doc.theme.palette.length ? doc.theme.palette : DEFAULT_PALETTE, mode: "light", fontFamily: FONT_FAMILY };
}

const chartHeight = (w: Widget) => Math.max(220, Math.min(420, Math.round((IMAGE_WIDTH * w.h) / Math.max(1, w.w))));

async function renderChartWidget(
  w: Widget, doc: Dashboard, periods: ReportPeriods, exec: Executor,
): Promise<{ png: Buffer; width: number; height: number } | null> {
  const c = w.config;
  if (c.kind !== "chart") return null;
  const dateCol = dateColumnFor(w, doc);
  const series = isTimeSeries(w, doc);
  const filter = dateCol ? periodFilter(dateCol, periods.cur) : null;
  // Biểu đồ theo thời gian: lấy cả lịch sử đến hết kỳ (bỏ cận dưới).
  if (filter && series && filter.dateRange) delete filter.dateRange.from;
  const q = specForWidget(w, filter ? [filter] : [], calcDefsFor(doc.calculatedFields, c.sourceId));
  if (!q || q.spec.mode !== "aggregate") return null;
  const r = await exec(q.sourceId, q.spec);
  if (r.mode !== "aggregate" || r.table.rows.length === 0) return null;
  const option = buildChartOptionFromTable(c, r.table, reportTheme(doc));
  if (!option) return null;
  const h = chartHeight(w);
  return svgToPng(withTitle(chartSvg(padGrid(option), IMAGE_WIDTH, h), c.title ?? "", IMAGE_WIDTH, h));
}

/**
 * Vẽ ảnh cho báo cáo. Số trên thẻ KPI lấy từ `facts` (cùng số với bảng KPI và bài viết); biểu đồ truy vấn theo kỳ:
 * biểu đồ theo nhóm chỉ lấy dữ liệu trong kỳ báo cáo, biểu đồ theo thời gian lấy lịch sử đến hết kỳ.
 * Lỗi vẽ một ảnh không làm hỏng báo cáo: ảnh đó bị bỏ và ghi vào `notes`.
 */
export async function renderReportImages(p: {
  doc: Dashboard;
  facts: ReportFacts;
  periods: ReportPeriods;
  exec: Executor;
  widgetIds: string[];
}): Promise<{ images: RenderedImage[]; notes: string[] }> {
  const { doc, facts, periods, exec } = p;
  const notes: string[] = [];
  const out: RenderedImage[] = [];
  const widgets = pickImageWidgets(doc, p.widgetIds);
  for (const [i, w] of widgets.entries()) {
    try {
      let img: { png: Buffer; width: number; height: number } | null = null;
      let title = "";
      if (w.config.kind === "kpi") {
        const k = facts.kpis.find((x) => x.widgetId === w.id);
        if (!k) {
          notes.push(`Thẻ KPI "${w.config.title ?? w.id}" chưa có số liệu để vẽ ảnh.`);
          continue;
        }
        img = svgToPng(kpiCardSvg(k));
        title = k.title;
      } else {
        img = await renderChartWidget(w, doc, periods, exec);
        title = w.config.kind === "chart" ? w.config.title?.trim() || "Biểu đồ" : "";
      }
      if (!img) {
        notes.push(`Biểu đồ "${title || w.id}" không có dữ liệu trong kỳ nên không có ảnh.`);
        continue;
      }
      out.push({ widgetId: w.id, cid: `chart-${i + 1}@cerno.report`, title, ...img });
    } catch (e) {
      console.error("[report-image] vẽ ảnh thất bại:", e instanceof Error ? e.message : e);
      notes.push(`Không vẽ được ảnh cho widget ${w.id}.`);
    }
  }
  const { kept, dropped } = fitImageBudget(out);
  if (dropped) notes.push(`Đã bỏ ${dropped} ảnh để email không quá nặng.`);
  return { images: kept, notes };
}
