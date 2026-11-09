import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ECharts chỉ chạy các thành phần đã đăng ký (echarts.use). Engine sinh option thuần nên rất dễ dùng một khoá mới
 * (graphic, visualMap...) hoặc loại series mới mà quên đăng ký: lỗi chỉ lộ ra lúc chạy ("Component X is used but not
 * imported"). Test này đối chiếu mã engine với danh sách đăng ký trong WidgetContent.
 */
const engine = readFileSync(join(__dirname, "../../../../../packages/chart-engine/src/option.ts"), "utf8");
const widget = readFileSync(join(__dirname, "WidgetContent.tsx"), "utf8");
const start = widget.indexOf("echarts.use([");
const registered = widget.slice(start, widget.indexOf("]);", start));

const COMPONENT_KEYS: Record<string, string> = {
  graphic: "GraphicComponent",
  visualMap: "VisualMapComponent",
  radar: "RadarComponent",
  tooltip: "TooltipComponent",
  legend: "LegendComponent",
  grid: "GridComponent",
  title: "TitleComponent",
};
const SERIES: Record<string, string> = {
  bar: "BarChart", line: "LineChart", pie: "PieChart", scatter: "ScatterChart", treemap: "TreemapChart",
  funnel: "FunnelChart", radar: "RadarChart", gauge: "GaugeChart", heatmap: "HeatmapChart",
};

/** Khoá dùng như thuộc tính của option: "key: ...", hoặc viết gọn "{ key }", "key.length". */
const usesKey = (key: string) => new RegExp(String.raw`(^|[\s,{])${key}\s*(:|\.length|,|\})`, "m").test(engine);
const seriesTypes = () => new Set([...engine.matchAll(/type:\s*"(\w+)"/g)].map((m) => m[1]));

describe("đăng ký thành phần ECharts", () => {
  it("bộ dò khoá hoạt động (không bị im lặng bỏ sót)", () => {
    for (const key of Object.keys(COMPONENT_KEYS)) expect(usesKey(key), key).toBe(true);
    expect(seriesTypes().has("scatter")).toBe(true);
    expect(registered).toContain("TooltipComponent");
  });

  it("mọi khoá component engine dùng đều đã đăng ký", () => {
    const missing = Object.entries(COMPONENT_KEYS)
      .filter(([key, comp]) => usesKey(key) && !registered.includes(comp))
      .map(([, comp]) => comp);
    expect(missing).toEqual([]);
  });

  it("mọi loại series engine dùng đều đã đăng ký", () => {
    const missing = [...seriesTypes()].filter((t) => SERIES[t] && !registered.includes(SERIES[t])).map((t) => SERIES[t]);
    expect(missing).toEqual([]);
  });
});
