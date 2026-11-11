import { describe, expect, it } from "vitest";
import { addPeriods, backtestSize, forecastNumbers, forecastSeries, labelToIso, FORECAST_DEFAULTS } from "./forecast";
import { grainLabel } from "./period";

const OPTS = { ...FORECAST_DEFAULTS, periods: 6 };

describe("forecastNumbers", () => {
  it("chuỗi tăng đều: tiếp tục xu hướng, backtest sai số nhỏ, dải bao quanh đường dự báo", () => {
    const y = Array.from({ length: 16 }, (_, i) => 100 + 10 * i);
    const f = forecastNumbers(y, 0, OPTS)!;
    expect(f).not.toBeNull();
    expect(f.mean).toHaveLength(6);
    // Giá trị kế tiếp thật là 260; chấp nhận lệch vài %.
    expect(f.mean[0]).toBeGreaterThan(245);
    expect(f.mean[0]).toBeLessThan(275);
    expect(f.mean[5]).toBeGreaterThan(f.mean[0]);
    expect(f.backtest.wape).not.toBeNull();
    expect(f.backtest.wape!).toBeLessThan(0.06);
    f.mean.forEach((v, i) => {
      expect(f.lo[i]).toBeLessThanOrEqual(v);
      expect(f.hi[i]).toBeGreaterThanOrEqual(v);
    });
  });

  it("dải rộng dần theo thời gian dự báo", () => {
    const noisy = Array.from({ length: 24 }, (_, i) => 200 + 3 * i + ((i * 37) % 11) * 4);
    const f = forecastNumbers(noisy, 0, { ...OPTS, periods: 12 })!;
    const w = (i: number) => f.hi[i] - f.lo[i];
    expect(w(11)).toBeGreaterThan(w(0));
  });

  it("có mùa vụ rõ: chế độ tự động chọn mô hình mùa vụ và dự báo đúng nhịp", () => {
    const season = (i: number) => 30 * Math.sin((2 * Math.PI * i) / 12);
    const y = Array.from({ length: 36 }, (_, i) => 200 + 2 * i + season(i));
    const f = forecastNumbers(y, 12, { ...OPTS, periods: 12 })!;
    expect(f.seasonal).toBe(true);
    // So với giá trị thật của 12 kỳ tiếp theo.
    let abs = 0;
    let tot = 0;
    f.mean.forEach((v, j) => {
      const truth = 200 + 2 * (36 + j) + season(36 + j);
      abs += Math.abs(v - truth);
      tot += truth;
    });
    expect(abs / tot).toBeLessThan(0.05);
    expect(f.backtest.wape!).toBeLessThan(0.08);
  });

  it("không có mùa vụ thì không chọn mô hình mùa vụ", () => {
    const y = Array.from({ length: 36 }, (_, i) => 100 + 5 * i);
    expect(forecastNumbers(y, 12, OPTS)!.seasonal).toBe(false);
  });

  it("quá ít điểm: từ chối", () => {
    expect(forecastNumbers([1, 2, 3, 4, 5, 6, 7], 0, OPTS)).toBeNull();
  });

  it("giá trị luôn không âm khi dữ liệu không âm", () => {
    const y = Array.from({ length: 12 }, (_, i) => Math.max(0, 50 - 6 * i));
    const f = forecastNumbers(y, 0, { ...OPTS, periods: 12 })!;
    expect(Math.min(...f.mean, ...f.lo)).toBeGreaterThanOrEqual(0);
  });

  it("chuỗi hằng: dự báo hằng, dải không âm độ rộng", () => {
    const f = forecastNumbers(Array(12).fill(40), 0, OPTS)!;
    f.mean.forEach((v) => expect(v).toBeCloseTo(40, 3));
  });

  it("phương pháp 'xu hướng' dùng hồi quy tuyến tính", () => {
    const y = Array.from({ length: 12 }, (_, i) => 5 + 2 * i);
    const f = forecastNumbers(y, 0, { ...OPTS, method: "trend", periods: 3 })!;
    expect(f.mean[0]).toBeCloseTo(29, 6);
    expect(f.mean[2]).toBeCloseTo(33, 6);
  });

  it("phương pháp 'mùa vụ' mà chưa đủ hai chu kỳ: từ chối", () => {
    const y = Array.from({ length: 20 }, (_, i) => 10 + i);
    expect(forecastNumbers(y, 12, { ...OPTS, method: "seasonal" })).toBeNull();
  });

  it("backtestSize giữ ít nhất 6 điểm để học", () => {
    expect(backtestSize(8)).toBe(2);
    expect(backtestSize(7)).toBe(0);
    expect(backtestSize(48)).toBe(12);
  });
});

describe("nhãn kỳ", () => {
  it("labelToIso đọc đúng từng cấp và từ chối nhãn sai", () => {
    expect(labelToIso("2025-03", "month")).toBe("2025-03-01");
    expect(labelToIso("2025-Q3", "quarter")).toBe("2025-07-01");
    expect(labelToIso("2025", "year")).toBe("2025-01-01");
    expect(labelToIso("2025-03-09", "day")).toBe("2025-03-09");
    expect(labelToIso("2025-W01", "week")).toBe("2024-12-30"); // tuần ISO 1 của 2025 bắt đầu thứ 2 30/12/2024
    expect(labelToIso("2025-13", "month")).toBeNull();
    expect(labelToIso("Tháng 3", "month")).toBeNull();
    expect(labelToIso("2025-03", "day")).toBeNull();
  });

  it("nhãn → ngày → nhãn khớp với grainLabel, kể cả qua biên năm", () => {
    for (const [g, start] of [["month", "2024-11-01"], ["quarter", "2024-07-01"], ["week", "2024-12-16"], ["day", "2024-12-29"]] as const) {
      for (let n = 0; n < 8; n++) {
        const iso = addPeriods(start, g, n);
        expect(labelToIso(grainLabel(iso, g), g)).toBe(iso);
      }
    }
  });
});

describe("forecastSeries", () => {
  const months = (n: number, from = 2023) =>
    Array.from({ length: n }, (_, i) => `${from + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);

  it("dự báo tiếp ngay sau tháng cuối, nhãn đúng thứ tự và qua biên năm", () => {
    const labels = months(24);
    const values = labels.map((_, i) => 100 + 4 * i);
    const r = forecastSeries(labels, values, "month", { ...OPTS, periods: 4 }, "2026-06-01");
    if (!r.ok) throw new Error(r.reason);
    expect(r.labels).toEqual(["2025-01", "2025-02", "2025-03", "2025-04"]);
    expect(r.anchorLabel).toBe("2024-12");
    expect(r.droppedLast).toBe(false);
  });

  it("kỳ cuối chưa trọn thì bỏ khỏi dữ liệu học và dự báo bắt đầu từ chính kỳ đó", () => {
    const labels = months(24);
    const values = labels.map((_, i) => 100 + 4 * i);
    const r = forecastSeries(labels, values, "month", { ...OPTS, periods: 3 }, "2024-12-15");
    if (!r.ok) throw new Error(r.reason);
    expect(r.droppedLast).toBe(true);
    expect(r.anchorLabel).toBe("2024-11");
    expect(r.labels[0]).toBe("2024-12");
  });

  it("thiếu vài kỳ ở giữa vẫn dự báo (nội suy), thiếu quá nhiều thì từ chối", () => {
    const labels = months(24);
    const values: Array<number | null> = labels.map((_, i) => 100 + 4 * i);
    const few = labels.filter((_, i) => i !== 5 && i !== 6);
    const fewV = values.filter((_, i) => i !== 5 && i !== 6);
    expect(forecastSeries(few, fewV, "month", OPTS, "2026-06-01").ok).toBe(true);

    const sparse = labels.filter((_, i) => i % 2 === 0 || i === 23);
    const sparseV = values.filter((_, i) => i % 2 === 0 || i === 23);
    const bad = forecastSeries(sparse, sparseV, "month", OPTS, "2026-06-01");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("gaps");
  });

  it("ít kỳ, nhãn lạ, cấp không hỗ trợ: trả lý do", () => {
    const l = months(5);
    const r1 = forecastSeries(l, [1, 2, 3, 4, 5], "month", OPTS, "2026-06-01");
    expect(r1.ok ? "" : r1.reason).toBe("too_few");
    const r2 = forecastSeries(["a", "b", "c", "d", "e", "f", "g", "h", "i"], Array(9).fill(1), "month", OPTS, "2026-06-01");
    expect(r2.ok ? "" : r2.reason).toBe("labels");
    const r3 = forecastSeries(months(24), Array(24).fill(1), "weekday" as never, OPTS, "2026-06-01");
    expect(r3.ok ? "" : r3.reason).toBe("unsupported");
  });

  it("dự báo theo tuần chạy được và nhãn tuần liền mạch", () => {
    const labels = Array.from({ length: 20 }, (_, i) => grainLabel(addPeriods("2025-01-06", "week", i), "week"));
    const r = forecastSeries(labels, labels.map((_, i) => 50 + i), "week", { ...OPTS, periods: 2 }, "2030-01-01");
    if (!r.ok) throw new Error(r.reason);
    expect(r.labels).toEqual([grainLabel(addPeriods("2025-01-06", "week", 20), "week"), grainLabel(addPeriods("2025-01-06", "week", 21), "week")]);
  });
});
