import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COL, type ColumnMapping, type InputField } from "./canonical";
import { detectSheet } from "./detect";
import { readSheets, type RawCell } from "./files";
import { normalizeOrders } from "./normalize";
import { prepareImport } from "./prepare";

/**
 * Kiểm thử trên hai file MÔ PHỎNG (xem sample-files/README.md): chúng do người viết dựng theo trí nhớ, KHÔNG phải file thật của sàn.
 * Giá trị kỳ vọng được tính độc lập từ bảng thô trong chính test này (không dùng lại logic của normalize.ts), nên test bắt được
 * lỗi cộng nhân đôi phí cấp đơn, đơn hủy lọt vào doanh thu, hàng mô tả bị nhập như đơn thật... nhưng KHÔNG chứng minh Cerno đọc đúng
 * file thật. Khi có file thật, thêm vào sample-files/ và viết test tương tự.
 */
const load = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./sample-files/${name}`, import.meta.url))));
const SHOPEE = "MO-PHONG_Shopee_Order.all.20261101_20261115.xlsx";
const TIKTOK = "MO-PHONG_TikTokShop_OrderSKUList_2026-11.xlsx";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const n = (c: RawCell) => (typeof c === "number" ? c : 0);
const headerOf = (mapping: ColumnMapping, headers: string[], f: InputField) => (mapping[f] ?? []).map((i) => headers[i]);
const numCol = (rows: Record<string, unknown>[], k: string) => sum(rows.map((r) => (typeof r[k] === "number" ? (r[k] as number) : 0)));

/** Chuỗi chỉ có trong các cột thông tin người mua của file mô phỏng: không được xuất hiện trong kết quả. */
const BUYER_MARKERS = ["Người mua mẫu", "người_mua_mẫu", "nguoimua_mau", "0900000000", "(+84)900000000", "địa chỉ giả"];

describe("file mô phỏng Shopee", () => {
  it("nhận diện đúng hồ sơ, đủ cột và tính số liệu khớp với bảng thô", async () => {
    const bytes = load(SHOPEE);
    const raw = (await readSheets(bytes, SHOPEE))[0].rows;
    const H = raw[0] as string[];
    const c = (name: string) => H.indexOf(name);
    const lines = raw.slice(1);

    const p = await prepareImport(bytes, SHOPEE, {});
    expect(p.profile).toBe("shopee");
    expect(p.channel).toBe("Shopee");
    expect(p.problems).toEqual([]);
    expect(headerOf(p.mapping, p.headers, "platformFee")).toEqual(["Phí Cố Định", "Phí Dịch Vụ", "Phí Thanh Toán"]);
    expect(headerOf(p.mapping, p.headers, "status")).toEqual(["Trạng Thái Đơn Hàng"]);
    expect(headerOf(p.mapping, p.headers, "shippingFee")).toEqual(["Phí vận chuyển mà người mua trả"]);
    const out = p.normalized!;
    expect(out.rows.length).toBe(lines.length);
    expect(out.warnings).toEqual([]);

    // Kỳ vọng tính độc lập: đơn hợp lệ = mọi đơn trừ "Đã hủy"; giá trị cấp đơn lấy ở dòng đầu của đơn.
    const firstOf = new Map<string, RawCell[]>();
    for (const r of lines) if (!firstOf.has(String(r[c("Mã đơn hàng")]))) firstOf.set(String(r[c("Mã đơn hàng")]), r);
    const validOrders = [...firstOf.values()].filter((r) => r[c("Trạng Thái Đơn Hàng")] !== "Đã hủy");
    const validLines = lines.filter((r) => r[c("Trạng Thái Đơn Hàng")] !== "Đã hủy");

    expect(out.stats.orders).toBe(firstOf.size);
    expect(numCol(out.rows, COL.orders)).toBe(validOrders.length);
    expect(numCol(out.rows, COL.cancelledOrders)).toBe(firstOf.size - validOrders.length);
    expect(numCol(out.rows, COL.netRevenue)).toBe(sum(validLines.map((r) => n(r[c("Tổng giá bán (sản phẩm)")]))));
    expect(numCol(out.rows, COL.platformFee)).toBe(sum(validOrders.map((r) => n(r[c("Phí Cố Định")]) + n(r[c("Phí Dịch Vụ")]) + n(r[c("Phí Thanh Toán")]))));
    expect(numCol(out.rows, COL.shippingFee)).toBe(sum(validOrders.map((r) => n(r[c("Phí vận chuyển mà người mua trả")]))));
    // Đơn hủy không mất phí dù file ghi phí ước tính.
    expect(out.rows.filter((r) => r[COL.status] === "Đã hủy").every((r) => r[COL.platformFee] === null && r[COL.netRevenue] === 0)).toBe(true);
    // Đơn nhiều dòng: phí chỉ nằm ở dòng đầu, không nhân lên.
    const multi = [...firstOf.keys()].filter((id) => lines.filter((r) => r[c("Mã đơn hàng")] === id).length > 1);
    expect(multi.length).toBeGreaterThan(3);
    for (const id of multi) expect(out.rows.filter((r) => r[COL.orderId] === id && r[COL.platformFee] !== null).length).toBeLessThanOrEqual(1);
  });

  it("không đọc thông tin người mua", async () => {
    const p = await prepareImport(load(SHOPEE), SHOPEE, {});
    const json = JSON.stringify(p.normalized!.rows);
    for (const m of BUYER_MARKERS) expect(json).not.toContain(m);
  });
});

describe("file mô phỏng TikTok Shop", () => {
  it("nhận diện đúng hồ sơ, bỏ hàng mô tả và tính số liệu khớp với bảng thô", async () => {
    const bytes = load(TIKTOK);
    const raw = (await readSheets(bytes, TIKTOK))[0].rows;
    const H = raw[0] as string[];
    const c = (name: string) => H.indexOf(name);
    const lines = raw.slice(2); // dòng 1 là tiêu đề, dòng 2 là hàng mô tả cột

    const p = await prepareImport(bytes, TIKTOK, {});
    expect(p.profile).toBe("tiktok");
    expect(p.channel).toBe("TikTok Shop");
    expect(p.problems).toEqual([]);
    expect(headerOf(p.mapping, p.headers, "discount")).toEqual(["SKU Seller Discount"]);
    expect(headerOf(p.mapping, p.headers, "shippingFee")).toEqual(["Shipping Fee After Discount"]);
    const out = p.normalized!;
    expect(out.stats.skippedDescription).toBe(1);
    expect(out.rows.length).toBe(lines.length);
    expect(out.warnings).toEqual(["Đã bỏ qua dòng mô tả cột nằm ngay dưới tiêu đề."]);
    expect(out.rows.some((r) => String(r[COL.orderId]).includes("unique"))).toBe(false);

    const firstOf = new Map<string, RawCell[]>();
    for (const r of lines) if (!firstOf.has(String(r[c("Order ID")]))) firstOf.set(String(r[c("Order ID")]), r);
    const validOrders = [...firstOf.values()].filter((r) => r[c("Order Status")] !== "Canceled");
    const validLines = lines.filter((r) => r[c("Order Status")] !== "Canceled");
    expect(out.stats.orders).toBe(firstOf.size);
    expect(numCol(out.rows, COL.orders)).toBe(validOrders.length);
    expect(numCol(out.rows, COL.netRevenue)).toBe(sum(validLines.map((r) => n(r[c("SKU Subtotal After Discount")]))));
    expect(numCol(out.rows, COL.discount)).toBe(sum(lines.map((r) => n(r[c("SKU Seller Discount")]))));
    expect(numCol(out.rows, COL.shippingFee)).toBe(sum(validOrders.map((r) => n(r[c("Shipping Fee After Discount")]))));
    // File đơn hàng của TikTok Shop không có phí sàn (phí nằm trong báo cáo đối soát).
    expect(numCol(out.rows, COL.platformFee)).toBe(0);
    // Giờ 12 tiếng AM/PM và ngày dd/mm/yyyy đọc đúng, nằm trong tháng 11/2026.
    expect(out.rows.every((r) => /^2026-11-\d\d \d\d:\d\d$/.test(String(r[COL.date])))).toBe(true);
    expect(out.stats.dateMin! >= "2026-11-01" && out.stats.dateMax! <= "2026-11-16").toBe(true);
  });

  it("không đọc thông tin người mua", async () => {
    const p = await prepareImport(load(TIKTOK), TIKTOK, {});
    const json = JSON.stringify(p.normalized!.rows);
    for (const m of BUYER_MARKERS) expect(json).not.toContain(m);
  });
});

describe("nhận diện tên cột gần đúng", () => {
  const detect = (headers: string[]) => detectSheet([headers, headers.map(() => null)])!.mapping;
  const fieldOf = (mapping: ColumnMapping, headers: string[]) => Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, (v as number[]).map((i) => headers[i])]));

  it("nhận các tên thường gặp của sổ bán hàng tự ghi", () => {
    const h = ["Mã đơn hàng", "Ngày đặt hàng", "Tên khách hàng", "Tỉnh/Thành phố", "Mã sản phẩm", "Tên sản phẩm", "Số lượng", "Đơn giá", "Giảm giá", "Doanh thu hàng hóa", "Phí vận chuyển khách trả", "Phí sàn Shopee", "Chi phí giá vốn", "Chi phí quảng cáo", "Thuế GTGT", "Doanh thu thực nhận", "Lợi nhuận ước tính", "Trạng thái đơn", "Kênh thanh toán"];
    expect(fieldOf(detect(h), h)).toEqual({
      orderId: ["Mã đơn hàng"],
      date: ["Ngày đặt hàng"],
      sku: ["Mã sản phẩm"],
      product: ["Tên sản phẩm"],
      quantity: ["Số lượng"],
      unitPrice: ["Đơn giá"],
      discount: ["Giảm giá"],
      revenue: ["Doanh thu hàng hóa"],
      shippingFee: ["Phí vận chuyển khách trả"],
      platformFee: ["Phí sàn Shopee"],
      cost: ["Chi phí giá vốn"],
      adCost: ["Chi phí quảng cáo"],
      status: ["Trạng thái đơn"],
      province: ["Tỉnh/Thành phố"],
      payment: ["Kênh thanh toán"],
    });
  });

  it("không nhận nhầm các cột na ná", () => {
    const h = ["Mã vận đơn", "Mã đơn hàng", "Ngày giao hàng dự kiến", "Ngày đặt hàng", "Trạng Thái Trả hàng/Hoàn tiền", "Số lượng tồn kho", "Số lượng", "Phí vận chuyển (dự kiến)", "Doanh thu thực nhận", "Giá gốc", "Thành tiền", "Tên Người nhận", "Tên sản phẩm"];
    const m = fieldOf(detect(h), h);
    expect(m.orderId).toEqual(["Mã đơn hàng"]);
    expect(m.date).toEqual(["Ngày đặt hàng"]);
    expect(m.quantity).toEqual(["Số lượng"]);
    expect(m.revenue).toEqual(["Thành tiền"]);
    expect(m.product).toEqual(["Tên sản phẩm"]);
    expect(m.status).toBeUndefined(); // "Trạng thái trả hàng/hoàn tiền" không phải trạng thái đơn
    expect(m.platformFee).toBeUndefined(); // "Phí vận chuyển" không phải phí sàn
    expect(m.shippingFee).toBeUndefined(); // chưa rõ ai trả nên không đoán
    expect(m.unitPrice).toBeUndefined(); // "Giá gốc" là giá trước giảm
  });

  it("tên khớp chính xác luôn thắng tên gần đúng", () => {
    const h = ["Ngày", "Ngày đặt hàng", "Thành tiền", "Doanh thu"];
    const m = fieldOf(detect(h), h);
    expect(m.date).toEqual(["Ngày đặt hàng"]);
    expect(m.revenue).toEqual(["Thành tiền"]); // cả hai đều khớp chính xác: theo thứ tự ưu tiên trong hồ sơ
  });
});

describe("sổ bán hàng tự ghi có ô công thức chưa tính", () => {
  const headers = ["Mã đơn hàng", "Ngày đặt hàng", "Mã sản phẩm", "Số lượng", "Đơn giá", "Giảm giá", "Doanh thu hàng hóa", "Phí vận chuyển khách trả", "Phí sàn Shopee", "Chi phí giá vốn", "Chi phí quảng cáo", "Trạng thái đơn"];
  // Cột công thức (Doanh thu hàng hóa, Chi phí giá vốn) trống như file chưa từng được mở và lưu bằng Excel.
  const table = [
    headers,
    ["D1", "2026-01-05", "SP1", 2, 149000, 10000, null, 30000, 14400, null, 8000, "Đã giao"],
    ["D2", "2026-01-06", "SP2", 1, 189000, 0, null, 25000, 9450, null, 12000, "Đã hủy"],
    ["D3", "2026-01-07", "SP3", 1, 99000, 0, null, 20000, 5000, 60000, 5000, "Đã giao"],
  ];

  it("tính doanh thu từ đơn giá × số lượng − giảm giá và báo cột trống", () => {
    const d = detectSheet(table)!;
    const out = normalizeOrders(table, d.headerRow, d.mapping, "Shopee");
    expect(out.rows.map((r) => r[COL.revenue])).toEqual([288000, 189000, 99000]);
    expect(out.warnings.join("\n")).toMatch(/Cột "Doanh thu hàng hóa" không có giá trị nào/);
  });

  it("đơn hủy: không phí sàn, không phí vận chuyển, giá vốn 0; quảng cáo vẫn tính", () => {
    const d = detectSheet(table)!;
    const rows = normalizeOrders(table, d.headerRow, d.mapping, "Shopee").rows;
    const cancelled = rows[1];
    expect(cancelled[COL.platformFee]).toBeNull();
    expect(cancelled[COL.shippingFee]).toBeNull();
    expect(cancelled[COL.netRevenue]).toBe(0);
    expect(cancelled[COL.adCost]).toBe(12000);
    expect(rows[0][COL.shippingFee]).toBe(30000);
    expect(rows[2][COL.cost]).toBe(60000); // giá vốn có trong file thì lưu cho đơn hợp lệ
  });
});

describe("trạng thái hoàn hàng", () => {
  it('"Hoàn hàng" là Hoàn trả, không phải trạng thái lạ', async () => {
    const { mapStatus } = await import("./normalize");
    expect(mapStatus("Hoàn hàng")).toEqual({ status: "Hoàn trả", known: true });
  });
});

describe("hàng mô tả dưới tiêu đề", () => {
  const h = ["Order ID", "Order Status", "Created Time", "Quantity", "SKU Subtotal After Discount"];
  const desc = ["Platform unique order ID.", "Current order status.", "Order created time.", "Quantity ordered.", "SKU subtotal after discount."];

  it("bỏ hàng mô tả", () => {
    const t = [h, desc, ["A1", "Completed", "01/11/2026 02:00:00 PM", 1, 100000]];
    const d = detectSheet(t)!;
    const out = normalizeOrders(t, d.headerRow, d.mapping, "TikTok Shop");
    expect(out.rows.length).toBe(1);
    expect(out.stats.skippedDescription).toBe(1);
  });

  it("không bỏ nhầm dòng dữ liệu thật bị thiếu ngày hoặc thiếu tiền", () => {
    const t = [h, ["A1", "Completed", "không phải ngày", null, null], ["A2", "Completed", "02/11/2026 09:00:00 AM", 1, 50000]];
    const d = detectSheet(t)!;
    const out = normalizeOrders(t, d.headerRow, d.mapping, "TikTok Shop");
    expect(out.rows.length).toBe(2);
    expect(out.stats.skippedDescription).toBe(0);
    expect(out.stats.missingDate).toBe(1);
  });
});
