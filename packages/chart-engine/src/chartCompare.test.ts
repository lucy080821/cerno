import { describe, expect, it } from "vitest";
import type { ChartConfig } from "@dashboard/schema";
import type { Row } from "./aggregate";
import { chartCompareSupported, computeChartCompare } from "./chartCompare";
import type { RowFilter } from "./filter";
import { buildChartOption } from "./option";

const cfg = (over: Partial<ChartConfig> = {}, to: "prev_period" | "prev_year" = "prev_year"): ChartConfig =>
  ({
    kind: "chart", sourceId: "s", chartType: "line", title: "x",
    dimensions: [{ column: "Ngày", aggregation: "sum", grain: "day" }],
    metrics: [{ column: "Doanh thu", aggregation: "sum" }],
    format: { compare: { to } },
    ...over,
  }) as unknown as ChartConfig;

const rows: Row[] = [
  // Kỳ hiện tại: 01–03/11/2026
  { Ngày: "2026-11-01", "Doanh thu": 100 }, { Ngày: "2026-11-02", "Doanh thu": 200 }, { Ngày: "2026-11-03", "Doanh thu": 300 },
  // Cùng kỳ năm ngoái: 01–03/11/2025
  { Ngày: "2025-11-01", "Doanh thu": 10 }, { Ngày: "2025-11-02", "Doanh thu": 20 },
  // Kỳ trước liền kề (3 ngày trước đó): 29–31/10/2026
  { Ngày: "2026-10-29", "Doanh thu": 7 }, { Ngày: "2026-10-31", "Doanh thu": 9 },
];
const TH = { palette: [], mode: "light" as const };
const range = (from: string, to: string): RowFilter[] => [{ column: "Ngày", dateRange: { from, to } } as RowFilter];

describe("so sánh kỳ trên chart", () => {
  it("cùng kỳ năm ngoái: ngày của năm trước được dời về năm nay để khớp nhãn trục", () => {
    const r = computeChartCompare(rows, range("2026-11-01", "2026-11-03"), undefined, cfg());
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    expect(r.table.rows.map((x) => [x.keys[0], x.values[0]])).toEqual([["2026-11-01", 10], ["2026-11-02", 20]]);
    expect(r.label).toBe("cùng kỳ năm ngoái");
    expect(r.prev).toEqual({ from: "2025-11-01", to: "2025-11-03" });
  });

  it("kỳ trước: khoảng liền kề cùng độ dài, dời tới đầu kỳ hiện tại", () => {
    const r = computeChartCompare(rows, range("2026-11-01", "2026-11-03"), undefined, cfg({}, "prev_period"));
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    expect(r.table.rows.map((x) => [x.keys[0], x.values[0]])).toEqual([["2026-11-01", 7], ["2026-11-03", 9]]);
    expect(r.label).toBe("kỳ trước");
  });

  it("thiếu bộ lọc khoảng ngày đủ hai đầu thì báo no_range", () => {
    expect(computeChartCompare(rows, [], undefined, cfg())).toEqual({ ok: false, reason: "no_range" });
    expect(computeChartCompare(rows, [{ column: "Ngày", dateRange: { from: "2026-11-01" } } as RowFilter], undefined, cfg())).toEqual({ ok: false, reason: "no_range" });
  });

  it("kỳ so sánh không có dòng nào thì báo no_data", () => {
    expect(computeChartCompare(rows, range("2024-01-01", "2024-01-03"), undefined, cfg())).toEqual({ ok: false, reason: "no_data" });
  });

  it("không bật so sánh thì trả null; chart không hỗ trợ thì báo unsupported", () => {
    expect(computeChartCompare(rows, range("2026-11-01", "2026-11-03"), undefined, cfg({ format: {} }))).toBeNull();
    expect(chartCompareSupported(cfg({ chartType: "hbar" }))).toBe(false);
    expect(chartCompareSupported(cfg({ dimensions: [{ column: "Ngày", aggregation: "sum" }] as never }))).toBe(false);
    expect(computeChartCompare(rows, range("2026-11-01", "2026-11-03"), undefined, cfg({ chartType: "pie" }))).toEqual({ ok: false, reason: "unsupported" });
  });

  it("bộ lọc khác (không phải ngày) vẫn áp cho cả hai kỳ", () => {
    const rs: Row[] = [...rows.map((r) => ({ ...r, Kênh: "A" })), { Ngày: "2025-11-01", "Doanh thu": 999, Kênh: "B" }];
    const fs: RowFilter[] = [...range("2026-11-01", "2026-11-03"), { column: "Kênh", values: ["A"] } as RowFilter];
    const r = computeChartCompare(rs, fs, undefined, cfg());
    expect(r?.ok && r.table.rows[0].values[0]).toBe(10);
  });

  it("buildChartOption thêm series nét đứt của kỳ so sánh, khớp theo nhãn trục", () => {
    const c = cfg();
    const f = range("2026-11-01", "2026-11-03");
    const cur = rows.filter((r) => String(r.Ngày).startsWith("2026-11"));
    const cmp = computeChartCompare(rows, f, undefined, c);
    const opt = buildChartOption(c, cur, TH, [], undefined, cmp && cmp.ok ? cmp : null) as { series: Array<{ name: string; data: unknown[]; lineStyle?: { type?: string } }>; legend: { show?: boolean } };
    expect(opt.series).toHaveLength(2);
    expect(opt.series[1].name).toBe("Tổng Doanh thu · cùng kỳ năm ngoái");
    expect(opt.series[1].data).toEqual([10, 20, null]);
    expect(opt.series[1].lineStyle?.type).toBe("dashed");
    expect(opt.legend.show).not.toBe(false);
  });

  it("cột: kỳ so sánh là cột nhạt; không đổi gì khi không có so sánh", () => {
    const c = cfg({ chartType: "bar" });
    const cur = rows.filter((r) => String(r.Ngày).startsWith("2026-11"));
    const cmp = computeChartCompare(rows, range("2026-11-01", "2026-11-03"), undefined, c);
    const opt = buildChartOption(c, cur, TH, [], undefined, cmp && cmp.ok ? cmp : null) as { series: Array<{ type: string; itemStyle?: { opacity?: number } }> };
    expect(opt.series[1].type).toBe("bar");
    expect(opt.series[1].itemStyle?.opacity).toBeLessThan(1);
    const plain = buildChartOption(c, cur, TH) as { series: unknown[] };
    expect(plain.series).toHaveLength(1);
  });
});
