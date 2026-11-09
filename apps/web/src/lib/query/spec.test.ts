import { describe, expect, it } from "vitest";
import { QueryRequestSchema, parseQuerySpec } from "./spec";

const ID = "123e4567-e89b-12d3-a456-426614174000";
const agg = { mode: "aggregate", dims: [{ column: "A" }], metrics: [{ column: "B", aggregation: "sum" }], filters: [], calc: [] };

describe("QuerySpec", () => {
  it("nhận truy vấn hợp lệ cả ba chế độ", () => {
    expect(parseQuerySpec(agg)).not.toBeNull();
    expect(parseQuerySpec({ mode: "raw", limit: 100, filters: [], calc: [] })).not.toBeNull();
    expect(parseQuerySpec({ mode: "stats", column: "A", calc: [] })).not.toBeNull();
  });

  it("từ chối chế độ lạ, thiếu trường, sai kiểu", () => {
    for (const bad of [
      null, 1, "x", {}, { mode: "sql", q: "select 1" }, { ...agg, dims: "A" }, { ...agg, metrics: [{ aggregation: "sum" }] },
      { ...agg, metrics: [{ column: "B", aggregation: "drop table" }] }, { mode: "raw", limit: 0, filters: [], calc: [] },
      { mode: "raw", limit: 99999, filters: [], calc: [] }, { mode: "stats", calc: [] },
    ]) {
      expect(parseQuerySpec(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("giới hạn kích thước để không bị lạm dụng", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ column: `c${i}` }));
    expect(parseQuerySpec({ ...agg, dims: many(4) })).toBeNull();
    expect(parseQuerySpec({ ...agg, metrics: many(7) })).toBeNull();
    expect(parseQuerySpec({ ...agg, filters: Array.from({ length: 41 }, () => ({ column: "A", values: [] })) })).toBeNull();
    expect(parseQuerySpec({ ...agg, filters: [{ column: "A", values: Array.from({ length: 1001 }, String) }] })).toBeNull();
    expect(parseQuerySpec({ ...agg, filters: [{ column: "A".repeat(101), values: [] }] })).toBeNull();
    expect(parseQuerySpec({ ...agg, calc: [{ id: "x", name: "n", expression: "1".repeat(1001) }] })).toBeNull();
    expect(parseQuerySpec({ ...agg, calc: Array.from({ length: 51 }, (_, i) => ({ id: `${i}`, name: `n${i}`, expression: "1" })) })).toBeNull();
  });

  it("bộ lọc khoảng số/ngày hợp lệ, số vô cực bị từ chối", () => {
    expect(parseQuerySpec({ ...agg, filters: [{ column: "A", values: [], range: { min: 1, max: 5 }, dateRange: { from: "2026-01-01" } }] })).not.toBeNull();
    expect(parseQuerySpec({ ...agg, filters: [{ column: "A", values: [], range: { min: Infinity } }] })).toBeNull();
  });

  it("yêu cầu cần sourceId đúng dạng uuid", () => {
    expect(QueryRequestSchema.safeParse({ sourceId: ID, spec: agg }).success).toBe(true);
    expect(QueryRequestSchema.safeParse({ sourceId: "../../etc", spec: agg }).success).toBe(false);
    expect(QueryRequestSchema.safeParse({ spec: agg }).success).toBe(false);
  });
});
