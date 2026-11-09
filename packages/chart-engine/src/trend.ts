/** Hồi quy tuyến tính bình phương tối thiểu: y = slope * x + intercept, kèm R². Null nếu không đủ điểm hoặc x không đổi. */
export interface LinearFit {
  slope: number;
  intercept: number;
  /** Hệ số xác định, 0..1: đường thẳng giải thích được bao nhiêu phần biến thiên của dữ liệu. */
  r2: number;
}

export function linearRegression(points: Array<readonly [number, number]>): LinearFit | null {
  const pts = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : Math.min(1, Math.max(0, (sxy * sxy) / (sxx * syy)));
  return { slope, intercept, r2 };
}

/**
 * Đường xu hướng cho dãy giá trị theo thứ tự (trục nhóm): vị trí 0, 1, 2... là x.
 *  - "linear": đường thẳng hồi quy qua các điểm có giá trị.
 *  - "movingAverage": trung bình của `window` điểm gần nhất (đầu dãy dùng ít điểm hơn).
 * Ô trống (null) không tính vào phép trung bình; với đường thẳng, mọi vị trí đều có giá trị.
 */
export function trendOf(
  values: Array<number | null>,
  mode: "linear" | "movingAverage",
  window = 3,
): Array<number | null> {
  if (mode === "linear") {
    const pts: Array<[number, number]> = [];
    values.forEach((v, i) => {
      if (typeof v === "number" && Number.isFinite(v)) pts.push([i, v]);
    });
    const fit = linearRegression(pts);
    return values.map((_, i) => (fit ? fit.slope * i + fit.intercept : null));
  }
  const w = Math.max(2, Math.floor(window));
  return values.map((_, i) => {
    const part = values.slice(Math.max(0, i - w + 1), i + 1).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return part.length ? part.reduce((a, b) => a + b, 0) / part.length : null;
  });
}
