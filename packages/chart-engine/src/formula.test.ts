import { describe, expect, it } from "vitest";
import {
  aggregate, compileCalcFields, evalAggField, inferCalcType, materializeRows, parseFormula, unknownRefs, type Row,
} from "./index";

const rows: Row[] = [
  { Ngày: "2026-03-15", "Doanh thu": 100, "Chi phí": 40, "Đơn": 4, Loại: "A", Tên: " an " },
  { Ngày: "2026-04-02", "Doanh thu": 200, "Chi phí": 50, "Đơn": 0, Loại: "B", Tên: "binh" },
  { Ngày: "02/05/2026", "Doanh thu": 300, "Chi phí": 60, "Đơn": 6, Loại: "A", Tên: "chi" },
  { Ngày: null, "Doanh thu": null, "Chi phí": 10, "Đơn": 2, Loại: "A", Tên: "" },
];

const calc = (defs: Array<[string, string]>, cols: string[] = Object.keys(rows[0])) =>
  compileCalcFields(defs.map(([name, expression], i) => ({ id: `f${i}`, name, expression })), cols);
const row = (expr: string): unknown[] => {
  const set = calc([["X", expr]]);
  expect(set.errors.size, [...set.errors.values()].join("; ")).toBe(0);
  return materializeRows(rows, set).map((r) => r.X);
};

describe("công thức theo dòng", () => {
  it("số học và tên cột có dấu/khoảng trắng trong [ ]", () => {
    expect(row("[Doanh thu] - [Chi phí]")).toEqual([60, 150, 240, null]);
    expect(row("[Doanh thu] * 2 + 1")).toEqual([201, 401, 601, null]);
    expect(row("-[Chi phí] + (1 + 2) * 3")).toEqual([-31, -41, -51, -1]);
  });
  it("chia cho 0 hoặc ô trống ra trống, không phải Infinity", () => {
    expect(row("[Doanh thu] / [Đơn]")).toEqual([25, null, 50, null]);
    expect(row("SAFE_DIVIDE([Doanh thu], [Đơn], 0)")).toEqual([25, 0, 50, 0]);
  });
  it("IF, so sánh, AND/OR/NOT", () => {
    expect(row('IF([Doanh thu] >= 200, "Cao", "Thấp")')).toEqual(["Thấp", "Cao", "Cao", "Thấp"]);
    expect(row('IF([Loại] = "A" AND [Đơn] > 2, 1, 0)')).toEqual([1, 0, 1, 0]);
    expect(row('IF(NOT ([Loại] = "A") OR [Đơn] = 2, "x", "y")')).toEqual(["y", "x", "y", "x"]);
  });
  it("hàm chữ và toán tử &", () => {
    expect(row("UPPER(TRIM([Tên]))")).toEqual(["AN", "BINH", "CHI", ""]);
    expect(row('[Loại] & "-" & [Đơn]')).toEqual(["A-4", "B-0", "A-6", "A-2"]);
    expect(row('CONTAINS([Tên], "NH")')).toEqual([false, true, false, false]);
    expect(row("LEFT([Tên], 2)")).toEqual([" a", "bi", "ch", ""]);
  });
  it("hàm ngày (ISO và dd/mm/yyyy)", () => {
    expect(row("YEAR([Ngày])")).toEqual([2026, 2026, 2026, null]);
    expect(row("MONTH([Ngày])")).toEqual([3, 4, 5, null]);
    expect(row("QUARTER([Ngày])")).toEqual([1, 2, 2, null]);
    expect(row("YEAR_MONTH([Ngày])")).toEqual(["2026-03", "2026-04", "2026-05", null]);
    expect(row('DATE_DIFF([Ngày], "2026-03-10")')).toEqual([5, 23, 53, null]);
  });
  it("ROUND, GREATEST, IFNULL, NUMBER", () => {
    expect(row("ROUND([Doanh thu] / 3, 1)")).toEqual([33.3, 66.7, 100, null]);
    expect(row("IFNULL([Doanh thu], 0)")).toEqual([100, 200, 300, 0]);
    expect(row("GREATEST([Doanh thu], 150)")).toEqual([150, 200, 300, 150]);
    expect(row('NUMBER("1.234,5") + NUMBER("1,234.5")')).toEqual([2469, 2469, 2469, 2469]);
  });
  it("trường dùng trường khác, theo đúng thứ tự phụ thuộc dù khai báo ngược", () => {
    const set = calc([["Lãi %", "[Lãi] / [Doanh thu] * 100"], ["Lãi", "[Doanh thu] - [Chi phí]"]]);
    expect(set.errors.size).toBe(0);
    expect(materializeRows(rows, set).map((r) => r["Lãi %"])).toEqual([60, 75, 80, null]);
  });
  it("không sửa dòng gốc", () => {
    const set = calc([["X", "[Đơn] + 1"]]);
    const out = materializeRows(rows, set);
    expect("X" in rows[0]).toBe(false);
    expect(out[0].X).toBe(5);
  });
  it("kiểu cột suy ra từ kết quả", () => {
    const set = calc([["A", "[Đơn] + 1"], ["B", '[Loại] & "!"'], ["C", "[Đơn] > 1"]]);
    const m = materializeRows(rows, set);
    expect(set.rowFields.map((f) => inferCalcType(f, m))).toEqual(["number", "string", "boolean"]);
  });
});

describe("công thức tổng hợp", () => {
  it("tỉ lệ của hai tổng khác trung bình của tỉ lệ", () => {
    const set = calc([["AOV", "SUM([Doanh thu]) / SUM([Đơn])"]]);
    expect(set.aggFields.has("AOV")).toBe(true);
    expect(evalAggField(set.aggFields.get("AOV")!, rows)).toBeCloseTo(600 / 12);
  });
  it("aggregate() tính theo từng nhóm và đặt tên số đo theo tên trường", () => {
    const set = calc([["AOV", "SUM([Doanh thu]) / SUM([Đơn])"]]);
    const t = aggregate(rows, [{ column: "Loại" }], [{ column: "AOV" }], set);
    expect(t.metricLabels).toEqual(["AOV"]);
    expect(t.rows.map((r) => [r.keys[0], r.values[0]])).toEqual([["A", 400 / 12], ["B", 0]]);
  });
  it("hàm tổng hợp bọc biểu thức theo dòng và trường theo dòng khác", () => {
    const set = calc([["Lãi", "[Doanh thu] - [Chi phí]"], ["Tổng lãi đơn lớn", "SUM(IF([Đơn] >= 4, [Lãi], 0))"]]);
    expect(evalAggField(set.aggFields.get("Tổng lãi đơn lớn")!, materializeRows(rows, set))).toBe(60 + 240);
  });
  it("COUNT_DISTINCT, COUNT bỏ ô trống, MIN/MAX", () => {
    const set = calc([["a", "COUNT_DISTINCT([Loại])"], ["b", "COUNT([Doanh thu])"], ["c", "MAX([Doanh thu]) - MIN([Doanh thu])"]]);
    expect([...set.aggFields.values()].map((f) => evalAggField(f, rows))).toEqual([2, 3, 200]);
  });
});

describe("lỗi và an toàn", () => {
  const err = (e: string) => {
    const r = parseFormula(e);
    return r.ok ? null : r.error;
  };
  it("báo lỗi dễ hiểu", () => {
    expect(err("")).toMatch(/Chưa nhập/);
    expect(err("1 +")).toMatch(/chưa đầy đủ/);
    expect(err("(1 + 2")).toMatch(/\)/);
    expect(err("FOO(1)")).toMatch(/không tồn tại/);
    expect(err("ROUND()")).toMatch(/cần/);
    expect(err("DoanhThu + 1")).toBeNull(); // tên trần hợp lệ khi không có khoảng trắng
    expect(err("Doanh thu + 1")).toMatch(/viết trong \[ \]/); // có dấu cách: nhắc dùng [ ]
    expect(err("[Doanh thu")).toMatch(/\]/);
    expect(err('"abc')).toMatch(/nháy/);
    expect(err("1 $ 2")).toMatch(/không hợp lệ/);
  });
  it("cột phải nằm trong hàm tổng hợp; không lồng hàm tổng hợp", () => {
    expect(err("SUM([a]) / [b]")).toMatch(/phải nằm trong hàm tổng hợp/);
    expect(err("SUM(SUM([a]))")).toMatch(/hàm tổng hợp/);
  });
  it("giới hạn độ dài và độ sâu", () => {
    expect(err("1+".repeat(600) + "1")).toMatch(/dài quá/);
    expect(err("(".repeat(100) + "1" + ")".repeat(100))).toMatch(/sâu/);
  });
  it("trùng tên, trùng cột gốc, vòng lặp, phụ thuộc trường tổng hợp", () => {
    expect(calc([["Đơn", "1"]]).errors.get("Đơn")).toMatch(/Trùng tên/);
    expect(calc([["A", "1"], ["A", "2"]]).errors.get("A")).toMatch(/cùng tên/);
    const cyc = calc([["A", "[B] + 1"], ["B", "[A] + 1"]]);
    expect(cyc.errors.get("A")).toMatch(/Vòng lặp/);
    expect(cyc.errors.get("B")).toMatch(/Vòng lặp/);
    expect(cyc.rowFields).toHaveLength(0);
    const dep = calc([["T", "SUM([Đơn])"], ["U", "[T] + 1"]]);
    expect(dep.errors.get("U")).toMatch(/tổng hợp/);
  });
  it("trường lỗi kéo theo trường phụ thuộc, trường tốt vẫn chạy", () => {
    const set = calc([["Tốt", "[Đơn] + 1"], ["Hỏng", "1 +"], ["Phụ", "[Hỏng] + 1"]]);
    expect([...set.errors.keys()].sort()).toEqual(["Hỏng", "Phụ"]);
    expect(set.rowFields.map((f) => f.name)).toEqual(["Tốt"]);
  });
  it("tên đặc biệt (__proto__, constructor) không làm hỏng và không đụng prototype", () => {
    const set = calc([["__proto__", "[Đơn] + 1"], ["constructor", "2"]]);
    const out = materializeRows(rows, set);
    expect(Object.getPrototypeOf(out[0])).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("công thức giống mã JS không chạy được mã", () => {
    expect(err("constructor.constructor('return 1')()")).not.toBeNull();
    expect(err("process.exit(1)")).not.toBeNull();
  });
  it("cột không tồn tại: báo gợi ý, và tính ra trống", () => {
    expect(unknownRefs({ id: "x", name: "X", expression: "[Không có] + [Đơn]" }, Object.keys(rows[0]))).toEqual(["Không có"]);
    const set = calc([["X", "[Không có] + 1"]]);
    expect(materializeRows(rows, set).map((r) => r.X)).toEqual([null, null, null, null]);
  });
});
