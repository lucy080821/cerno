import { zipSync } from "fflate";
import writeExcelFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "./canonical";
import { pickSheet } from "./detect";
import { FileError, readSheets } from "./files";
import { SHOPEE_TABLE } from "./fixtures";
import { normalizeOrders } from "./normalize";
import { COL } from "./canonical";

const bytes = (s: string) => new TextEncoder().encode(s);

async function xlsx(rows: unknown[][]): Promise<Uint8Array> {
  const buf = await writeExcelFile(rows as never, { dateFormat: "yyyy-mm-dd hh:mm" }).toBuffer();
  return new Uint8Array(buf);
}

describe("đọc file", () => {
  it("đọc .xlsx nhiều sheet, giữ số, chữ và ngày", async () => {
    const day = new Date(Date.UTC(2025, 8, 5, 14, 30));
    const file = await xlsx([["Mã đơn hàng", "Ngày đặt hàng", "Số lượng"], ["A1", day, 2]]);
    const sheets = await readSheets(file, "don.xlsx");
    expect(sheets).toHaveLength(1);
    const [head, row] = sheets[0].rows;
    expect(head).toEqual(["Mã đơn hàng", "Ngày đặt hàng", "Số lượng"]);
    expect(row[0]).toBe("A1");
    expect(row[1]).toBeInstanceOf(Date);
    expect(row[2]).toBe(2);
  });

  it("đi hết đường: file Excel Shopee → nhận diện → chuẩn hoá", async () => {
    const file = await xlsx(SHOPEE_TABLE as unknown[][]);
    const sheets = await readSheets(file, "Order.all.xlsx");
    const picked = pickSheet(sheets)!;
    expect(picked.detection.profile).toBe("shopee");
    const { rows } = normalizeOrders(picked.sheet.rows, picked.detection.headerRow, picked.detection.mapping, "Shopee");
    expect(rows).toHaveLength(4);
    expect(rows.reduce((n, r) => n + Number(r[COL.netRevenue]), 0)).toBe(560000);
  });

  it("ô ngày kiểu Excel (Date) được đọc đúng theo giờ ghi trong ô", async () => {
    const file = await xlsx([["Ngày đặt hàng", "Mã đơn hàng", "Tổng giá bán (sản phẩm)"], [new Date(Date.UTC(2025, 8, 5, 14, 30)), "X", 10]]);
    const picked = pickSheet(await readSheets(file, "a.xlsx"))!;
    const { rows } = normalizeOrders(picked.sheet.rows, picked.detection.headerRow, picked.detection.mapping, "Khác");
    expect(rows[0][COL.date]).toBe("2025-09-05 14:30");
  });

  it("đọc CSV", async () => {
    const sheets = await readSheets(bytes("Order ID,Order Status\n1,Completed\n"), "orders.csv");
    expect(sheets[0].rows).toEqual([["Order ID", "Order Status"], ["1", "Completed"]]);
  });

  it("từ chối file rỗng, quá lớn, .xls đời cũ và .xlsx hỏng", async () => {
    await expect(readSheets(new Uint8Array(0), "a.csv")).rejects.toThrow(FileError);
    await expect(readSheets(new Uint8Array(MAX_UPLOAD_BYTES + 1), "a.csv")).rejects.toThrow(/lớn hơn/);
    const legacy = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]);
    await expect(readSheets(legacy, "a.xls")).rejects.toThrow(/\.xls/);
    await expect(readSheets(bytes("không phải excel"), "a.xlsx")).rejects.toThrow(/định dạng/);
    const brokenZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(readSheets(brokenZip, "a.xlsx")).rejects.toThrow(FileError);
  });

  it("chặn bom nén: file nhỏ nhưng giải nén ra quá lớn", async () => {
    const huge = zipSync({ "xl/sheet.xml": new Uint8Array(151 * 1024 * 1024) }, { level: 1 });
    expect(huge.length).toBeLessThan(MAX_UPLOAD_BYTES);
    await expect(readSheets(huge, "bom.xlsx")).rejects.toThrow(/giải nén/);
  });
});
