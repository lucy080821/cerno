import { formatCompact } from "@dashboard/chart-engine";
import { chartSvg, svgToPng, withTitle } from "@/lib/server/reports/render-chart";
import type { AlertSeries } from "./compute";

/**
 * Biểu đồ nhỏ (cột) cho email cảnh báo: các kỳ gần đây, kỳ hiện tại tô đỏ, vạch ngang là ngưỡng (nếu luật có ngưỡng).
 * Vẽ phía server bằng ECharts SSR → SVG → PNG (cùng đường với ảnh trong báo cáo định kỳ).
 */

const WIDTH = 600;
const HEIGHT = 230;

export function alertChartOption(series: AlertSeries, threshold: number | null): Record<string, unknown> {
  const last = series.values.length - 1;
  const data = series.values.map((v, i) => (v === null ? null : { value: v, itemStyle: { color: i === last ? "#dc2626" : "#9aa5ff" } }));
  return {
    textStyle: { fontFamily: "Noto Sans" },
    grid: { left: 12, right: 36, top: 24, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: series.labels, axisLabel: { color: "#6b7280", fontSize: 11, hideOverlap: true } },
    yAxis: { type: "value", axisLabel: { color: "#6b7280", fontSize: 11, formatter: (v: number) => formatCompact(v) }, splitLine: { lineStyle: { color: "#eef0f4" } } },
    series: [
      {
        type: "bar",
        data,
        barMaxWidth: 28,
        ...(threshold !== null && Number.isFinite(threshold)
          ? {
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { color: "#14162b", type: "dashed", width: 1.5 },
                label: { formatter: "Ngưỡng", color: "#14162b", fontSize: 11 },
                data: [{ yAxis: threshold }],
              },
            }
          : {}),
      },
    ],
  };
}

/** PNG của biểu đồ nhỏ. null nếu không có đủ dữ liệu để vẽ (cần ít nhất 2 giá trị). */
export function alertChartPng(series: AlertSeries, threshold: number | null, title: string) {
  if (series.values.filter((v) => v !== null).length < 2) return null;
  return svgToPng(withTitle(chartSvg(alertChartOption(series, threshold), WIDTH, HEIGHT), title, WIDTH, HEIGHT));
}
