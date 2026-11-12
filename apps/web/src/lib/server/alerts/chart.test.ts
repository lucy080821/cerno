import { describe, expect, it } from "vitest";
import { alertChartOption, alertChartPng } from "./chart";

const series = { labels: ["01/11", "02/11", "03/11", "04/11"], values: [10, 12, null, 3] as (number | null)[] };

describe("biểu đồ nhỏ cho email cảnh báo", () => {
  it("kỳ hiện tại (cuối) tô đỏ, các kỳ trước màu nhạt, kỳ thiếu dữ liệu là null", () => {
    const o = alertChartOption(series, null) as { series: { data: ({ itemStyle: { color: string } } | null)[]; markLine?: unknown }[] };
    const d = o.series[0].data;
    expect(d[3]?.itemStyle.color).toBe("#dc2626");
    expect(d[0]?.itemStyle.color).not.toBe("#dc2626");
    expect(d[2]).toBeNull();
    expect(o.series[0].markLine).toBeUndefined();
  });
  it("có ngưỡng thì có vạch ngưỡng", () => {
    const o = alertChartOption(series, 8) as { series: { markLine: { data: { yAxis: number }[] } }[] };
    expect(o.series[0].markLine.data[0].yAxis).toBe(8);
  });
  it("vẽ được PNG rộng 600px có tiêu đề; ít hơn 2 giá trị thì không vẽ", () => {
    const r = alertChartPng(series, 8, "Doanh thu 14 ngày qua")!;
    expect(r.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(r.width).toBe(600);
    expect(r.png.length).toBeGreaterThan(3000);
    expect(alertChartPng({ labels: ["a"], values: [1] }, null, "x")).toBeNull();
    expect(alertChartPng({ labels: ["a", "b"], values: [null, 1] }, null, "x")).toBeNull();
  });
});
