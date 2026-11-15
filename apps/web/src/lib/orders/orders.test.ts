import { describe, expect, it } from "vitest";
import { COL, ORDER_COLUMNS } from "./canonical";
import { decodeText, detectDelimiter, parseCsv } from "./csv";
import { detectSheet, pickSheet, proposeMapping, validateMapping } from "./detect";
import { SHOPEE_TABLE, TIKTOK_TABLE } from "./fixtures";
import { mergeOrders } from "./merge";
import { detectDateOrder, mapStatus, normalizeOrders } from "./normalize";
import { SHOPEE, TIKTOK } from "./profiles";

describe("csv", () => {
  it("tách ô có dấu phẩy, ngoặc kép và xuống dòng bên trong", () => {
    const t = 'a,b,c\n1,"x, y","dòng 1\ndòng 2"\n2,"nói ""hi""",z\n';
    expect(parseCsv(t, 100, 10)).toEqual([["a", "b", "c"], ["1", "x, y", "dòng 1\ndòng 2"], ["2", 'nói "hi"', "z"]]);
  });
  it("đoán dấu phân cách và bỏ dòng trống cuối", () => {
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"a,b";c;d')).toBe(";");
    expect(parseCsv("a;b\r\n1;2\r\n\r\n", 10, 10)).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("giải mã BOM UTF-8, UTF-16 và lùi về bảng mã Windows", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe("hi");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe("hi");
    expect(decodeText(new TextEncoder().encode("Đơn hàng"))).toBe("Đơn hàng");
    // 0xD0 là "Đ" trong Windows-1258/1252 nhưng không hợp lệ ở UTF-8.
    expect(decodeText(new Uint8Array([0xd0, 0x6f, 0x6e]))).toMatch(/on$/);
  });
  it("từ chối file quá nhiều dòng hoặc cột", () => {
    expect(() => parseCsv("a\n1\n2\n3\n", 2, 10)).toThrow(/quá/);
    expect(() => parseCsv("a,b,c\n", 10, 2)).toThrow(/cột/);
  });
});

describe("nhận diện file", () => {
  it("nhận ra file Shopee và gán đúng cột (theo chỉ số)", () => {
    const d = detectSheet(SHOPEE_TABLE)!;
    expect(d.profile).toBe("shopee");
    expect(d.channel).toBe("Shopee");
    expect(d.headerRow).toBe(0);
    expect(d.problems).toEqual([]);
    const h = d.headers;
    expect(h[d.mapping.orderId![0]]).toBe("Mã đơn hàng");
    expect(h[d.mapping.revenue![0]]).toBe("Tổng giá bán (sản phẩm)");
    expect(h[d.mapping.sku![0]]).toBe("SKU phân loại hàng"); // ưu tiên SKU phân loại hơn SKU sản phẩm
    expect(h[d.mapping.date![0]]).toBe("Ngày đặt hàng");
    expect(d.mapping.platformFee!.map((i) => h[i])).toEqual(["Phí cố định", "Phí Dịch Vụ", "Phí Thanh Toán"]);
  });
  it("nhận ra file TikTok Shop", () => {
    const d = detectSheet(TIKTOK_TABLE)!;
    expect(d.profile).toBe("tiktok");
    expect(d.channel).toBe("TikTok Shop");
    expect(d.headers[d.mapping.revenue![0]]).toBe("SKU Subtotal After Discount");
    expect(d.mapping.platformFee).toBeUndefined();
  });
  it("bỏ qua vài dòng ghi chú phía trên tiêu đề", () => {
    const d = detectSheet([["Báo cáo đơn hàng"], ["Từ 01/09 đến 30/09"], [], ...SHOPEE_TABLE])!;
    expect(d.headerRow).toBe(3);
    expect(d.profile).toBe("shopee");
  });
  it("file tự ghi dùng hồ sơ chung và để người dùng chọn kênh", () => {
    const t = [["Ngày bán", "Tên hàng", "SL", "Thành tiền", "Tỉnh"], ["05/09/2025", "Áo", 1, 120000, "Hà Nội"]];
    const d = detectSheet(t)!;
    expect(d.profile).toBe("generic");
    expect(d.channel).toBeNull();
    expect(d.problems).toEqual([]);
    expect(d.headers[d.mapping.revenue![0]]).toBe("Thành tiền");
  });
  it("báo thiếu cột ngày hoặc thành tiền", () => {
    expect(validateMapping({})).toHaveLength(2);
    expect(validateMapping({ date: [0], unitPrice: [1] })[0]).toMatch(/số lượng/);
    expect(validateMapping({ date: [0], unitPrice: [1], quantity: [2] })).toEqual([]);
  });
  it("một cột chỉ được gán cho một trường", () => {
    const m = proposeMapping(SHOPEE, ["Mã đơn hàng", "Ngày đặt hàng", "Số lượng", "Số lượng"]);
    expect(m.quantity).toEqual([2]);
  });
  it("trả null khi không giống bảng đơn hàng", () => {
    expect(detectSheet([["abc", "def", "ghi"], ["1", "2", "3"]])).toBeNull();
    expect(detectSheet([])).toBeNull();
  });
  it("chọn sheet đúng trong file nhiều sheet", () => {
    const got = pickSheet([{ name: "Hướng dẫn", rows: [["Xin chào"]] }, { name: "Orders", rows: SHOPEE_TABLE }]);
    expect(got?.sheet.name).toBe("Orders");
  });
});

describe("trạng thái", () => {
  it.each([
    ["Hoàn thành", "Hoàn thành"], ["Completed", "Hoàn thành"], ["Đã giao", "Hoàn thành"], ["Delivered", "Hoàn thành"],
    ["Đã hủy", "Đã hủy"], ["Cancelled", "Đã hủy"], ["Đang giao", "Chưa hoàn tất"], ["Chờ lấy hàng", "Chưa hoàn tất"],
    ["Awaiting shipment", "Chưa hoàn tất"], ["Unpaid", "Chưa hoàn tất"], ["Đã hoàn trả", "Hoàn trả"], ["Giao không thành công", "Hoàn trả"],
    ["Return/Refund", "Hoàn trả"],
  ])("%s → %s", (raw, want) => {
    expect(mapStatus(raw)).toEqual({ status: want, known: true });
  });
  it("trạng thái lạ tính là Chưa hoàn tất và báo chưa nhận ra", () => {
    expect(mapStatus("Xyz lạ")).toEqual({ status: "Chưa hoàn tất", known: false });
  });
});

describe("chuẩn hoá đơn hàng", () => {
  const run = (table: typeof SHOPEE_TABLE, channel: string) => {
    const d = detectSheet(table)!;
    return normalizeOrders(table, d.headerRow, d.mapping, channel);
  };

  it("Shopee: đơn nhiều dòng chỉ đếm một đơn, tiền theo dòng, phí theo đơn", () => {
    const { rows, stats, keyed } = run(SHOPEE_TABLE, "Shopee");
    expect(keyed).toBe(true);
    expect(rows).toHaveLength(4);
    expect(stats.orders).toBe(3);
    const sum = (k: string) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
    expect(sum(COL.orders)).toBe(2); // A1 và C3; B2 đã hủy
    expect(sum(COL.cancelledOrders)).toBe(1);
    expect(sum(COL.revenue)).toBe(120000 + 200000 + 120000 + 240000);
    expect(sum(COL.netRevenue)).toBe(120000 + 200000 + 240000); // bỏ đơn hủy
    // Phí 6000+6000+3000 chỉ ghi một lần cho đơn A1 dù đơn có 2 dòng.
    expect(rows[0][COL.platformFee]).toBe(15000);
    expect(rows[1][COL.platformFee]).toBeNull();
    // Đơn B2 đã hủy: file vẫn ghi phí nhưng không được cộng.
    expect(rows[2][COL.platformFee]).toBeNull();
    expect(sum(COL.platformFee)).toBe(15000 * 2); // A1 và C3
    expect(rows.every((r) => r[COL.channel] === "Shopee")).toBe(true);
  });

  it("Shopee: các cột chuẩn đúng thứ tự và đúng giá trị", () => {
    const { rows } = run(SHOPEE_TABLE, "Shopee");
    expect(Object.keys(rows[0])).toEqual(ORDER_COLUMNS.map((c) => c.name));
    expect(rows[0]).toMatchObject({
      [COL.orderId]: "A1", [COL.date]: "2025-09-05 14:30", [COL.status]: "Hoàn thành", [COL.sku]: "ÁO-01-M",
      [COL.product]: "Áo thun nam", [COL.variant]: "Size M", [COL.quantity]: 1, [COL.province]: "TP. Hồ Chí Minh",
      [COL.payment]: "Thanh toán khi nhận hàng",
    });
    expect(rows[2]).toMatchObject({ [COL.status]: "Đã hủy", [COL.rawStatus]: "Đã hủy", [COL.netRevenue]: 0, [COL.revenue]: 120000 });
  });

  it("KHÔNG bao giờ đưa thông tin người mua vào kết quả", () => {
    for (const [table, ch] of [[SHOPEE_TABLE, "Shopee"], [TIKTOK_TABLE, "TikTok Shop"]] as const) {
      expect(JSON.stringify(run(table, ch).rows)).not.toContain("SECRET");
    }
  });

  it("TikTok: bỏ tab đầu mã đơn, đọc ngày dd/mm/yyyy giờ 12 tiếng", () => {
    const { rows, warnings } = run(TIKTOK_TABLE, "TikTok Shop");
    expect(rows[0][COL.orderId]).toBe("576460752303423488");
    expect(rows[0][COL.date]).toBe("2025-09-07 14:30");
    expect(rows[1][COL.date]).toBe("2025-09-25 10:00");
    expect(rows[0][COL.revenue]).toBe(90000);
    expect(rows[1][COL.status]).toBe("Đã hủy");
    expect(rows[1][COL.netRevenue]).toBe(0);
    expect(rows[0][COL.platformFee]).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("đọc ngày mm/dd/yyyy khi có ngày lớn hơn 12 ở số thứ hai", () => {
    expect(detectDateOrder(["09/25/2025", "09/07/2025"])).toBe("mdy");
    expect(detectDateOrder(["25/09/2025", "09/07/2025"])).toBe("dmy");
    expect(detectDateOrder(["09/07/2025"])).toBe("dmy"); // mơ hồ: theo kiểu Việt Nam
    const t = [["Mã đơn hàng", "Trạng Thái Đơn Hàng", "Ngày đặt hàng", "Tổng giá bán (sản phẩm)"], ["X1", "Hoàn thành", "09/25/2025 10:00", 5], ["X2", "Hoàn thành", "09/07/2025 10:00", 5]];
    const { rows, warnings } = run(t as never, "Shopee");
    expect(rows.map((r) => r[COL.date])).toEqual(["2025-09-25 10:00", "2025-09-07 10:00"]);
    expect(warnings.join(" ")).toMatch(/tháng\/ngày\/năm/);
  });

  it("tính thành tiền từ đơn giá × số lượng khi thiếu cột thành tiền", () => {
    const t = [["Ngày", "Sản phẩm", "SL", "Đơn giá"], ["2025-09-05", "Áo", 3, 50000]];
    const { rows } = run(t as never, "Khác");
    expect(rows[0][COL.revenue]).toBe(150000);
  });

  it("file không có mã đơn: mỗi dòng một đơn, không gộp trùng, mặc định Hoàn thành", () => {
    const t = [["Ngày", "Sản phẩm", "SL", "Thành tiền"], ["2025-09-05", "Áo", 1, 100000], ["2025-09-05", "Áo", 1, 100000]];
    const r = run(t as never, "Facebook");
    expect(r.keyed).toBe(false);
    expect(r.rows.map((x) => x[COL.orders])).toEqual([1, 1]);
    expect(r.rows.every((x) => x[COL.orderId] === null && x[COL.status] === "Hoàn thành")).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/không có cột trạng thái/);
  });

  it("đọc số tiền kiểu Việt và bỏ dòng trống", () => {
    const t = [["Ngày", "Thành tiền"], ["05/09/2025", "1.250.000đ"], [null, null], ["06/09/2025", "300,5"]];
    const { rows, stats } = run(t as never, "Khác");
    expect(rows.map((r) => r[COL.revenue])).toEqual([1250000, 300.5]);
    expect(stats.skippedEmpty).toBe(1);
  });

  it("báo dòng thiếu ngày, thiếu tiền, trạng thái lạ và mã đơn bị Excel làm hỏng", () => {
    const t = [
      ["Mã đơn hàng", "Trạng Thái Đơn Hàng", "Ngày đặt hàng", "Tổng giá bán (sản phẩm)"],
      ["Z1", "Trạng thái lạ XYZ", "không phải ngày", ""],
      [5.76e17, "Hoàn thành", "2025-09-05", 10],
    ];
    const { warnings, stats } = run(t as never, "Shopee");
    expect(stats.missingDate).toBe(1);
    expect(stats.missingRevenue).toBe(1);
    const w = warnings.join("\n");
    expect(w).toMatch(/không đọc được ngày/);
    expect(w).toMatch(/không có thành tiền/);
    expect(w).toMatch(/chưa nhận ra.*Trạng thái lạ XYZ/);
    expect(w).toMatch(/Mã đơn bị Excel/);
  });

  it("ghi khoảng ngày của dữ liệu", () => {
    const { stats } = run(SHOPEE_TABLE, "Shopee");
    expect(stats.dateMin).toBe("2025-09-05 14:30");
    expect(stats.dateMax).toBe("2025-09-07 20:15");
    expect(stats.byStatus).toEqual({ "Hoàn thành": 2, "Chưa hoàn tất": 1, "Đã hủy": 1, "Hoàn trả": 0 });
  });
});

describe("gộp file", () => {
  const norm = (table: typeof SHOPEE_TABLE, ch: string) => {
    const d = detectSheet(table)!;
    return normalizeOrders(table, d.headerRow, d.mapping, ch);
  };

  it("tải lại file chồng khoảng thời gian: đơn trùng bị thay bằng bản mới, đơn khác giữ nguyên", () => {
    const first = norm(SHOPEE_TABLE, "Shopee");
    const updated = SHOPEE_TABLE.map((r) => [...r]);
    updated[4][1] = "Hoàn thành"; // đơn C3 trước đó "Đang giao" nay đã xong
    const second = norm([updated[0], updated[4]] as never, "Shopee"); // file mới chỉ chứa đơn C3
    const merged = mergeOrders(first.rows, second.rows, true);
    expect(merged).toHaveLength(4); // A1 (2 dòng) + B2 + C3 mới, không nhân đôi
    expect(merged.filter((r) => r[COL.orderId] === "C3")).toHaveLength(1);
    expect(merged.find((r) => r[COL.orderId] === "C3")![COL.status]).toBe("Hoàn thành");
  });

  it("kênh khác không bị đụng tới và trùng mã giữa hai kênh không lẫn nhau", () => {
    const shopee = norm(SHOPEE_TABLE, "Shopee").rows;
    const t = [["Mã đơn hàng", "Trạng Thái Đơn Hàng", "Ngày đặt hàng", "Tổng giá bán (sản phẩm)"], ["A1", "Hoàn thành", "2025-09-05", 7]];
    const lazada = norm(t as never, "Lazada").rows;
    const merged = mergeOrders(shopee, lazada, true);
    expect(merged).toHaveLength(shopee.length + 1);
    expect(merged.filter((r) => r[COL.orderId] === "A1")).toHaveLength(3);
  });

  it("file không có mã đơn thay toàn bộ dữ liệu của cùng kênh, giữ kênh khác", () => {
    const shopee = norm(SHOPEE_TABLE, "Shopee").rows;
    const t = [["Ngày", "Thành tiền"], ["2025-09-05", 1]];
    const fb1 = norm(t as never, "Facebook");
    const once = mergeOrders(shopee, fb1.rows, false);
    const twice = mergeOrders(once, norm([["Ngày", "Thành tiền"], ["2025-10-01", 2], ["2025-10-02", 3]] as never, "Facebook").rows, false);
    expect(twice.filter((r) => r[COL.channel] === "Facebook")).toHaveLength(2);
    expect(twice.filter((r) => r[COL.channel] === "Shopee")).toHaveLength(shopee.length);
  });

  it("file rỗng không đổi gì", () => {
    const rows = norm(SHOPEE_TABLE, "Shopee").rows;
    expect(mergeOrders(rows, [], true)).toBe(rows);
  });
});

describe("chuẩn bị nhập file", () => {
  it("tự nhận diện, chuẩn hoá và có kênh mặc định", async () => {
    const { prepareImport } = await import("./prepare");
    const { default: writeExcelFile } = await import("write-excel-file/node");
    const file = new Uint8Array(await writeExcelFile(SHOPEE_TABLE as never).toBuffer());
    const p = await prepareImport(file, "Order.all.xlsx");
    expect(p.profile).toBe("shopee");
    expect(p.channel).toBe("Shopee");
    expect(p.problems).toEqual([]);
    expect(p.normalized?.rows).toHaveLength(4);
  });

  it("ánh xạ do người dùng chỉnh được dùng, ánh xạ bậy bị lọc", async () => {
    const { prepareImport, sanitizeMapping } = await import("./prepare");
    const csv = new TextEncoder().encode("Ngày bán,Hàng,Tiền,Tiền khác\n05/09/2025,Áo,100,999\n");
    const auto = await prepareImport(csv, "a.csv", { channel: "Facebook" });
    expect(auto.problems.join(" ")).toMatch(/thành tiền/);
    const fixed = await prepareImport(csv, "a.csv", { channel: "Facebook", mapping: { date: [0], revenue: [3], product: [1] } });
    expect(fixed.problems).toEqual([]);
    expect(fixed.normalized?.rows[0]["Doanh thu"]).toBe(999);

    expect(sanitizeMapping({ date: [0, 0, 99, -1, 1.5, "x"], revenue: [1, 2], platformFee: [3, 4], hack: [0], product: "a" }, 5)).toEqual({ date: [0], revenue: [1], platformFee: [3, 4] });
    expect(sanitizeMapping("x", 5)).toBeNull();
    expect(sanitizeMapping([1], 5)).toBeNull();
  });

  it("file tự ghi bắt buộc chọn kênh; kênh lạ bị từ chối", async () => {
    const { prepareImport } = await import("./prepare");
    const csv = new TextEncoder().encode("Ngày,Thành tiền\n05/09/2025,100\n");
    expect((await prepareImport(csv, "a.csv")).problems).toContain("Chưa chọn kênh bán.");
    expect((await prepareImport(csv, "a.csv", { channel: "Sàn lạ" })).problems).toContain("Chưa chọn kênh bán.");
    expect((await prepareImport(csv, "a.csv", { channel: "Lazada" })).problems).toEqual([]);
  });

  it("file không giống bảng đơn hàng báo lỗi rõ ràng", async () => {
    const { prepareImport } = await import("./prepare");
    await expect(prepareImport(new TextEncoder().encode("a,b,c\n1,2,3\n"), "a.csv")).rejects.toThrow(/không tìm thấy bảng đơn hàng/i);
  });
});
