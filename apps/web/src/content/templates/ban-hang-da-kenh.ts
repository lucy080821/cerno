import { Template } from "@dashboard/schema";
import { SRC, LAYOUT, at, canvas, chart, isoDay, kpi, sum, titleText } from "./builders";

/**
 * Mẫu "Bán hàng đa kênh" cho người bán Shopee / TikTok Shop / Facebook. Dùng với nguồn "Đơn hàng đa kênh" (tải file đơn
 * hàng ở /dashboards): mọi khoá vai dưới đây trùng tên cột chuẩn của nguồn đó (lib/orders/canonical.ts) nên tự khớp đủ.
 * "Số đơn" và "Số đơn hủy" là cột đếm theo ĐƠN (chỉ ghi ở dòng đầu của mỗi đơn), vì vậy cộng lên là ra số đơn đúng dù
 * một đơn có nhiều dòng sản phẩm; "Doanh thu thực" đã bỏ đơn hủy/hoàn trả.
 * Dữ liệu mẫu tất định, KHÔNG phải số liệu thật.
 */
export const ORDERS_TEMPLATE_ID = "ban-hang-da-kenh";

const CHANNELS = ["Shopee", "Shopee", "TikTok Shop", "Facebook", "Shopee", "TikTok Shop"];
const PRODUCTS = ["Áo thun nam", "Váy hoa", "Son môi", "Ốp lưng", "Tai nghe", "Túi tote"];
const PROVINCES = ["TP. Hồ Chí Minh", "Hà Nội", "Đà Nẵng", "Cần Thơ", "Hải Phòng"];
const PAYMENTS = ["Thanh toán khi nhận hàng", "Ví điện tử", "Chuyển khoản"];

function sampleRows() {
  const rows = [];
  for (let i = 0; i < 72; i++) {
    const cancelled = i % 9 === 4;
    const qty = 1 + ((i * 5) % 3);
    const price = 69_000 + ((i * 31) % 8) * 28_000;
    rows.push({
      ngay: isoDay("2025-09-01", Math.floor(i / 2)),
      kenh: CHANNELS[i % CHANNELS.length],
      trang_thai: cancelled ? "Đã hủy" : i % 11 === 0 ? "Chưa hoàn tất" : "Hoàn thành",
      san_pham: PRODUCTS[(i * 5) % PRODUCTS.length],
      so_luong: qty,
      doanh_thu_thuc: cancelled ? 0 : qty * price,
      so_don: cancelled ? 0 : 1,
      so_don_huy: cancelled ? 1 : 0,
      phi_san: cancelled ? 0 : Math.round(qty * price * (CHANNELS[i % CHANNELS.length] === "Facebook" ? 0 : 0.12)),
      tinh_thanh: PROVINCES[(i * 3) % PROVINCES.length],
      thanh_toan: PAYMENTS[i % PAYMENTS.length],
    });
  }
  return rows;
}

export const BAN_HANG_DA_KENH: Template = Template.parse({
  id: ORDERS_TEMPLATE_ID,
  version: 1,
  industry: "Bán hàng online",
  name: "Bán hàng đa kênh",
  description: "Doanh thu, số đơn, tỷ lệ hủy theo ngày, kênh (Shopee, TikTok Shop, Facebook), sản phẩm và khu vực từ file đơn hàng bạn tải lên.",
  slots: [
    { key: "ngay", label: "Ngày đặt", type: "date", required: true,
      synonyms: ["ngày đặt hàng", "ngày bán", "ngày tạo đơn", "thời gian đặt"] },
    { key: "kenh", label: "Kênh", type: "string", required: true,
      synonyms: ["kênh bán", "sàn", "nguồn đơn", "nền tảng"] },
    { key: "doanh_thu_thuc", label: "Doanh thu thực", type: "number", required: true,
      // KHÔNG đưa "doanh thu" vào đây: nó trùng đúng tên cột "Doanh thu" (gộp cả đơn hủy) của nguồn đơn hàng và sẽ khớp nhầm.
      synonyms: ["doanh thu sau hủy", "doanh thu hợp lệ"] },
    { key: "so_don", label: "Số đơn", type: "number", required: true,
      synonyms: ["số đơn hàng", "số đơn hợp lệ", "đơn hợp lệ"] },
    { key: "so_don_huy", label: "Số đơn hủy", type: "number", required: false,
      synonyms: ["số đơn bị hủy", "đơn hủy", "đơn hoàn hủy"] },
    { key: "trang_thai", label: "Trạng thái", type: "string", required: false,
      synonyms: ["trạng thái đơn", "tình trạng đơn"] },
    { key: "san_pham", label: "Sản phẩm", type: "string", required: false,
      synonyms: ["tên sản phẩm", "tên hàng", "mặt hàng"] },
    { key: "so_luong", label: "Số lượng", type: "number", required: false,
      synonyms: ["số lượng bán", "sl bán"] },
    { key: "phi_san", label: "Phí sàn", type: "number", required: false,
      synonyms: ["tổng phí sàn", "phí giao dịch", "phí dịch vụ sàn"] },
    { key: "tinh_thanh", label: "Tỉnh/Thành", type: "string", required: false,
      synonyms: ["tỉnh thành phố", "khu vực", "nơi nhận hàng"] },
    { key: "thanh_toan", label: "Thanh toán", type: "string", required: false,
      synonyms: ["phương thức thanh toán", "hình thức thanh toán"] },
  ],
  doc: {
    schemaVersion: 1,
    id: "tpl-ban-hang-da-kenh",
    name: "Bán hàng đa kênh",
    canvas,
    sources: [{ id: SRC, type: "sample", name: "Đơn hàng đa kênh", columns: [{ name: "ngay", type: "date" }] }],
    pages: [{ id: "p1", name: "Tổng quan" }],
    // Công thức TỔNG HỢP: tính theo từng nhóm (kênh, ngày...) nên ra tỉ số đúng thay vì trung bình các dòng.
    calculatedFields: [
      { id: "cf-aov", sourceId: SRC, name: "Giá trị trung bình mỗi đơn", expression: "SUM([doanh_thu_thuc]) / SUM([so_don])" },
      { id: "cf-huy", sourceId: SRC, name: "Tỷ lệ hủy", expression: "SUM([so_don_huy]) / (SUM([so_don]) + SUM([so_don_huy]))" },
    ],
    filters: [
      { id: "f-ngay", sourceId: SRC, column: "ngay", control: "date_range", label: "Thời gian" },
      { id: "f-kenh", sourceId: SRC, column: "kenh", control: "multiselect", label: "Kênh" },
      { id: "f-tinh", sourceId: SRC, column: "tinh_thanh", control: "dropdown", label: "Khu vực" },
    ],
    widgets: [
      titleText("Bán hàng đa kênh"),
      kpi("w-k-dt", 0, "Doanh thu thực", sum("doanh_thu_thuc"), { dateColumn: "ngay" }),
      kpi("w-k-don", 1, "Số đơn", sum("so_don"), { dateColumn: "ngay" }),
      kpi("w-k-aov", 2, "Giá trị trung bình mỗi đơn", { column: "Giá trị trung bình mỗi đơn", aggregation: "sum" }, { dateColumn: "ngay" }),
      kpi("w-k-huy", 3, "Tỷ lệ hủy", { column: "Tỷ lệ hủy", aggregation: "sum" }, { dateColumn: "ngay", goodWhen: "down" }),
      chart("w-day", ...at(LAYOUT.wide), "stackedbar", "Doanh thu theo ngày và kênh",
        [{ column: "ngay", grain: "day" }, { column: "kenh" }], [sum("doanh_thu_thuc")]),
      chart("w-pie", ...at(LAYOUT.side), "pie", "Doanh thu theo kênh",
        [{ column: "kenh" }], [sum("doanh_thu_thuc")]),
      chart("w-sp", ...at(LAYOUT.a), "hbar", "Sản phẩm bán chạy",
        [{ column: "san_pham" }], [sum("doanh_thu_thuc")]),
      chart("w-tinh", ...at(LAYOUT.b), "hbar", "Doanh thu theo khu vực",
        [{ column: "tinh_thanh" }], [sum("doanh_thu_thuc")]),
      chart("w-table", ...at(LAYOUT.c), "table", "So sánh các kênh",
        [{ column: "kenh" }], [sum("doanh_thu_thuc"), sum("so_don"), sum("phi_san"), { column: "Tỷ lệ hủy", aggregation: "sum" }]),
    ],
  },
  sampleRows: sampleRows(),
});
