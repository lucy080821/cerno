import { addDays, addMonths, grainLabel, periodEnd, periodStart, type Grain } from "./period";

/**
 * Dự báo chuỗi thời gian cho chart đường/vùng. Hàm thuần (không DOM, không echarts) để web, server và mobile dùng chung.
 *
 * Phương pháp thống kê (không phải "AI"): số liệu do thuật toán tính, kiểm chứng được:
 *  - Xu hướng      : hồi quy tuyến tính.
 *  - Mùa vụ        : Holt-Winters cộng.
 *  - Tự động       : trung bình (ensemble) của Holt giảm chấn + Theta (+ Holt-Winters khi đủ hai chu kỳ), và CHỌN giữa
 *                    bản có mùa vụ / không mùa vụ theo sai số kiểm chứng ngược (backtest).
 * Dải tin cậy lấy từ sai số một bước của mô hình, rồi co giãn theo sai số THẬT của backtest (ngoài mẫu).
 * Backtest: cắt `k` điểm cuối, dự báo lại bằng phần còn lại, đo sai số tuyệt đối tổng / tổng giá trị (WAPE).
 */

export type ForecastMethod = "auto" | "trend" | "seasonal";

export interface ForecastOptions {
  /** Số kỳ dự báo (1..24). */
  periods: number;
  method: ForecastMethod;
  /** Mức tin cậy của dải: 0.8 / 0.9 / 0.95. */
  level: number;
}

export const FORECAST_DEFAULTS: ForecastOptions = { periods: 6, method: "auto", level: 0.95 };
export const FORECAST_MAX_PERIODS = 24;
export const FORECAST_MIN_POINTS = 8;
/** Tối đa bao nhiêu đường được dự báo trong một chart (chart tách nhiều series sẽ rối nếu dự báo hết). */
export const FORECAST_MAX_SERIES = 5;

const Z: Record<string, number> = { "0.8": 1.2816, "0.9": 1.6449, "0.95": 1.96 };
const zOf = (level: number) => Z[String(level)] ?? 1.96;

// ---------------------------------------------------------------------------------------------
// Mô hình số học: mỗi mô hình trả `fc` (h giá trị) và `sd` (độ lệch chuẩn dự báo theo từng bước)
// ---------------------------------------------------------------------------------------------

interface Fit {
  fc: number[];
  sd: number[];
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);

function olsLine(y: number[]): { slope: number; intercept: number; sxx: number; xbar: number } {
  const n = y.length;
  const xbar = (n - 1) / 2;
  const ybar = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (i - xbar) ** 2;
    sxy += (i - xbar) * (y[i] - ybar);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: ybar - slope * xbar, sxx, xbar };
}

function linearFit(y: number[], h: number): Fit {
  const n = y.length;
  const { slope, intercept, sxx, xbar } = olsLine(y);
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - (intercept + slope * i)) ** 2;
  const sigma = Math.sqrt(sse / Math.max(1, n - 2));
  const fc: number[] = [];
  const sd: number[] = [];
  for (let j = 0; j < h; j++) {
    const x = n + j;
    fc.push(intercept + slope * x);
    sd.push(sigma * Math.sqrt(1 + 1 / n + (sxx === 0 ? 0 : (x - xbar) ** 2 / sxx)));
  }
  return { fc, sd };
}

/** Holt giảm chấn (ETS A,Ad,N): tìm α, β*, φ bằng lưới thô để SSE một bước nhỏ nhất. */
function holtFit(y: number[], h: number): Fit {
  const n = y.length;
  const k = Math.min(n - 1, 4);
  const b0 = k > 0 ? (y[k] - y[0]) / k : 0;
  let best = { sse: Infinity, a: 0.3, bs: 0.1, phi: 1, l: y[0], b: b0 };
  for (const a of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]) {
    for (const bs of [0.05, 0.1, 0.2, 0.3]) {
      for (const phi of [0.9, 0.95, 1]) {
        let l = y[0];
        let b = b0;
        let sse = 0;
        for (let t = 1; t < n; t++) {
          const pred = l + phi * b;
          const e = y[t] - pred;
          sse += e * e;
          l = pred + a * e;
          b = phi * b + a * bs * e;
        }
        if (sse < best.sse) best = { sse, a, bs, phi, l, b };
      }
    }
  }
  const sigma = Math.sqrt(best.sse / Math.max(1, n - 1));
  const fc: number[] = [];
  const sd: number[] = [];
  let damp = 0;
  let c2 = 0;
  for (let j = 1; j <= h; j++) {
    damp += best.phi ** j;
    fc.push(best.l + damp * best.b);
    // Phương sai dự báo: 1 + Σ c_i², c_i = α(1 + β* Σ φ^m) (Hyndman).
    sd.push(sigma * Math.sqrt(1 + c2));
    let ph = 0;
    for (let m = 1; m <= j; m++) ph += best.phi ** m;
    c2 += (best.a * (1 + best.bs * ph)) ** 2;
  }
  return { fc, sd };
}

/** Theta (Hyndman & Billah): san mũ đơn + nửa độ dốc của hồi quy tuyến tính. Rất mạnh với chuỗi ngắn. */
function thetaFit(y: number[], h: number): Fit {
  const n = y.length;
  let best = { sse: Infinity, a: 0.5, l: y[0] };
  for (let a = 0.05; a <= 1.0001; a += 0.05) {
    let l = y[0];
    let sse = 0;
    for (let t = 1; t < n; t++) {
      const e = y[t] - l;
      sse += e * e;
      l += a * e;
    }
    if (sse < best.sse) best = { sse, a, l };
  }
  const { slope } = olsLine(y);
  const sigma = Math.sqrt(best.sse / Math.max(1, n - 1));
  const fc: number[] = [];
  const sd: number[] = [];
  for (let j = 0; j < h; j++) {
    fc.push(best.l + (slope / 2) * (j + (1 - (1 - best.a) ** n) / best.a));
    sd.push(sigma * Math.sqrt(1 + j * best.a * best.a));
  }
  return { fc, sd };
}

/** Holt-Winters cộng (ETS A,A,A). Cần n ≥ 2m. */
function holtWintersFit(y: number[], m: number, h: number): Fit | null {
  const n = y.length;
  if (m < 2 || n < 2 * m) return null;
  const m1 = mean(y.slice(0, m));
  const m2 = mean(y.slice(m, 2 * m));
  const b0 = (m2 - m1) / m;
  // Mức ở cuối chu kỳ đầu; chỉ số mùa vụ ban đầu = phần còn lại sau khi trừ mức + độ dốc.
  const lEnd = m1 + (b0 * (m - 1)) / 2;
  const s0 = y.slice(0, m).map((v, i) => v - (m1 + b0 * (i - (m - 1) / 2)));
  let best: { sse: number; a: number; bs: number; g: number; l: number; b: number; s: number[] } | null = null;
  for (const a of [0.1, 0.3, 0.5, 0.7]) {
    for (const bs of [0, 0.05, 0.15]) {
      for (const g of [0.05, 0.2, 0.4, 0.6]) {
        let l = lEnd;
        let b = b0;
        const s = s0.slice();
        let sse = 0;
        for (let t = m; t < n; t++) {
          const i = t % m;
          const pred = l + b + s[i];
          const e = y[t] - pred;
          sse += e * e;
          l = l + b + a * e;
          b = b + a * bs * e;
          s[i] = s[i] + g * (1 - a) * e;
        }
        if (!best || sse < best.sse) best = { sse, a, bs, g, l, b, s };
      }
    }
  }
  if (!best || !Number.isFinite(best.sse)) return null;
  const sigma = Math.sqrt(best.sse / Math.max(1, n - m));
  const fc: number[] = [];
  const sd: number[] = [];
  let c2 = 0;
  for (let j = 1; j <= h; j++) {
    fc.push(best.l + j * best.b + best.s[(n + j - 1) % m]);
    sd.push(sigma * Math.sqrt(1 + c2));
    c2 += (best.a * (1 + j * best.bs) + (j % m === 0 ? best.g * (1 - best.a) : 0)) ** 2;
  }
  return { fc, sd };
}

/** Chỉ số mùa vụ cộng theo từng pha (trung bình phần dư quanh đường thẳng, đã đưa về trung bình 0). */
function seasonalIndices(y: number[], m: number): number[] {
  const { slope, intercept } = olsLine(y);
  const acc: number[][] = Array.from({ length: m }, () => []);
  y.forEach((v, i) => acc[i % m].push(v - (intercept + slope * i)));
  const raw = acc.map(mean);
  const c = mean(raw);
  return raw.map((v) => v - c);
}

/**
 * Mùa vụ mạnh đến đâu: phương sai của chỉ số mùa vụ / phương sai của chuỗi sau khi bỏ đường thẳng. ~0 = không có mùa vụ.
 * Dùng để không bao giờ gọi một chuỗi là "có mùa vụ" chỉ vì mô hình mùa vụ tình cờ khớp xu hướng tốt hơn.
 */
export function seasonalStrength(y: number[], m: number): number {
  if (m < 2 || y.length < 2 * m) return 0;
  const { slope, intercept } = olsLine(y);
  const resid = y.map((v, i) => v - (intercept + slope * i));
  const total = mean(resid.map((v) => v * v));
  if (total < 1e-9 * Math.max(1, mean(y.map((v) => v * v)))) return 0;
  const idx = seasonalIndices(y, m);
  return mean(y.map((_, i) => idx[i % m] ** 2)) / total;
}

/** Chạy một mô hình không mùa vụ trên chuỗi đã loại mùa vụ, rồi cộng chỉ số mùa vụ lại. */
function withSeasonal(model: (y: number[], h: number) => Fit, y: number[], m: number, h: number): Fit {
  const idx = seasonalIndices(y, m);
  const adj = y.map((v, i) => v - idx[i % m]);
  const f = model(adj, h);
  return { fc: f.fc.map((v, j) => v + idx[(y.length + j) % m]), sd: f.sd };
}

function combine(fits: Fit[]): Fit {
  const h = fits[0].fc.length;
  return {
    fc: Array.from({ length: h }, (_, j) => mean(fits.map((f) => f.fc[j]))),
    sd: Array.from({ length: h }, (_, j) => mean(fits.map((f) => f.sd[j]))),
  };
}

type Mode = "linear" | "plain" | "seasonal";

/** Chạy một "chế độ" trên chuỗi y. Trả null nếu chế độ không áp dụng được (vd mùa vụ mà chưa đủ hai chu kỳ). */
function runMode(mode: Mode, y: number[], m: number, h: number): Fit | null {
  if (mode === "linear") return linearFit(y, h);
  if (mode === "plain") return combine([holtFit(y, h), thetaFit(y, h)]);
  const hw = holtWintersFit(y, m, h);
  if (!hw) return null;
  return combine([hw, withSeasonal(thetaFit, y, m, h), withSeasonal(holtFit, y, m, h)]);
}

// ---------------------------------------------------------------------------------------------
// Backtest
// ---------------------------------------------------------------------------------------------

export interface Backtest {
  /** Sai số tuyệt đối tổng / tổng giá trị thật (0.07 = 7%). Null khi không tính được (quá ít điểm hoặc tổng bằng 0). */
  wape: number | null;
  /** Căn bình phương sai số trung bình (cùng đơn vị với dữ liệu), dùng để hiệu chỉnh dải tin cậy. */
  rmse: number | null;
  /** Số điểm cuối đã được giấu đi để kiểm tra. */
  k: number;
}

const NO_BACKTEST: Backtest = { wape: null, rmse: null, k: 0 };

/** Số điểm giấu: ~25% (tối thiểu 2, tối đa 12), nhưng phần còn lại phải đủ ít nhất 6 điểm. */
export function backtestSize(n: number): number {
  const k = Math.min(12, Math.max(2, Math.ceil(n / 4)));
  return n - k >= 6 ? k : 0;
}

function backtestMode(mode: Mode, y: number[], m: number): Backtest {
  const k = backtestSize(y.length);
  if (!k) return NO_BACKTEST;
  const train = y.slice(0, y.length - k);
  const test = y.slice(y.length - k);
  const f = runMode(mode, train, m, k);
  if (!f) return NO_BACKTEST;
  let abs = 0;
  let sq = 0;
  let tot = 0;
  for (let i = 0; i < k; i++) {
    const e = test[i] - f.fc[i];
    abs += Math.abs(e);
    sq += e * e;
    tot += Math.abs(test[i]);
  }
  if (!Number.isFinite(abs)) return NO_BACKTEST;
  return { wape: tot > 0 ? abs / tot : null, rmse: Math.sqrt(sq / k), k };
}

// ---------------------------------------------------------------------------------------------
// Dự báo một chuỗi số đều đặn
// ---------------------------------------------------------------------------------------------

export interface NumericForecast {
  mean: number[];
  lo: number[];
  hi: number[];
  backtest: Backtest;
  /** Mô hình đã dùng có mùa vụ không. */
  seasonal: boolean;
  /** Tên chế độ đã chọn. */
  mode: Mode;
}

/**
 * Dự báo `h` kỳ tiếp theo cho chuỗi `y` đều đặn (không thiếu), chu kỳ mùa vụ `m` (0/1 = không có).
 * Trả null khi `y` quá ngắn hoặc không đủ điều kiện cho phương pháp được chọn.
 */
export function forecastNumbers(y: number[], m: number, opts: ForecastOptions): NumericForecast | null {
  if (y.length < FORECAST_MIN_POINTS || y.some((v) => !Number.isFinite(v))) return null;
  const h = Math.max(1, Math.min(FORECAST_MAX_PERIODS, Math.floor(opts.periods)));
  const season = m >= 2 ? m : 0;

  let mode: Mode;
  if (opts.method === "trend") mode = "linear";
  else if (opts.method === "seasonal") mode = "seasonal";
  else {
    // Tự động: chọn giữa không mùa vụ và có mùa vụ theo sai số backtest (hòa thì chọn bản đơn giản).
    mode = "plain";
    if (season && y.length >= 2 * season && seasonalStrength(y, season) >= 0.3) {
      const plain = backtestMode("plain", y, season).wape;
      const seas = backtestMode("seasonal", y, season).wape;
      // Phải tốt hơn rõ rệt (≥5% tương đối VÀ ≥0,5 điểm %), tránh chọn mùa vụ chỉ vì nhiễu số học.
      if (seas !== null && (plain === null || (seas < plain * 0.95 && plain - seas > 0.005))) mode = "seasonal";
    }
  }

  const fit = runMode(mode, y, season, h);
  if (!fit || fit.fc.some((v) => !Number.isFinite(v))) return null;
  const bt = backtestMode(mode, y, season);

  // Hiệu chỉnh dải: nếu sai số thật ngoài mẫu lớn hơn độ rộng mô hình tự tính thì nới ra (tối đa 3 lần).
  let scale = 1;
  if (bt.rmse !== null && bt.k > 0) {
    const own = mean(fit.sd.slice(0, bt.k));
    if (own > 0 && bt.rmse > own) scale = Math.min(3, bt.rmse / own);
  }
  const z = zOf(opts.level);
  const nonNeg = y.every((v) => v >= 0);
  const clamp = (v: number) => (nonNeg ? Math.max(0, v) : v);
  return {
    mean: fit.fc.map(clamp),
    lo: fit.fc.map((v, j) => clamp(v - z * fit.sd[j] * scale)),
    hi: fit.fc.map((v, j) => clamp(v + z * fit.sd[j] * scale)),
    backtest: bt,
    seasonal: mode === "seasonal",
    mode,
  };
}

// ---------------------------------------------------------------------------------------------
// Nhãn kỳ (theo cấp gom ngày) ↔ ngày thật
// ---------------------------------------------------------------------------------------------

export const FORECAST_GRAINS: Grain[] = ["day", "week", "month", "quarter", "year"];

/** Chu kỳ mùa vụ (số kỳ) theo cấp gom: ngày→7, tuần→52, tháng→12, quý→4, năm→không có. */
export function seasonLength(grain: Grain): number {
  return { day: 7, week: 52, month: 12, quarter: 4, year: 0 }[grain];
}

const mk = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const validDate = (iso: string) => !Number.isNaN(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso;

/** Ngày đầu kỳ của một nhãn ("2025-03", "2025-Q1", "2025-W36", "2025-03-09", "2025"). Null nếu nhãn không đúng định dạng của cấp. */
export function labelToIso(label: string, grain: Grain): string | null {
  let m: RegExpMatchArray | null;
  let iso: string | null = null;
  if (grain === "day" && /^\d{4}-\d{2}-\d{2}$/.test(label)) iso = label;
  else if (grain === "week" && (m = label.match(/^(\d{4})-W(\d{2})$/))) {
    const wk1 = periodStart(mk(Number(m[1]), 1, 4), "week");
    iso = addDays(wk1, (Number(m[2]) - 1) * 7);
  } else if (grain === "month" && (m = label.match(/^(\d{4})-(\d{2})$/))) iso = mk(Number(m[1]), Number(m[2]), 1);
  else if (grain === "quarter" && (m = label.match(/^(\d{4})-Q([1-4])$/))) iso = mk(Number(m[1]), (Number(m[2]) - 1) * 3 + 1, 1);
  else if (grain === "year" && /^\d{4}$/.test(label)) iso = mk(Number(label), 1, 1);
  return iso && validDate(iso) ? iso : null;
}

/** Ngày đầu kỳ cách `iso` (một ngày đầu kỳ) `n` kỳ. */
export function addPeriods(iso: string, grain: Grain, n: number): string {
  if (grain === "day") return addDays(iso, n);
  if (grain === "week") return addDays(iso, 7 * n);
  return addMonths(iso, n * { month: 1, quarter: 3, year: 12 }[grain]);
}

// ---------------------------------------------------------------------------------------------
// Dự báo một series của chart (nhãn kỳ + giá trị có thể thiếu)
// ---------------------------------------------------------------------------------------------

export type ForecastFail = "unsupported" | "labels" | "too_few" | "gaps" | "season";

export interface SeriesForecast {
  ok: true;
  /** Nhãn các kỳ được dự báo, theo thứ tự thời gian. */
  labels: string[];
  mean: number[];
  lo: number[];
  hi: number[];
  /** Nhãn kỳ cuối cùng DÙNG để học (điểm nối đường thật với đường dự báo). */
  anchorLabel: string;
  /** Kỳ cuối chưa trọn (vẫn đang diễn ra) nên đã bị bỏ khỏi dữ liệu học. */
  droppedLast: boolean;
  seasonal: boolean;
  backtest: Backtest;
  level: number;
}

/** Tối đa tỉ lệ kỳ thiếu dữ liệu (được nội suy) mà ta còn chấp nhận. */
const MAX_GAP_RATIO = 0.25;

/**
 * @param labels nhãn kỳ đã sắp theo thời gian, @param values giá trị cùng độ dài (null = không có dữ liệu kỳ đó).
 * @param today ngày hôm nay (yyyy-mm-dd) để nhận ra kỳ cuối chưa trọn; truyền vào để test không phụ thuộc đồng hồ.
 */
export function forecastSeries(
  labels: string[],
  values: Array<number | null>,
  grain: Grain,
  opts: ForecastOptions,
  today: string = new Date().toISOString().slice(0, 10),
): SeriesForecast | { ok: false; reason: ForecastFail } {
  if (!FORECAST_GRAINS.includes(grain)) return { ok: false, reason: "unsupported" };
  // Chỉ giữ từ điểm có giá trị đầu tiên đến cuối cùng.
  const first = values.findIndex((v) => typeof v === "number" && Number.isFinite(v));
  let last = -1;
  values.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) last = i;
  });
  if (first < 0) return { ok: false, reason: "too_few" };
  const isos = labels.slice(first, last + 1).map((l) => labelToIso(l, grain));
  if (isos.some((x) => x === null)) return { ok: false, reason: "labels" };
  const iso = isos as string[];

  // Lưới kỳ liên tục từ kỳ đầu đến kỳ cuối; mỗi nhãn phải nằm đúng trên lưới.
  const grid: string[] = [];
  const gridLabels: string[] = [];
  for (let p = iso[0], guard = 0; p <= iso[iso.length - 1] && guard < 5000; p = addPeriods(p, grain, 1), guard++) {
    grid.push(p);
    gridLabels.push(grainLabel(p, grain));
  }
  const pos = new Map(gridLabels.map((l, i) => [l, i]));
  const y: Array<number | null> = grid.map(() => null);
  for (let i = first; i <= last; i++) {
    const at = pos.get(labels[i]);
    if (at === undefined) return { ok: false, reason: "labels" };
    y[at] = values[i] as number;
  }

  // Kỳ cuối còn đang diễn ra (hôm nay chưa qua hết kỳ): số liệu chưa trọn nên không dùng để học.
  let droppedLast = false;
  if (periodEnd(grid[grid.length - 1], grain) >= today) {
    droppedLast = true;
    y.pop();
    grid.pop();
    gridLabels.pop();
  }
  // Điểm cuối dùng để học phải có thật (nếu vừa bỏ kỳ cuối mà kỳ trước đó trống thì cắt tiếp).
  while (y.length && y[y.length - 1] === null) {
    y.pop();
    grid.pop();
    gridLabels.pop();
  }
  if (y.length < FORECAST_MIN_POINTS) return { ok: false, reason: "too_few" };

  const missing = y.filter((v) => v === null).length;
  if (missing / y.length > MAX_GAP_RATIO) return { ok: false, reason: "gaps" };
  // Nội suy tuyến tính các kỳ thiếu ở giữa.
  const filled = y.slice() as Array<number | null>;
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] !== null) continue;
    const a = i - 1;
    let b = i + 1;
    while (filled[b] === null) b++;
    const va = filled[a] as number;
    const vb = filled[b] as number;
    for (let j = i; j < b; j++) filled[j] = va + ((vb - va) * (j - a)) / (b - a);
    i = b;
  }
  const clean = filled as number[];

  const m = seasonLength(grain);
  if (opts.method === "seasonal" && (m < 2 || clean.length < 2 * m)) return { ok: false, reason: "season" };
  const f = forecastNumbers(clean, m, opts);
  if (!f) return { ok: false, reason: opts.method === "seasonal" ? "season" : "too_few" };

  const h = f.mean.length;
  const start = addPeriods(grid[grid.length - 1], grain, 1);
  const outLabels = Array.from({ length: h }, (_, j) => grainLabel(addPeriods(start, grain, j), grain));
  return {
    ok: true,
    labels: outLabels,
    mean: f.mean,
    lo: f.lo,
    hi: f.hi,
    anchorLabel: gridLabels[gridLabels.length - 1],
    droppedLast,
    seasonal: f.seasonal,
    backtest: f.backtest,
    level: opts.level,
  };
}

/** Câu giải thích khi không dự báo được (hiện cho người dùng). */
export function forecastFailText(reason: ForecastFail): string {
  switch (reason) {
    case "unsupported":
      return "Dự báo chỉ dùng được khi chiều đầu tiên là ngày gom theo ngày, tuần, tháng, quý hoặc năm.";
    case "labels":
      return "Không đọc được các mốc thời gian của biểu đồ để dự báo.";
    case "gaps":
      return "Dữ liệu thiếu quá nhiều kỳ nên không dự báo được.";
    case "season":
      return "Chưa đủ dữ liệu cho dự báo theo mùa vụ (cần ít nhất hai chu kỳ).";
    default:
      return `Chưa đủ dữ liệu để dự báo (cần ít nhất ${FORECAST_MIN_POINTS} kỳ).`;
  }
}
