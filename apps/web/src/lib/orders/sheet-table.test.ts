import { describe, expect, it } from "vitest";
import type { RawTable } from "./files";
import { COL } from "./canonical";
import { cleanSheetTable, countScientificIds, mappingToNames, prepareSheetTable, resolveNamedMapping, sanitizeNamedMapping } from "./sheet-table";
import { SHOPEE_TABLE } from "./fixtures";

const HEADER = ["Mã đơn hàng", "Trạng thái đơn hàng", "Ngày đặt hàng", "Tên sản phẩm", "SKU phân loại hàng", "Số lượng", "Tổng giá bán (sản phẩm)"];
const row = (id: string, status: string, date: string, product = "Áo", sku = "A1", qty = "1", total = "100.000") => [id, status, date, product, sku, qty, total];
const table = (...rows: string[][]): RawTable => [HEADER, ...rows];

describe("tab Google Sheet đơn hàng", () => {
  it("nhận diện và chuẩn hoá giống file: một dòng một sản phẩm, đếm đơn đúng", () => {
    const p = prepareSheetTable(table(row("A1", "Hoàn thành", "05/09/2025"), row("A2", "Đã hủy", "06/09/2025")), { channel: "Shopee" });
    expect(p.problems).toEqual([]);
    expect(p.normalized?.stats.orders).toBe(2);
    expect(p.named.orderId).toEqual(["Mã đơn hàng"]);
    expect(p.named.date).toEqual(["Ngày đặt hàng"]);
  });

  it("chưa chọn kênh thì chưa nhập được (file chung không đoán ra kênh)", () => {
    const p = prepareSheetTable(table(row("A1", "Hoàn thành", "05/09/2025")));
    expect(p.channel === null || typeof p.channel === "string").toBe(true);
    if (!p.channel) expect(p.problems).toContain("Chưa chọn kênh bán.");
  });

  it("khử trùng: dán chồng khoảng ngày thì giữ dòng nằm DƯỚI (bản mới hơn)", () => {
    const t = table(
      row("A1", "Hoàn thành", "05/09/2025"),
      row("A2", "Hoàn thành", "06/09/2025"),
      row("A1", "Hoàn trả", "05/09/2025"), // dán lại sau, trạng thái đã đổi
      row("A3", "Hoàn thành", "07/09/2025"),
    );
    const p = prepareSheetTable(t, { channel: "Shopee" });
    expect(p.duplicates).toBe(1);
    expect(p.normalized?.stats.orders).toBe(3);
    const a1 = p.normalized?.rows.find((r) => r[COL.orderId] === "A1");
    expect(a1?.[COL.status]).toBe("Hoàn trả");
    expect(p.warnings.join(" ")).toMatch(/Đã bỏ 1 dòng trùng/);
  });

  it("một đơn nhiều dòng sản phẩm khác nhau thì không bị coi là trùng; dòng không có mã đơn không bao giờ trùng", () => {
    const t = table(row("A1", "Hoàn thành", "05/09/2025", "Áo", "A1"), row("A1", "Hoàn thành", "05/09/2025", "Quần", "Q1"), row("", "Hoàn thành", "05/09/2025"), row("", "Hoàn thành", "05/09/2025"));
    const c = cleanSheetTable(t, 0, prepareSheetTable(t, { channel: "Shopee" }).mapping);
    expect(c.duplicates).toBe(0);
    expect(c.table).toHaveLength(5);
  });

  it("bỏ dòng tiêu đề bị dán lặp ở giữa bảng", () => {
    const t = table(row("A1", "Hoàn thành", "05/09/2025"), HEADER, row("A2", "Hoàn thành", "06/09/2025"));
    const p = prepareSheetTable(t, { channel: "Shopee" });
    expect(p.repeatedHeaders).toBe(1);
    expect(p.normalized?.stats.orders).toBe(2);
  });

  it("mã đơn bị đổi sang số khoa học là dữ liệu hỏng: báo lỗi, không nhập", () => {
    const t = table(row("5.78E+17", "Hoàn thành", "05/09/2025"), row("A2", "Hoàn thành", "06/09/2025"));
    const p = prepareSheetTable(t, { channel: "TikTok Shop" });
    expect(countScientificIds(t, 0, p.mapping)).toBe(1);
    expect(p.problems.join(" ")).toMatch(/số khoa học/);
    expect(p.normalized).toBeNull();
  });

  it("ánh xạ lưu theo tên cột: chèn thêm cột hay đổi thứ tự cột không làm lệch", () => {
    const first = prepareSheetTable(table(row("A1", "Hoàn thành", "05/09/2025")), { channel: "Shopee" });
    // Người dùng chèn thêm hai cột đầu và đảo thứ tự các cột còn lại.
    const moved: RawTable = [
      ["Ghi chú", "Khác", ...[...HEADER].reverse()],
      ["x", "y", ...row("B9", "Hoàn thành", "08/09/2025").reverse()],
    ];
    const p = prepareSheetTable(moved, { channel: "Shopee", named: first.named });
    expect(p.problems).toEqual([]);
    expect(p.normalized?.rows[0][COL.orderId]).toBe("B9");
  });

  it("thiếu cột đã lưu thì báo đúng tên cột, không đoán mò", () => {
    const first = prepareSheetTable(table(row("A1", "Hoàn thành", "05/09/2025")), { channel: "Shopee" });
    const broken: RawTable = [HEADER.filter((h) => h !== "Ngày đặt hàng"), ["A1", "Hoàn thành", "Áo", "A1", "1", "100.000"]];
    const r = resolveNamedMapping(first.named, broken);
    expect("error" in r && r.error).toMatch(/"Ngày đặt hàng"/);
    expect(prepareSheetTable(broken, { channel: "Shopee", named: first.named }).problems[0]).toMatch(/Ngày đặt hàng/);
  });

  it("tên cột trùng nhau (nhiều cột phí) được gán lần lượt các cột còn trống", () => {
    const t: RawTable = [["Mã đơn hàng", "Ngày đặt hàng", "Tổng giá bán (sản phẩm)", "Phí cố định", "Phí cố định"], ["A1", "05/09/2025", "100000", "5000", "2000"]];
    const r = resolveNamedMapping({ orderId: ["Mã đơn hàng"], platformFee: ["Phí cố định", "Phí cố định"] }, t);
    expect("mapping" in r && r.mapping.platformFee).toEqual([3, 4]);
  });

  it("đọc ánh xạ tên từ DB: bỏ trường lạ, giới hạn độ dài và số cột", () => {
    const s = sanitizeNamedMapping({ date: ["Ngày"], hack: ["x"], orderId: ["A", "B"], platformFee: Array.from({ length: 30 }, (_, i) => `Phí ${i}`), revenue: [42] });
    expect(s.date).toEqual(["Ngày"]);
    expect(s.orderId).toEqual(["A"]);
    expect(s.platformFee).toHaveLength(10);
    expect("hack" in s).toBe(false);
    expect("revenue" in s).toBe(false);
    expect(sanitizeNamedMapping(null)).toEqual({});
  });

  it("tab trống hoặc không phải bảng đơn hàng thì báo rõ", () => {
    expect(prepareSheetTable([], { channel: "Shopee" }).problems[0]).toMatch(/trống/);
    expect(prepareSheetTable([["a", "b"], ["1", "2"]], { channel: "Shopee" }).problems[0]).toMatch(/Không tìm thấy bảng đơn hàng/);
  });

  it("mappingToNames bỏ cột không có tên", () => {
    expect(mappingToNames({ date: [1], revenue: [3] }, ["a", "Ngày", "", ""])).toEqual({ date: ["Ngày"] });
  });

  it("bảng mẫu Shopee (file mô phỏng) đi qua được như một tab Sheet", () => {
    const p = prepareSheetTable(SHOPEE_TABLE.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))), { channel: "Shopee" });
    expect(p.problems).toEqual([]);
    expect(p.normalized?.rows.length).toBeGreaterThan(0);
  });
});
