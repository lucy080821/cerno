import type { ChartConfig } from "@dashboard/schema";
import { describe, expect, it } from "vitest";
import type { AggregatedTable } from "./aggregate";
import { chartForecastInfo, pivotSeries } from "./forecastChart";
import { buildChartOptionFromTable } from "./option";

const theme = { palette: ["#111111", "#222222"], mode: "light" as const };
const months = Array.from({ length: 24 }, (_, i) => `${2023 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);

const table = (values: number[], labels = months): AggregatedTable => ({
  dimLabels: ["Ngày"],
  metricLabels: ["Doanh thu"],
  rows: labels.map((l, i) => ({ keys: [l], values: [values[i]] })),
});

const config = (forecast?: ChartConfig["format"] extends infer F ? (F extends { forecast?: infer T } ? T : never) : never, grain: "month" | null = "month"): ChartConfig =>
  ({
    kind: "chart",
    chartType: "line",
    sourceId: "s",
    dimensions: [{ column: "Ngày", grain: grain ?? undefined }],
    metrics: [{ column: "Doanh thu", aggregation: "sum" }],
    format: forecast ? { forecast } : undefined,
  }) as ChartConfig;

const values = months.map((_, i) => 100 + 5 * i);
const TODAY = "2026-06-01";

type Opt = { xAxis: { data: string[] }; series: Array<Record<string, unknown>>; tooltip: { formatter?: (p: unknown) => string } };

describe("chart dự báo", () => {
  it("không bật thì option giữ nguyên (không có series dự báo)", () => {
    const o = buildChartOptionFromTable(config(), table(values), theme, [], TODAY) as unknown as Opt;
    expect(o.series).toHaveLength(1);
    expect(o.xAxis.data).toHaveLength(24);
  });

  it("bật: trục dài thêm đúng số kỳ, có đường nét đứt và dải tin cậy, series gốc được đệm null", () => {
    const o = buildChartOptionFromTable(config({ periods: 4 }), table(values), theme, [], TODAY) as unknown as Opt;
    expect(o.xAxis.data).toHaveLength(28);
    expect(o.xAxis.data.slice(-4)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04"]);
    const names = o.series.map((s) => s.name);
    expect(names).toContain("Doanh thu · dự báo");
    expect(names.filter((n) => String(n).startsWith("__"))).toHaveLength(2);
    const base = o.series[0].data as Array<number | null>;
    expect(base).toHaveLength(28);
    expect(base[27]).toBeNull();
    const fc = o.series.find((s) => s.name === "Doanh thu · dự báo")!;
    const data = fc.data as Array<number | null>;
    expect(data[22]).toBeNull();
    expect(data[23]).toBe(values[23]); // điểm nối với số liệu thật
    expect(data[24]).toBeGreaterThan(values[23]);
    expect((fc.lineStyle as { type: string }).type).toBe("dashed");
  });

  it("tắt dải thì không có series dải", () => {
    const o = buildChartOptionFromTable(config({ periods: 3, showBand: false }), table(values), theme, [], TODAY) as unknown as Opt;
    expect(o.series.filter((s) => String(s.name).startsWith("__"))).toHaveLength(0);
  });

  it("tooltip ẩn series dải, hiện khoảng tin cậy ở kỳ dự báo và thoát HTML tên series", () => {
    const t = table(values);
    t.metricLabels = ["<b>Thu</b>"];
    const o = buildChartOptionFromTable(config({ periods: 2 }), t, theme, [], TODAY) as unknown as Opt;
    const fmt = o.tooltip.formatter!;
    const html = fmt([
      { seriesName: "<b>Thu</b>", value: null, dataIndex: 24, axisValueLabel: "2025-01", marker: "" },
      { seriesName: "__lo0", value: 10, dataIndex: 24, axisValueLabel: "2025-01", marker: "" },
      { seriesName: "<b>Thu</b> · dự báo", value: 250, dataIndex: 24, axisValueLabel: "2025-01", marker: "" },
    ]);
    expect(html).not.toContain("__lo0");
    expect(html).not.toContain("<b>Thu</b>");
    expect(html).toContain("&lt;b&gt;Thu&lt;/b&gt;");
    expect(html).toMatch(/95%: .* – /);
    // Điểm nối (kỳ cuối có thật) không hiện lại dòng dự báo.
    const anchor = fmt([{ seriesName: "<b>Thu</b> · dự báo", value: 215, dataIndex: 23, axisValueLabel: "2024-12", marker: "" }]);
    expect(anchor).not.toContain("dự báo");
  });

  it("chart không đủ điều kiện (thiếu cấp gom ngày, ít điểm) thì vẽ như thường và giải thích lý do", () => {
    const no = buildChartOptionFromTable(config({ periods: 3 }, null), table(values), theme, [], TODAY) as unknown as Opt;
    expect(no.series).toHaveLength(1);
    const info = chartForecastInfo(config({ periods: 3 }, null), table(values), TODAY)!;
    expect(info.ok).toBe(false);
    expect(info.failText).toMatch(/ngày/);

    const few = chartForecastInfo(config({ periods: 3 }), table(values.slice(0, 5), months.slice(0, 5)), TODAY)!;
    expect(few.ok).toBe(false);
    expect(few.failText).toMatch(/Chưa đủ dữ liệu/);
    expect(chartForecastInfo(config(), table(values), TODAY)).toBeNull();
  });

  it("tóm tắt có sai số backtest, và báo kỳ cuối chưa trọn đã bị bỏ", () => {
    const info = chartForecastInfo(config({ periods: 3 }), table(values), "2024-12-20")!;
    expect(info.ok).toBe(true);
    expect(info.wape).not.toBeNull();
    expect(info.wape!).toBeLessThan(0.1);
    expect(info.backtestPoints).toBeGreaterThanOrEqual(2);
    expect(info.droppedLast).toBe(true);
  });

  it("chart chia nhiều series: dự báo từng series, tối đa 5", () => {
    const labels = months.slice(0, 20);
    const t: AggregatedTable = {
      dimLabels: ["Ngày", "Vùng"],
      metricLabels: ["Doanh thu"],
      rows: labels.flatMap((l, i) => Array.from({ length: 7 }, (_, s) => ({ keys: [l, `V${s}`], values: [50 + s * 10 + i] }))),
    };
    expect(pivotSeries(t).series).toHaveLength(7);
    const o = buildChartOptionFromTable({ ...config({ periods: 2 }), dimensions: [{ column: "Ngày", grain: "month" }, { column: "Vùng" }] } as ChartConfig, t, theme, [], TODAY) as unknown as Opt;
    const lines = o.series.filter((s) => String(s.name).endsWith("· dự báo"));
    expect(lines).toHaveLength(5);
    const info = chartForecastInfo({ ...config({ periods: 2 }), dimensions: [{ column: "Ngày", grain: "month" }, { column: "Vùng" }] } as ChartConfig, t, TODAY)!;
    expect(info.skipped).toBe(2);
  });
});
