import { describe, expect, it } from "vitest";
import type { KpiCompare } from "@dashboard/schema";
import { aggregate, computeCompare, formatGrowth, hourOf, resolvePeriods, runQuery, type Row, type RowFilter } from "./index";

const cmp = (o: Partial<KpiCompare> = {}): KpiCompare => ({
  to: "prev_period", dateColumn: "d", grain: "month", show: "percent", goodWhen: "up", toDate: true, ...o,
});
const m = { column: "v", aggregation: "sum" as const };
const rows: Row[] = [
  { d: "2024-11-03", v: 50 }, { d: "2024-11-20", v: 50 },
  { d: "2025-10-05", v: 100 }, { d: "2025-10-25", v: 100 },
  { d: "2025-11-02", v: 60 }, { d: "2025-11-09", v: 60 },
];

describe("resolvePeriods", () => {
  it("tháng đang dở: so cùng số ngày với tháng trước", () => {
    const p = resolvePeriods(cmp(), null, "2025-11-09")!;
    expect(p.cur).toEqual({ from: "2025-11-01", to: "2025-11-09" });
    expect(p.prev).toEqual({ from: "2025-10-01", to: "2025-10-09" });
    expect(p.label).toBe("so với tháng trước");
  });
  it("tắt toDate thì so cả tháng", () => {
    const p = resolvePeriods(cmp({ toDate: false }), null, "2025-11-09")!;
    expect(p.cur.to).toBe("2025-11-30");
    expect(p.prev).toEqual({ from: "2025-10-01", to: "2025-10-31" });
  });
  it("cùng kỳ năm ngoái, kẹp ngày cuối tháng", () => {
    const p = resolvePeriods(cmp({ to: "prev_year" }), null, "2025-11-09")!;
    expect(p.prev).toEqual({ from: "2024-11-01", to: "2024-11-09" });
    const q = resolvePeriods(cmp({ to: "prev_year", grain: "month" }), null, "2024-02-29")!;
    expect(q.prev.to).toBe("2023-02-28");
  });
  it("tháng 1 so với tháng 12 năm trước; quý; năm", () => {
    expect(resolvePeriods(cmp(), null, "2025-01-15")!.prev.from).toBe("2024-12-01");
    expect(resolvePeriods(cmp({ grain: "quarter", toDate: false }), null, "2025-02-10")!.prev)
      .toEqual({ from: "2024-10-01", to: "2024-12-31" });
    expect(resolvePeriods(cmp({ grain: "year", toDate: false }), null, "2025-02-10")!.prev)
      .toEqual({ from: "2024-01-01", to: "2024-12-31" });
  });
  it("khoảng ngày rõ ràng: kỳ trước liền kề cùng độ dài", () => {
    const p = resolvePeriods(cmp(), { from: "2025-11-01", to: "2025-11-10" }, null)!;
    expect(p.prev).toEqual({ from: "2025-10-22", to: "2025-10-31" });
    const y = resolvePeriods(cmp({ to: "prev_year" }), { from: "2025-11-01", to: "2025-11-10" }, null)!;
    expect(y.prev).toEqual({ from: "2024-11-01", to: "2024-11-10" });
  });
});

describe("computeCompare", () => {
  it("tháng mới nhất so với tháng trước (cùng 9 ngày đầu)", () => {
    const r = computeCompare(rows, [], undefined, m, cmp())!;
    expect(r.current).toBe(120);
    expect(r.previous).toBe(100); // 5/10 trong 1–9/10; 25/10 nằm ngoài
    expect(formatGrowth(r, cmp()).text).toBe("+20%");
  });
  it("cùng kỳ năm ngoái", () => {
    const c = cmp({ to: "prev_year" });
    const r = computeCompare(rows, [], undefined, m, c)!;
    expect(r.previous).toBe(50); // 3/11/2024; 20/11 ngoài 1–9
    expect(formatGrowth(r, c).text).toBe("+140%");
  });
  it("bộ lọc khoảng ngày trên cột ngày xác định kỳ, không làm rỗng kỳ trước", () => {
    const f: RowFilter = { column: "d", values: [], dateRange: { from: "2025-10-01", to: "2025-10-31" } };
    const r = computeCompare(rows, [f], undefined, m, cmp())!;
    expect(r.current).toBe(200);
    expect(r.previous).toBeNull(); // 1/10 → 30/9/2025 không có dữ liệu
  });
  it("kỳ so sánh không có dữ liệu thì không tính %", () => {
    const g = formatGrowth({ current: 5, previous: null, label: "", cur: { from: "", to: "" }, prev: { from: "", to: "" } }, cmp());
    expect(g.text).toBe("");
  });
  it("tôn trọng bộ lọc khác", () => {
    const rs: Row[] = [{ d: "2025-11-02", v: 10, r: "A" }, { d: "2025-11-03", v: 99, r: "B" }, { d: "2025-10-02", v: 5, r: "A" }];
    const f: RowFilter = { column: "r", values: ["A"] };
    const r = computeCompare(rs, [f], undefined, m, cmp())!;
    expect([r.current, r.previous]).toEqual([10, 5]);
  });
  it("hoạt động qua runQuery (nguồn lớn)", () => {
    const res = runQuery(rows, { mode: "aggregate", dims: [], metrics: [m], filters: [], calc: [], compare: cmp() });
    expect(res.mode === "aggregate" && res.compare?.current).toBe(120);
  });
});

describe("formatGrowth", () => {
  const r = (current: number, previous: number | null) => ({ current, previous, label: "", cur: { from: "", to: "" }, prev: { from: "", to: "" } });
  it("màu theo goodWhen", () => {
    expect(formatGrowth(r(120, 100), cmp()).tone).toBe("good");
    expect(formatGrowth(r(120, 100), cmp({ goodWhen: "down" })).tone).toBe("bad");
    expect(formatGrowth(r(80, 100), cmp({ goodWhen: "down" })).tone).toBe("good");
  });
  it("giảm dùng dấu trừ; chia cho 0 để trống; pp và chênh lệch", () => {
    expect(formatGrowth(r(80, 100), cmp()).text).toBe("−20%");
    expect(formatGrowth(r(5, 0), cmp()).text).toBe("");
    expect(formatGrowth(r(5.5, 5), cmp({ show: "pp" })).text).toBe("+0,5 pp");
    expect(formatGrowth(r(1500, 500), cmp({ show: "diff" })).text).toBe("+1K");
    expect(formatGrowth(r(100, 100), cmp()).dir).toBe("flat");
  });
});

describe("gom ngày theo cấp (grain)", () => {
  it("gom theo tháng, sắp tăng dần, bỏ ô không phải ngày", () => {
    const rs: Row[] = [{ d: "2025-11-02", v: 1 }, { d: "2025-10-05", v: 2 }, { d: "xx", v: 9 }, { d: "2025-11-20", v: 3 }, { d: "05/09/2025", v: 4 }];
    const t = aggregate(rs, [{ column: "d", grain: "month" }], [m]);
    expect(t.rows.map((x) => [x.keys[0], x.values[0]])).toEqual([["2025-09", 4], ["2025-10", 2], ["2025-11", 4]]);
    const q = aggregate(rs, [{ column: "d", grain: "quarter" }], [m]);
    expect(q.rows.map((x) => x.keys[0])).toEqual(["2025-Q3", "2025-Q4"]);
  });

  it("tuần ISO, tháng trong năm, thứ trong tuần (sắp đúng thứ tự)", () => {
    const rs: Row[] = [
      { d: "2025-12-29", v: 1 }, // thứ 2, tuần 1 của 2026
      { d: "2025-01-05", v: 2 }, // chủ nhật
      { d: "2024-10-10", v: 4 }, { d: "2025-02-03", v: 8 }, // thứ 5, thứ 2
    ];
    const wk = aggregate(rs, [{ column: "d", grain: "week" }], [m]);
    expect(wk.rows.map((x) => x.keys[0])).toEqual(["2024-W41", "2025-W01", "2025-W06", "2026-W01"]);
    const moy = aggregate(rs, [{ column: "d", grain: "month_of_year" }], [m]);
    expect(moy.rows.map((x) => x.keys[0])).toEqual(["Tháng 1", "Tháng 2", "Tháng 10", "Tháng 12"]);
    const wd = aggregate(rs, [{ column: "d", grain: "weekday" }], [m]);
    expect(wd.rows.map((x) => [x.keys[0], x.values[0]])).toEqual([["Thứ 2", 9], ["Thứ 5", 4], ["CN", 2]]);
  });
  it("KPI theo tuần: tuần trước và cùng kỳ năm ngoái giữ nguyên thứ", () => {
    const p = resolvePeriods(cmp({ grain: "week", toDate: false }), null, "2025-11-09")!; // chủ nhật
    expect(p.cur).toEqual({ from: "2025-11-03", to: "2025-11-09" });
    expect(p.prev).toEqual({ from: "2025-10-27", to: "2025-11-02" });
    const y = resolvePeriods(cmp({ grain: "week", to: "prev_year", toDate: false }), null, "2025-11-09")!;
    expect(y.prev).toEqual({ from: "2024-11-04", to: "2024-11-10" });
  });
});

describe("cấp giờ", () => {
  it("hourOf đọc nhiều dạng, null khi chỉ có ngày", () => {
    expect(hourOf("2025-09-05 14:30")).toBe(14);
    expect(hourOf("2025-09-05T07:05:00Z")).toBe(7);
    expect(hourOf("Sep 5, 2025 3:20 PM")).toBe(15);
    expect(hourOf("5/9/2025 12:10 AM")).toBe(0);
    expect(hourOf("5/9/2025 12:10 PM")).toBe(12);
    expect(hourOf("5/9/2025 3:20 CH")).toBe(15);
    expect(hourOf("2025-09-05")).toBeNull();
    expect(hourOf("Sep 5, 2025")).toBeNull();
    expect(hourOf("25:00")).toBeNull();
  });
  it("gom theo ngày+giờ và giờ trong ngày, bỏ ô không có giờ", () => {
    const rs: Row[] = [
      { d: "2025-09-05 14:30", v: 1 }, { d: "2025-09-05 14:59", v: 2 }, { d: "2025-09-06 09:00", v: 4 },
      { d: "2025-09-07", v: 99 }, { d: "2025-09-08 14:00", v: 8 },
    ];
    const h = aggregate(rs, [{ column: "d", grain: "hour" }], [m]);
    expect(h.rows.map((x) => [x.keys[0], x.values[0]])).toEqual([
      ["2025-09-05 14:00", 3], ["2025-09-06 09:00", 4], ["2025-09-08 14:00", 8],
    ]);
    const hod = aggregate(rs, [{ column: "d", grain: "hour_of_day" }], [m]);
    expect(hod.rows.map((x) => [x.keys[0], x.values[0]])).toEqual([["09h", 4], ["14h", 11]]);
  });
});
