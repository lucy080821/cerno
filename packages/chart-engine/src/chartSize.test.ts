import { describe, expect, it } from "vitest";
import { buildChartOption, chartMinSize, chartScrollSize, type Row } from "./index";

const theme = { palette: [], mode: "light" as const };
const months = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ m: `T${i + 1}`, v: i + 1, w: 2 * i }));
const cfg = (chartType: string, extra: object = {}) => ({
  kind: "chart" as const, chartType, sourceId: "s", dimensions: [{ column: "m" }], metrics: [{ column: "v", aggregation: "sum" as const }], ...extra,
}) as never;
const opt = (chartType: string, n: number, extra: object = {}) =>
  buildChartOption(cfg(chartType, extra), months(n), theme) as Record<string, unknown>;

describe("chartScrollSize: chart nào cần cuộn trên màn hình hẹp", () => {
  const W = 346; // khung điện thoại dọc đã trừ lề
  const H = 220;

  it("chart ít mục thì vừa khung, không cuộn", () => {
    expect(chartScrollSize("bar", opt("bar", 5), W, H)).toBeNull();
    expect(chartScrollSize("line", opt("line", 8), W, H)).toBeNull();
  });

  it("chart cột nhiều mục cần cuộn ngang, rộng đủ để mỗi cột đọc được", () => {
    const r = chartScrollSize("bar", opt("bar", 24), W, H)!;
    expect(r.h).toBeNull();
    expect(r.w!).toBeGreaterThan(W);
    expect(r.w!).toBeGreaterThanOrEqual(24 * 40);
  });

  it("nhiều số đo (cột đứng cạnh nhau theo nhóm) cần rộng hơn", () => {
    const one = chartMinSize("bar", opt("bar", 12)).minW!;
    const three = chartMinSize("bar", opt("bar", 12, { metrics: [
      { column: "v", aggregation: "sum" }, { column: "w", aggregation: "sum" }, { column: "v", aggregation: "avg" },
    ] })).minW!;
    expect(three).toBeGreaterThan(one);
  });

  it("cột ngang nhiều mục cần cuộn dọc, không cuộn ngang", () => {
    const r = chartScrollSize("hbar", opt("hbar", 30), W, H)!;
    expect(r.w).toBeNull();
    expect(r.h!).toBeGreaterThan(H);
  });

  it("đường và vùng có ngưỡng thoáng hơn cột", () => {
    expect(chartMinSize("line", opt("line", 20)).minW!).toBeLessThan(chartMinSize("bar", opt("bar", 20)).minW!);
  });

  it("chart không có trục danh mục (tròn, phễu...) không bao giờ cuộn", () => {
    expect(chartScrollSize("pie", opt("pie", 40), W, H)).toBeNull();
    expect(chartMinSize("pie", opt("pie", 40))).toEqual({ minW: null, minH: null });
  });

  it("khung rộng hơn (xoay ngang) thì ít chart cần cuộn hơn", () => {
    const o = opt("bar", 14);
    expect(chartScrollSize("bar", o, 346, H)).not.toBeNull();
    expect(chartScrollSize("bar", o, 760, H)).toBeNull();
  });

  it("dung sai nhỏ: chỉ vượt vài px thì không bật cuộn", () => {
    const { minW } = chartMinSize("bar", opt("bar", 9));
    expect(chartScrollSize("bar", opt("bar", 9), minW! - 3, H)).toBeNull();
  });

  it("option rỗng hoặc lạ không gây lỗi", () => {
    expect(chartMinSize("bar", {})).toEqual({ minW: null, minH: null });
    expect(chartMinSize("bar", { xAxis: [{ type: "category", data: ["a", "b"] }], series: "x" }).minW).not.toBeNull();
  });
});
