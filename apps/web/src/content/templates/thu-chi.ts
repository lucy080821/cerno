import { Template } from "@dashboard/schema";
import { SRC, LAYOUT, at, canvas, chart, isoDay, kpi, sum, titleText } from "./builders";

/**
 * Mẫu "Thu chi". Cột "Loại thu/chi" phải có giá trị đúng là "Thu" hoặc "Chi" thì Khoản thu/Khoản chi/Dòng tiền ròng mới
 * có số (công thức so sánh với đúng hai chữ này); biểu đồ chia theo loại thì dùng giá trị nào cũng được.
 * Dữ liệu mẫu tất định, KHÔNG phải số liệu thật.
 */
const CATEGORIES_IN = ["Bán hàng", "Dịch vụ", "Lãi ngân hàng"];
const CATEGORIES_OUT = ["Nhập hàng", "Lương nhân viên", "Thuê mặt bằng", "Điện nước", "Marketing"];
const ACCOUNTS = ["Tiền mặt", "Vietcombank", "Momo"];
const PARTIES = ["Công ty Minh Phát", "Khách lẻ", "Nhà cung cấp An Khang", "Chủ nhà", "Nhân viên"];

function sampleRows() {
  const rows = [];
  for (let i = 0; i < 48; i++) {
    const income = i % 3 === 0;
    const cats = income ? CATEGORIES_IN : CATEGORIES_OUT;
    const base = income ? 4_500_000 + ((i * 37) % 9) * 1_300_000 : 800_000 + ((i * 29) % 10) * 650_000;
    rows.push({
      ngay: isoDay("2025-01-03", i * 4),
      so_tien: base,
      loai: income ? "Thu" : "Chi",
      danh_muc: cats[(i * 5) % cats.length],
      tai_khoan: ACCOUNTS[(i * 7) % ACCOUNTS.length],
      doi_tuong: PARTIES[(i * 3) % PARTIES.length],
    });
  }
  return rows;
}

export const THU_CHI: Template = Template.parse({
  id: "thu-chi",
  version: 1,
  industry: "Tài chính",
  name: "Báo cáo thu chi",
  description: "Tổng thu, tổng chi và dòng tiền ròng theo tháng, theo danh mục và theo tài khoản.",
  slots: [
    { key: "ngay", label: "Ngày giao dịch", type: "date", required: true,
      synonyms: ["ngày", "ngày thu chi", "ngày chứng từ", "thời gian", "date"] },
    { key: "so_tien", label: "Số tiền", type: "number", required: true,
      synonyms: ["giá trị", "thành tiền", "tiền", "số tiền giao dịch", "amount"] },
    { key: "loai", label: "Loại thu/chi", type: "string", required: true,
      synonyms: ["thu chi", "thu/chi", "phân loại thu chi", "loại giao dịch", "loại phiếu", "type"] },
    { key: "danh_muc", label: "Danh mục", type: "string", required: false,
      synonyms: ["hạng mục", "khoản mục", "nhóm chi phí", "loại chi phí", "nội dung", "category"] },
    { key: "tai_khoan", label: "Tài khoản", type: "string", required: false,
      synonyms: ["quỹ", "nguồn tiền", "ví", "tài khoản ngân hàng", "phương thức thanh toán", "account"] },
    { key: "doi_tuong", label: "Đối tượng", type: "string", required: false,
      synonyms: ["người nhận", "nhà cung cấp", "khách hàng", "đối tác", "bên liên quan"] },
  ],
  doc: {
    schemaVersion: 1,
    id: "tpl-thu-chi",
    name: "Báo cáo thu chi",
    canvas,
    sources: [{ id: SRC, type: "sample", name: "Sổ thu chi", columns: [{ name: "ngay", type: "date" }] }],
    pages: [{ id: "p1", name: "Tổng quan" }],
    calculatedFields: [
      { id: "cf-thu", sourceId: SRC, name: "Khoản thu", expression: 'IF([loai] = "Thu", [so_tien], 0)' },
      { id: "cf-chi", sourceId: SRC, name: "Khoản chi", expression: 'IF([loai] = "Chi", [so_tien], 0)' },
      { id: "cf-rong", sourceId: SRC, name: "Dòng tiền ròng", expression: "[Khoản thu] - [Khoản chi]" },
    ],
    filters: [
      { id: "f-ngay", sourceId: SRC, column: "ngay", control: "date_range", label: "Thời gian" },
      { id: "f-loai", sourceId: SRC, column: "loai", control: "dropdown", label: "Loại thu/chi" },
      { id: "f-dm", sourceId: SRC, column: "danh_muc", control: "dropdown", label: "Danh mục" },
      { id: "f-tk", sourceId: SRC, column: "tai_khoan", control: "dropdown", label: "Tài khoản" },
    ],
    widgets: [
      titleText("Báo cáo thu chi"),
      kpi("w-k-thu", 0, "Tổng thu", sum("Khoản thu"), { dateColumn: "ngay" }),
      kpi("w-k-chi", 1, "Tổng chi", sum("Khoản chi"), { dateColumn: "ngay", goodWhen: "down" }),
      kpi("w-k-rong", 2, "Dòng tiền ròng", sum("Dòng tiền ròng"), { dateColumn: "ngay" }),
      kpi("w-k-gd", 3, "Số giao dịch", { column: "so_tien", aggregation: "count" }, { dateColumn: "ngay" }),
      chart("w-bar", ...at(LAYOUT.wide), "bar", "Thu và chi theo tháng",
        [{ column: "ngay", grain: "month" }], [sum("Khoản thu"), sum("Khoản chi")]),
      chart("w-pie", ...at(LAYOUT.side), "pie", "Chi theo danh mục",
        [{ column: "danh_muc" }], [sum("Khoản chi")]),
      chart("w-net", ...at(LAYOUT.a), "line", "Dòng tiền ròng theo tháng",
        [{ column: "ngay", grain: "month" }], [sum("Dòng tiền ròng")]),
      chart("w-tk", ...at(LAYOUT.b), "bar", "Số tiền theo tài khoản",
        [{ column: "tai_khoan" }], [sum("so_tien")]),
      chart("w-table", ...at(LAYOUT.c), "table", "Thu chi theo danh mục",
        [{ column: "danh_muc" }], [sum("Khoản thu"), sum("Khoản chi")]),
    ],
  },
  sampleRows: sampleRows(),
});
