import { z } from "zod";

/** Phiên bản schema, tăng khi thay đổi không tương thích để migrate dashboard cũ. */
export const SCHEMA_VERSION = 1;

export const ChartType = z.enum([
  "bar", "line", "area", "pie", "scatter", "table", "gauge", "heatmap",
  "hbar", "stackedbar", "treemap", "funnel", "radar", "histogram",
]);

export const Aggregation = z.enum(["sum", "avg", "count", "min", "max", "count_distinct"]);

/** Một field kéo vào chart: dimension (nhóm theo) hoặc metric (tính toán). */
export const FieldBinding = z.object({
  column: z.string(),
  aggregation: Aggregation.optional(),
  label: z.string().optional(),
  /** Chỉ dimension số: gom giá trị vào `bins` khoảng bằng nhau (histogram). Do engine đặt, không phải người dùng. */
  bins: z.number().int().min(2).max(100).optional(),
  /** Như `bins` nhưng chỉ định độ rộng mỗi khoảng (ưu tiên hơn `bins`), và cận dưới khoảng đầu tiên. */
  binWidth: z.number().positive().optional(),
  binStart: z.number().optional(),
});

/** Kiểu chữ dùng cho tiêu đề, trục, nhãn dữ liệu. Trường nào bỏ trống thì dùng mặc định của theme. */
export const TextStyle = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().min(6).max(96).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: z.string().optional(),
});

/**
 * Định dạng chart. Mọi trường đều tuỳ chọn nên dashboard cũ vẫn hợp lệ (không cần đổi SCHEMA_VERSION).
 * Mặc định: hiện trục, đường lưới, chú giải; nhãn dữ liệu tắt (riêng biểu đồ tròn mặc định bật).
 */
export const ChartFormat = z.object({
  title: TextStyle.optional(),
  axis: TextStyle.optional(),
  dataLabel: TextStyle.optional(),
  legend: TextStyle.optional(),
  showXAxis: z.boolean().optional(),
  showYAxis: z.boolean().optional(),
  showDataLabels: z.boolean().optional(),
  showGrid: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  /**
   * Màu riêng cho từng series (cột/đường/vùng) hoặc từng lát (biểu đồ tròn), khoá theo TÊN series/lát.
   * Tên nào không có thì dùng màu theo thứ tự trong palette của theme.
   */
  colors: z.record(z.string(), z.string()).optional(),
  /** Độ rộng cột (px) của biểu đồ cột. Bỏ trống = tự động (tối đa 36px). */
  barWidth: z.number().min(2).max(200).optional(),
  /**
   * Tên hiển thị của trục ngang (X) và trục dọc (Y). Bỏ trống (không đặt) = mặc định (phân tán: tên số đo; loại khác:
   * không có tên). Chuỗi rỗng "" = ẩn tên.
   */
  /** Phân tán: đường kính bong bóng nhỏ nhất / lớn nhất (px) khi có số đo thứ 3, và cỡ chấm cố định khi không có. */
  /**
   * Đường xu hướng: "linear" = đường thẳng hồi quy, "movingAverage" = trung bình trượt `trendWindow` điểm (không dùng cho phân tán).
   * `showTrendInfo`: hiện phương trình và R² (chỉ phân tán với đường thẳng).
   */
  trendline: z.enum(["none", "linear", "movingAverage"]).optional(),
  trendWindow: z.number().int().min(2).max(60).optional(),
  showTrendInfo: z.boolean().optional(),
  bubbleMin: z.number().min(3).max(60).optional(),
  bubbleMax: z.number().min(6).max(140).optional(),
  pointSize: z.number().min(3).max(60).optional(),
  xAxisTitle: z.string().max(80).optional(),
  yAxisTitle: z.string().max(80).optional(),
  /** Đồng hồ (gauge): giá trị tối đa của mặt đồng hồ. Bỏ trống = tự chọn số tròn lớn hơn giá trị. */
  gaugeMax: z.number().positive().optional(),
  /** Histogram: số khoảng (cột). Bỏ trống = 10 (tối đa; bước được làm tròn đẹp). */
  histBins: z.number().int().min(2).max(100).optional(),
  /** Histogram: độ rộng mỗi khoảng (ưu tiên hơn histBins) và cận dưới khoảng đầu tiên. */
  histBinWidth: z.number().positive().optional(),
  histBinStart: z.number().optional(),
  /** Bảng: kiểu chữ của hàng tiêu đề cột và của các ô dữ liệu. */
  tableHeader: TextStyle.optional(),
  tableCell: TextStyle.optional(),
  /** Căn lề tiêu đề của chart/bảng. Bỏ trống = căn trái. */
  titleAlign: z.enum(["left", "center", "right"]).optional(),
  /** Căn lề chữ trong bảng (cả hàng tiêu đề và ô). Bỏ trống = tự động: số căn phải, chữ căn trái. */
  tableAlign: z.enum(["left", "center", "right"]).optional(),
});

export const ChartConfig = z.object({
  kind: z.literal("chart"),
  chartType: ChartType,
  sourceId: z.string(),
  dimensions: z.array(FieldBinding).default([]),
  metrics: z.array(FieldBinding).default([]),
  title: z.string().optional(),
  format: ChartFormat.optional(),
  /** Override tuỳ chọn cho option ECharts (người dùng nâng cao). */
  echartsOverride: z.record(z.unknown()).optional(),
});

export const TextConfig = z.object({
  kind: z.literal("text"),
  text: z.string(),
  fontSize: z.number().default(16),
  color: z.string().optional(),
  bold: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("left"),
  fontFamily: z.string().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
});

export const ImageConfig = z.object({
  kind: z.literal("image"),
  url: z.string(),
  fit: z.enum(["cover", "contain"]).default("contain"),
});

/** Kiểu chữ của số KPI: cỡ chữ cho phép lớn hơn (tới 300px) vì KPI thường là con số to. */
const KpiValueStyle = TextStyle.extend({ fontSize: z.number().min(6).max(300).optional() });

export const KpiConfig = z.object({
  kind: z.literal("kpi"),
  sourceId: z.string(),
  metric: FieldBinding,
  title: z.string().optional(),
  compareToPrevious: z.boolean().default(false),
  /** Kiểu chữ của dòng tiêu đề và của con số. Bỏ trống = tự theo chủ đề và kích thước widget. */
  titleStyle: TextStyle.optional(),
  valueStyle: KpiValueStyle.optional(),
  /** Căn lề tiêu đề và con số. Bỏ trống = căn trái. */
  align: z.enum(["left", "center", "right"]).optional(),
});

export const WidgetConfig = z.discriminatedUnion("kind", [
  ChartConfig, TextConfig, ImageConfig, KpiConfig,
]);

/**
 * Một trang của dashboard. Dashboard không khai báo trang nào (`pages` rỗng) được hiểu là có đúng một trang
 * mặc định (xem `getPages` trong pages.ts), nên dashboard cũ vẫn hợp lệ, không cần migrate.
 * Mọi trang dùng chung kích thước canvas, bộ lọc, nguồn dữ liệu và chủ đề của dashboard.
 */
export const Page = z.object({
  id: z.string(),
  name: z.string().max(80),
  /** Màu nền riêng của trang. Bỏ trống = theo `canvas.background`. */
  background: z.string().optional(),
  /** Icon hiện ở thanh trang (khoá trong bộ icon của web). Bỏ trống/khoá lạ = icon trang mặc định. */
  icon: z.string().max(32).optional(),
});

/** Thanh danh sách trang (điều hướng) hiện bên trái khi xem / chiếu toàn màn hình, và kiểu chuyển trang. */
export const PageNav = z.object({
  show: z.boolean().default(true),
  width: z.number().min(120).max(360).default(200),
  background: z.string().default("#0f172a"),
  textColor: z.string().default("#cbd5e1"),
  activeColor: z.string().default("#ffffff"),
  activeBackground: z.string().default("#2563eb"),
  fontSize: z.number().min(10).max(24).default(14),
  bold: z.boolean().default(false),
  radius: z.number().min(0).max(24).default(8),
  /** Hiện tên dashboard ở đầu thanh. */
  showTitle: z.boolean().default(true),
  transition: z.enum([
    "none", "fade", "slide", "slideUp", "zoomIn", "zoomOut", "flip", "flipX",
    "rotate", "blur", "wipe", "drop", "cube", "bounce",
  ]).default("slide"),
});

/** Widget đặt TỰ DO trên canvas: toạ độ tuyệt đối, không dùng lưới. */
export const Widget = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.number().default(0),
  z: z.number().int().default(0),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  groupId: z.string().optional(),
  /** Widget thuộc trang nào. Bỏ trống hoặc không khớp trang nào = trang đầu tiên. */
  pageId: z.string().optional(),
  /** Khung của widget. Bỏ trống = trong suốt, không viền. */
  style: z
    .object({
      background: z.string().optional(),
      radius: z.number().min(0).default(12),
      border: z.boolean().default(false),
      /** Độ dày viền (px) khi `border` bật. Bỏ trống = 1. */
      borderWidth: z.number().min(0).max(20).optional(),
      /** Màu viền. Bỏ trống = màu nhạt theo chủ đề sáng/tối. */
      borderColor: z.string().optional(),
    })
    .optional(),
  /** Tuỳ chọn để người dùng chỉnh layout mobile sau này; mặc định tự sinh. */
  mobile: z
    .object({
      order: z.number().optional(),
      hidden: z.boolean().optional(),
      height: z.number().positive().optional(),
    })
    .optional(),
  config: WidgetConfig,
});

export const Filter = z.object({
  id: z.string(),
  sourceId: z.string(),
  column: z.string(),
  /** dropdown: chọn 1 giá trị; multiselect: chọn nhiều; slider: khoảng số (từ–đến). date_range chưa có UI. */
  control: z.enum(["dropdown", "multiselect", "date_range", "slider"]),
  label: z.string().optional(),
  /** Chỉ áp cho các widget này. Bỏ trống = áp cho mọi widget có cột đó. */
  targets: z.array(z.string()).optional(),
});

const Column = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "date", "boolean"]),
  /** Đơn vị tính (đồng, đơn, lượt, %...). Bỏ trống thì AI tự suy ra từ tên cột. */
  unit: z.string().optional(),
});

export const GoogleSheetsSource = z.object({
  id: z.string(),
  type: z.literal("google_sheets"),
  spreadsheetId: z.string(),
  sheetName: z.string(),
  /** Kiểu cột đã nhận diện/sửa tay. */
  columns: z.array(Column),
});

/** Dữ liệu mẫu có sẵn trong app, dùng để thử editor khi chưa nối nguồn thật. */
export const SampleSource = z.object({
  id: z.string(),
  type: z.literal("sample"),
  name: z.string(),
  columns: z.array(Column),
});

export const DataSource = z.discriminatedUnion("type", [GoogleSheetsSource, SampleSource]);

/**
 * Trường tính toán: cột mới tạo từ công thức trên các cột của một nguồn dữ liệu (xem chart-engine/formula.ts).
 * Công thức có SUM/AVG/... thì chỉ dùng làm số đo; không có thì dùng như một cột thường.
 */
export const CalculatedField = z.object({
  id: z.string(),
  sourceId: z.string(),
  name: z.string().min(1).max(80),
  expression: z.string().max(1000),
});

export const Dashboard = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  canvas: z.object({
    width: z.number().positive().default(1440),
    height: z.number().positive().default(900),
    background: z.string().default("#ffffff"),
  }),
  theme: z
    .object({
      palette: z.array(z.string()).default([]),
      fontFamily: z.string().optional(),
      mode: z.enum(["light", "dark"]).default("light"),
    })
    .default({}),
  sources: z.array(DataSource).default([]),
  filters: z.array(Filter).default([]),
  /** Trường tính toán (tối đa 50). Dashboard cũ không có thì coi là rỗng, không cần đổi SCHEMA_VERSION. */
  calculatedFields: z.array(CalculatedField).max(50).default([]),
  /** Danh sách trang theo thứ tự hiển thị. Rỗng = một trang mặc định. */
  pages: z.array(Page).max(20).default([]),
  nav: PageNav.default({}),
  widgets: z.array(Widget).default([]),
});

export type Dashboard = z.infer<typeof Dashboard>;
export type Page = z.infer<typeof Page>;
export type PageNav = z.infer<typeof PageNav>;
export type Widget = z.infer<typeof Widget>;
export type WidgetConfig = z.infer<typeof WidgetConfig>;
export type DataSource = z.infer<typeof DataSource>;
export type Filter = z.infer<typeof Filter>;
export type CalculatedField = z.infer<typeof CalculatedField>;
export type FieldBinding = z.infer<typeof FieldBinding>;
export type ChartConfig = z.infer<typeof ChartConfig>;
export type TextStyle = z.infer<typeof TextStyle>;
export type ChartFormat = z.infer<typeof ChartFormat>;
export type ChartType = z.infer<typeof ChartType>;
export type Aggregation = z.infer<typeof Aggregation>;
