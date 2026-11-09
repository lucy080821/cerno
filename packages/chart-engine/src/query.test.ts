import { describe, expect, it } from "vitest";
import { MAX_RAW_ROWS, MAX_RESULT_GROUPS, aggregate, applyFilters, compileCalcFields, materializeRows, numberRange, runQuery, type Row } from "./index";

const rows: Row[] = [
  { Tháng: "T1", Loại: "A", "Doanh thu": 100, "Đơn": 4, Ngày: "2026-01-05" },
  { Tháng: "T1", Loại: "B", "Doanh thu": 200, "Đơn": 6, Ngày: "2026-01-20" },
  { Tháng: "T2", Loại: "A", "Doanh thu": 300, "Đơn": 5, Ngày: "2026-02-03" },
  { Tháng: "T2", Loại: "B", "Doanh thu": null, "Đơn": 1, Ngày: "02/03/2026" },
];
const dims = [{ column: "Tháng" }];
const sum = (column: string) => ({ column, aggregation: "sum" as const });

describe("runQuery: kết quả giống hệt tính tại máy", () => {
  it("gộp theo chiều, kèm bộ lọc", () => {
    const filters = [{ column: "Loại", values: ["A"] }];
    const r = runQuery(rows, { mode: "aggregate", dims, metrics: [sum("Doanh thu")], filters, calc: [] });
    expect(r.mode).toBe("aggregate");
    if (r.mode !== "aggregate") return;
    expect(r.table).toEqual(aggregate(applyFilters(rows, filters), dims, [sum("Doanh thu")]));
    expect(r.matched).toBe(2);
    expect(r.truncated).toBe(false);
  });

  it("bộ lọc do chính widget tạo (lọc chéo) bị bỏ qua nhờ selfId", () => {
    const filters = [{ column: "Loại", values: ["A"], originId: "w1" }];
    const mine = runQuery(rows, { mode: "aggregate", dims, metrics: [sum("Đơn")], filters, selfId: "w1", calc: [] });
    const other = runQuery(rows, { mode: "aggregate", dims, metrics: [sum("Đơn")], filters, selfId: "w2", calc: [] });
    expect(mine.mode === "aggregate" && mine.matched).toBe(4);
    expect(other.mode === "aggregate" && other.matched).toBe(2);
  });

  it("trường tính toán theo dòng làm chiều và làm bộ lọc", () => {
    const calc = [{ id: "c1", name: "Quý", expression: 'IF([Tháng] = "T1", "Q1", "Q2")' }];
    const r = runQuery(rows, {
      mode: "aggregate", dims: [{ column: "Quý" }], metrics: [sum("Đơn")], calc,
      filters: [{ column: "Quý", values: ["Q2"] }],
    });
    expect(r.mode === "aggregate" && r.table.rows.map((x) => [x.keys[0], x.values[0]])).toEqual([["Q2", 6]]);
  });

  it("trường tổng hợp (SUM/SUM) tính theo nhóm, kể cả khi dùng trường theo dòng khác", () => {
    const calc = [
      { id: "a", name: "Lãi", expression: "[Doanh thu] / 10" },
      { id: "b", name: "Lãi/đơn", expression: "SUM([Lãi]) / SUM([Đơn])" },
    ];
    const r = runQuery(rows, { mode: "aggregate", dims, metrics: [{ column: "Lãi/đơn" }], calc, filters: [] });
    expect(r.mode === "aggregate" && r.table.rows.map((x) => x.values[0])).toEqual([30 / 10, 30 / 6]);
    // Cùng kết quả khi tự tính từ đầu:
    const set = compileCalcFields(calc, Object.keys(rows[0]));
    const local = aggregate(materializeRows(rows, set), dims, [{ column: "Lãi/đơn" }], set);
    expect(r.mode === "aggregate" && r.table).toEqual(local);
  });

  it("không tính cột theo dòng khi truy vấn không dùng tới (giữ nguyên tham chiếu dòng gốc)", () => {
    const calc = [{ id: "c1", name: "Thừa", expression: "[Đơn] * 2" }];
    const r = runQuery(rows, { mode: "aggregate", dims, metrics: [sum("Đơn")], calc, filters: [] });
    expect(r.mode === "aggregate" && r.table.rows.length).toBe(2);
    const raw = runQuery(rows, { mode: "raw", limit: 10, calc, filters: [] });
    expect(raw.mode === "raw" && raw.columns).toContain("Thừa");
  });

  it("công thức hỏng không làm sập truy vấn: bỏ trường đó", () => {
    const calc = [{ id: "x", name: "Hỏng", expression: "1 +" }];
    const r = runQuery(rows, { mode: "aggregate", dims, metrics: [sum("Đơn")], calc, filters: [] });
    expect(r.mode).toBe("aggregate");
  });
});

describe("runQuery: dòng thô, thống kê, giới hạn", () => {
  it("raw giới hạn số dòng và đếm tổng khớp", () => {
    const r = runQuery(rows, { mode: "raw", limit: 2, calc: [], filters: [{ column: "Loại", values: ["B"] }] });
    expect(r.mode === "raw" && r.rows.length).toBe(2);
    expect(r.mode === "raw" && r.matched).toBe(2);
    const big = Array.from({ length: MAX_RAW_ROWS + 50 }, (_, i) => ({ i }));
    const r2 = runQuery(big, { mode: "raw", limit: 99_999, calc: [], filters: [] });
    expect(r2.mode === "raw" && r2.rows.length).toBe(MAX_RAW_ROWS);
  });

  it("stats: giá trị khác nhau, khoảng số, khoảng ngày (ISO và dd/mm/yyyy)", () => {
    const s = runQuery(rows, { mode: "stats", column: "Doanh thu", calc: [] });
    expect(s.mode === "stats" && s.numeric).toEqual({ min: 100, max: 300 }); // ô trống không tính là 0
    const d = runQuery(rows, { mode: "stats", column: "Ngày", calc: [] });
    expect(d.mode === "stats" && d.date).toEqual({ min: "2026-01-05", max: "2026-03-02" });
    const t = runQuery(rows, { mode: "stats", column: "Tháng", calc: [] });
    expect(t.mode === "stats" && t.distinct).toEqual(["T1", "T2"]);
  });

  it("cắt bớt khi quá nhiều nhóm và báo truncated", () => {
    const many: Row[] = Array.from({ length: MAX_RESULT_GROUPS + 10 }, (_, i) => ({ id: `k${i}`, v: 1 }));
    const r = runQuery(many, { mode: "aggregate", dims: [{ column: "id" }], metrics: [sum("v")], calc: [], filters: [] });
    expect(r.mode === "aggregate" && r.table.rows.length).toBe(MAX_RESULT_GROUPS);
    expect(r.mode === "aggregate" && r.groups).toBe(MAX_RESULT_GROUPS + 10);
    expect(r.mode === "aggregate" && r.truncated).toBe(true);
  });

  it("nguồn rỗng không lỗi", () => {
    const r = runQuery([], { mode: "aggregate", dims, metrics: [sum("Đơn")], calc: [], filters: [] });
    expect(r.mode === "aggregate" && r.table.rows).toEqual([]);
  });
});

describe("numberRange", () => {
  it("bỏ qua ô trống thay vì coi là 0", () => {
    expect(numberRange([{ a: null }, { a: "" }, { a: 5 }, { a: 9 }], "a")).toEqual({ min: 5, max: 9 });
    expect(numberRange([{ a: null }], "a")).toBeNull();
  });
});
