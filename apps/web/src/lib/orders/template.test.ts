import { describe, expect, it } from "vitest";
import { applyTemplate, matchColumns, type ColumnInfo, type DataSource } from "@dashboard/schema";
import { calcDefsFor, runQuery, specForWidget, type Row } from "@dashboard/chart-engine";
import { BAN_HANG_DA_KENH } from "@/content/templates/ban-hang-da-kenh";
import { toDataSource } from "@/lib/templates/source";
import { COL, ORDERS_SPREADSHEET_ID, ORDER_COLUMNS } from "./canonical";
import { detectSheet } from "./detect";
import { SHOPEE_TABLE, TIKTOK_TABLE } from "./fixtures";
import { mergeOrders } from "./merge";
import { normalizeOrders } from "./normalize";

/**
 * Hợp đồng giữa bộ nhập file và dashboard mẫu: nạp file Shopee + TikTok Shop mô phỏng, áp mẫu "Bán hàng đa kênh" lên nguồn
 * đơn hàng, rồi so TỪNG con số trên dashboard với số tính tay từ file.
 */
const load = (table: typeof SHOPEE_TABLE, channel: string) => {
  const d = detectSheet(table)!;
  return normalizeOrders(table, d.headerRow, d.mapping, channel);
};
const rows = mergeOrders(load(SHOPEE_TABLE, "Shopee").rows, load(TIKTOK_TABLE, "TikTok Shop").rows, true);

const source = toDataSource({
  id: "src-1", name: "Đơn hàng đa kênh", sheet_name: "orders", spreadsheet_id: ORDERS_SPREADSHEET_ID, columns: ORDER_COLUMNS,
});

const t = BAN_HANG_DA_KENH;
const cols: ColumnInfo[] = ORDER_COLUMNS.map((c) => ({ name: c.name, type: c.type }));
const matched = matchColumns(t.slots, cols);
const { doc, dropped } = applyTemplate(t, matched.mapping, source as DataSource);
const calc = calcDefsFor(doc.calculatedFields, "src-1");

/** Widget theo tiêu đề (applyTemplate sinh id mới cho mọi widget). */
const run = (title: string) => {
  const w = doc.widgets.find((x) => "title" in x.config && x.config.title === title);
  if (!w) throw new Error(`Không có widget "${title}"`);
  const q = specForWidget(w, [], calc)!;
  const res = runQuery(rows as Row[], q.spec);
  if (res.mode !== "aggregate") throw new Error("không phải truy vấn gộp");
  return res.table;
};
const byKey = (table: ReturnType<typeof run>) => Object.fromEntries(table.rows.map((r) => [r.keys.join("|"), r.values]));

describe("mẫu Bán hàng đa kênh trên dữ liệu đã nhập", () => {
  it("nguồn đơn hàng khớp đủ mọi vai của mẫu, không bỏ widget nào", () => {
    expect(matched.unmatched).toEqual([]);
    // Mỗi vai phải khớp ĐÚNG cột cùng tên, đặc biệt "Doanh thu thực" không được lẫn với "Doanh thu" (gộp cả đơn hủy).
    expect(matched.mapping).toEqual(Object.fromEntries(t.slots.map((s) => [s.key, s.label])));
    expect(dropped.widgets).toEqual([]);
    expect(source.type).toBe("upload");
  });

  // Tay: Shopee thực = 120k + 200k + 240k = 560k (đơn B2 đã hủy tính 0); TikTok thực = 90k (đơn thứ hai đã hủy).
  it("KPI: doanh thu thực, số đơn, giá trị trung bình, tỷ lệ hủy", () => {
    expect(run("Doanh thu thực").rows[0].values[0]).toBe(650_000);
    expect(run("Số đơn").rows[0].values[0]).toBe(3); // A1, C3 (Shopee) + 1 đơn TikTok; đơn nhiều dòng chỉ đếm một lần
    expect(run("Giá trị trung bình mỗi đơn").rows[0].values[0]).toBeCloseTo(650_000 / 3, 6);
    expect(run("Tỷ lệ hủy").rows[0].values[0]).toBeCloseTo(2 / (3 + 2), 6); // 2 đơn hủy: B2 và đơn TikTok thứ hai
  });

  it("doanh thu theo kênh và bảng so sánh kênh", () => {
    const pie = byKey(run("Doanh thu theo kênh"));
    expect(pie["Shopee"]).toEqual([560_000]);
    expect(pie["TikTok Shop"]).toEqual([90_000]);
    const table = byKey(run("So sánh các kênh")); // doanh thu thực, số đơn, phí sàn, tỷ lệ hủy
    expect(table["Shopee"][0]).toBe(560_000);
    expect(table["Shopee"][1]).toBe(2);
    expect(table["Shopee"][2]).toBe(15_000 * 2); // phí tính một lần mỗi đơn hợp lệ: A1 (2 dòng) và C3; đơn hủy B2 không tính
    expect(table["Shopee"][3]).toBeCloseTo(1 / 3, 6);
    expect(table["TikTok Shop"][3]).toBeCloseTo(1 / 2, 6);
  });

  it("sản phẩm bán chạy và doanh thu theo khu vực bỏ đơn hủy", () => {
    const sp = byKey(run("Sản phẩm bán chạy"));
    expect(sp["Áo thun nam"]).toEqual([120_000 + 240_000]); // A1 dòng 1 + C3 (đơn B2 hủy = 0)
    expect(sp["Quần jean"]).toEqual([200_000]);
    expect(sp["Son môi"]).toEqual([90_000]);
    const tinh = byKey(run("Doanh thu theo khu vực"));
    expect(tinh["TP. Hồ Chí Minh"]).toEqual([320_000]);
    expect(tinh["Hà Nội"]).toEqual([0]);
    expect(tinh["Đà Nẵng"]).toEqual([240_000]);
  });

  it("doanh thu theo ngày tách theo kênh", () => {
    const stacked = run("Doanh thu theo ngày và kênh");
    const total = stacked.rows.reduce((n, r) => n + r.values[0], 0);
    expect(total).toBe(650_000);
    const perDay = new Map<string, number>();
    for (const r of stacked.rows) perDay.set(String(r.keys[0]), (perDay.get(String(r.keys[0])) ?? 0) + r.values[0]);
    // Đơn TikTok bị hủy ngày 25/09 vẫn có mặt trên trục ngày nhưng với doanh thu 0.
    expect(Object.fromEntries(perDay)).toEqual({ "2025-09-05": 320_000, "2025-09-06": 0, "2025-09-07": 330_000, "2025-09-25": 0 });
  });

  it("Phí sàn: mỗi đơn hợp lệ một lần, không nhân theo số dòng sản phẩm và không tính đơn hủy", () => {
    const fee = rows.reduce((n, r) => n + (Number(r[COL.platformFee]) || 0), 0);
    expect(fee).toBe(15_000 * 2); // đơn A1 và C3 của Shopee, mỗi đơn 6k+6k+3k
  });
});
