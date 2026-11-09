import { describe, expect, it } from "vitest";
import type { ChartConfig } from "@dashboard/schema";
import { buildChartOption, linearRegression, trendOf, type Row } from "./index";

describe("linearRegression", () => {
  it("đường thẳng hoàn hảo: y = 2x + 1, R² = 1", () => {
    const fit = linearRegression([[0, 1], [1, 3], [2, 5], [3, 7]])!;
    expect(fit.slope).toBeCloseTo(2, 10);
    expect(fit.intercept).toBeCloseTo(1, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
  });

  it("dữ liệu nhiễu: R² nằm giữa 0 và 1", () => {
    const fit = linearRegression([[0, 1], [1, 4], [2, 3], [3, 7], [4, 6]])!;
    expect(fit.slope).toBeGreaterThan(0);
    expect(fit.r2).toBeGreaterThan(0);
    expect(fit.r2).toBeLessThan(1);
  });

  it("không đủ điểm hoặc x không đổi thì null; y không đổi thì R² = 1", () => {
    expect(linearRegression([[1, 1]])).toBeNull();
    expect(linearRegression([[2, 1], [2, 5]])).toBeNull();
    expect(linearRegression([[0, 4], [1, 4], [2, 4]])!.r2).toBe(1);
  });
});

describe("trendOf", () => {
  it("tuyến tính: bỏ qua ô trống khi tính nhưng vẫn vẽ cả dãy", () => {
    const t = trendOf([0, null, 4, 6], "linear");
    expect(t).toHaveLength(4);
    expect(t[1]).toBeCloseTo(2, 5);
    expect(t[3]).toBeCloseTo(6, 5);
  });

  it("trung bình trượt: đầu dãy dùng ít điểm hơn", () => {
    expect(trendOf([2, 4, 6, 8], "movingAverage", 2)).toEqual([2, 3, 5, 7]);
    expect(trendOf([3, 6, 9], "movingAverage", 3)).toEqual([3, 4.5, 6]);
  });

  it("trung bình trượt bỏ qua null", () => {
    expect(trendOf([2, null, 6], "movingAverage", 3)).toEqual([2, 2, 4]);
  });
});

const rows: Row[] = [
  { m: "T1", region: "A", rev: 10, orders: 1 },
  { m: "T2", region: "A", rev: 20, orders: 2 },
  { m: "T3", region: "A", rev: 30, orders: 3 },
  { m: "T1", region: "B", rev: 5, orders: 2 },
  { m: "T2", region: "B", rev: 5, orders: 4 },
  { m: "T3", region: "B", rev: 5, orders: 6 },
];
const sum = (column: string) => ({ column, aggregation: "sum" as const });
const mk = (chartType: ChartConfig["chartType"], over: Partial<ChartConfig> = {}): ChartConfig => ({
  kind: "chart", chartType, sourceId: "s", dimensions: [{ column: "m" }], metrics: [sum("rev")], ...over,
});
const theme = { palette: [], mode: "light" as const };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const opt = (c: ChartConfig) => buildChartOption(c, rows, theme) as any;

describe("đường xu hướng trên biểu đồ", () => {
  it("mặc định không có đường xu hướng", () => {
    expect(opt(mk("line")).series).toHaveLength(1);
  });

  it("đường: thêm một series nét đứt cho mỗi series", () => {
    const o = opt(mk("line", { format: { trendline: "linear" } }));
    expect(o.series).toHaveLength(2);
    const t = o.series[1];
    expect(t.lineStyle.type).toBe("dashed");
    expect(t.silent).toBe(true);
    // doanh thu cộng theo tháng 15, 25, 35 nằm đúng một đường thẳng nên đường hồi quy trùng khớp
    expect(t.data).toEqual([15, 25, 35]);
  });

  it("cột với hai nhóm: mỗi nhóm một đường, chú giải không liệt kê đường xu hướng", () => {
    const o = opt(mk("bar", { dimensions: [{ column: "m" }, { column: "region" }], format: { trendline: "linear" } }));
    expect(o.series).toHaveLength(4);
    expect(o.legend.data).toEqual(["A", "B"]);
    expect(o.series[2].lineStyle.color).toBe(o.color[0]);
    expect(o.series[3].lineStyle.color).toBe(o.color[1]);
  });

  it("trung bình trượt theo trendWindow", () => {
    const o = opt(mk("area", { format: { trendline: "movingAverage", trendWindow: 2 } }));
    expect(o.series[1].data).toEqual([15, 20, 30]);
    expect(o.series[1].name).toContain("TB trượt 2");
  });

  it("cột chồng: một đường duy nhất cho tổng các phần", () => {
    const o = opt(mk("stackedbar", { dimensions: [{ column: "m" }, { column: "region" }], format: { trendline: "linear" } }));
    expect(o.series).toHaveLength(3);
    expect(o.series[2].name).toContain("Tổng");
    expect(o.series[2].data[0]).toBeCloseTo(15, 5);
  });

  it("cột ngang chưa hỗ trợ: không thêm series", () => {
    expect(opt(mk("hbar", { format: { trendline: "linear" } })).series).toHaveLength(1);
  });
});

describe("đường xu hướng của biểu đồ phân tán", () => {
  const sc = (format: ChartConfig["format"]) =>
    mk("scatter", { dimensions: [{ column: "region" }], metrics: [sum("orders"), sum("rev")], format });

  it("thêm đường thẳng hai đầu qua khoảng giá trị X", () => {
    const o = opt(sc({ trendline: "linear" }));
    expect(o.series).toHaveLength(2);
    const t = o.series[1];
    expect(t.type).toBe("line");
    expect(t.data).toHaveLength(2);
    expect(t.data[0][0]).toBeLessThan(t.data[1][0]);
  });

  it("trung bình trượt không có nghĩa với phân tán nên vẫn vẽ đường thẳng", () => {
    expect(opt(sc({ trendline: "movingAverage" })).series).toHaveLength(2);
  });

  it("hiện phương trình và R² khi bật showTrendInfo", () => {
    const o = opt(sc({ trendline: "linear", showTrendInfo: true }));
    const text = o.graphic.map((g: { style: { text: string } }) => g.style.text).join(" ");
    expect(text).toContain("R²");
    expect(text).toContain("y =");
    expect(opt(sc({ trendline: "linear" })).graphic).toBeUndefined();
  });

  it("chỉ một điểm thì không có đường", () => {
    const one = buildChartOption(sc({ trendline: "linear" }), [rows[0]], theme) as { series: unknown[] };
    expect(one.series).toHaveLength(1);
  });
});
