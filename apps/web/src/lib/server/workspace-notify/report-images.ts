import { formatCompact, addDays } from "@dashboard/chart-engine";
import type { ProfitSummary } from "@/lib/profit/order-profit";
import { IMAGE_WIDTH, chartSvg, fitImageBudget, svgToPng, withTitle, type RenderedImage } from "@/lib/server/reports/render-chart";
import type { ReportPeriods } from "@/lib/server/reports/period";

/**
 * Ảnh cho báo cáo theo cửa hàng: 3 biểu đồ cố định (Lãi theo ngày, Lãi theo kênh, Top sản phẩm theo doanh thu), vẽ bằng ECharts phía server
 * rồi đổi sang PNG như báo cáo dashboard (cùng font, nền trắng, rộng 600px). Chỉ vẽ biểu đồ có dữ liệu; lỗi vẽ một ảnh thì bỏ ảnh đó.
 */

const FONT = "Noto Sans";
const GREEN = "#6d5efc";
const RED = "#dc2626";
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const base = {
  textStyle: { fontFamily: FONT },
  animation: false,
};
const axisText = { fontFamily: FONT, fontSize: 11, color: "#6b7280" };
const yAxis = { type: "value", axisLabel: { ...axisText, formatter: (v: number) => formatCompact(v) }, splitLine: { lineStyle: { color: "#e5e7eb" } } };

/** Ngày liên tiếp từ `from` đến `to` (gồm hai đầu), tối đa 62 ngày. */
function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
}

export function dailyProfitOption(daily: ProfitSummary["daily"], from: string, to: string): Record<string, unknown> | null {
  const byDay = new Map(daily.map((d) => [d.date, d.profit]));
  const labels = days(from, to);
  if (!labels.some((d) => byDay.has(d))) return null;
  return {
    ...base,
    grid: { left: 58, right: 16, top: 16, bottom: 34 },
    xAxis: { type: "category", data: labels.map(dm), axisLabel: { ...axisText, interval: labels.length > 16 ? Math.ceil(labels.length / 10) - 1 : 0 }, axisTick: { show: false } },
    yAxis,
    series: [{ type: "bar", barMaxWidth: 26, data: labels.map((d) => { const v = byDay.get(d) ?? 0; return { value: v, itemStyle: { color: v < 0 ? RED : GREEN } }; }) }],
  };
}

export function channelProfitOption(channels: ProfitSummary["channels"]): Record<string, unknown> | null {
  const rows = channels.filter((c) => c.profit !== 0).sort((a, b) => b.profit - a.profit).slice(0, 8);
  if (!rows.length) return null;
  return {
    ...base,
    grid: { left: 58, right: 16, top: 16, bottom: 34 },
    xAxis: { type: "category", data: rows.map((r) => r.channel), axisLabel: axisText, axisTick: { show: false } },
    yAxis,
    series: [{ type: "bar", barMaxWidth: 46, data: rows.map((r) => ({ value: r.profit, itemStyle: { color: r.profit < 0 ? RED : GREEN } })), label: { show: true, position: "top", fontFamily: FONT, fontSize: 11, color: "#14162b", formatter: (p: { value: number }) => formatCompact(p.value) } }],
  };
}

export function topProductsOption(products: ProfitSummary["products"]): Record<string, unknown> | null {
  const rows = products.filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 8).reverse();
  if (!rows.length) return null;
  const name = (n: string) => (n.length > 26 ? n.slice(0, 25) + "…" : n);
  return {
    ...base,
    grid: { left: 150, right: 56, top: 12, bottom: 24 },
    xAxis: { type: "value", axisLabel: { ...axisText, formatter: (v: number) => formatCompact(v) }, splitLine: { lineStyle: { color: "#e5e7eb" } } },
    yAxis: { type: "category", data: rows.map((r) => name(r.name)), axisLabel: axisText, axisTick: { show: false } },
    series: [{ type: "bar", barMaxWidth: 20, data: rows.map((r) => r.revenue), itemStyle: { color: GREEN }, label: { show: true, position: "right", fontFamily: FONT, fontSize: 11, color: "#14162b", formatter: (p: { value: number }) => formatCompact(p.value) } }],
  };
}

/** Khoảng ngày của biểu đồ "Lãi theo ngày": báo cáo hằng ngày xem 14 ngày kết thúc ở ngày báo cáo, còn lại đúng kỳ báo cáo. */
export function dailyWindow(periods: ReportPeriods): { from: string; to: string } {
  return periods.cur.from === periods.cur.to ? { from: addDays(periods.cur.to, -13), to: periods.cur.to } : { from: periods.cur.from, to: periods.cur.to };
}

/**
 * `cur` là tổng hợp của kỳ báo cáo; `daily` là tổng hợp của khoảng `dailyWindow` (có thể rộng hơn kỳ khi báo cáo hằng ngày).
 */
export function renderStoreImages(p: { cur: ProfitSummary; daily: ProfitSummary; periods: ReportPeriods }): { images: RenderedImage[]; notes: string[] } {
  const win = dailyWindow(p.periods);
  const specs: { id: string; title: string; option: Record<string, unknown> | null; h: number }[] = [
    { id: "daily", title: "Lãi theo ngày", option: dailyProfitOption(p.daily.daily, win.from, win.to), h: 240 },
    { id: "channels", title: "Lãi theo kênh bán", option: channelProfitOption(p.cur.channels), h: 240 },
    { id: "products", title: "Top sản phẩm theo doanh thu", option: topProductsOption(p.cur.products), h: 300 },
  ];
  const notes: string[] = [];
  const out: RenderedImage[] = [];
  for (const [i, s] of specs.entries()) {
    if (!s.option) continue;
    try {
      const img = svgToPng(withTitle(chartSvg(s.option, IMAGE_WIDTH, s.h), s.title, IMAGE_WIDTH, s.h));
      out.push({ widgetId: `ws-${s.id}`, cid: `chart-${i + 1}@cerno.report`, title: s.title, ...img });
    } catch (e) {
      console.error("[store-report-image] vẽ ảnh thất bại:", e instanceof Error ? e.message : e);
      notes.push(`Không vẽ được biểu đồ "${s.title}".`);
    }
  }
  const { kept, dropped } = fitImageBudget(out);
  if (dropped) notes.push(`Đã bỏ ${dropped} ảnh để email không quá nặng.`);
  return { images: kept, notes };
}
