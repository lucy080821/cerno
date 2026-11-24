import { normalizeText } from "@dashboard/schema";
import { VISUAL_CHART_TYPES } from "@/lib/ai-chat/visual";
import type { ToolDef } from "../ai/types";

/**
 * Biểu đồ và thẻ KPI ngay trong khung chat, CHỈ KHI người dùng yêu cầu (để tiết kiệm token): định nghĩa công cụ + lời nhắc
 * (~700 token) chỉ được gửi cho model ở lượt mà câu hỏi có ý muốn xem hình. Các lượt phân tích thường không tốn thêm gì.
 */

/** Cụm từ muốn xem hình, so trên chữ đã bỏ dấu, hạ chữ thường, tách từ bằng một dấu cách (nên so nguyên cụm giữa hai dấu cách). */
const VISUAL_WORDS = [
  "bieu do", "do thi", "chart", "charts", "graph", "graphs", "plot", "kpi", "the kpi", "the so lieu", "truc quan", "visual", "visualize", "visualise",
  "dang cot", "dang duong", "dang tron", "cot ngang", "hinh tron", "hinh cot", "infographic",
];

/**
 * Câu hỏi này có đòi hình ảnh (biểu đồ / thẻ KPI) không? Chỉ xét câu hỏi hiện tại, không xét lịch sử.
 * "vẽ" phải xét trên chữ CÒN DẤU: bỏ dấu thì "vẽ" trùng "về" ("nói về doanh thu") và câu phân tích thường sẽ bị tính nhầm là đòi hình.
 */
export function wantsVisual(question: string): boolean {
  const t = ` ${normalizeText(question)} `;
  if (VISUAL_WORDS.some((w) => t.includes(` ${w} `))) return true;
  const raw = ` ${question.toLowerCase().normalize("NFC").replace(/[.,!?;:()"]/g, " ")} `;
  return /\svẽ\s/.test(raw) || /\s(draw|sketch)\s/.test(raw);
}

const SOURCE_PARAM = { type: "string", description: "Tên ngắn của nguồn dữ liệu (s1, s2...) trong danh sách nguồn." };
const METRICS = {
  type: "array",
  description: "Số đo, mỗi số đo là {column, agg} HOẶC {formula, name}. agg: sum, avg, count, min, max, count_distinct. formula ví dụ SUM([Doanh thu thực])/SUM([Số đơn]).",
  items: {
    type: "object",
    properties: {
      column: { type: "string" },
      agg: { type: "string", enum: ["sum", "avg", "count", "min", "max", "count_distinct"] },
      formula: { type: "string" },
      name: { type: "string", description: "Tên hiển thị (bắt buộc với formula, nên đặt cả khi dùng column)." },
    },
  },
};
const FILTERS = {
  type: "array",
  description: "Điều kiện lọc (AND). Cột chữ: values. Cột số: min/max. Cột ngày: from/to dạng yyyy-mm-dd.",
  items: { type: "object", properties: { column: { type: "string" }, values: { type: "array", items: { type: "string" } }, min: { type: "number" }, max: { type: "number" }, from: { type: "string" }, to: { type: "string" } }, required: ["column"] },
};

export const SHOW_CHART_DEF: ToolDef = {
  type: "function",
  function: {
    name: "show_chart",
    description:
      "Vẽ biểu đồ NGAY trong khung chat cho người dùng (chỉ khi họ yêu cầu). Tự tính số liệu như query_data. Theo thời gian: group_by cột ngày kèm grain, chart_type line hoặc bar. " +
      "So sánh các nhóm: bar hoặc hbar. Tỷ trọng: pie (tối đa 8 nhóm). Nhiều số đo chung một biểu đồ chỉ nên cùng đơn vị.",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        chart_type: { type: "string", enum: [...VISUAL_CHART_TYPES] },
        title: { type: "string", description: "Tiêu đề ngắn, nêu đúng nội dung biểu đồ." },
        group_by: {
          type: "array",
          description: "1-2 cột nhóm (cột thứ hai tách thành nhiều đường/cột).",
          items: { type: "object", properties: { column: { type: "string" }, grain: { type: "string", enum: ["day", "week", "month", "quarter", "year", "month_of_year", "weekday", "hour", "hour_of_day"] } }, required: ["column"] },
        },
        metrics: METRICS,
        filters: FILTERS,
        order_by: { type: "string" },
        order: { type: "string", enum: ["desc", "asc"] },
        limit: { type: "integer", description: "Số nhóm tối đa (1-20, mặc định 12)." },
      },
      required: ["source", "chart_type", "group_by", "metrics"],
    },
  },
};

export const SHOW_KPI_DEF: ToolDef = {
  type: "function",
  function: {
    name: "show_kpi",
    description: "Hiện 1-4 thẻ KPI (mỗi thẻ là một con số lớn kèm nhãn) NGAY trong khung chat, chỉ khi người dùng yêu cầu. Số liệu tính trên toàn bộ dòng khớp bộ lọc (không nhóm).",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        title: { type: "string", description: "Tiêu đề chung của nhóm thẻ (tuỳ chọn), ví dụ phạm vi thời gian." },
        metrics: METRICS,
        filters: FILTERS,
      },
      required: ["source", "metrics"],
    },
  },
};

export const VISUAL_TOOL_NAMES = new Set(["show_chart", "show_kpi"]);

/** Chỉ ghép vào lời nhắc khi người dùng đang yêu cầu hình ảnh. */
export const VISUAL_RULES = `BIỂU ĐỒ VÀ THẺ KPI (người dùng đang muốn xem hình)
- Dùng show_chart để vẽ biểu đồ và show_kpi để hiện thẻ số liệu NGAY trong khung chat. Chỉ vẽ đúng thứ họ nhờ, tối đa 3 hình; không tự thêm hình khác.
- Cần tra thêm thì dùng query_data trước, nhưng nếu show_chart/show_kpi đã đủ thì gọi thẳng. Tham số giống query_data.
- Hình đã hiện cho người dùng, kết quả công cụ chỉ để bạn nhận xét: ĐỪNG liệt kê lại cả bảng số liệu. Khi họ chỉ nhờ vẽ hình, bỏ cấu trúc báo cáo đầy đủ: viết 2 đến 4 câu chữ thuần nêu điều đáng chú ý nhất kèm con số, và phạm vi (nguồn, khoảng ngày). Họ còn hỏi phân tích thì viết thêm như bình thường.
- Công cụ báo LỖI thì sửa tham số rồi gọi lại. Không vẽ được thì nói lý do ngắn gọn.`;
