import { describe, expect, it } from "vitest";
import type { CalculatedField, Widget } from "@dashboard/schema";
import { calcDefsFor, specForWidget } from "./widget-spec";

const box = { x: 0, y: 0, w: 100, h: 100, rotation: 0, z: 0, locked: false, hidden: false };
const chart = (over: Record<string, unknown>): Widget =>
  ({ id: "w", ...box, config: { kind: "chart", chartType: "bar", sourceId: "s", dimensions: [], metrics: [], ...over } }) as Widget;

describe("calcDefsFor", () => {
  it("chỉ lấy trường của nguồn đó, bỏ sourceId", () => {
    const fields: CalculatedField[] = [
      { id: "a", sourceId: "s", name: "A", expression: "[x]" },
      { id: "b", sourceId: "t", name: "B", expression: "[y]" },
    ];
    expect(calcDefsFor(fields, "s")).toEqual([{ id: "a", name: "A", expression: "[x]" }]);
    expect(calcDefsFor(fields, "zzz")).toEqual([]);
  });
});

describe("specForWidget", () => {
  const filters = [{ column: "Loại", values: ["A"] }];
  const calc = [{ id: "a", name: "A", expression: "[x]" }];

  it("KPI thường: gộp không chiều, không có compare", () => {
    const w = { id: "k", ...box, config: { kind: "kpi", sourceId: "s", metric: { column: "DT", aggregation: "sum" }, compareToPrevious: false } } as Widget;
    expect(specForWidget(w, filters, calc)).toEqual({
      sourceId: "s",
      spec: { mode: "aggregate", dims: [], metrics: [{ column: "DT", aggregation: "sum" }], filters, selfId: "k", calc },
    });
  });

  it("KPI có so kỳ: đưa compare vào truy vấn", () => {
    const compare = { to: "prev_period", dateColumn: "Ngày", grain: "month", show: "percent", goodWhen: "up", toDate: true } as const;
    const w = { id: "k", ...box, config: { kind: "kpi", sourceId: "s", metric: { column: "DT", aggregation: "sum" }, compareToPrevious: false, compare } } as Widget;
    const r = specForWidget(w, [], []);
    expect(r?.spec).toMatchObject({ mode: "aggregate", compare });
  });

  it("bảng không chọn trường: truy vấn thô 100 dòng; có trường: gộp", () => {
    expect(specForWidget(chart({ chartType: "table" }), filters, calc)?.spec).toEqual({ mode: "raw", limit: 100, filters, selfId: "w", calc });
    const t = specForWidget(chart({ chartType: "table", dimensions: [{ column: "Tỉnh" }], metrics: [{ column: "DT", aggregation: "sum" }] }), [], []);
    expect(t?.spec).toMatchObject({ mode: "aggregate", dims: [{ column: "Tỉnh" }], metrics: [{ column: "DT", aggregation: "sum" }] });
  });

  it("chart đủ trường: gộp theo chiều và số đo", () => {
    const r = specForWidget(chart({ dimensions: [{ column: "Tỉnh" }], metrics: [{ column: "DT", aggregation: "sum" }] }), filters, calc);
    expect(r).toEqual({
      sourceId: "s",
      spec: { mode: "aggregate", dims: [{ column: "Tỉnh" }], metrics: [{ column: "DT", aggregation: "sum" }], filters, selfId: "w", calc },
    });
  });

  it("chart thiếu trường, widget văn bản/ảnh: không có truy vấn", () => {
    expect(specForWidget(chart({}), [], [])).toBeNull();
    expect(specForWidget({ id: "t", ...box, config: { kind: "text", text: "x", fontSize: 16, bold: false, align: "left" } } as Widget, [], [])).toBeNull();
    expect(specForWidget({ id: "i", ...box, config: { kind: "image", url: "u", fit: "contain" } } as Widget, [], [])).toBeNull();
  });
});
