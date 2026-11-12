import { describe, expect, it } from "vitest";
import { AlertDraft } from "@dashboard/schema";
import { checkRule, columnsUsed, type CalcInfo, type SourceInfo } from "./validate";

const sources: SourceInfo[] = [
  { id: "s", columns: [{ name: "Ngày", type: "date" }, { name: "DT", type: "number" }, { name: "Tỉnh", type: "string" }, { name: "Mã đơn", type: "string" }] },
  { id: "t", columns: [{ name: "X", type: "number" }] },
];
const calc: CalcInfo[] = [{ name: "Biên", sourceId: "s" }, { name: "Lạ", sourceId: "t" }];

const rule = (m: Record<string, unknown>, condition: unknown = { type: "threshold", op: "lt", value: 1 }) =>
  AlertDraft.parse({ metric: { sourceId: "s", metric: { column: "DT", aggregation: "sum" }, dateColumn: "Ngày", window: "today", ...m }, condition });

describe("checkRule", () => {
  it("luật hợp lệ", () => {
    expect(checkRule(rule({}), sources, calc)).toEqual([]);
  });
  it("nguồn không thuộc dashboard", () => {
    expect(checkRule(rule({ sourceId: "khac" }), sources, calc)).toEqual(["Nguồn dữ liệu không thuộc dashboard này."]);
  });
  it("cột chỉ số bịa ra / thiếu", () => {
    expect(checkRule(rule({ metric: { column: "Bịa" } }), sources, calc)).toEqual(['Cột "Bịa" không có trong nguồn dữ liệu.']);
    expect(checkRule(rule({ metric: { column: "" } }), sources, calc)).toEqual(["Chưa chọn cột cho chỉ số."]);
  });
  it("tổng/trung bình trên cột chữ bị từ chối; đếm thì được", () => {
    expect(checkRule(rule({ metric: { column: "Tỉnh", aggregation: "sum" } }), sources, calc)[0]).toMatch(/không phải cột số/);
    expect(checkRule(rule({ metric: { column: "Tỉnh", aggregation: "avg" } }), sources, calc)[0]).toMatch(/không phải cột số/);
    expect(checkRule(rule({ metric: { column: "Mã đơn", aggregation: "count" } }), sources, calc)).toEqual([]);
    expect(checkRule(rule({ metric: { column: "Mã đơn", aggregation: "count_distinct" } }), sources, calc)).toEqual([]);
  });
  it("trường tính toán của ĐÚNG nguồn dùng được; của nguồn khác thì không", () => {
    expect(checkRule(rule({ metric: { column: "Biên" } }), sources, calc)).toEqual([]);
    expect(checkRule(rule({ metric: { column: "Lạ" } }), sources, calc)).toEqual(['Cột "Lạ" không có trong nguồn dữ liệu.']);
  });
  it("cột ngày phải tồn tại và có kiểu ngày", () => {
    expect(checkRule(rule({ dateColumn: "Không" }), sources, calc)).toEqual(['Cột ngày "Không" không có trong nguồn dữ liệu.']);
    expect(checkRule(rule({ dateColumn: "Tỉnh" }), sources, calc)).toEqual(['Cột "Tỉnh" không phải cột ngày.']);
  });
  it("cột nhóm và cột lọc phải tồn tại", () => {
    const pg = { type: "per_group", inner: { type: "threshold", op: "lt", value: 1 } };
    expect(checkRule(rule({ groupBy: "Vùng" }, pg), sources, calc)).toEqual(['Cột nhóm "Vùng" không có trong nguồn dữ liệu.']);
    expect(checkRule(rule({ groupBy: "Tỉnh" }, pg), sources, calc)).toEqual([]);
    expect(checkRule(rule({ filters: [{ column: "Ma", values: ["x"] }] }), sources, calc)).toEqual(['Cột lọc "Ma" không có trong nguồn dữ liệu.']);
  });
  it("luật stale chỉ cần nguồn có thật, bỏ qua cột chỉ số", () => {
    expect(checkRule(rule({ metric: { column: "Bịa" } }, { type: "stale", hours: 24 }), sources, calc)).toEqual([]);
    expect(checkRule(rule({ sourceId: "khac" }, { type: "stale", hours: 24 }), sources, calc)).toHaveLength(1);
  });
  it("gom nhiều lỗi cùng lúc", () => {
    expect(checkRule(rule({ metric: { column: "A" }, dateColumn: "B", filters: [{ column: "C", values: [] }] }), sources, calc)).toHaveLength(3);
  });
});

describe("columnsUsed", () => {
  it("liệt kê cột dùng, bỏ trùng và rỗng", () => {
    const m = rule({ groupBy: "Tỉnh", filters: [{ column: "Tỉnh", values: [] }, { column: "Mã đơn", values: [] }] }, { type: "per_group", inner: { type: "threshold", op: "lt", value: 1 } }).metric;
    expect(columnsUsed(m).sort()).toEqual(["DT", "Mã đơn", "Ngày", "Tỉnh"].sort());
  });
});
