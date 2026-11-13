import { Template } from "@dashboard/schema";
import { SRC, LAYOUT, at, canvas, chart, isoDay, kpi, sum, titleText } from "./builders";

/** Mẫu "Quảng cáo Facebook". Dữ liệu mẫu tất định, KHÔNG phải số liệu thật. */
const CAMPAIGNS = ["Khuyến mãi mùa hè", "Remarketing giỏ hàng", "Ra mắt sản phẩm mới", "Thương hiệu"];
const ADSETS = ["Nữ 18-24", "Nữ 25-34", "Nam 25-34", "Tệp tương tự"];
const ADS = ["Video 15s", "Ảnh đơn", "Carousel", "Bộ sưu tập"];

function sampleRows() {
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const day = Math.floor(i / 4);
    const c = i % 4;
    const spend = 220_000 + ((i * 53) % 13) * 85_000;
    const impressions = 9_000 + ((i * 1471) % 17) * 3_100;
    const clicks = Math.round(impressions * (0.012 + ((i * 5) % 9) / 600));
    const conversions = Math.max(1, Math.round(clicks * (0.03 + ((i * 3) % 7) / 150)));
    rows.push({
      ngay: isoDay("2025-05-01", day),
      chien_dich: CAMPAIGNS[c],
      chi_phi: spend,
      hien_thi: impressions,
      nhap_chuot: clicks,
      chuyen_doi: conversions,
      doanh_thu_qc: conversions * (260_000 + ((i * 29) % 8) * 40_000),
      nhom_quang_cao: ADSETS[(i + day) % ADSETS.length],
      quang_cao: ADS[(i * 3) % ADS.length],
    });
  }
  return rows;
}

export const QUANG_CAO_FACEBOOK: Template = Template.parse({
  id: "quang-cao-facebook",
  version: 1,
  industry: "Quảng cáo",
  name: "Báo cáo quảng cáo Facebook",
  description: "Chi phí, hiển thị, nhấp chuột, chuyển đổi, CPC, CPA và ROAS theo chiến dịch và theo ngày.",
  slots: [
    { key: "ngay", label: "Ngày", type: "date", required: true,
      synonyms: ["ngày báo cáo", "bắt đầu báo cáo", "ngày bắt đầu báo cáo", "reporting starts", "day", "date"] },
    { key: "chien_dich", label: "Chiến dịch", type: "string", required: true,
      synonyms: ["tên chiến dịch", "campaign", "campaign name"] },
    { key: "chi_phi", label: "Chi phí quảng cáo", type: "number", required: true,
      synonyms: ["số tiền đã chi tiêu", "số tiền đã chi", "chi tiêu", "chi phí", "ngân sách đã dùng", "amount spent", "spend", "cost"] },
    { key: "hien_thi", label: "Lượt hiển thị", type: "number", required: false,
      synonyms: ["hiển thị", "impressions", "lượt xem quảng cáo"] },
    { key: "nhap_chuot", label: "Lượt nhấp", type: "number", required: false,
      synonyms: ["lượt click", "nhấp vào liên kết", "lượt nhấp vào liên kết", "clicks", "link clicks"] },
    { key: "chuyen_doi", label: "Lượt chuyển đổi", type: "number", required: false,
      synonyms: ["kết quả", "lượt mua", "đơn hàng", "chuyển đổi", "results", "purchases", "conversions"] },
    { key: "doanh_thu_qc", label: "Doanh thu từ quảng cáo", type: "number", required: false,
      synonyms: ["giá trị chuyển đổi mua hàng", "giá trị chuyển đổi", "doanh thu", "purchase conversion value", "conversion value", "revenue"] },
    { key: "nhom_quang_cao", label: "Nhóm quảng cáo", type: "string", required: false,
      synonyms: ["tên nhóm quảng cáo", "ad set", "ad set name", "adset"] },
    { key: "quang_cao", label: "Quảng cáo", type: "string", required: false,
      synonyms: ["tên quảng cáo", "mẫu quảng cáo", "ad", "ad name"] },
  ],
  doc: {
    schemaVersion: 1,
    id: "tpl-quang-cao-facebook",
    name: "Báo cáo quảng cáo Facebook",
    canvas,
    sources: [{ id: SRC, type: "sample", name: "Dữ liệu quảng cáo", columns: [{ name: "ngay", type: "date" }] }],
    pages: [{ id: "p1", name: "Tổng quan" }],
    // Công thức TỔNG HỢP: tính theo từng nhóm (chiến dịch, ngày...) nên ra tỉ số đúng, không phải trung bình các dòng.
    calculatedFields: [
      { id: "cf-roas", sourceId: SRC, name: "ROAS", expression: "SUM([doanh_thu_qc]) / SUM([chi_phi])" },
      { id: "cf-cpa", sourceId: SRC, name: "CPA", expression: "SUM([chi_phi]) / SUM([chuyen_doi])" },
      { id: "cf-cpc", sourceId: SRC, name: "CPC", expression: "SUM([chi_phi]) / SUM([nhap_chuot])" },
    ],
    filters: [
      { id: "f-ngay", sourceId: SRC, column: "ngay", control: "date_range", label: "Thời gian" },
      { id: "f-cd", sourceId: SRC, column: "chien_dich", control: "dropdown", label: "Chiến dịch" },
      { id: "f-nhom", sourceId: SRC, column: "nhom_quang_cao", control: "dropdown", label: "Nhóm quảng cáo" },
    ],
    widgets: [
      titleText("Báo cáo quảng cáo Facebook"),
      kpi("w-k-cp", 0, "Chi phí quảng cáo", sum("chi_phi"), { dateColumn: "ngay", goodWhen: "down" }),
      kpi("w-k-cd", 1, "Lượt chuyển đổi", sum("chuyen_doi"), { dateColumn: "ngay" }),
      kpi("w-k-cpa", 2, "CPA (chi phí / chuyển đổi)", { column: "CPA", aggregation: "sum" }, { dateColumn: "ngay", goodWhen: "down" }),
      kpi("w-k-roas", 3, "ROAS (doanh thu / chi phí)", { column: "ROAS", aggregation: "sum" }, { dateColumn: "ngay" }),
      chart("w-line", ...at(LAYOUT.wide), "line", "Chi phí theo tuần",
        [{ column: "ngay", grain: "week" }], [sum("chi_phi")]),
      chart("w-pie", ...at(LAYOUT.side), "pie", "Chuyển đổi theo chiến dịch",
        [{ column: "chien_dich" }], [sum("chuyen_doi")]),
      chart("w-bar", ...at(LAYOUT.a), "bar", "Chi phí theo chiến dịch",
        [{ column: "chien_dich" }], [sum("chi_phi")]),
      chart("w-roas", ...at(LAYOUT.b), "hbar", "ROAS theo chiến dịch",
        [{ column: "chien_dich" }], [{ column: "ROAS", aggregation: "sum" }]),
      chart("w-table", ...at(LAYOUT.c), "table", "Hiệu quả theo chiến dịch",
        [{ column: "chien_dich" }], [sum("chi_phi"), sum("chuyen_doi"), { column: "CPA", aggregation: "sum" }]),
    ],
  },
  sampleRows: sampleRows(),
});
