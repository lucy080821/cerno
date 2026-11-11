import type { ChartConfig } from "@dashboard/schema";
import type { AggregatedTable } from "./aggregate";
import {
  FORECAST_DEFAULTS,
  FORECAST_GRAINS,
  FORECAST_MAX_SERIES,
  forecastFailText,
  forecastSeries,
  type ForecastFail,
  type ForecastOptions,
  type SeriesForecast,
} from "./forecast";
import type { Grain } from "./period";

/** Phần dự báo ở cấp chart: gắn engine số học (forecast.ts) với bảng đã gộp / các series đang vẽ. */

export interface ChartForecastItem {
  /** Vị trí series gốc trong danh sách series của chart. */
  index: number;
  name: string;
  result: SeriesForecast;
}

export interface ChartForecast {
  items: ChartForecastItem[];
  /** Lý do các series không dự báo được (mỗi lý do một lần). Rỗng khi mọi series đều được. */
  failures: ForecastFail[];
  /** Số series bị bỏ qua vì vượt FORECAST_MAX_SERIES. */
  skipped: number;
  options: ForecastOptions;
  /** Nhãn các kỳ tương lai chưa có trong trục, theo thứ tự thời gian. */
  extraLabels: string[];
}

export interface ChartSeriesValues {
  name: string;
  values: Array<number | null>;
}

export function forecastOptionsOf(config: ChartConfig): ForecastOptions | null {
  const f = config.format?.forecast;
  if (!f) return null;
  return {
    periods: f.periods ?? FORECAST_DEFAULTS.periods,
    method: f.method ?? FORECAST_DEFAULTS.method,
    level: f.level ?? FORECAST_DEFAULTS.level,
  };
}

/** Chart nào có thể dự báo: đường/vùng, và chiều đầu có cấp gom ngày theo dòng thời gian. */
export function forecastGrainOf(config: ChartConfig): Grain | null {
  if (config.chartType !== "line" && config.chartType !== "area") return null;
  const g = config.dimensions[0]?.grain;
  return g && (FORECAST_GRAINS as string[]).includes(g) ? (g as Grain) : null;
}

/**
 * Dự báo mọi series (tối đa FORECAST_MAX_SERIES). Trả null khi chart không bật dự báo.
 * Khi chart bật mà không dự báo được thì vẫn trả đối tượng (items rỗng + failures) để giao diện giải thích.
 */
export function planChartForecast(
  config: ChartConfig,
  categories: string[],
  series: ChartSeriesValues[],
  today?: string,
): ChartForecast | null {
  const options = forecastOptionsOf(config);
  if (!options) return null;
  const grain = forecastGrainOf(config);
  if (!grain) return { items: [], failures: ["unsupported"], skipped: 0, options, extraLabels: [] };

  const items: ChartForecastItem[] = [];
  const failures: ForecastFail[] = [];
  series.slice(0, FORECAST_MAX_SERIES).forEach((s, index) => {
    const r = forecastSeries(categories, s.values, grain, options, today);
    if (r.ok) items.push({ index, name: s.name, result: r });
    else if (!failures.includes(r.reason)) failures.push(r.reason);
  });
  const have = new Set(categories);
  const extra = new Set<string>();
  for (const it of items) for (const l of it.result.labels) if (!have.has(l)) extra.add(l);
  // Nhãn kỳ theo dòng thời gian tự sắp đúng theo chữ.
  return { items, failures: items.length ? [] : failures, skipped: Math.max(0, series.length - FORECAST_MAX_SERIES), options, extraLabels: [...extra].sort() };
}

/** Tách bảng đã gộp thành danh sách nhãn kỳ + các series (cùng cách option.ts vẽ chart cartesian). */
export function pivotSeries(table: AggregatedTable): { categories: string[]; series: ChartSeriesValues[] } {
  const categories: string[] = [];
  const idx = new Map<string, number>();
  for (const r of table.rows) {
    const k = String(r.keys[0] ?? "");
    if (!idx.has(k)) {
      idx.set(k, categories.length);
      categories.push(k);
    }
  }
  if (table.dimLabels.length >= 2) {
    const by = new Map<string, Array<number | null>>();
    for (const r of table.rows) {
      const name = String(r.keys[1] ?? "");
      if (!by.has(name)) by.set(name, categories.map(() => null));
      by.get(name)![idx.get(String(r.keys[0] ?? ""))!] = r.values[0];
    }
    return { categories, series: [...by.entries()].map(([name, values]) => ({ name, values })) };
  }
  return {
    categories,
    series: table.metricLabels.map((name, mi) => {
      const values: Array<number | null> = categories.map(() => null);
      for (const r of table.rows) values[idx.get(String(r.keys[0] ?? ""))!] = r.values[mi];
      return { name, values };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Tóm tắt cho giao diện (huy hiệu "Dự báo · sai số ~x%")
// ---------------------------------------------------------------------------------------------

export interface ForecastInfo {
  ok: boolean;
  /** Câu giải thích khi không dự báo được. */
  failText?: string;
  /** Sai số backtest trung bình (0.07 = 7%); null nếu không tính được. */
  wape: number | null;
  /** Số điểm cuối đã giấu để kiểm tra. */
  backtestPoints: number;
  seasonal: boolean;
  droppedLast: boolean;
  periods: number;
  level: number;
  seriesCount: number;
  skipped: number;
}

export function summarizeForecast(f: ChartForecast): ForecastInfo {
  const wapes = f.items.map((i) => i.result.backtest.wape).filter((v): v is number => v !== null);
  return {
    ok: f.items.length > 0,
    failText: f.items.length ? undefined : forecastFailText(f.failures[0] ?? "too_few"),
    wape: wapes.length ? wapes.reduce((a, b) => a + b, 0) / wapes.length : null,
    backtestPoints: f.items.reduce((m, i) => Math.max(m, i.result.backtest.k), 0),
    seasonal: f.items.some((i) => i.result.seasonal),
    droppedLast: f.items.some((i) => i.result.droppedLast),
    periods: f.options.periods,
    level: f.options.level,
    seriesCount: f.items.length,
    skipped: f.skipped,
  };
}

/** Dự báo cho một chart từ bảng đã gộp (giao diện dùng để hiện huy hiệu). Null nếu chart không bật dự báo. */
export function chartForecastInfo(config: ChartConfig, table: AggregatedTable, today?: string): ForecastInfo | null {
  if (!forecastOptionsOf(config)) return null;
  const { categories, series } = pivotSeries(table);
  const plan = planChartForecast(config, categories, series, today);
  return plan ? summarizeForecast(plan) : null;
}
