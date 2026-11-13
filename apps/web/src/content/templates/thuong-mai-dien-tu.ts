import { Template } from "@dashboard/schema";
import { SRC, LAYOUT, at, canvas, chart, countDistinct, isoDay, kpi, sum, titleText } from "./builders";

/** Mẫu "Thương mại điện tử" (Shopee, TikTok Shop, Lazada). Dữ liệu mẫu tất định, KHÔNG phải số liệu thật. */
const PRODUCTS = ["Tai nghe không dây", "Ốp lưng điện thoại", "Sạc nhanh 20W", "Cáp USB-C", "Chuột không dây", "Giá đỡ laptop"];
const SHOPS = ["Shopee", "TikTok Shop", "Lazada"];
const PROVINCES = ["Hà Nội", "TP. Hồ Chí Minh", "Đà Nẵng", "Cần Thơ", "Hải Phòng"];
const STATUS = ["Hoàn thành", "Hoàn thành", "Hoàn thành", "Đang giao", "Đã hủy", "Hoàn thành", "Hoàn trả"];

function sampleRows() {
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const qty = 1 + ((i * 5) % 4);
    const price = 89_000 + ((i * 41) % 9) * 38_000;
    const revenue = qty * price;
    rows.push({
      ngay: isoDay("2025-04-01", i * 2),
      ma_don: `DH${25000 + i * 7}`,
      trang_thai: STATUS[i % STATUS.length],
      doanh_thu: revenue,
      san_pham: PRODUCTS[i % PRODUCTS.length],
      so_luong: qty,
      phi_san: Math.round(revenue * (0.08 + ((i * 3) % 5) / 100)),
      gia_von: Math.round(revenue * (0.5 + ((i * 7) % 12) / 100)),
      gian_hang: SHOPS[(i * 2) % SHOPS.length],
      tinh_thanh: PROVINCES[(i * 3) % PROVINCES.length],
    });
  }
  return rows;
}

export const THUONG_MAI_DIEN_TU: Template = Template.parse({
  id: "thuong-mai-dien-tu",
  version: 1,
  industry: "Thương mại điện tử",
  name: "Báo cáo sàn TMĐT",
  description: "Doanh thu, tỉ lệ đơn hủy, phí sàn và lợi nhuận theo sản phẩm, gian hàng và trạng thái đơn (Shopee, TikTok Shop, Lazada).",
  slots: [
    { key: "ngay", label: "Ngày đặt hàng", type: "date", required: true,
      synonyms: ["ngày tạo đơn", "ngày đặt", "thời gian đặt hàng", "ngày tạo", "order date", "order creation date", "created time"] },
    { key: "ma_don", label: "Mã đơn hàng", type: "string", required: true,
      synonyms: ["mã đơn", "số đơn", "order id", "order sn", "order number"] },
    { key: "trang_thai", label: "Trạng thái đơn", type: "string", required: true,
      synonyms: ["trạng thái", "tình trạng đơn", "tình trạng", "order status", "status"] },
    { key: "doanh_thu", label: "Doanh thu", type: "number", required: true,
      synonyms: ["tổng giá trị đơn hàng", "tổng tiền", "tổng thanh toán", "giá bán", "thành tiền", "order amount", "total amount"] },
    { key: "san_pham", label: "Sản phẩm", type: "string", required: false,
      synonyms: ["tên sản phẩm", "tên hàng", "product name", "sku", "mặt hàng"] },
    { key: "so_luong", label: "Số lượng", type: "number", required: false,
      synonyms: ["số lượng bán", "sl", "quantity"] },
    { key: "phi_san", label: "Phí sàn", type: "number", required: false,
      synonyms: ["phí giao dịch", "phí hoa hồng", "phí dịch vụ", "phí cố định", "commission fee", "transaction fee"] },
    { key: "gia_von", label: "Giá vốn", type: "number", required: false,
      synonyms: ["tổng giá vốn", "giá nhập", "chi phí hàng bán", "cost"] },
    { key: "gian_hang", label: "Gian hàng", type: "string", required: false,
      synonyms: ["tên shop", "shop", "cửa hàng", "kênh bán", "sàn", "sàn thương mại"] },
    { key: "tinh_thanh", label: "Tỉnh/Thành phố", type: "string", required: false,
      synonyms: ["tỉnh", "tỉnh thành", "khu vực giao hàng", "province"] },
  ],
  doc: {
    schemaVersion: 1,
    id: "tpl-thuong-mai-dien-tu",
    name: "Báo cáo sàn TMĐT",
    canvas,
    sources: [{ id: SRC, type: "sample", name: "Đơn hàng sàn TMĐT", columns: [{ name: "ngay", type: "date" }] }],
    pages: [{ id: "p1", name: "Tổng quan" }],
    calculatedFields: [
      { id: "cf-loi-nhuan", sourceId: SRC, name: "Lợi nhuận", expression: "[doanh_thu] - [phi_san] - [gia_von]" },
    ],
    filters: [
      { id: "f-ngay", sourceId: SRC, column: "ngay", control: "date_range", label: "Thời gian" },
      { id: "f-shop", sourceId: SRC, column: "gian_hang", control: "dropdown", label: "Gian hàng" },
      { id: "f-tt", sourceId: SRC, column: "trang_thai", control: "dropdown", label: "Trạng thái đơn" },
    ],
    widgets: [
      titleText("Báo cáo sàn TMĐT"),
      kpi("w-k-dt", 0, "Doanh thu", sum("doanh_thu"), { dateColumn: "ngay" }),
      kpi("w-k-don", 1, "Số đơn hàng", countDistinct("ma_don"), { dateColumn: "ngay" }),
      kpi("w-k-phi", 2, "Phí sàn", sum("phi_san"), { dateColumn: "ngay", goodWhen: "down" }),
      kpi("w-k-ln", 3, "Lợi nhuận", sum("Lợi nhuận"), { dateColumn: "ngay" }),
      chart("w-line", ...at(LAYOUT.wide), "line", "Doanh thu theo tháng",
        [{ column: "ngay", grain: "month" }], [sum("doanh_thu")]),
      chart("w-pie", ...at(LAYOUT.side), "pie", "Số đơn theo trạng thái",
        [{ column: "trang_thai" }], [countDistinct("ma_don")]),
      chart("w-hbar", ...at(LAYOUT.a), "hbar", "Doanh thu theo sản phẩm",
        [{ column: "san_pham" }], [sum("doanh_thu")]),
      chart("w-shop", ...at(LAYOUT.b), "bar", "Doanh thu theo gian hàng",
        [{ column: "gian_hang" }], [sum("doanh_thu")]),
      chart("w-table", ...at(LAYOUT.c), "table", "Chi tiết theo tỉnh/thành",
        [{ column: "tinh_thanh" }], [countDistinct("ma_don"), sum("doanh_thu")]),
    ],
  },
  sampleRows: sampleRows(),
});
