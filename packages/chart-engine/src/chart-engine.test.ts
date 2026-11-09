import { describe, expect, it } from "vitest";
import type { ChartConfig } from "@dashboard/schema";
import { aggregate, buildChartOption, chartColorKeys, DEFAULT_PALETTE, formatCompact, resolveSeriesColors, type Row } from "./index";

const rows: Row[] = [
  { month: "T1", region: "Bắc", rev: 100, orders: 10 },
  { month: "T1", region: "Nam", rev: 50, orders: 5 },
  { month: "T2", region: "Bắc", rev: 200, orders: 20 },
  { month: "T2", region: "Nam", rev: 70, orders: 5 },
];

const cfg = (over: Partial<ChartConfig>): ChartConfig => ({
  kind: "chart",
  chartType: "bar",
  sourceId: "s",
  dimensions: [{ column: "month" }],
  metrics: [{ column: "rev", aggregation: "sum" }],
  ...over,
});

const theme = { palette: [], mode: "light" as const };

describe("aggregate", () => {
  it("cộng theo nhóm và giữ thứ tự xuất hiện", () => {
    const t = aggregate(rows, [{ column: "month" }], [{ column: "rev", aggregation: "sum" }]);
    expect(t.rows.map((r) => [r.keys[0], r.values[0]])).toEqual([["T1", 150], ["T2", 270]]);
  });

  it("avg, count_distinct và không có dimension", () => {
    const t = aggregate(rows, [], [
      { column: "rev", aggregation: "avg" },
      { column: "region", aggregation: "count_distinct" },
    ]);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].values).toEqual([105, 2]);
  });

  it("không có dòng dữ liệu vẫn trả một nhóm cho KPI", () => {
    const t = aggregate([], [], [{ column: "rev", aggregation: "sum" }]);
    expect(t.rows[0].values).toEqual([0]);
  });
});

describe("buildChartOption", () => {
  it("trả null khi chưa chọn trường", () => {
    expect(buildChartOption(cfg({ dimensions: [] }), rows, theme)).toBeNull();
    expect(buildChartOption(cfg({ metrics: [] }), rows, theme)).toBeNull();
  });

  it("bar: một series, trục x là các tháng", () => {
    const o = buildChartOption(cfg({}), rows, theme) as any;
    expect(o.xAxis.data).toEqual(["T1", "T2"]);
    expect(o.series).toHaveLength(1);
    expect(o.series[0].type).toBe("bar");
    expect(o.series[0].data).toEqual([150, 270]);
  });

  it("chiều thứ hai tách thành nhiều series", () => {
    const o = buildChartOption(
      cfg({ dimensions: [{ column: "month" }, { column: "region" }] }),
      rows,
      theme,
    ) as any;
    expect(o.series.map((s: any) => s.name)).toEqual(["Bắc", "Nam"]);
    expect(o.series[0].data).toEqual([100, 200]);
  });

  it("pie dùng dữ liệu name/value", () => {
    const o = buildChartOption(
      cfg({ chartType: "pie", dimensions: [{ column: "region" }] }),
      rows,
      theme,
    ) as any;
    expect(o.series[0].data).toEqual([
      { name: "Bắc", value: 300 },
      { name: "Nam", value: 120 },
    ]);
  });

  it("area là line có areaStyle", () => {
    const o = buildChartOption(cfg({ chartType: "area" }), rows, theme) as any;
    expect(o.series[0].type).toBe("line");
    expect(o.series[0].areaStyle).toBeDefined();
  });
});

describe("formatCompact", () => {
  it("rút gọn K/M/B", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1500)).toBe("1,5K");
    expect(formatCompact(2_500_000)).toBe("2,5M");
  });
});

import { applyFilters } from "./index";

describe("applyFilters (lọc chéo)", () => {
  const rows = [
    { st: "A", m: 1 },
    { st: "B", m: 2 },
    { st: "C", m: 3 },
  ];
  it("giữ dòng khớp giá trị đã chọn", () => {
    expect(applyFilters(rows, [{ column: "st", values: ["A", "C"] }]).map((r) => r.m)).toEqual([1, 3]);
  });
  it("không áp bộ lọc lên chính widget tạo ra nó", () => {
    expect(applyFilters(rows, [{ column: "st", values: ["A"], originId: "w1" }], "w1")).toBe(rows);
  });
  it("bỏ qua cột mà nguồn không có", () => {
    expect(applyFilters(rows, [{ column: "khac", values: ["x"] }])).toBe(rows);
  });
  it("nhiều bộ lọc là AND", () => {
    const r2 = [{ a: "1", b: "x" }, { a: "1", b: "y" }, { a: "2", b: "x" }];
    expect(applyFilters(r2, [{ column: "a", values: ["1"] }, { column: "b", values: ["x"] }])).toHaveLength(1);
  });
  it("highlight làm mờ cột không được chọn", () => {
    const cfg = { kind: "chart", chartType: "bar", sourceId: "s", dimensions: [{ column: "st" }], metrics: [{ column: "m", aggregation: "sum" }] } as never;
    const opt = buildChartOption(cfg, rows, { palette: [], mode: "light" }, ["B"]) as { series: { data: unknown[] }[] };
    expect(opt.series[0].data).toEqual([{ value: 1, itemStyle: { opacity: 0.3 } }, 2, { value: 3, itemStyle: { opacity: 0.3 } }]);
  });
});

describe("định dạng chart", () => {
  const base = { kind: "chart", chartType: "bar", sourceId: "s", dimensions: [{ column: "st" }], metrics: [{ column: "m", aggregation: "sum" }] };
  const th = { palette: [], mode: "light" as const };
  const data = [{ st: "A", m: 1 }, { st: "B", m: 2 }];
  type Opt = { xAxis: { show: boolean; axisLabel: Record<string, unknown> }; yAxis: { splitLine: { show: boolean } }; series: { label: { show: boolean; fontWeight: number; fontStyle: string } }[] };

  it("mặc định: hiện trục + lưới, tắt nhãn dữ liệu", () => {
    const o = buildChartOption(base as never, data, th) as unknown as Opt;
    expect(o.xAxis.show).toBe(true);
    expect(o.yAxis.splitLine.show).toBe(true);
    expect(o.series[0].label.show).toBe(false);
  });
  it("tắt trục/lưới, bật nhãn và kiểu chữ", () => {
    const cfg = { ...base, format: { showXAxis: false, showYAxis: true, showGrid: false, showDataLabels: true,
      axis: { fontSize: 20, bold: true, italic: true }, dataLabel: { bold: true, italic: true } } };
    const o = buildChartOption(cfg as never, data, th) as unknown as Opt;
    expect(o.xAxis.show).toBe(false);
    expect((o.yAxis as unknown as { show: boolean }).show).toBe(true);
    expect(o.yAxis.splitLine.show).toBe(false);
    expect(o.series[0].label).toMatchObject({ show: true, fontWeight: 700, fontStyle: "italic" });
    expect(o.xAxis.axisLabel).toMatchObject({ fontSize: 20, fontWeight: 700, fontStyle: "italic" });
  });
});

describe("bộ lọc dashboard (range, targets)", () => {
  const data = [{ g: "A", n: 1 }, { g: "B", n: 5 }, { g: "C", n: 9 }];
  it("lọc theo khoảng số", () => {
    expect(applyFilters(data, [{ column: "n", values: [], range: { min: 2, max: 9 } }]).map((r) => r.g)).toEqual(["B", "C"]);
    expect(applyFilters(data, [{ column: "n", values: [], range: { max: 1 } }]).map((r) => r.g)).toEqual(["A"]);
  });
  it("khoảng rỗng = không lọc", () => {
    expect(applyFilters(data, [{ column: "n", values: [], range: {} }])).toBe(data);
  });
  it("targets: chỉ áp cho widget được chọn", () => {
    const f = [{ column: "g", values: ["A"], targets: ["w1"] }];
    expect(applyFilters(data, f, "w1")).toHaveLength(1);
    expect(applyFilters(data, f, "w2")).toBe(data);
  });
});

import { toIsoDate } from "./index";
describe("lọc khoảng ngày", () => {
  const data = [{ d: "2025-01-10", n: 1 }, { d: "2025-02-15", n: 2 }, { d: "20/03/2025", n: 3 }, { d: "không rõ", n: 4 }];
  it("toIsoDate hiểu ISO và dd/mm/yyyy", () => {
    expect(toIsoDate("2025-01-10T08:00:00Z")).toBe("2025-01-10");
    expect(toIsoDate("5/3/2025")).toBe("2025-03-05");
    expect(toIsoDate("abc")).toBeNull();
  });
  it("lấy cả hai đầu, bỏ dòng không đọc được ngày", () => {
    const r = applyFilters(data, [{ column: "d", values: [], dateRange: { from: "2025-01-10", to: "2025-03-20" } }]);
    expect(r.map((x) => x.n)).toEqual([1, 2, 3]);
  });
  it("chỉ có một đầu", () => {
    expect(applyFilters(data, [{ column: "d", values: [], dateRange: { from: "2025-02-01" } }]).map((x) => x.n)).toEqual([2, 3]);
    expect(applyFilters(data, [{ column: "d", values: [], dateRange: {} }])).toBe(data);
  });
});

describe("màu series (format.colors)", () => {
  const rows = [
    { M: "A", S: "x", V: 1 }, { M: "B", S: "x", V: 2 },
    { M: "A", S: "y", V: 3 }, { M: "B", S: "y", V: 4 },
  ];
  const base = {
    kind: "chart" as const, chartType: "bar" as const, sourceId: "s",
    dimensions: [{ column: "M" }], metrics: [{ column: "V", aggregation: "sum" as const }],
  };
  const th = { palette: [], mode: "light" as const };
  const colorOf = (cfg: Parameters<typeof buildChartOption>[0]) =>
    (buildChartOption(cfg, rows, th) as { color: string[] }).color;

  it("mặc định dùng palette theo thứ tự", () => {
    expect(colorOf(base)[0]).toBe(DEFAULT_PALETTE[0]);
  });
  it("khoá theo tên metric", () => {
    const label = "Tổng V";
    expect(colorOf({ ...base, format: { colors: { [label]: "#ff0000" } } })[0]).toBe("#ff0000");
  });
  it("chiều thứ hai: khoá theo tên series, series không đặt giữ màu palette", () => {
    const cfg = { ...base, dimensions: [{ column: "M" }, { column: "S" }], format: { colors: { y: "#00ff00" } } };
    expect(colorOf(cfg)).toEqual([DEFAULT_PALETTE[0], "#00ff00"]);
    expect(chartColorKeys(cfg, rows)).toEqual(["x", "y"]);
  });
  it("biểu đồ tròn: khoá theo tên lát", () => {
    const cfg = { ...base, chartType: "pie" as const, format: { colors: { B: "#123456" } } };
    expect(colorOf(cfg)).toEqual([DEFAULT_PALETTE[0], "#123456"]);
  });
  it("tên đặc biệt như __proto__ không gây lỗi", () => {
    const keys = resolveSeriesColors(["__proto__", "a"], [], {});
    expect(keys).toHaveLength(2);
  });
});

describe("độ rộng cột (format.barWidth)", () => {
  const rows2 = [{ M: "A", V: 1 }, { M: "B", V: 2 }];
  const c = {
    kind: "chart" as const, chartType: "bar" as const, sourceId: "s",
    dimensions: [{ column: "M" }], metrics: [{ column: "V", aggregation: "sum" as const }],
  };
  const th = { palette: [], mode: "light" as const };
  const s0 = (cfg: Parameters<typeof buildChartOption>[0]) =>
    (buildChartOption(cfg, rows2, th) as { series: Array<{ barWidth?: number; barMaxWidth?: number }> }).series[0];

  it("mặc định tối đa 36px", () => {
    expect(s0(c)).toMatchObject({ barMaxWidth: 36 });
    expect(s0(c).barWidth).toBeUndefined();
  });
  it("đặt độ rộng thì dùng đúng số đó", () => {
    const s = s0({ ...c, format: { barWidth: 60 } });
    expect(s.barWidth).toBe(60);
    expect(s.barMaxWidth).toBeUndefined();
  });
});
