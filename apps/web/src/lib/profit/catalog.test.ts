import { describe, expect, it } from "vitest";
import type { Row } from "@dashboard/chart-engine";
import { COL } from "@/lib/orders/canonical";
import { applyCatalogCosts, catalogMap, findByKey, parentKeys } from "./catalog";

const row = (sku: string, over: Partial<Record<string, string | number | null>> = {}): Row => ({
  [COL.sku]: sku, [COL.product]: "Áo", [COL.status]: "Hoàn thành", [COL.quantity]: 2, [COL.cost]: null, ...over,
});

describe("mã SKU biến thể thừa hưởng mã gốc", () => {
  it("bỏ dần đuôi sau - hoặc _, tối đa 3 lần, khoá cha ≥ 3 ký tự", () => {
    expect(parentKeys("AO-001-AE")).toEqual(["ao-001"]);
    expect(parentKeys("AO-001_DO-XL")).toEqual(["ao-001_do", "ao-001"]);
    expect(parentKeys("A-1")).toEqual([]);
    expect(parentKeys("KHONGDAU")).toEqual([]);
  });

  it("tra khoá đúng trước, rồi khoá cha", () => {
    const m = new Map([["ao-001", 1], ["ao-001-ae", 2]]);
    expect(findByKey(m, "AO-001-AE")).toBe(2);
    expect(findByKey(m, "AO-001-DO")).toBe(1);
    expect(findByKey(m, "QUAN-002")).toBeUndefined();
  });

  it("giá vốn nhập cho mã gốc áp dụng cho mọi biến thể; giá của chính biến thể thắng", () => {
    const rows = [row("AO-001"), row("AO-001-AE"), row("AO-001-DO"), row("AO-002-AE")];
    const { rows: out } = applyCatalogCosts(rows, catalogMap([{ sku: "AO-001", unitCost: 30_000 }, { sku: "AO-001-DO", unitCost: 35_000 }]));
    expect(out.map((r) => r[COL.cost])).toEqual([60_000, 60_000, 70_000, null]);
  });

  it("chỉ vừa sửa mã gốc thì không đè giá riêng của biến thể", () => {
    const rows = [row("AO-001"), row("AO-001-AE", { [COL.cost]: 70_000 }), row("AO-001-DO")];
    const cat = catalogMap([{ sku: "AO-001", unitCost: 30_000 }, { sku: "AO-001-AE", unitCost: 35_000 }]);
    const { rows: out, changed } = applyCatalogCosts(rows, cat, new Set(["ao-001"]));
    expect(out.map((r) => r[COL.cost])).toEqual([60_000, 70_000, 60_000]);
    expect(changed).toBe(2);
  });
});
