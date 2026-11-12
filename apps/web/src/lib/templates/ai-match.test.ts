import { describe, expect, it } from "vitest";
import { Slot } from "@dashboard/schema";
import { buildMatchPrompt, parseMatchResult } from "./ai-match";

const slots = [
  Slot.parse({ key: "ngay", label: "Ngày", type: "date" }),
  Slot.parse({ key: "doanh_thu", label: "Doanh thu", type: "number" }),
  Slot.parse({ key: "khu_vuc", label: "Khu vực", type: "string", required: false }),
];
const cols = [
  { name: "Ngày lập", type: "date" as const },
  { name: "Tiền", type: "number" as const },
  { name: "Miền", type: "string" as const },
];

describe("parseMatchResult", () => {
  const args = (matches: unknown) => JSON.stringify({ matches });

  it("nhận cặp hợp lệ", () => {
    expect(parseMatchResult(args([{ slot: "ngay", column: "Ngày lập" }, { slot: "doanh_thu", column: "Tiền" }]), slots, cols)).toEqual({
      ngay: "Ngày lập", doanh_thu: "Tiền",
    });
  });

  it("bỏ vai lạ, cột không tồn tại, chuỗi rỗng, khác kiểu", () => {
    const r = parseMatchResult(
      args([
        { slot: "khong_co", column: "Tiền" },
        { slot: "ngay", column: "Cột bịa" },
        { slot: "khu_vuc", column: "" },
        { slot: "doanh_thu", column: "Miền" },
      ]),
      slots, cols,
    );
    expect(r).toEqual({});
  });

  it("mỗi cột và mỗi vai chỉ dùng một lần (cặp đầu thắng)", () => {
    const two = [...cols, { name: "Ngày giao", type: "date" as const }];
    const r = parseMatchResult(args([{ slot: "ngay", column: "Ngày lập" }, { slot: "ngay", column: "Ngày giao" }]), slots, two);
    expect(r).toEqual({ ngay: "Ngày lập" });
    const r2 = parseMatchResult(
      args([{ slot: "doanh_thu", column: "Tiền" }, { slot: "ngay", column: "Tiền" }]),
      slots, cols,
    );
    expect(r2).toEqual({ doanh_thu: "Tiền" });
  });

  it("JSON hỏng hoặc sai dạng thì trả rỗng, không ném lỗi", () => {
    expect(parseMatchResult("không phải json", slots, cols)).toEqual({});
    expect(parseMatchResult('{"matches":"x"}', slots, cols)).toEqual({});
    expect(parseMatchResult("null", slots, cols)).toEqual({});
  });

  it("không tin chỉ dẫn lén trong kết quả: khoá vai kiểu __proto__ bị bỏ", () => {
    const r = parseMatchResult(args([{ slot: "__proto__", column: "Tiền" }]), slots, cols);
    expect(r).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("buildMatchPrompt", () => {
  it("chỉ gửi tối đa 3 giá trị mẫu, cắt ngắn, gói trong <data>", () => {
    const p = buildMatchPrompt(slots, [{ name: "Tiền", type: "number", samples: ["1", "2", "x".repeat(100), "4"] }]);
    expect(p.startsWith("<data>")).toBe(true);
    expect(p).not.toContain('"4"');
    expect(p).toContain("…");
  });
});
