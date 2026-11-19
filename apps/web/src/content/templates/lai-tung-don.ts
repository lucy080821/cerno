import { Template } from "@dashboard/schema";
import { SRC, LAYOUT, at, canvas, chart, isoDay, kpi, sum, titleText } from "./builders";

/**
 * Mẫu "Lãi từng đơn" cho nguồn "Đơn hàng đa kênh" (lib/orders/canonical.ts): khoá vai trùng tên cột chuẩn nên tự khớp.
 * "Lãi đơn" là trường tính toán THEO DÒNG: doanh thu thực + phí ship khách trả − phí sàn − giá vốn − quảng cáo. Các khoản
 * cấp đơn (phí sàn, phí ship, quảng cáo) chỉ nằm ở dòng đầu của mỗi đơn nên cộng các dòng lại là ra đúng lãi của đơn.
 * Ô trống tính là 0 (IFNULL): đơn chưa có giá vốn sẽ trông lãi hơn thực tế, nên mô tả mẫu nhắc nhập giá vốn.
 * Dữ liệu mẫu tất định, KHÔNG phải số liệu thật.
 */
export const PROFIT_TEMPLATE_ID = "lai-tung-don";

const CHANNELS = ["Shopee", "TikTok Shop", "Shopee", "Facebook", "TikTok Shop", "Shopee"];
const PRODUCTS = [
  { name: "Áo thun cotton", price: 129_000, cost: 70_000, ad: 18_000 },
  { name: "Váy hoa nhí", price: 220_000, cost: 125_000, ad: 37_000 },
  { name: "Túi tote canvas", price: 99_000, cost: 48_000, ad: 12_000 },
  { name: "Son lì mini", price: 79_000, cost: 35_000, ad: 9_000 },
  { name: "Tai nghe bluetooth", price: 150_000, cost: 100_000, ad: 44_000 },
  { name: "Set skincare mini", price: 180_000, cost: 120_000, ad: 66_000 },
];

function sampleRows() {
  const rows = [];
  for (let i = 0; i < 84; i++) {
    const ch = CHANNELS[i % CHANNELS.length];
    const p = PRODUCTS[(i * 5) % PRODUCTS.length];
    const qty = 1 + ((i * 7) % 3 === 0 ? 1 : 0);
    const cancelled = i % 13 === 6;
    const returned = i % 17 === 9;
    const valid = !cancelled && !returned;
    const rev = qty * p.price;
    rows.push({
      ngay: isoDay("2025-09-01", Math.floor(i / 3)),
      kenh: ch,
      trang_thai: cancelled ? "Đã hủy" : returned ? "Hoàn trả" : "Hoàn thành",
      san_pham: p.name,
      so_luong: qty,
      doanh_thu_thuc: valid ? rev : 0,
      so_don: valid ? 1 : 0,
      phi_san: valid ? Math.round(rev * (ch === "Facebook" ? 0 : ch === "Shopee" ? 0.14 : 0.12)) : 0,
      phi_van_chuyen: valid && i % 4 === 0 ? 15_000 : 0,
      gia_von: valid ? qty * p.cost : 0,
      quang_cao: p.ad,
    });
  }
  return rows;
}

export const LAI_TUNG_DON: Template = Template.parse({
  id: PROFIT_TEMPLATE_ID,
  version: 1,
  industry: "Bán hàng online",
  name: "Lãi từng đơn",
  description: "Lãi thật của từng đơn sau phí sàn, giá vốn và quảng cáo: lãi theo ngày, theo sản phẩm, theo kênh. Nhập giá vốn ở trang Sản phẩm và giá vốn để số liệu đúng.",
  slots: [
    { key: "ngay", label: "Ngày đặt", type: "date", required: true, synonyms: ["ngày đặt hàng", "ngày bán", "ngày tạo đơn"] },
    { key: "kenh", label: "Kênh", type: "string", required: true, synonyms: ["kênh bán", "sàn", "nền tảng"] },
    // Không đưa "doanh thu" vào: trùng đúng tên cột "Doanh thu" (gộp cả đơn hủy) của nguồn đơn hàng.
    { key: "doanh_thu_thuc", label: "Doanh thu thực", type: "number", required: true, synonyms: ["doanh thu sau hủy", "doanh thu hợp lệ"] },
    { key: "so_don", label: "Số đơn", type: "number", required: true, synonyms: ["số đơn hàng", "số đơn hợp lệ"] },
    { key: "gia_von", label: "Giá vốn", type: "number", required: true, synonyms: ["tổng giá vốn", "chi phí giá vốn", "giá nhập"] },
    { key: "phi_san", label: "Phí sàn", type: "number", required: false, synonyms: ["tổng phí sàn", "phí giao dịch"] },
    { key: "quang_cao", label: "Chi phí quảng cáo", type: "number", required: false, synonyms: ["phí quảng cáo", "quảng cáo", "ads"] },
    { key: "phi_van_chuyen", label: "Phí vận chuyển khách trả", type: "number", required: false, synonyms: ["phí ship khách trả", "phí vận chuyển người mua trả"] },
    { key: "san_pham", label: "Sản phẩm", type: "string", required: false, synonyms: ["tên sản phẩm", "tên hàng", "mặt hàng"] },
    { key: "so_luong", label: "Số lượng", type: "number", required: false, synonyms: ["số lượng bán", "sl bán"] },
    { key: "trang_thai", label: "Trạng thái", type: "string", required: false, synonyms: ["trạng thái đơn", "tình trạng đơn"] },
  ],
  doc: {
    schemaVersion: 1,
    id: "tpl-lai-tung-don",
    name: "Lãi từng đơn",
    canvas,
    sources: [{ id: SRC, type: "sample", name: "Đơn hàng đa kênh", columns: [{ name: "ngay", type: "date" }] }],
    pages: [{ id: "p1", name: "Lãi từng đơn" }],
    calculatedFields: [
      { id: "cf-lai", sourceId: SRC, name: "Lãi đơn",
        expression: "IFNULL([doanh_thu_thuc], 0) + IFNULL([phi_van_chuyen], 0) - IFNULL([phi_san], 0) - IFNULL([gia_von], 0) - IFNULL([quang_cao], 0)" },
      { id: "cf-lai-tb", sourceId: SRC, name: "Lãi trung bình mỗi đơn", expression: "SUM([Lãi đơn]) / SUM([so_don])" },
      // Engine chưa có định dạng phần trăm cho KPI nên nhân 100 và ghi "(%)" trong tên.
      { id: "cf-bien", sourceId: SRC, name: "Biên lãi (%)", expression: "SUM([Lãi đơn]) * 100 / SUM([doanh_thu_thuc])" },
    ],
    filters: [
      { id: "f-ngay", sourceId: SRC, column: "ngay", control: "date_range", label: "Thời gian" },
      { id: "f-kenh", sourceId: SRC, column: "kenh", control: "multiselect", label: "Kênh" },
    ],
    widgets: [
      titleText("Lãi từng đơn"),
      kpi("w-k-lai", 0, "Lãi thật", { column: "Lãi đơn", aggregation: "sum" }, { dateColumn: "ngay" }),
      kpi("w-k-tb", 1, "Lãi trung bình mỗi đơn", { column: "Lãi trung bình mỗi đơn", aggregation: "sum" }, { dateColumn: "ngay" }),
      kpi("w-k-bien", 2, "Biên lãi (%)", { column: "Biên lãi (%)", aggregation: "sum" }, { dateColumn: "ngay" }),
      kpi("w-k-qc", 3, "Chi phí quảng cáo", sum("quang_cao"), { dateColumn: "ngay", goodWhen: "down" }),
      chart("w-day", ...at(LAYOUT.wide), "bar", "Lãi theo ngày",
        [{ column: "ngay", grain: "day" }], [{ column: "Lãi đơn", aggregation: "sum" }]),
      chart("w-kenh", ...at(LAYOUT.side), "bar", "Lãi trung bình mỗi đơn theo kênh",
        [{ column: "kenh" }], [{ column: "Lãi trung bình mỗi đơn", aggregation: "sum" }]),
      chart("w-sp", ...at(LAYOUT.a), "hbar", "Lãi theo sản phẩm",
        [{ column: "san_pham" }], [{ column: "Lãi đơn", aggregation: "sum" }]),
      chart("w-chiphi", ...at({ x: 610, y: 570, w: 800, h: 310 }), "table", "Doanh thu, chi phí và lãi theo sản phẩm",
        [{ column: "san_pham" }], [sum("doanh_thu_thuc"), sum("gia_von"), sum("phi_san"), sum("quang_cao"), { column: "Lãi đơn", aggregation: "sum" }]),
    ],
  },
  sampleRows: sampleRows(),
});
