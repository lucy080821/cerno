import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepareImport } from "./prepare";

/** Chọn nhầm cột "Tổng giá trị đơn hàng" (cả đơn, lặp ở mọi dòng) làm thành tiền phải bị cảnh báo: doanh thu bị cộng nhiều lần, lãi ảo cao. */
const NAME = "MO-PHONG_Shopee_Order.all.20261101_20261115.xlsx";
const bytes = () => new Uint8Array(readFileSync(fileURLToPath(new URL(`./sample-files/${NAME}`, import.meta.url))));

describe("cảnh báo cột thành tiền là tổng cả đơn", () => {
  it("nhận diện tự động (Tổng giá bán của từng sản phẩm): không cảnh báo", async () => {
    const p = await prepareImport(bytes(), NAME, {});
    expect(p.normalized!.warnings.join(" ")).not.toContain("cùng một số tiền");
  });

  it("chọn 'Tổng giá trị đơn hàng' làm thành tiền: cảnh báo, nêu đúng tên cột và cách sửa", async () => {
    const auto = await prepareImport(bytes(), NAME, {});
    const orderTotal = auto.headers.indexOf("Tổng giá trị đơn hàng (VND)");
    expect(orderTotal).toBeGreaterThan(-1);
    const p = await prepareImport(bytes(), NAME, { mapping: { ...auto.mapping, revenue: [orderTotal] } });
    const w = p.normalized!.warnings.join(" ");
    expect(w).toContain('Cột "Tổng giá trị đơn hàng (VND)" có cùng một số tiền ở mọi dòng');
    expect(w).toContain("Tổng giá bán (sản phẩm)");
  });
});
