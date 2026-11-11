import { CHART_TYPE_ORDER } from "@dashboard/chart-engine";

/** Mô tả công cụ gửi cho model (định dạng function calling của OpenAI/Groq). Phải khớp với TOOL_SCHEMAS trong ai-actions.ts. */

const CHART_TYPES: string[] = [...CHART_TYPE_ORDER];
export const CHART_GUIDE =
  "Loại chart và cách điền: bar/hbar/stackedbar/line/area = 1-2 dimension + 1-6 metric (hbar là cột ngang, stackedbar là cột chồng); " +
  "pie/funnel = đúng 1 dimension + 1 metric; treemap = 1-2 dimension + 1 metric; " +
  "scatter = 1 dimension (mỗi giá trị một chấm) + 2-3 metric (X, Y, kích thước bong bóng); radar = 1 dimension + 3-6 metric (mỗi metric một cạnh); " +
  "gauge = KHÔNG dimension + 1 metric; heatmap = đúng 2 dimension + 1 metric; histogram = 1 dimension là CỘT SỐ + 1 metric count (chia khoảng, đếm số dòng); table = tuỳ ý.";

const binding = {
  type: "object",
  properties: {
    column: { type: "string", description: "Tên cột (cột số, trừ khi dùng count/count_distinct)" },
    aggregation: { type: "string", enum: ["sum", "avg", "count", "min", "max", "count_distinct"], description: "Mặc định sum" },
  },
  required: ["column"],
};

/** Kiểu chữ: lược đồ gọn (mô tả các trường ở `format`); ChartFormat của zod vẫn kiểm tra chặt. */
const textStyle = { type: "object" };

const geometry = {
  x: { type: "number" },
  y: { type: "number" },
  w: { type: "number" },
  h: { type: "number" },
};

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required } },
});

export const TOOL_DEFS = [
  fn(
    "add_widget",
    "Thêm biểu đồ/bảng/KPI/văn bản vào dashboard. x,y,w,h là px; không nêu x,y thì tự đặt bên dưới.",
    {
      kind: { type: "string", enum: [...CHART_TYPES, "kpi", "text"] },
      title: { type: "string" },
      dimensions: { type: "array", items: { type: "string" }, description: "Cột nhóm (trục X)" },
      metrics: { type: "array", items: binding },
      text: { type: "string", description: "Chỉ cho kind=text" },
      ...geometry,
    },
    ["kind"],
  ),
  fn(
    "update_widget",
    "Sửa widget theo id: dữ liệu, loại chart, tiêu đề, định dạng, vị trí, khung.",
    {
      id: { type: "string", description: "id của widget (lấy từ dữ liệu dashboard)" },
      title: { type: "string" },
      chartType: { type: "string", enum: CHART_TYPES },
      dimensions: { type: "array", items: { type: "string" } },
      metrics: { type: "array", items: binding },
      text: { type: "string" },
      fontSize: { type: "number" },
      bold: { type: "boolean" },
      ...geometry,
      background: { type: "string", description: "#rrggbb" },
      radius: { type: "number" },
      border: { type: "boolean" },
      borderWidth: { type: "number" },
      borderColor: { type: "string", description: "#rrggbb" },
      hidden: { type: "boolean" },
      format: {
        type: "object",
        description: "Định dạng chart. title/axis/dataLabel/legend là kiểu chữ: {fontFamily, fontSize, bold, italic, underline (chỉ title), color #rrggbb}.",
        properties: {
          showXAxis: { type: "boolean" },
          showYAxis: { type: "boolean" },
          showGrid: { type: "boolean" },
          showDataLabels: { type: "boolean" },
          showLegend: { type: "boolean" },
          barWidth: { type: "number", description: "px, chart cột" },
          gaugeMax: { type: "number", description: "chart gauge" },
          trendline: { type: "string", enum: ["none", "linear", "movingAverage"], description: "Đường xu hướng: linear = hồi quy tuyến tính; movingAverage = trung bình trượt (không dùng cho scatter)" },
          trendWindow: { type: "number", description: "Số điểm của trung bình trượt (2-60)" },
          forecast: {
            type: "object",
            description: "Bật dự báo cho chart line/area (chiều đầu phải là ngày có grain day/week/month/quarter/year). {} = mặc định 6 kỳ",
            properties: { periods: { type: "number" }, method: { type: "string", enum: ["auto", "trend", "seasonal"] }, level: { type: "number", enum: [0.8, 0.9, 0.95] }, showBand: { type: "boolean" } },
          },
          xAxisTitle: { type: "string", description: "Tên trục ngang (X). Chuỗi rỗng = ẩn tên." },
          yAxisTitle: { type: "string", description: "Tên trục dọc (Y). Chuỗi rỗng = ẩn tên." },
          colors: {
            type: "object",
            description: "Màu từng series/lát theo tên: {\"Tên\": \"#rrggbb\"}",
            additionalProperties: { type: "string" },
          },
          title: textStyle,
          axis: textStyle,
          dataLabel: textStyle,
          legend: textStyle,
        },
      },
    },
    ["id"],
  ),
  fn("delete_widget", "Xoá một widget theo id. Chỉ làm khi người dùng yêu cầu xoá rõ ràng.", { id: { type: "string" } }, ["id"]),
  fn(
    "add_filter",
    "Thêm bộ lọc theo cột (mặc định: số→slider, ngày→date_range, còn lại→multiselect).",
    {
      column: { type: "string" },
      control: { type: "string", enum: ["dropdown", "multiselect", "slider", "date_range"] },
      label: { type: "string" },
    },
    ["column"],
  ),
  fn("remove_filter", "Xoá bộ lọc theo id hoặc theo tên cột.", { id: { type: "string" }, column: { type: "string" } }),
  fn(
    "set_filter_value",
    "Đặt giá trị lọc cho cả dashboard (tự tạo bộ lọc nếu chưa có): values cho cột chữ, min/max cho số, from/to yyyy-mm-dd cho ngày, clear=true để bỏ lọc.",
    {
      column: { type: "string" },
      values: { type: "array", items: { type: "string" } },
      min: { type: "number" },
      max: { type: "number" },
      from: { type: "string", description: "yyyy-mm-dd" },
      to: { type: "string", description: "yyyy-mm-dd" },
      clear: { type: "boolean" },
    },
    ["column"],
  ),
  fn("update_dashboard", "Sửa thiết lập chung: tên, cỡ trang, màu nền, chủ đề chart.", {
    name: { type: "string" },
    width: { type: "number" },
    height: { type: "number" },
    background: { type: "string", description: "#rrggbb" },
    themeMode: { type: "string", enum: ["light", "dark"] },
  }),
];

/**
 * Vẽ biểu đồ NGAY TRONG KHUNG CHAT (không đụng tới dashboard). Luôn được gửi cho model, kể cả khi tắt "Cho phép AI sửa
 * dashboard", vì nó chỉ đọc dữ liệu. Phải khớp với ShowChartSchema trong ai-chart.ts.
 */
export const SHOW_CHART_DEF = fn(
  "show_chart",
  "Vẽ biểu đồ ngay trong khung chat (không sửa dashboard); người dùng có nút \"Thêm vào dashboard\". Dùng khi họ muốn XEM/VẼ biểu đồ.",
  {
    chartType: { type: "string", enum: CHART_TYPES.filter((t) => t !== "table") },
    title: { type: "string" },
    dimensions: { type: "array", items: { type: "string" }, description: "Cột hoặc trường tính toán để nhóm" },
    metrics: { type: "array", items: binding },
    calculated_fields: {
      type: "array",
      description: "Trường tính toán TẠM (tối đa 3), ví dụ {name:\"Tháng đăng\", expression:\"YEAR_MONTH([Ngày đăng])\"}.",
      items: {
        type: "object",
        properties: { name: { type: "string" }, expression: { type: "string" } },
        required: ["name", "expression"],
      },
    },
  },
  ["chartType", "metrics"],
);
