import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/server/crypto", () => ({ decrypt: (x: string) => x, encrypt: (x: string) => x }));

import { MAX_CELLS, MAX_COLUMNS, MAX_ROWS, hashValues, maxRowsFor, sheetToTable } from "./sheet-data";

describe("giới hạn sheet lớn", () => {
  it("số dòng tối đa giảm theo số cột để tổng ô không quá MAX_CELLS", () => {
    expect(maxRowsFor(1)).toBe(MAX_ROWS);
    expect(maxRowsFor(10)).toBe(MAX_ROWS); // 2.000.000 / 10 = 200.000
    expect(maxRowsFor(20)).toBe(100_000);
    expect(maxRowsFor(MAX_COLUMNS)).toBe(Math.floor(MAX_CELLS / MAX_COLUMNS));
    expect(maxRowsFor(0)).toBeGreaterThan(0);
  });

  it("sheetToTable cắt theo số ô và báo truncated", () => {
    const cols = 40; // → 50.000 dòng
    const header = Array.from({ length: cols }, (_, i) => `c${i}`);
    const body = Array.from({ length: 50_010 }, (_, r) => header.map((_, c) => String(r + c)));
    const t = sheetToTable([header, ...body]);
    expect(t.rows).toHaveLength(Math.floor(MAX_CELLS / cols));
    expect(t.truncated).toBe(true);
    const small = sheetToTable([header, ...body.slice(0, 100)]);
    expect(small.truncated).toBe(false);
    expect(small.rows).toHaveLength(100);
  });

  it("dấu vân tay: ổn định, và đổi khi nội dung hoặc số dòng đổi", () => {
    const v = Array.from({ length: 12_000 }, (_, i) => [`a${i}`, `${i}`]);
    const h = hashValues(v);
    expect(hashValues(v.map((r) => [...r]))).toBe(h);
    const changed = v.map((r) => [...r]);
    changed[11_999][1] = "x";
    expect(hashValues(changed)).not.toBe(h);
    expect(hashValues(v.slice(0, 11_999))).not.toBe(h);
  });
});

describe("readTab đọc theo đoạn", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Giả lập Sheets API: tab 45.000 dòng lưới; dữ liệu thật tới hết dòng `dataRows`; trả theo yêu cầu đoạn. */
  function fakeSheets(gridRows: number, dataRows: number, blankAt: number[] = []) {
    const calls: string[] = [];
    const rowAt = (n: number) => (blankAt.includes(n) ? [] : [`r${n}`, `v${n}`]);
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(decodeURIComponent(url));
      if (url.includes("fields=sheets.properties")) {
        return new Response(JSON.stringify({ sheets: [{ properties: { title: "Tab 1", gridProperties: { rowCount: gridRows } } }] }));
      }
      const m = /!(\d+):(\d+)/.exec(decodeURIComponent(url))!;
      const a = Number(m[1]);
      const b = Number(m[2]);
      const values: string[][] = [];
      for (let n = a; n <= Math.min(b, dataRows); n++) values.push(rowAt(n));
      // Sheets bỏ các dòng trống ở cuối đoạn.
      while (values.length && values[values.length - 1].length === 0) values.pop();
      return new Response(JSON.stringify(values.length ? { values } : {}));
    });
    return calls;
  }

  it("ghép các đoạn đúng vị trí, kể cả khi cuối đoạn có dòng trống bị Sheets bỏ", async () => {
    // Dòng 20.000 (cuối đoạn đầu) trống: không được làm dòng của đoạn sau dồn lên.
    const calls = fakeSheets(45_000, 45_000, [20_000]);
    const { readTab } = await import("./api");
    const out = await readTab("tok", "sheetid", "Tab 1");
    expect(out).toHaveLength(45_000);
    expect(out[0]).toEqual(["r1", "v1"]);
    expect(out[19_999]).toEqual([]); // dòng 20.000 là dòng trống
    expect(out[20_000]).toEqual(["r20001", "v20001"]); // vị trí đúng
    expect(out[44_999]).toEqual(["r45000", "v45000"]);
    expect(calls.filter((c) => c.includes("!")).length).toBe(3); // 20k + 20k + 5k
  });

  it("dừng khi đã đủ số dòng tối đa, không đọc hết lưới", async () => {
    const calls = fakeSheets(1_000_000, 1_000_000);
    const { readTab } = await import("./api");
    const out = await readTab("tok", "sheetid", "Tab 1", 30_000);
    expect(out.length).toBeGreaterThanOrEqual(30_001);
    expect(out.length).toBeLessThan(80_000);
    expect(calls.filter((c) => c.includes("!")).length).toBeLessThan(5);
  });

  it("cắt cột thừa ngay khi nhận", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("fields=sheets.properties")) {
        return new Response(JSON.stringify({ sheets: [{ properties: { title: "T", gridProperties: { rowCount: 2 } } }] }));
      }
      return new Response(JSON.stringify({ values: [Array.from({ length: 100 }, (_, i) => `h${i}`), Array.from({ length: 100 }, () => "1")] }));
    });
    const { readTab } = await import("./api");
    const out = await readTab("tok", "sheetid", "T");
    expect(out[0]).toHaveLength(MAX_COLUMNS);
  });
});
