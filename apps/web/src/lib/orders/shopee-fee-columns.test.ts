import { describe, expect, it } from "vitest";
import { COL } from "./canonical";
import { detectSheet } from "./detect";
import { normalizeOrders } from "./normalize";

/** Tên cột phí mới của Shopee (2025–2026) và việc đơn hoàn tiền vẫn bị tính phí. Bảng dựng tay, không phải file thật của sàn. */
const headers = ["Mã đơn hàng", "Ngày đặt hàng", "Trạng thái đơn hàng", "SKU phân loại hàng", "Số lượng", "Tổng giá bán sản phẩm", "Phí Cố Định", "Phí Dịch Vụ", "Phí Xử Lý Giao Dịch", "Phí Hạ Tầng"];
const table = [
  headers,
  ["A1", "2026-10-01", "Hoàn thành", "SP1", 1, 200000, 34000, 11000, 12000, 3000],
  ["A2", "2026-10-02", "Đã hủy", "SP1", 1, 200000, 34000, 11000, 12000, 3000],
  ["A3", "2026-10-03", "Hoàn hàng", "SP2", 1, 150000, 25500, 8000, 9000, 3000],
];

describe("cột phí mới của Shopee", () => {
  it("nhận Phí Xử Lý Giao Dịch và Phí Hạ Tầng cùng các phí cũ và cộng lại", () => {
    const d = detectSheet(table)!;
    expect(d.profile).toBe("shopee");
    expect((d.mapping.platformFee ?? []).map((i) => headers[i])).toEqual(["Phí Cố Định", "Phí Dịch Vụ", "Phí Xử Lý Giao Dịch", "Phí Hạ Tầng"]);
    const rows = normalizeOrders(table, d.headerRow, d.mapping, "Shopee").rows;
    expect(rows[0][COL.platformFee]).toBe(34000 + 11000 + 12000 + 3000);
  });

  it("đơn hủy không mất phí, đơn hoàn trả vẫn mất phí ghi trong file", () => {
    const d = detectSheet(table)!;
    const rows = normalizeOrders(table, d.headerRow, d.mapping, "Shopee").rows;
    expect(rows[1][COL.status]).toBe("Đã hủy");
    expect(rows[1][COL.platformFee]).toBeNull();
    expect(rows[2][COL.status]).toBe("Hoàn trả");
    expect(rows[2][COL.platformFee]).toBe(25500 + 8000 + 9000 + 3000);
    expect(rows[2][COL.netRevenue]).toBe(0);
  });

  it("file tên cột lạ vẫn nhận phí xử lý giao dịch ở hồ sơ chung", () => {
    const t = [["Mã đơn", "Ngày đặt", "Thành tiền", "Phí xử lý giao dịch"], ["B1", "2026-10-01", 100000, 6000]];
    const d = detectSheet(t)!;
    expect((d.mapping.platformFee ?? []).map((i) => t[0][i])).toEqual(["Phí xử lý giao dịch"]);
  });
});
