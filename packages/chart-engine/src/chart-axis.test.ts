import { describe, expect, it } from "vitest";
import type { ChartConfig } from "@dashboard/schema";
import { buildChartOption, defaultAxisTitles, resolveAxisTitles, type Row } from "./index";

const rows: Row[] = [
  { month: "T1", region: "Bắc", rev: 100, orders: 10 },
  { month: "T2", region: "Nam", rev: 50, orders: 5 },
];
const sum = (column: string) => ({ column, aggregation: "sum" as const });
const mk = (chartType: ChartConfig["chartType"], over: Partial<ChartConfig> = {}): ChartConfig => ({
  kind: "chart", chartType, sourceId: "s", dimensions: [{ column: "month" }], metrics: [sum("rev")], ...over,
});
const theme = { palette: [], mode: "light" as const };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const opt = (c: ChartConfig) => buildChartOption(c, rows, theme) as any;

describe("tên trục", () => {
  it("mặc định: chart cột không có tên trục", () => {
    const o = opt(mk("bar"));
    expect(o.xAxis.name).toBeUndefined();
    expect(o.yAxis.name).toBeUndefined();
  });

  it("đặt tên trục X và Y cho chart cột", () => {
    const o = opt(mk("bar", { format: { xAxisTitle: "Tháng", yAxisTitle: "Doanh thu (triệu)" } }));
    expect(o.xAxis.name).toBe("Tháng");
    expect(o.yAxis.name).toBe("Doanh thu (triệu)");
    // chừa chỗ cho tên: lề dưới lớn hơn mặc định (8)
    expect(o.grid.bottom).toBeGreaterThan(8);
  });

  it("cột ngang: X luôn là trục ngang (trục số), Y là trục dọc (trục nhóm)", () => {
    const o = opt(mk("hbar", { format: { xAxisTitle: "Giá trị", yAxisTitle: "Tháng" } }));
    expect(o.xAxis.type).toBe("value");
    expect(o.xAxis.name).toBe("Giá trị");
    expect(o.yAxis.type).toBe("category");
    expect(o.yAxis.name).toBe("Tháng");
  });

  it("phân tán: mặc định lấy tên hai số đo, có thể đổi hoặc ẩn bằng chuỗi rỗng", () => {
    const base = mk("scatter", { dimensions: [{ column: "region" }], metrics: [sum("orders"), sum("rev")] });
    expect(opt(base).xAxis.name).toBe("Tổng orders");
    expect(opt(base).yAxis.name).toBe("Tổng rev");
    expect(opt({ ...base, format: { xAxisTitle: "Đơn hàng" } }).xAxis.name).toBe("Đơn hàng");
    expect(opt({ ...base, format: { xAxisTitle: "", yAxisTitle: "  " } }).xAxis.name).toBeUndefined();
    expect(opt({ ...base, format: { yAxisTitle: "" } }).yAxis.name).toBeUndefined();
  });

  it("ẩn trục thì không vẽ tên trục", () => {
    const o = opt(mk("bar", { format: { showXAxis: false, xAxisTitle: "Tháng" } }));
    expect(o.xAxis.name).toBeUndefined();
  });

  it("resolveAxisTitles / defaultAxisTitles", () => {
    const sc = mk("scatter", { metrics: [sum("orders"), sum("rev")] });
    expect(defaultAxisTitles(sc)).toEqual({ x: "Tổng orders", y: "Tổng rev" });
    expect(defaultAxisTitles(mk("bar"))).toEqual({});
    expect(resolveAxisTitles(mk("bar", { format: { xAxisTitle: " Tháng " } }))).toEqual({ x: "Tháng", y: "" });
  });

  it("bản đồ nhiệt có thể đặt tên trục", () => {
    const o = opt(mk("heatmap", { dimensions: [{ column: "month" }, { column: "region" }], format: { xAxisTitle: "Tháng", yAxisTitle: "Khu vực" } }));
    expect(o.xAxis.name).toBe("Tháng");
    expect(o.yAxis.name).toBe("Khu vực");
  });
});
