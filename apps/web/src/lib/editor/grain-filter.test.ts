import { describe, expect, it } from "vitest";
import type { Filter, Widget } from "@dashboard/schema";
import { toRowFilters, withGrainOverride } from "./filters";

const chart = (id: string, grain?: "month"): Widget =>
  ({
    id, x: 0, y: 0, w: 100, h: 100, rotation: 0, z: 0, locked: false, hidden: false,
    config: { kind: "chart", chartType: "line", sourceId: "s", dimensions: [{ column: "d", ...(grain ? { grain } : {}) }, { column: "r" }], metrics: [{ column: "v", aggregation: "sum" }] },
  }) as Widget;
const f = (over: Partial<Filter> = {}): Filter => ({ id: "g1", sourceId: "s", column: "d", control: "grain", ...over });
const dims = (w: Widget) => (w.config.kind === "chart" ? w.config.dimensions : []);

describe("bộ chọn cấp thời gian", () => {
  it("đổi grain của chiều thuộc cột, kể cả chiều chưa đặt grain; giữ nguyên chiều khác", () => {
    const w = withGrainOverride(chart("a"), [f()], { g1: { values: ["week"] } });
    expect(dims(w)).toEqual([{ column: "d", grain: "week" }, { column: "r" }]);
  });
  it("chưa chọn (Mặc định) thì trả đúng widget gốc", () => {
    const w = chart("a", "month");
    expect(withGrainOverride(w, [f()], {})).toBe(w);
  });
  it("giá trị đã trùng thì không tạo bản sao mới", () => {
    const w = chart("a", "month");
    expect(withGrainOverride(w, [f()], { g1: { values: ["month"] } })).toBe(w);
  });
  it("tôn trọng targets và nguồn dữ liệu", () => {
    const w = chart("a");
    expect(withGrainOverride(w, [f({ targets: ["b"] })], { g1: { values: ["week"] } })).toBe(w);
    expect(withGrainOverride(w, [f({ sourceId: "khac" })], { g1: { values: ["week"] } })).toBe(w);
    expect(dims(withGrainOverride(w, [f({ targets: ["a"] })], { g1: { values: ["week"] } }))[0].grain).toBe("week");
  });
  it("không bao giờ biến thành bộ lọc dòng", () => {
    expect(toRowFilters([f()], { g1: { values: ["week"] } }, "s")).toEqual([]);
  });
});
