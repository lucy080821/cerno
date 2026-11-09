import { describe, expect, it } from "vitest";
import type { ChartConfig } from "@dashboard/schema";
import {
  buildChartOption, CHART_SPECS, CHART_TYPE_ORDER, chartColorKeys, clampFields, hasEnoughFields, niceMax, type Row,
} from "./index";

const rows: Row[] = [
  { month: "T1", region: "Bắc", rev: 100, orders: 10, visits: 1000 },
  { month: "T1", region: "Nam", rev: 50, orders: 5, visits: 400 },
  { month: "T2", region: "Bắc", rev: 200, orders: 20, visits: 2500 },
  { month: "T2", region: "Nam", rev: 70, orders: 5, visits: 900 },
];

const sum = (column: string) => ({ column, aggregation: "sum" as const });
const mk = (chartType: ChartConfig["chartType"], over: Partial<ChartConfig> = {}): ChartConfig => ({
  kind: "chart", chartType, sourceId: "s",
  dimensions: [{ column: "region" }],
  metrics: [sum("rev")],
  ...over,
});
const theme = { palette: [], mode: "light" as const };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const opt = (c: ChartConfig, data = rows) => buildChartOption(c, data, theme) as any;

describe("CHART_SPECS", () => {
  it("mọi loại trong schema đều có mô tả và có mặt trong danh sách thứ tự", () => {
    expect([...CHART_TYPE_ORDER].sort()).toEqual(Object.keys(CHART_SPECS).sort());
  });

  it("hasEnoughFields theo từng loại", () => {
    expect(hasEnoughFields("bar", 1, 1)).toBe(true);
    expect(hasEnoughFields("bar", 0, 1)).toBe(false);
    expect(hasEnoughFields("scatter", 1, 1)).toBe(false);
    expect(hasEnoughFields("scatter", 1, 2)).toBe(true);
    expect(hasEnoughFields("radar", 1, 2)).toBe(false);
    expect(hasEnoughFields("radar", 1, 3)).toBe(true);
    expect(hasEnoughFields("gauge", 0, 1)).toBe(true);
    expect(hasEnoughFields("heatmap", 1, 1)).toBe(false);
    expect(hasEnoughFields("heatmap", 2, 1)).toBe(true);
    expect(hasEnoughFields("table", 0, 0)).toBe(true);
  });

  it("clampFields cắt phần thừa khi đổi loại", () => {
    const r = clampFields("pie", ["a", "b"], ["x", "y", "z"]);
    expect(r).toEqual({ dims: ["a"], metrics: ["x"] });
    expect(clampFields("gauge", ["a"], ["x", "y"])).toEqual({ dims: [], metrics: ["x"] });
  });
});

describe("cột ngang / cột chồng", () => {
  it("cột ngang đổi trục: trục nhóm nằm dọc, nhóm đầu ở trên", () => {
    const o = opt(mk("hbar"));
    expect(o.yAxis.type).toBe("category");
    expect(o.yAxis.inverse).toBe(true);
    expect(o.xAxis.type).toBe("value");
    expect(o.series[0].type).toBe("bar");
  });

  it("cột chồng gắn stack cho mọi series", () => {
    const o = opt(mk("stackedbar", { dimensions: [{ column: "month" }, { column: "region" }] }));
    expect(o.series).toHaveLength(2);
    expect(o.series.every((s: { stack?: string }) => s.stack === "total")).toBe(true);
  });

  it("showXAxis/showYAxis theo nghĩa nhìn thấy được, kể cả khi cột ngang", () => {
    const o = opt(mk("hbar", { format: { showYAxis: false } }));
    expect(o.yAxis.show).toBe(false); // trục nhóm (dọc) bị ẩn
    expect(o.xAxis.show).toBe(true);
  });
});

describe("phễu / treemap", () => {
  it("phễu tạo series funnel với một mục mỗi giá trị", () => {
    const o = opt(mk("funnel"));
    expect(o.series[0].type).toBe("funnel");
    expect(o.series[0].data.map((d: { name: string; value: number }) => [d.name, d.value])).toEqual([["Bắc", 300], ["Nam", 120]]);
  });

  it("treemap một chiều: ô phẳng; hai chiều: nhóm có children", () => {
    const flat = opt(mk("treemap"));
    expect(flat.series[0].data).toHaveLength(2);
    expect(flat.series[0].data[0].children).toBeUndefined();

    const nested = opt(mk("treemap", { dimensions: [{ column: "region" }, { column: "month" }] }));
    expect(nested.series[0].data).toHaveLength(2);
    expect(nested.series[0].data[0].children.map((k: { name: string }) => k.name)).toEqual(["T1", "T2"]);
  });

  it("màu tuỳ chỉnh theo tên áp cho phễu và treemap", () => {
    const c = mk("funnel", { format: { colors: { Nam: "#123456" } } });
    expect(opt(c).color[1]).toBe("#123456");
    expect(chartColorKeys(mk("treemap"), rows)).toEqual(["Bắc", "Nam"]);
  });
});

describe("phân tán", () => {
  it("cần ít nhất 2 số đo", () => {
    expect(buildChartOption(mk("scatter"), rows, theme)).toBeNull();
  });

  it("mỗi giá trị của chiều là một chấm, giá trị = [x, y, cỡ]", () => {
    const o = opt(mk("scatter", { metrics: [sum("orders"), sum("rev"), sum("visits")] }));
    const s = o.series[0];
    expect(s.type).toBe("scatter");
    expect(s.data.map((d: { name: string; value: number[] }) => [d.name, ...d.value])).toEqual([
      ["Bắc", 30, 300, 3500],
      ["Nam", 10, 120, 1300],
    ]);
    expect(typeof s.symbolSize).toBe("function");
    expect(o.xAxis.name).toBe("Tổng orders");
  });

  it("tooltip thoát HTML trong tên điểm", () => {
    const evil: Row[] = [{ region: "<img src=x onerror=alert(1)>", rev: 1, orders: 2 }];
    const o = opt(mk("scatter", { metrics: [sum("orders"), sum("rev")] }), evil);
    const html = o.tooltip.formatter({ name: evil[0].region, value: [2, 1] });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("radar", () => {
  it("cần 3 số đo; mỗi giá trị của chiều là một vùng", () => {
    expect(buildChartOption(mk("radar", { metrics: [sum("rev"), sum("orders")] }), rows, theme)).toBeNull();
    const o = opt(mk("radar", { metrics: [sum("rev"), sum("orders"), sum("visits")] }));
    expect(o.radar.indicator.map((i: { name: string }) => i.name)).toEqual(["Tổng rev", "Tổng orders", "Tổng visits"]);
    expect(o.series[0].data).toHaveLength(2);
    expect(o.series[0].data[0].value).toEqual([300, 30, 3500]);
    // trục đủ lớn để không cắt giá trị lớn nhất
    expect(o.radar.indicator[0].max).toBeGreaterThan(300);
  });
});

describe("đồng hồ", () => {
  it("không cần chiều, lấy tổng làm giá trị và tự chọn max tròn", () => {
    const o = opt(mk("gauge", { dimensions: [] }));
    expect(o.series[0].type).toBe("gauge");
    expect(o.series[0].data[0].value).toBe(420);
    expect(o.series[0].max).toBe(500);
  });

  it("gaugeMax do người dùng đặt được ưu tiên", () => {
    const o = opt(mk("gauge", { dimensions: [], format: { gaugeMax: 1000 } }));
    expect(o.series[0].max).toBe(1000);
  });

  it("niceMax", () => {
    expect(niceMax(0)).toBe(100);
    expect(niceMax(70)).toBe(75);
    expect(niceMax(420)).toBe(500);
    expect(niceMax(1)).toBe(1.5);
    expect(niceMax(Number.NaN)).toBe(100);
  });

  it("chiều thừa bị bỏ qua (vừa đổi từ loại khác)", () => {
    const o = opt(mk("gauge", { dimensions: [{ column: "region" }] }));
    expect(o.series[0].data[0].value).toBe(420);
  });
});

describe("bản đồ nhiệt", () => {
  it("cần đúng 2 chiều; dữ liệu là [x, y, giá trị]", () => {
    expect(buildChartOption(mk("heatmap"), rows, theme)).toBeNull();
    const o = opt(mk("heatmap", { dimensions: [{ column: "month" }, { column: "region" }] }));
    expect(o.xAxis.data).toEqual(["T1", "T2"]);
    expect(o.yAxis.data).toEqual(["Bắc", "Nam"]);
    expect(o.series[0].data).toEqual([[0, 0, 100], [0, 1, 50], [1, 0, 200], [1, 1, 70]]);
    expect(o.visualMap.max).toBe(200);
  });

  it("không có mục đổi màu riêng", () => {
    expect(chartColorKeys(mk("heatmap", { dimensions: [{ column: "month" }, { column: "region" }] }), rows)).toEqual([]);
  });
});

describe("histogram", () => {
  const nums = Array.from({ length: 100 }, (_, i) => ({ v: i + 1 })) as Row[];
  const cfg = (extra = {}) => mk("histogram", {
    dimensions: [{ column: "v" }], metrics: [], ...extra,
  });

  it("chia khoảng bằng nhau và đếm đủ mọi dòng", () => {
    const o = buildChartOption(cfg({ format: { histBins: 10 } }), nums, theme) as any;
    expect(o.series[0].type).toBe("bar");
    expect(o.xAxis.data[0]).toBe("0–10");
    expect(o.series[0].data.reduce((a: number, b: number) => a + b, 0)).toBe(100);
    expect(o.series[0].data[0]).toBe(9); // 1..9
  });

  it("giữ khoảng trống với số đếm 0", () => {
    const rows = [{ v: 1 }, { v: 2 }, { v: 99 }] as Row[];
    const o = buildChartOption(cfg({ format: { histBins: 10 } }), rows, theme) as any;
    expect(o.series[0].data.includes(0)).toBe(true);
    expect(o.series[0].data.reduce((a: number, b: number) => a + b, 0)).toBe(3);
  });

  it("bỏ qua ô không phải số", () => {
    const rows = [{ v: 1 }, { v: null }, { v: "abc" }, { v: 5 }] as Row[];
    const o = buildChartOption(cfg(), rows, theme) as any;
    expect(o.series[0].data.reduce((a: number, b: number) => a + b, 0)).toBe(2);
  });

  it("mọi giá trị giống nhau vẫn vẽ được", () => {
    const o = buildChartOption(cfg(), [{ v: 7 }, { v: 7 }] as Row[], theme) as any;
    expect(o.series[0].data.reduce((a: number, b: number) => a + b, 0)).toBe(2);
  });

  it("đặt độ rộng và điểm bắt đầu", () => {
    const o = buildChartOption(cfg({ format: { histBinWidth: 25, histBinStart: 1 } }), nums, theme) as any;
    expect(o.xAxis.data).toEqual(["1–26", "26–51", "51–76", "76–101"]);
    expect(o.series[0].data).toEqual([25, 25, 25, 25]);
    const o2 = buildChartOption(cfg({ format: { histBinWidth: 50, histBinStart: 51 } }), nums, theme) as any;
    expect(o2.series[0].data).toEqual([50]); // giá trị < 51 bị bỏ
  });
});
