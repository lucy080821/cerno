import { describe, expect, it } from "vitest";
import type { Widget } from "@dashboard/schema";
import { ALL_PARTS, applyFormat } from "./widget-format";

const chart = (id: string, over: Partial<Widget> = {}, cfg: Record<string, unknown> = {}): Widget =>
  ({
    id, x: 0, y: 0, w: 100, h: 80, rotation: 0, z: 0, locked: false, hidden: false,
    config: { kind: "chart", chartType: "bar", sourceId: "s", dimensions: [], metrics: [], ...cfg },
    ...over,
  }) as Widget;

describe("applyFormat", () => {
  const src = chart("a", { x: 10, y: 20, w: 300, h: 200, rotation: 15, style: { radius: 4, border: true } as Widget["style"] }, {
    format: { showGrid: false },
  });

  it("chỉ đổi kích thước", () => {
    const t = applyFormat(chart("b", { x: 5 }, { title: "T" }), src, ["size"]);
    expect([t.w, t.h, t.x]).toEqual([300, 200, 5]);
  });
  it("vị trí gồm cả góc xoay", () => {
    const t = applyFormat(chart("b"), src, ["position"]);
    expect([t.x, t.y, t.rotation, t.w]).toEqual([10, 20, 15, 100]);
  });
  it("kiểu dáng giữ nguyên dữ liệu của đích", () => {
    const t = applyFormat(chart("b", {}, { title: "Giữ", metrics: [{ column: "x" }] }), src, ["style"]);
    const c = t.config as unknown as Record<string, unknown>;
    expect(c.title).toBe("Giữ");
    expect(c.metrics).toEqual([{ column: "x" }]);
    expect(c.format).toEqual({ showGrid: false });
    expect(t.style?.border).toBe(true);
  });
  it("khác loại thì chỉ áp khung", () => {
    const kpi = { ...chart("k"), config: { kind: "kpi", sourceId: "s", metric: { column: "m" }, compareToPrevious: false } } as Widget;
    const t = applyFormat(kpi, src, ALL_PARTS);
    expect(t.config).toEqual(kpi.config);
    expect(t.style?.radius).toBe(4);
  });
  it("không đụng widget khoá hoặc chính nó", () => {
    const locked = chart("b", { locked: true });
    expect(applyFormat(locked, src, ALL_PARTS)).toBe(locked);
    expect(applyFormat(src, src, ALL_PARTS)).toBe(src);
  });
  it("không dùng chung tham chiếu với nguồn", () => {
    const t = applyFormat(chart("b"), src, ["style"]);
    expect((t.config as { format?: object }).format).not.toBe((src.config as { format?: object }).format);
  });
});
