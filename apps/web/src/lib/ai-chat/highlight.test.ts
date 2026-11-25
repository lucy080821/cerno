import { describe, expect, it } from "vitest";
import { autoHighlight, splitHighlights, stripHighlights, usesHighlights } from "./highlight";

const hot = (segs: { text: string; hot: boolean }[]) => segs.filter((s) => s.hot).map((s) => s.text);

describe("splitHighlights", () => {
  it("tách đoạn được AI đánh dấu", () => {
    const s = splitHighlights("Lãi ⟦18.382.974 đồng⟧, biên lãi ⟦46,59%⟧ trên 64 đơn.");
    expect(hot(s)).toEqual(["18.382.974 đồng", "46,59%"]);
    expect(s.map((x) => x.text).join("")).toBe("Lãi 18.382.974 đồng, biên lãi 46,59% trên 64 đơn.");
  });
  it("dấu mở chưa kịp đóng (đang stream) hoặc dấu lẻ không hiện ra", () => {
    expect(splitHighlights("Lãi ⟦18.382")).toEqual([{ text: "Lãi 18.382", hot: false }]);
    expect(splitHighlights("a ⟧ b")).toEqual([{ text: "a  b", hot: false }]);
  });
  it("usesHighlights và stripHighlights", () => {
    expect(usesHighlights("x ⟦1⟧")).toBe(true);
    expect(usesHighlights("x ⟦1")).toBe(true);
    expect(usesHighlights("x 1")).toBe(false);
    expect(stripHighlights("a ⟦b⟧ ⟦c")).toBe("a b c");
  });
});

describe("autoHighlight", () => {
  it("nổi số kèm đơn vị và số lớn, bỏ số thứ tự và mã", () => {
    expect(hot(autoHighlight("Toàn shop lãi 18.382.974 đồng, biên lãi 46,59%."))).toEqual(["18.382.974 đồng", "46,59%"]);
    expect(hot(autoHighlight("Có 64 đơn và 3 sản phẩm lỗ."))).toEqual(["64 đơn", "3 sản phẩm"]);
    expect(hot(autoHighlight("Sản phẩm CHAO-006 và SKU12 bán 7 cái"))).toEqual(["7 cái"]);
    expect(hot(autoHighlight("Doanh thu 1.234.567"))).toEqual(["1.234.567"]);
  });
  it("không có số đáng nổi thì giữ nguyên một đoạn", () => {
    expect(autoHighlight("Không có đơn nào lỗ.")).toEqual([{ text: "Không có đơn nào lỗ.", hot: false }]);
  });
  it("dấu chấm cuối câu không bị coi là một phần của số", () => {
    const s = autoHighlight("Lãi 5.300.000 đồng.");
    expect(hot(s)).toEqual(["5.300.000 đồng"]);
    expect(s.map((x) => x.text).join("")).toBe("Lãi 5.300.000 đồng.");
  });
});
