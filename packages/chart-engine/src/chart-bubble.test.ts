import { describe, expect, it } from "vitest";
import type { ChartConfig } from "@dashboard/schema";
import { buildChartOption, CHART_SPECS, type Row } from "./index";

const rows: Row[] = [
  { region: "Bắc", views: 1000, rev: 300, orders: 30 },
  { region: "Nam", views: 400, rev: 120, orders: 10 },
  { region: "Trung", views: 100, rev: 40, orders: 0 },
];
const sum = (column: string) => ({ column, aggregation: "sum" as const });
const mk = (over: Partial<ChartConfig> = {}): ChartConfig => ({
  kind: "chart", chartType: "scatter", sourceId: "s", dimensions: [{ column: "region" }],
  metrics: [sum("views"), sum("rev"), sum("orders")], ...over,
});
const theme = { palette: [], mode: "light" as const };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const opt = (c: ChartConfig) => buildChartOption(c, rows, theme) as any;
const size = (o: { series: Array<{ symbolSize: unknown }> }, v: number[]) => (o.series[0].symbolSize as (v: number[]) => number)(v);

describe("biểu đồ bong bóng (phân tán + số đo thứ 3)", () => {
  it("ô số đo thứ 3 được gọi là kích thước bong bóng", () => {
    expect(CHART_SPECS.scatter.metricLabels[2]).toContain("bong bóng");
  });

  it("cỡ bong bóng nằm giữa bubbleMin và bubbleMax theo diện tích", () => {
    const o = opt(mk({ format: { bubbleMin: 10, bubbleMax: 50 } }));
    expect(size(o, [0, 0, 30])).toBeCloseTo(50, 5); // lớn nhất
    expect(size(o, [0, 0, 0])).toBeCloseTo(10, 5); // giá trị 0 = cỡ nhỏ nhất
    // giá trị bằng 1/4 giá trị lớn nhất thì đường kính ở nửa khoảng (căn bậc hai)
    expect(size(o, [0, 0, 7.5])).toBeCloseTo(30, 5);
  });

  it("có chú thích số đo quyết định cỡ bong bóng", () => {
    const o = opt(mk());
    expect(o.graphic[0].style.text).toContain("Tổng orders");
  });

  it("không có số đo thứ 3: chấm cỡ cố định (pointSize) và không có chú thích", () => {
    const base = mk({ metrics: [sum("views"), sum("rev")] });
    const o = opt(base);
    expect(o.series[0].symbolSize).toBe(11);
    expect(o.graphic).toBeUndefined();
    expect(opt({ ...base, format: { pointSize: 20 } }).series[0].symbolSize).toBe(20);
  });

  it("số đo thứ 3 toàn bằng 0 thì quay về chấm cố định, không chia cho 0", () => {
    const zero: Row[] = [{ region: "A", views: 1, rev: 1, orders: 0 }];
    const o = buildChartOption(mk(), zero, theme) as { series: Array<{ symbolSize: unknown }> };
    expect(o.series[0].symbolSize).toBe(11);
  });

  it("giá trị trong tooltip có cả số đo thứ 3", () => {
    const o = opt(mk());
    const html = o.tooltip.formatter({ name: "Bắc", value: [1000, 300, 30] });
    expect(html).toContain("Tổng orders");
  });
});
