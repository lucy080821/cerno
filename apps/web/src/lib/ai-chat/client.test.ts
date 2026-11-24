import { describe, expect, it } from "vitest";
import { defaultSelection, parseEvent, reportBlocks, splitLines, toggleSource, type SourceOption } from "./client";

const src = (id: string, spreadsheet_id = "abc"): SourceOption => ({ id, name: id, sheet_name: id, spreadsheet_id, row_count: 1, last_synced_at: null });

describe("luồng NDJSON", () => {
  it("ghép dòng bị cắt giữa chừng", () => {
    const a = splitLines("", '{"t":"text","v":"Xin');
    expect(a.lines).toEqual([]);
    const b = splitLines(a.rest, ' chào"}\n{"t":"reset"}\n');
    expect(b.lines).toHaveLength(2);
    expect(b.rest).toBe("");
    expect(parseEvent(b.lines[0])).toEqual({ t: "text", v: "Xin chào" });
    expect(parseEvent(b.lines[1])).toEqual({ t: "reset" });
  });
  it("bỏ dòng hỏng và sự kiện lạ", () => {
    expect(parseEvent("không phải json")).toBeNull();
    expect(parseEvent('{"t":"lạ"}')).toBeNull();
    expect(parseEvent('{"t":"done"}')).toBeNull();
  });
  it("đọc sự kiện lỗi và hoàn tất", () => {
    expect(parseEvent('{"t":"error","message":"Hết lượt","status":429}')).toMatchObject({ t: "error", message: "Hết lượt", status: 429 });
    expect(parseEvent('{"t":"done","message":{"id":"1","role":"assistant","content":"ok","meta":{},"createdAt":"x"}}')).toMatchObject({ t: "done" });
  });
});

describe("reportBlocks", () => {
  it("nhận ra tiêu đề, phạm vi, mục, gạch đầu dòng", () => {
    const b = reportBlocks("BÁO CÁO: Lãi tháng 11\nPhạm vi: Shopee, 01/11 đến 24/11\n\n1. TÓM TẮT\nLãi 2.100.000 đồng.\n\n2. SỐ LIỆU CHI TIẾT\n- Shopee: 12.345.000 đồng\n- TikTok Shop: 4.000.000 đồng");
    expect(b.map((x) => x.kind)).toEqual(["title", "scope", "gap", "heading", "para", "gap", "heading", "item", "item"]);
    expect(b[7].text).toBe("Shopee: 12.345.000 đồng");
  });
  it("câu thường bắt đầu bằng số không bị coi là tiêu đề mục", () => {
    expect(reportBlocks("1. Lãi tăng nhẹ so với tháng trước")[0].kind).toBe("para");
  });
  it("bỏ dòng trống thừa ở đầu cuối và liền nhau", () => {
    expect(reportBlocks("a\n\n\n\nb\n\n").map((x) => x.kind)).toEqual(["para", "gap", "para"]);
  });
});

describe("chọn nguồn", () => {
  it("mặc định ưu tiên nguồn đã lưu còn tồn tại, rồi nguồn đơn hàng", () => {
    const list = [src("a"), src("b", "upload:orders")];
    expect(defaultSelection(["x", "a"], list)).toEqual(["a"]);
    expect(defaultSelection([], list)).toEqual(["b"]);
    expect(defaultSelection([], [src("a")])).toEqual(["a"]);
    expect(defaultSelection([], [])).toEqual([]);
  });
  it("chọn tối đa 5 nguồn", () => {
    let s: string[] = [];
    for (const id of ["1", "2", "3", "4", "5", "6"]) s = toggleSource(s, id);
    expect(s).toEqual(["1", "2", "3", "4", "5"]);
    expect(toggleSource(s, "3")).toEqual(["1", "2", "4", "5"]);
  });
});
