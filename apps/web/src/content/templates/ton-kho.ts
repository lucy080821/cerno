import { Template } from "@dashboard/schema";
import { SRC, LAYOUT, at, canvas, chart, countDistinct, kpi, sum, titleText } from "./builders";

/** Mẫu "Tồn kho". Mỗi dòng là một mặt hàng tại một kho. Dữ liệu mẫu tất định, KHÔNG phải số liệu thật. */
const ITEMS: [string, string][] = [
  ["Gạo ST25 5kg", "Lương thực"], ["Dầu ăn 1L", "Lương thực"], ["Mì gói thùng 30", "Lương thực"],
  ["Nước suối thùng 24", "Đồ uống"], ["Cà phê hòa tan", "Đồ uống"], ["Trà xanh hộp", "Đồ uống"],
  ["Bột giặt 3kg", "Gia dụng"], ["Nước rửa chén", "Gia dụng"], ["Giấy vệ sinh lốc 10", "Gia dụng"],
  ["Sữa tươi thùng 48", "Sữa"], ["Sữa chua lốc 4", "Sữa"], ["Bánh quy hộp", "Bánh kẹo"],
];
const WAREHOUSES = ["Kho Hà Nội", "Kho TP.HCM", "Kho Đà Nẵng"];

function sampleRows() {
  const rows = [];
  for (let i = 0; i < 36; i++) {
    const [name, group] = ITEMS[i % ITEMS.length];
    const min = 20 + ((i * 7) % 5) * 10;
    // Một số mặt hàng cố ý nằm dưới mức tối thiểu để KPI "sắp hết" có số.
    const stock = i % 5 === 0 ? Math.max(3, min - 8 - (i % 3) * 4) : min + 15 + ((i * 11) % 14) * 9;
    const unit = 18_000 + ((i * 13) % 9) * 14_000;
    rows.push({
      san_pham: name,
      ton_cuoi: stock,
      ma_hang: `SP${String(100 + (i % ITEMS.length)).padStart(4, "0")}`,
      nhom_hang: group,
      kho: WAREHOUSES[Math.floor(i / ITEMS.length)],
      ton_toi_thieu: min,
      nhap: 30 + ((i * 17) % 11) * 8,
      xuat: 24 + ((i * 19) % 12) * 7,
      don_gia: unit,
      gia_tri_ton: stock * unit,
      ngay: "2025-06-30",
    });
  }
  return rows;
}

export const TON_KHO: Template = Template.parse({
  id: "ton-kho",
  version: 1,
  industry: "Kho vận",
  name: "Báo cáo tồn kho",
  description: "Tồn kho, giá trị tồn, nhập xuất và hàng sắp hết theo sản phẩm, nhóm hàng và kho.",
  slots: [
    { key: "san_pham", label: "Sản phẩm", type: "string", required: true,
      synonyms: ["tên sản phẩm", "tên hàng", "mặt hàng", "hàng hóa", "tên vật tư", "item", "product"] },
    { key: "ton_cuoi", label: "Tồn kho", type: "number", required: true,
      synonyms: ["tồn cuối kỳ", "tồn cuối", "số lượng tồn", "tồn", "stock", "inventory", "on hand"] },
    { key: "ma_hang", label: "Mã hàng", type: "string", required: false,
      synonyms: ["mã sản phẩm", "mã sku", "sku", "mã vật tư", "mã"] },
    { key: "nhom_hang", label: "Nhóm hàng", type: "string", required: false,
      synonyms: ["danh mục", "loại hàng", "ngành hàng", "category", "nhóm"] },
    { key: "kho", label: "Kho", type: "string", required: false,
      synonyms: ["kho hàng", "tên kho", "địa điểm kho", "chi nhánh", "warehouse"] },
    { key: "ton_toi_thieu", label: "Tồn tối thiểu", type: "number", required: false,
      synonyms: ["mức tồn tối thiểu", "định mức tồn", "tồn an toàn", "min stock", "reorder point"] },
    { key: "nhap", label: "Số lượng nhập", type: "number", required: false,
      synonyms: ["nhập kho", "tổng nhập", "nhập trong kỳ", "sl nhập"] },
    { key: "xuat", label: "Số lượng xuất", type: "number", required: false,
      synonyms: ["xuất kho", "tổng xuất", "xuất trong kỳ", "sl xuất"] },
    { key: "don_gia", label: "Đơn giá vốn", type: "number", required: false,
      synonyms: ["giá vốn", "giá nhập", "đơn giá", "giá trị đơn vị", "unit cost"] },
    { key: "gia_tri_ton", label: "Giá trị tồn", type: "number", required: false,
      synonyms: ["giá trị tồn kho", "thành tiền tồn", "tổng giá trị", "inventory value"] },
    { key: "ngay", label: "Ngày chốt tồn", type: "date", required: false,
      synonyms: ["ngày chốt", "ngày cập nhật", "ngày nhập xuất", "ngày tồn", "ngày"] },
  ],
  doc: {
    schemaVersion: 1,
    id: "tpl-ton-kho",
    name: "Báo cáo tồn kho",
    canvas,
    sources: [{ id: SRC, type: "sample", name: "Dữ liệu tồn kho", columns: [{ name: "san_pham", type: "string" }] }],
    pages: [{ id: "p1", name: "Tổng quan" }],
    calculatedFields: [
      // 1 nếu mặt hàng đang dưới mức tồn tối thiểu; cộng lại ra số mặt hàng sắp hết.
      { id: "cf-sap-het", sourceId: SRC, name: "Sắp hết hàng", expression: "IF([ton_cuoi] < [ton_toi_thieu], 1, 0)" },
    ],
    filters: [
      { id: "f-kho", sourceId: SRC, column: "kho", control: "dropdown", label: "Kho" },
      { id: "f-nhom", sourceId: SRC, column: "nhom_hang", control: "dropdown", label: "Nhóm hàng" },
    ],
    widgets: [
      titleText("Báo cáo tồn kho"),
      kpi("w-k-ton", 0, "Tổng tồn kho", sum("ton_cuoi")),
      kpi("w-k-gt", 1, "Giá trị tồn", sum("gia_tri_ton")),
      kpi("w-k-sp", 2, "Số mặt hàng", countDistinct("san_pham")),
      kpi("w-k-het", 3, "Mặt hàng sắp hết", sum("Sắp hết hàng")),
      chart("w-hbar", ...at(LAYOUT.wide), "hbar", "Tồn kho theo sản phẩm",
        [{ column: "san_pham" }], [sum("ton_cuoi")]),
      chart("w-pie", ...at(LAYOUT.side), "pie", "Giá trị tồn theo nhóm hàng",
        [{ column: "nhom_hang" }], [sum("gia_tri_ton")]),
      chart("w-kho", ...at(LAYOUT.a), "bar", "Tồn kho theo kho",
        [{ column: "kho" }], [sum("ton_cuoi")]),
      chart("w-nx", ...at(LAYOUT.b), "bar", "Nhập và xuất theo nhóm hàng",
        [{ column: "nhom_hang" }], [sum("nhap"), sum("xuat")]),
      chart("w-table", ...at(LAYOUT.c), "table", "Tồn so với mức tối thiểu",
        [{ column: "san_pham" }], [sum("ton_cuoi"), sum("ton_toi_thieu")]),
    ],
  },
  sampleRows: sampleRows(),
});
