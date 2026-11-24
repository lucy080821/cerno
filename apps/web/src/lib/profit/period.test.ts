import { describe, expect, it } from "vitest";
import {
  ALL_TIME, addDays, inRange, isIsoDay, isFiltering, parseRangeParams, periodLabel, periodRange, presetPeriod, rangePeriod, sanitizePeriod, shiftPeriod, switchUnit,
  type Period,
} from "./period";

const p = (unit: Period["unit"], value: string): Period => ({ unit, value });

describe("khoảng thời gian lọc", () => {
  it("ngày hợp lệ: có thật trong lịch", () => {
    expect(isIsoDay("2026-02-28")).toBe(true);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2026-13-01")).toBe(false);
    expect(isIsoDay("26-1-1")).toBe(false);
    expect(isIsoDay(null)).toBe(false);
  });

  it("khoảng ngày của ngày, tháng, quý, năm, khoảng", () => {
    expect(periodRange(p("day", "2026-11-24"))).toEqual({ from: "2026-11-24", to: "2026-11-24" });
    expect(periodRange(p("month", "2026-02"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange(p("month", "2028-02"))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange(p("quarter", "2026-Q4"))).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodRange(p("quarter", "2026-Q1"))).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(periodRange(p("year", "2026"))).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange(p("range", "2026-11-01..2026-11-24"))).toEqual({ from: "2026-11-01", to: "2026-11-24" });
    expect(periodRange(ALL_TIME)).toBeNull();
  });

  it("giá trị sai thì không lọc", () => {
    for (const bad of [p("day", "2026-02-30"), p("month", "2026-13"), p("quarter", "2026-Q5"), p("year", "1999"), p("range", "2026-11-24..2026-11-01"), p("range", "x")]) {
      expect(periodRange(bad)).toBeNull();
      expect(isFiltering(bad)).toBe(false);
    }
  });

  it("lùi/tiến kỳ, qua ranh giới năm", () => {
    expect(shiftPeriod(p("day", "2026-12-31"), 1).value).toBe("2027-01-01");
    expect(shiftPeriod(p("month", "2026-01"), -1).value).toBe("2025-12");
    expect(shiftPeriod(p("month", "2026-12"), 1).value).toBe("2027-01");
    expect(shiftPeriod(p("quarter", "2026-Q1"), -1).value).toBe("2025-Q4");
    expect(shiftPeriod(p("quarter", "2026-Q4"), 1).value).toBe("2027-Q1");
    expect(shiftPeriod(p("year", "2026"), -1).value).toBe("2025");
    expect(shiftPeriod(p("range", "2026-11-01..2026-11-10"), 1).value).toBe("2026-11-11..2026-11-20");
    expect(shiftPeriod(ALL_TIME, 1)).toEqual(ALL_TIME);
  });

  it("lối tắt tính từ hôm nay", () => {
    expect(presetPeriod("today", "2026-11-24")).toEqual(p("day", "2026-11-24"));
    expect(periodRange(presetPeriod("7d", "2026-11-24"))).toEqual({ from: "2026-11-18", to: "2026-11-24" });
    expect(periodRange(presetPeriod("30d", "2026-11-24"))).toEqual({ from: "2026-10-26", to: "2026-11-24" });
    expect(presetPeriod("month", "2026-11-24").value).toBe("2026-11");
    expect(presetPeriod("quarter", "2026-11-24").value).toBe("2026-Q4");
    expect(presetPeriod("year", "2026-11-24").value).toBe("2026");
    expect(presetPeriod("all", "2026-11-24")).toEqual(ALL_TIME);
  });

  it("đổi đơn vị giữ kỳ đang xem", () => {
    expect(switchUnit(p("month", "2026-08"), "quarter", "2026-11-24").value).toBe("2026-Q3");
    expect(switchUnit(p("month", "2026-08"), "year", "2026-11-24").value).toBe("2026");
    expect(switchUnit(ALL_TIME, "month", "2026-11-24").value).toBe("2026-11");
    expect(switchUnit(p("year", "2025"), "day", "2026-11-24").value).toBe("2025-01-01");
    expect(switchUnit(p("month", "2026-08"), "all", "2026-11-24")).toEqual(ALL_TIME);
    expect(periodRange(switchUnit(ALL_TIME, "range", "2026-11-24"))).toEqual({ from: "2026-10-26", to: "2026-11-24" });
  });

  it("nhãn tiếng Việt", () => {
    expect(periodLabel(ALL_TIME)).toBe("Tất cả thời gian");
    expect(periodLabel(p("day", "2026-11-04"))).toBe("04/11/2026");
    expect(periodLabel(p("month", "2026-03"))).toBe("Tháng 3/2026");
    expect(periodLabel(p("quarter", "2026-Q2"))).toBe("Quý 2/2026");
    expect(periodLabel(p("year", "2026"))).toBe("Năm 2026");
    expect(periodLabel(rangePeriod("2026-11-01", "2026-11-24"))).toBe("01/11/2026 → 24/11/2026");
  });

  it("đọc từ nơi không tin cậy", () => {
    expect(sanitizePeriod({ unit: "month", value: "2026-11" })).toEqual(p("month", "2026-11"));
    expect(sanitizePeriod({ unit: "month", value: "bậy" })).toEqual(ALL_TIME);
    expect(sanitizePeriod({ unit: "drop table", value: "x" })).toEqual(ALL_TIME);
    expect(sanitizePeriod(null)).toEqual(ALL_TIME);
    expect(sanitizePeriod("x")).toEqual(ALL_TIME);
  });

  it("tham số địa chỉ phía máy chủ và so khớp ngày đơn", () => {
    expect(parseRangeParams("2026-11-01", "2026-11-30")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(parseRangeParams("2026-11-30", "2026-11-01")).toBeNull();
    expect(parseRangeParams(null, "2026-11-01")).toBeNull();
    expect(parseRangeParams("abc", "2026-11-01")).toBeNull();
    const r = { from: "2026-11-01", to: "2026-11-30" };
    expect(inRange("2026-11-01", r)).toBe(true);
    expect(inRange("2026-11-30 23:59", r)).toBe(true);
    expect(inRange("2026-12-01", r)).toBe(false);
    expect(inRange("2026-10-31 10:00", r)).toBe(false);
    expect(inRange(null, r)).toBe(false);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
