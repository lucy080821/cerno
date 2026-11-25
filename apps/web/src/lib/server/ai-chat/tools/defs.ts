import type { ToolDef } from "../../ai/types";
import type { SourceInfo } from "../sources";
import { SHOW_CHART_DEF, SHOW_KPI_DEF } from "../visual";

/* ------------------------------ định nghĩa công cụ ------------------------------ */

const SOURCE_PARAM = { type: "string", description: "Tên ngắn của nguồn dữ liệu (s1, s2...) trong danh sách nguồn." };

const FILTER_SCHEMA = {
  type: "array",
  description: "Điều kiện lọc dòng (AND). Cột chữ: values. Cột số: min/max. Cột ngày: from/to dạng yyyy-mm-dd (gồm cả hai đầu).",
  items: {
    type: "object",
    properties: {
      column: { type: "string" },
      values: { type: "array", items: { type: "string" }, description: "Giữ các dòng có giá trị chính xác trong danh sách." },
      min: { type: "number" },
      max: { type: "number" },
      from: { type: "string" },
      to: { type: "string" },
    },
    required: ["column"],
  },
};

export const QUERY_DATA_DEF: ToolDef = {
  type: "function",
  function: {
    name: "query_data",
    description:
      "Tính số liệu gộp từ nguồn dữ liệu: nhóm theo 0-2 cột rồi tính tổng/trung bình/đếm... Trả về bảng kết quả, TỔNG CHUNG đã tính đúng (kể cả trung bình/đếm khác biệt) và số dòng khớp. " +
      "Cột ngày phải kèm grain (day/week/month/quarter/year/weekday...). Muốn tỷ số (ví dụ doanh thu trên mỗi đơn) dùng metric dạng formula, đừng tự chia.",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        group_by: {
          type: "array",
          description: "Tối đa 2 cột nhóm. Bỏ trống = chỉ tính tổng chung.",
          items: { type: "object", properties: { column: { type: "string" }, grain: { type: "string", enum: ["day", "week", "month", "quarter", "year", "month_of_year", "weekday", "hour", "hour_of_day"] } }, required: ["column"] },
        },
        metrics: {
          type: "array",
          description: "1-5 số đo. Mỗi số đo là {column, agg} HOẶC {formula, name}. agg: sum, avg, count, min, max, count_distinct. formula ví dụ SUM([Doanh thu thực])/SUM([Số đơn]) (tên cột trong [ ]).",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              agg: { type: "string", enum: ["sum", "avg", "count", "min", "max", "count_distinct"] },
              formula: { type: "string" },
              name: { type: "string", description: "Tên hiển thị (bắt buộc với formula)." },
            },
          },
        },
        filters: FILTER_SCHEMA,
        order_by: { type: "string", description: "Tên số đo (hoặc số thứ tự 1-5) để sắp xếp; mặc định theo số đo đầu tiên. Cột ngày thì sắp theo thời gian." },
        order: { type: "string", enum: ["desc", "asc"] },
        limit: { type: "integer", description: "Số dòng tối đa trả về (1-50, mặc định 20)." },
      },
      required: ["source", "metrics"],
    },
  },
};

export const COLUMN_INFO_DEF: ToolDef = {
  type: "function",
  function: {
    name: "column_info",
    description: "Xem một cột: các giá trị khác nhau (tối đa 200), khoảng giá trị số, hoặc ngày sớm nhất/muộn nhất. Dùng trước khi lọc để biết giá trị chính xác.",
    parameters: { type: "object", properties: { source: SOURCE_PARAM, column: { type: "string" } }, required: ["source", "column"] },
  },
};

export const SAMPLE_ROWS_DEF: ToolDef = {
  type: "function",
  function: {
    name: "sample_rows",
    description: "Xem tối đa 10 dòng dữ liệu thô (sau khi lọc) để hiểu cấu trúc. Chỉ dùng khi cần, và chọn đúng các cột cần xem.",
    parameters: {
      type: "object",
      properties: { source: SOURCE_PARAM, columns: { type: "array", items: { type: "string" }, description: "Tối đa 10 cột." }, filters: FILTER_SCHEMA, limit: { type: "integer" } },
      required: ["source"],
    },
  },
};

export const PROFIT_REPORT_DEF: ToolDef = {
  type: "function",
  function: {
    name: "profit_report",
    description:
      "Báo cáo LÃI THẬT từ nguồn đơn hàng (đã trừ giá vốn, phí sàn, quảng cáo, ship shop chịu; cùng cách tính với trang Lãi lỗ). Trả tổng (đơn, doanh thu thực, các khoản chi phí, lãi, biên lãi, đơn lỗ, đơn hoàn/hủy) kèm số đơn CHƯA tính được lãi do thiếu giá vốn, và bảng chia theo nhóm. Chia được theo NGÀNH HÀNG (group_by=category): ngành do người bán chọn hoặc Cerno tự nhận diện từ tên sản phẩm, nên nguồn đơn hàng LUÔN có ngành dù không có cột \"ngành hàng\".",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        from: { type: "string", description: "Ngày bắt đầu yyyy-mm-dd (gồm cả ngày này). Bỏ trống = từ đầu." },
        to: { type: "string", description: "Ngày kết thúc yyyy-mm-dd (gồm cả ngày này). Bỏ trống = đến cuối." },
        channel: { type: "string", description: "Chỉ tính một kênh (ví dụ Shopee, TikTok Shop). Bỏ trống = mọi kênh." },
        group_by: { type: "string", enum: ["none", "channel", "product", "category", "day", "month", "loss_reason"], description: "Cách chia bảng chi tiết (mặc định none = chỉ tổng). category = theo ngành hàng." },
        category_level: { type: "integer", description: "Khi group_by=category: cấp ngành (1 = ngành lớn nhất như Thời Trang Nữ, 2, 3 = chi tiết hơn). Mặc định 1." },
        category: { type: "string", description: "Chỉ xem các sản phẩm thuộc ngành này (khớp một phần tên ngành). Chỉ áp cho bảng chi tiết; phần tổng vẫn là toàn bộ đơn." },
        sort: { type: "string", enum: ["profit_desc", "profit_asc", "revenue_desc"], description: "Sắp xếp khi chia theo product, category hoặc channel. profit_asc = lỗ nhiều nhất trước." },
        limit: { type: "integer", description: "Số dòng tối đa của bảng chi tiết (1-30, mặc định 15)." },
      },
      required: ["source"],
    },
  },
};

/** `visual`: chỉ true ở lượt người dùng đang yêu cầu hình (xem `wantsVisual`), để các lượt khác không tốn thêm token cho hai công cụ vẽ. */
export function toolDefs(sources: SourceInfo[], opts: { visual?: boolean } = {}): ToolDef[] {
  if (!sources.length) return [];
  const defs = [QUERY_DATA_DEF, COLUMN_INFO_DEF, SAMPLE_ROWS_DEF];
  if (sources.some((s) => s.kind === "orders")) defs.push(PROFIT_REPORT_DEF);
  if (opts.visual) defs.push(SHOW_CHART_DEF, SHOW_KPI_DEF);
  return defs;
}
