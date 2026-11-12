import { Template } from "@dashboard/schema";

/**
 * Mẫu "Bán hàng". Tên cột trong doc là KHOÁ VAI (xem packages/schema/src/template.ts).
 * Tạm viết tay; Bước 3 sẽ có script xuất mẫu từ dashboard dựng trong editor.
 */
const SRC = "src";
const NAMES = ["Nguyễn Văn An", "Trần Thị Bình", "Lê Hoàng Cường", "Phạm Minh Dũng"];
const PROVINCES = ["Hà Nội", "TP. Hồ Chí Minh", "Đà Nẵng", "Cần Thơ", "Hải Phòng"];
const PRODUCTS = ["Áo thun", "Quần jean", "Giày thể thao", "Túi xách", "Mũ lưỡi trai", "Đồng hồ"];
const CUSTOMERS = ["Công ty Minh Phát", "Cửa hàng Hoa Mai", "Anh Tuấn", "Chị Lan", "Siêu thị Việt"];

/** Dữ liệu mẫu tất định (không dùng Math.random để test ổn định). */
function sampleRows() {
  const rows = [];
  for (let i = 0; i < 36; i++) {
    const month = 1 + Math.floor(i / 6);
    const day = 1 + ((i * 5) % 27);
    const qty = 1 + ((i * 7) % 9);
    const price = 120_000 + ((i * 37) % 11) * 45_000;
    const revenue = qty * price;
    rows.push({
      ngay: `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      ma_don: `HD${String(1000 + i)}`,
      san_pham: PRODUCTS[i % PRODUCTS.length],
      so_luong: qty,
      doanh_thu: revenue,
      gia_von: Math.round(revenue * (0.55 + ((i * 3) % 10) / 100)),
      tinh_thanh: PROVINCES[(i * 3) % PROVINCES.length],
      nhan_vien: NAMES[i % NAMES.length],
      khach_hang: CUSTOMERS[(i * 2) % CUSTOMERS.length],
    });
  }
  return rows;
}

const kpi = (id: string, x: number, title: string, metric: Record<string, unknown>, compare = true) => ({
  id, x, y: 90, w: 330, h: 120, pageId: "p1",
  style: { background: "#ffffff", radius: 12, border: true },
  config: {
    kind: "kpi", sourceId: SRC, title, metric,
    ...(compare
      ? { compare: { to: "prev_period", dateColumn: "ngay", grain: "month", show: "percent", goodWhen: "up", toDate: true } }
      : {}),
  },
});

const chart = (
  id: string, x: number, y: number, w: number, h: number, chartType: string, title: string,
  dimensions: unknown[], metrics: unknown[],
) => ({
  id, x, y, w, h, pageId: "p1",
  style: { background: "#ffffff", radius: 12, border: true },
  config: { kind: "chart", chartType, sourceId: SRC, title, dimensions, metrics },
});

const sum = (column: string, label?: string) => ({ column, aggregation: "sum", label });

export const BAN_HANG: Template = Template.parse({
  id: "ban-hang",
  version: 1,
  industry: "Bán hàng",
  name: "Báo cáo bán hàng",
  description: "Doanh thu, số đơn, lợi nhuận gộp theo thời gian, sản phẩm, khu vực và nhân viên.",
  slots: [
    { key: "ngay", label: "Ngày bán", type: "date", required: true,
      synonyms: ["ngày hóa đơn", "ngày đặt hàng", "ngày chứng từ", "ngày giao dịch", "thời gian"] },
    { key: "doanh_thu", label: "Doanh thu", type: "number", required: true,
      synonyms: ["doanh thu sau chiết khấu", "thành tiền", "tổng tiền", "tiền hàng", "doanh số", "giá trị đơn hàng"] },
    { key: "san_pham", label: "Sản phẩm", type: "string", required: true,
      synonyms: ["tên sản phẩm", "tên hàng", "mặt hàng", "hàng hóa"] },
    { key: "so_luong", label: "Số lượng", type: "number", required: false, synonyms: ["số lượng bán", "sl bán"] },
    { key: "gia_von", label: "Giá vốn", type: "number", required: false,
      synonyms: ["tổng giá vốn", "chi phí hàng bán", "giá nhập"] },
    { key: "ma_don", label: "Mã đơn hàng", type: "string", required: false,
      synonyms: ["số hóa đơn", "mã hóa đơn", "số đơn", "mã đơn"] },
    { key: "tinh_thanh", label: "Tỉnh/Thành phố", type: "string", required: false,
      synonyms: ["tỉnh", "tỉnh thành", "khu vực", "miền"] },
    { key: "nhan_vien", label: "Nhân viên", type: "string", required: false,
      synonyms: ["tên nhân viên", "nhân viên bán hàng", "người bán", "sale"] },
    { key: "khach_hang", label: "Khách hàng", type: "string", required: false,
      synonyms: ["tên khách hàng", "tên khách", "người mua"] },
  ],
  doc: {
    schemaVersion: 1,
    id: "tpl-ban-hang",
    name: "Báo cáo bán hàng",
    canvas: { width: 1440, height: 900, background: "#f5f7fb" },
    sources: [{ id: SRC, type: "sample", name: "Dữ liệu bán hàng", columns: [{ name: "ngay", type: "date" }] }],
    pages: [{ id: "p1", name: "Tổng quan" }],
    calculatedFields: [
      { id: "cf-loi-nhuan", sourceId: SRC, name: "Lợi nhuận gộp", expression: "[doanh_thu] - [gia_von]" },
    ],
    filters: [
      { id: "f-ngay", sourceId: SRC, column: "ngay", control: "date_range", label: "Thời gian" },
      { id: "f-tinh", sourceId: SRC, column: "tinh_thanh", control: "dropdown", label: "Khu vực" },
      { id: "f-nv", sourceId: SRC, column: "nhan_vien", control: "dropdown", label: "Nhân viên" },
    ],
    widgets: [
      {
        id: "w-title", x: 30, y: 24, w: 700, h: 48, pageId: "p1",
        config: { kind: "text", text: "Báo cáo bán hàng", fontSize: 28, bold: true, align: "left" },
      },
      kpi("w-k-dt", 30, "Doanh thu", sum("doanh_thu")),
      kpi("w-k-don", 385, "Số đơn hàng", { column: "ma_don", aggregation: "count_distinct" }),
      kpi("w-k-sl", 740, "Số lượng bán", sum("so_luong")),
      kpi("w-k-ln", 1095, "Lợi nhuận gộp", sum("Lợi nhuận gộp")),
      chart("w-line", 30, 230, 860, 320, "line", "Doanh thu theo tháng",
        [{ column: "ngay", grain: "month" }], [sum("doanh_thu")]),
      chart("w-pie", 910, 230, 500, 320, "pie", "Doanh thu theo khu vực",
        [{ column: "tinh_thanh" }], [sum("doanh_thu")]),
      chart("w-hbar", 30, 570, 560, 310, "hbar", "Doanh thu theo sản phẩm",
        [{ column: "san_pham" }], [sum("doanh_thu")]),
      chart("w-nv", 610, 570, 380, 310, "bar", "Doanh thu theo nhân viên",
        [{ column: "nhan_vien" }], [sum("doanh_thu")]),
      chart("w-table", 1010, 570, 400, 310, "table", "Chi tiết theo khách hàng",
        [{ column: "khach_hang" }], [sum("so_luong"), sum("doanh_thu")]),
    ],
  },
  sampleRows: sampleRows(),
});
