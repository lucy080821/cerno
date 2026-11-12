import { describe, expect, it } from "vitest";
import type { AlertWindow } from "@dashboard/schema";
import { historySpans, hourVn, isIncomplete, isSettled, previousSpan, spanDays, spanLabel, todayVn, windowSpan } from "./windows";

/** Thời điểm theo giờ Việt Nam (UTC+7). */
const vn = (y: number, m: number, d: number, h = 10) => new Date(Date.UTC(y, m - 1, d, h - 7));
const span = (w: AlertWindow, d: Date) => {
  const s = windowSpan(w, d);
  return s ? [s.from, s.to] : null;
};

describe("todayVn / hourVn", () => {
  it("theo giờ VN, khác ngày UTC sau 17:00Z", () => {
    expect(todayVn(new Date("2025-11-12T18:00:00Z"))).toBe("2025-11-13");
    expect(hourVn(new Date("2025-11-12T18:00:00Z"))).toBe(1);
    expect(todayVn(new Date("2025-11-12T16:59:00Z"))).toBe("2025-11-12");
    expect(hourVn(new Date("2025-11-12T16:59:00Z"))).toBe(23);
  });
});

describe("windowSpan", () => {
  const thu = vn(2025, 11, 13); // thứ Năm
  it("các cửa sổ vào một ngày giữa tuần", () => {
    expect(span("today", thu)).toEqual(["2025-11-13", "2025-11-13"]);
    expect(span("yesterday", thu)).toEqual(["2025-11-12", "2025-11-12"]);
    expect(span("this_week", thu)).toEqual(["2025-11-10", "2025-11-13"]); // thứ Hai 10/11 → hôm nay
    expect(span("this_month", thu)).toEqual(["2025-11-01", "2025-11-13"]);
    expect(span("last_7d", thu)).toEqual(["2025-11-06", "2025-11-12"]); // 7 ngày TRỌN, không gồm hôm nay
    expect(span("all", thu)).toBeNull();
  });
  it("last_7d luôn đúng 7 ngày", () => {
    expect(spanDays(windowSpan("last_7d", thu)!)).toBe(7);
  });
  it("thứ Hai: tuần này chỉ có hôm nay; Chủ nhật: tuần này đủ 7 ngày", () => {
    expect(span("this_week", vn(2025, 11, 10))).toEqual(["2025-11-10", "2025-11-10"]);
    expect(span("this_week", vn(2025, 11, 16))).toEqual(["2025-11-10", "2025-11-16"]);
  });
  it("ngày 1 hàng tháng; đầu năm (tuần bắt đầu từ năm trước)", () => {
    expect(span("this_month", vn(2025, 12, 1))).toEqual(["2025-12-01", "2025-12-01"]);
    expect(span("yesterday", vn(2025, 1, 1))).toEqual(["2024-12-31", "2024-12-31"]);
    expect(span("this_week", vn(2025, 1, 1))).toEqual(["2024-12-30", "2025-01-01"]); // 1/1/2025 là thứ Tư
  });
  it("00:30 giờ VN (UTC còn hôm trước) tính theo ngày VN", () => {
    expect(span("today", new Date("2025-11-12T17:30:00Z"))).toEqual(["2025-11-13", "2025-11-13"]);
  });
  it("tháng 2 nhuận: hôm nay 29/2", () => {
    expect(span("this_month", vn(2024, 2, 29))).toEqual(["2024-02-01", "2024-02-29"]);
  });
});

describe("isIncomplete / isSettled", () => {
  it("chỉ today/this_week/this_month là chưa trọn", () => {
    for (const w of ["today", "this_week", "this_month"] as const) expect(isIncomplete(w)).toBe(true);
    for (const w of ["yesterday", "last_7d", "all"] as const) expect(isIncomplete(w)).toBe(false);
  });
  it("không đặt settleHour thì luôn đánh giá; khoảng đã trọn thì bỏ qua settleHour", () => {
    expect(isSettled("today", undefined, vn(2025, 11, 13, 9))).toBe(true);
    expect(isSettled("yesterday", 21, vn(2025, 11, 13, 9))).toBe(true);
    expect(isSettled("last_7d", 21, vn(2025, 11, 13, 9))).toBe(true);
  });
  it("khoảng chưa trọn: chỉ đánh giá từ giờ chốt trở đi (đúng giờ chốt là được)", () => {
    expect(isSettled("today", 21, vn(2025, 11, 13, 20))).toBe(false);
    expect(isSettled("today", 21, vn(2025, 11, 13, 21))).toBe(true);
    expect(isSettled("this_month", 21, vn(2025, 11, 13, 23))).toBe(true);
    expect(isSettled("today", 0, vn(2025, 11, 13, 0))).toBe(true);
  });
});

describe("previousSpan: prev_period", () => {
  const cmp = (w: AlertWindow, d: Date) => {
    const s = windowSpan(w, d)!;
    const p = previousSpan(w, s, "prev_period");
    return [p.from, p.to];
  };
  const thu = vn(2025, 11, 13);
  it("hôm nay → hôm qua; hôm qua → hôm kia", () => {
    expect(cmp("today", thu)).toEqual(["2025-11-12", "2025-11-12"]);
    expect(cmp("yesterday", thu)).toEqual(["2025-11-11", "2025-11-11"]);
  });
  it("tuần này (chưa trọn) so với phần tương ứng của tuần trước, cùng số ngày", () => {
    expect(cmp("this_week", thu)).toEqual(["2025-11-03", "2025-11-06"]); // T2..T5 tuần trước
  });
  it("7 ngày qua so với 7 ngày liền trước", () => {
    expect(cmp("last_7d", thu)).toEqual(["2025-10-30", "2025-11-05"]);
    expect(spanDays({ from: "2025-10-30", to: "2025-11-05" })).toBe(7);
  });
  it("tháng này (chưa trọn) so với phần tương ứng của tháng trước", () => {
    expect(cmp("this_month", thu)).toEqual(["2025-10-01", "2025-10-13"]);
  });
  it("tháng này vào ngày 31 gặp tháng trước ngắn hơn: kẹp về cuối tháng", () => {
    expect(cmp("this_month", vn(2025, 3, 31))).toEqual(["2025-02-01", "2025-02-28"]);
    expect(cmp("this_month", vn(2024, 3, 31))).toEqual(["2024-02-01", "2024-02-29"]);
    expect(cmp("this_month", vn(2025, 5, 31))).toEqual(["2025-04-01", "2025-04-30"]);
  });
  it("qua đầu năm", () => {
    expect(cmp("this_month", vn(2025, 1, 15))).toEqual(["2024-12-01", "2024-12-15"]);
    expect(cmp("today", vn(2025, 1, 1))).toEqual(["2024-12-31", "2024-12-31"]);
  });
});

describe("previousSpan: prev_year", () => {
  const py = (w: AlertWindow, d: Date) => {
    const s = windowSpan(w, d)!;
    const p = previousSpan(w, s, "prev_year");
    return [p.from, p.to];
  };
  it("cùng khoảng một năm trước", () => {
    expect(py("today", vn(2025, 11, 13))).toEqual(["2024-11-13", "2024-11-13"]);
    expect(py("this_month", vn(2025, 11, 13))).toEqual(["2024-11-01", "2024-11-13"]);
  });
  it("29/2 năm nhuận → 28/2 năm không nhuận", () => {
    expect(py("today", vn(2024, 2, 29))).toEqual(["2023-02-28", "2023-02-28"]);
  });
  it("tuần/7 ngày lùi 364 ngày để giữ nguyên thứ trong tuần", () => {
    // 13/11/2025 là thứ Năm; 364 ngày trước (14/11/2024) cũng là thứ Năm
    expect(py("this_week", vn(2025, 11, 13))).toEqual(["2024-11-11", "2024-11-14"]);
    expect(py("last_7d", vn(2025, 11, 13))).toEqual(["2024-11-07", "2024-11-13"]);
  });
});

describe("historySpans: các kỳ trước cùng loại", () => {
  const h = (w: AlertWindow, d: Date, n: number) => historySpans(w, windowSpan(w, d)!, n).map((s) => [s.from, s.to]);
  const thu = vn(2025, 11, 13);
  it("hôm qua (thứ Tư) → các thứ Tư của các tuần trước, gần nhất trước", () => {
    expect(h("yesterday", thu, 4)).toEqual([
      ["2025-11-05", "2025-11-05"], ["2025-10-29", "2025-10-29"], ["2025-10-22", "2025-10-22"], ["2025-10-15", "2025-10-15"],
    ]);
  });
  it("hôm nay (thứ Năm) → các thứ Năm trước", () => {
    expect(h("today", thu, 2)).toEqual([["2025-11-06", "2025-11-06"], ["2025-10-30", "2025-10-30"]]);
  });
  it("7 ngày qua và tuần này → các tuần trước cùng độ dài", () => {
    expect(h("last_7d", thu, 2)).toEqual([["2025-10-30", "2025-11-05"], ["2025-10-23", "2025-10-29"]]);
    expect(h("this_week", thu, 2)).toEqual([["2025-11-03", "2025-11-06"], ["2025-10-27", "2025-10-30"]]);
  });
  it("tháng này → các tháng trước, cùng số ngày đã trôi qua; kẹp cuối tháng", () => {
    expect(h("this_month", thu, 3)).toEqual([["2025-10-01", "2025-10-13"], ["2025-09-01", "2025-09-13"], ["2025-08-01", "2025-08-13"]]);
    expect(h("this_month", vn(2025, 3, 31), 2)).toEqual([["2025-02-01", "2025-02-28"], ["2025-01-01", "2025-01-31"]]);
  });
  it("trả đúng số kỳ yêu cầu (4..12)", () => {
    expect(h("yesterday", thu, 12)).toHaveLength(12);
  });
});

describe("spanLabel", () => {
  it("nhãn dễ đọc", () => {
    expect(spanLabel("today", { from: "2025-11-13", to: "2025-11-13" })).toBe("hôm nay (13/11/2025)");
    expect(spanLabel("last_7d", { from: "2025-11-06", to: "2025-11-12" })).toBe("7 ngày qua (06/11 – 12/11/2025)");
    expect(spanLabel("all", null)).toBe("toàn bộ dữ liệu");
  });
});
