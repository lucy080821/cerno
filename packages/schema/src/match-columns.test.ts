import { describe, expect, it } from "vitest";
import { matchColumns, normalizeText, scoreSlotAgainstName, type ColumnInfo } from "./match-columns";
import { Slot } from "./template";

const slot = (key: string, label: string, type: Slot["type"], synonyms: string[] = [], required = true) =>
  Slot.parse({ key, label, type, synonyms, required });

const SLOTS = [
  slot("ngay", "Ngày", "date", ["ngày hóa đơn", "ngày bán", "ngày đặt hàng"]),
  slot("doanh_thu", "Doanh thu", "number", ["doanh thu sau chiết khấu", "thành tiền", "tổng tiền"]),
  slot("tinh_thanh", "Tỉnh/Thành phố", "string", ["tỉnh", "tỉnh thành", "khu vực"]),
  slot("nhan_vien", "Nhân viên", "string", ["tên nhân viên", "nhân viên bán hàng"]),
  slot("so_luong", "Số lượng", "number", ["số lượng bán"]),
  slot("khach_hang", "Khách hàng", "string", ["tên khách hàng"]),
  slot("san_pham", "Sản phẩm", "string", ["tên sản phẩm", "mặt hàng"]),
  slot("giam_gia", "Giảm giá", "number", ["chiết khấu"], false),
  slot("ma_don", "Mã đơn", "string", ["số hóa đơn"], false),
];

const col = (name: string, type: ColumnInfo["type"]): ColumnInfo => ({ name, type });

describe("normalizeText", () => {
  it("bỏ dấu, đ→d, chữ thường, gộp ký tự lạ", () => {
    expect(normalizeText("  Ngày  HĐ / Đơn-hàng ")).toBe("ngay hd don hang");
    expect(normalizeText("ĐƠN GIÁ (VNĐ)")).toBe("don gia vnd");
  });
});

describe("matchColumns", () => {
  const COLUMNS = [
    col("Ngày HĐ", "date"),
    col("DT sau CK", "number"),
    col("Tỉnh", "string"),
    col("Tên NV", "string"),
    col("SL", "number"),
    col("Khách hàng", "string"),
    col("Tên sản phẩm", "string"),
    col("Chiết khấu", "number"),
    col("Ghi chú", "string"),
  ];

  it("khớp đúng ≥ 80% vai không cần AI, gồm 4 cột mẫu", () => {
    const r = matchColumns(SLOTS, COLUMNS);
    expect(r.mapping.ngay).toBe("Ngày HĐ");
    expect(r.mapping.doanh_thu).toBe("DT sau CK");
    expect(r.mapping.tinh_thanh).toBe("Tỉnh");
    expect(r.mapping.nhan_vien).toBe("Tên NV");
    const expected: Record<string, string> = {
      ngay: "Ngày HĐ", doanh_thu: "DT sau CK", tinh_thanh: "Tỉnh", nhan_vien: "Tên NV", so_luong: "SL",
      khach_hang: "Khách hàng", san_pham: "Tên sản phẩm", giam_gia: "Chiết khấu",
    };
    const ok = Object.entries(expected).filter(([k, v]) => r.mapping[k] === v).length;
    expect(ok / SLOTS.length).toBeGreaterThanOrEqual(0.8);
    expect(r.unmatched).toEqual(["ma_don"]);
  });

  it("bắt buộc trùng kiểu: cột chữ không khớp vai số", () => {
    const r = matchColumns([slot("doanh_thu", "Doanh thu", "number")], [col("Doanh thu", "string")]);
    expect(r.mapping).toEqual({});
    expect(r.unmatched).toEqual(["doanh_thu"]);
  });

  it("cột boolean không bao giờ khớp", () => {
    const r = matchColumns([slot("tinh", "Tỉnh", "string")], [col("Tỉnh", "boolean")]);
    expect(r.mapping).toEqual({});
  });

  it("mỗi cột chỉ dùng một lần: hai vai tranh một cột thì vai điểm cao thắng", () => {
    const slots = [
      slot("doanh_thu", "Doanh thu", "number", ["thành tiền"]),
      slot("giam_gia", "Giảm giá", "number", ["chiết khấu"], false),
    ];
    const r = matchColumns(slots, [col("Chiết khấu", "number")]);
    expect(r.mapping).toEqual({ giam_gia: "Chiết khấu" });
    expect(r.unmatched).toEqual(["doanh_thu"]);
  });

  it("hoà điểm thì vai bắt buộc được ưu tiên", () => {
    const slots = [
      slot("a_tuy_chon", "Giá trị", "number", [], false),
      slot("b_bat_buoc", "Giá trị", "number", [], true),
    ];
    const r = matchColumns(slots, [col("Giá trị", "number")]);
    expect(r.mapping).toEqual({ b_bat_buoc: "Giá trị" });
  });

  it("không khớp cột chỉ vì chia sẻ một từ chung quá yếu", () => {
    const r = matchColumns([slot("nhan_vien", "Nhân viên", "string")], [col("Ghi chú nhân sự thêm vào cuối cùng", "string")]);
    expect(r.mapping).toEqual({});
  });

  it("không phân biệt hoa thường, dấu, khoảng trắng thừa", () => {
    const r = matchColumns(SLOTS, [col("  TEN   NHAN VIEN ", "string"), col("ngay ban", "date")]);
    expect(r.mapping.nhan_vien).toBe("  TEN   NHAN VIEN ");
    expect(r.mapping.ngay).toBe("ngay ban");
  });

  it("mở rộng viết tắt: HĐ, KH, SL, ĐH", () => {
    expect(scoreSlotAgainstName(slot("ma_don", "Mã đơn", "string", ["số hóa đơn"]), "Số HĐ")).toBe(1);
    expect(scoreSlotAgainstName(slot("kh", "Khách hàng", "string"), "KH")).toBe(1);
    expect(scoreSlotAgainstName(slot("sl", "Số lượng", "number"), "SL")).toBe(1);
  });

  it("độ tin cậy nằm trong 0..1 và khớp chính xác = 1", () => {
    const r = matchColumns(SLOTS, COLUMNS);
    for (const v of Object.values(r.confidence)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(r.confidence.tinh_thanh).toBe(1);
  });

  it("danh sách rỗng", () => {
    expect(matchColumns(SLOTS, [])).toEqual({ mapping: {}, confidence: {}, unmatched: SLOTS.map((s) => s.key) });
    expect(matchColumns([], COLUMNS).mapping).toEqual({});
  });
});
