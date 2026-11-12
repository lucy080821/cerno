import { describe, expect, it } from "vitest";
import { reportPeriods, todayVn } from "./period";

/** Thời điểm theo giờ Việt Nam (UTC+7). */
const vn = (y: number, m: number, d: number, h = 8) => new Date(Date.UTC(y, m - 1, d, h - 7));
const span = (f: "daily" | "weekly" | "monthly", d: Date) => {
  const p = reportPeriods(f, d);
  return [p.cur.from, p.cur.to, p.prev.from, p.prev.to];
};

describe("todayVn", () => {
  it("lấy ngày theo giờ VN, khác ngày UTC sau 17:00Z", () => {
    expect(todayVn(new Date("2025-01-10T18:00:00Z"))).toBe("2025-01-11");
    expect(todayVn(new Date("2025-01-10T16:59:00Z"))).toBe("2025-01-10");
  });
});

describe("kỳ báo cáo hằng ngày", () => {
  it("hôm qua và hôm kia", () => {
    expect(span("daily", vn(2025, 11, 13))).toEqual(["2025-11-12", "2025-11-12", "2025-11-11", "2025-11-11"]);
  });
  it("qua đầu tháng, đầu năm, tháng 2 nhuận", () => {
    expect(span("daily", vn(2025, 1, 1))).toEqual(["2024-12-31", "2024-12-31", "2024-12-30", "2024-12-30"]);
    expect(span("daily", vn(2024, 3, 1))).toEqual(["2024-02-29", "2024-02-29", "2024-02-28", "2024-02-28"]);
  });
  it("00:30 giờ VN vẫn tính là ngày mới (UTC còn hôm trước)", () => {
    expect(span("daily", new Date("2025-11-12T17:30:00Z"))).toEqual(["2025-11-12", "2025-11-12", "2025-11-11", "2025-11-11"]);
  });
});

describe("kỳ báo cáo hằng tuần (thứ Hai – Chủ nhật vừa qua)", () => {
  it("gửi vào thứ Hai: tuần vừa kết thúc hôm qua", () => {
    // 13/10/2025 là thứ Hai
    expect(span("weekly", vn(2025, 10, 13))).toEqual(["2025-10-06", "2025-10-12", "2025-09-29", "2025-10-05"]);
  });
  it("gửi giữa tuần và vào Chủ nhật vẫn lấy tuần đã trọn gần nhất", () => {
    expect(span("weekly", vn(2025, 10, 15))).toEqual(["2025-10-06", "2025-10-12", "2025-09-29", "2025-10-05"]);
    expect(span("weekly", vn(2025, 10, 19))).toEqual(["2025-10-06", "2025-10-12", "2025-09-29", "2025-10-05"]);
  });
  it("qua đầu năm", () => {
    // 2/1/2025 là thứ Năm; tuần trước: T2 23/12 – CN 29/12
    expect(span("weekly", vn(2025, 1, 2))).toEqual(["2024-12-23", "2024-12-29", "2024-12-16", "2024-12-22"]);
  });
  it("nhãn", () => {
    expect(reportPeriods("weekly", vn(2025, 10, 13)).cur.label).toBe("Tuần 06/10 – 12/10/2025");
  });
});

describe("kỳ báo cáo hằng tháng (tháng lịch trước và trước nữa)", () => {
  it("tháng thường", () => {
    expect(span("monthly", vn(2025, 11, 1))).toEqual(["2025-10-01", "2025-10-31", "2025-09-01", "2025-09-30"]);
    expect(reportPeriods("monthly", vn(2025, 11, 1)).cur.label).toBe("Tháng 10/2025");
  });
  it("qua đầu năm", () => {
    expect(span("monthly", vn(2025, 1, 15))).toEqual(["2024-12-01", "2024-12-31", "2024-11-01", "2024-11-30"]);
    expect(span("monthly", vn(2025, 2, 3))).toEqual(["2025-01-01", "2025-01-31", "2024-12-01", "2024-12-31"]);
  });
  it("tháng 2 nhuận và không nhuận", () => {
    expect(span("monthly", vn(2024, 3, 5))).toEqual(["2024-02-01", "2024-02-29", "2024-01-01", "2024-01-31"]);
    expect(span("monthly", vn(2025, 3, 5))).toEqual(["2025-02-01", "2025-02-28", "2025-01-01", "2025-01-31"]);
  });
  it("gửi ngày 31 (tháng trước chỉ có 30 ngày): vẫn đúng tháng lịch", () => {
    expect(span("monthly", vn(2025, 5, 31))).toEqual(["2025-04-01", "2025-04-30", "2025-03-01", "2025-03-31"]);
  });
  it("00:30 VN ngày 1 (UTC còn là ngày cuối tháng trước) tính theo tháng mới", () => {
    expect(span("monthly", new Date("2025-10-31T17:30:00Z"))).toEqual(["2025-10-01", "2025-10-31", "2025-09-01", "2025-09-30"]);
  });
});
