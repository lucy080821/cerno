import type { ChartConfig } from "@dashboard/schema";

type ChartType = ChartConfig["chartType"];

/**
 * Mô tả từng loại chart: cần bao nhiêu chiều / số đo và mỗi ô dữ liệu mang ý nghĩa gì.
 * Là nguồn duy nhất cho thanh "Thêm vào canvas", ô chọn loại, bảng thiết lập dữ liệu, AI và engine.
 */
export interface ChartSpec {
  label: string;
  /** Số chiều tối thiểu / tối đa. */
  dims: [min: number, max: number];
  /** Số số đo tối thiểu / tối đa. */
  metrics: [min: number, max: number];
  /** Có trục X/Y và đường lưới (bar/line/area/scatter/heatmap...). */
  axes: boolean;
  /** Tên vai trò của từng chiều / số đo, hiện trên bảng thiết lập. */
  dimLabels: string[];
  metricLabels: string[];
  /** Gợi ý ngắn dưới phần chọn dữ liệu. */
  hint?: string;
  /** Kiểu "lát/ô": mỗi giá trị của chiều đầu là một mục có màu riêng (pie, funnel, treemap...). */
  sliceLike?: boolean;
}

export const CHART_SPECS: Record<ChartType, ChartSpec> = {
  bar: { label: "Cột", dims: [1, 2], metrics: [1, 6], axes: true, dimLabels: ["Trục X", "Tách nhóm"], metricLabels: ["Số đo"],
    hint: "Có 2 chiều: chiều thứ hai tách thành nhiều nhóm màu, chỉ dùng số đo đầu tiên." },
  hbar: { label: "Cột ngang", dims: [1, 2], metrics: [1, 6], axes: true, dimLabels: ["Trục dọc (nhóm)", "Tách nhóm"], metricLabels: ["Số đo"],
    hint: "Có 2 chiều: chiều thứ hai tách thành nhiều nhóm màu, chỉ dùng số đo đầu tiên." },
  stackedbar: { label: "Cột chồng", dims: [1, 2], metrics: [1, 6], axes: true, dimLabels: ["Trục X", "Chồng theo"], metricLabels: ["Số đo"],
    hint: "Các số đo (hoặc chiều thứ hai) được chồng lên nhau trong mỗi cột." },
  line: { label: "Đường", dims: [1, 2], metrics: [1, 6], axes: true, dimLabels: ["Trục X", "Tách nhóm"], metricLabels: ["Số đo"],
    hint: "Có 2 chiều: chiều thứ hai tách thành nhiều đường, chỉ dùng số đo đầu tiên." },
  area: { label: "Vùng", dims: [1, 2], metrics: [1, 6], axes: true, dimLabels: ["Trục X", "Tách nhóm"], metricLabels: ["Số đo"],
    hint: "Có 2 chiều: chiều thứ hai tách thành nhiều vùng, chỉ dùng số đo đầu tiên." },
  pie: { label: "Tròn", dims: [1, 1], metrics: [1, 1], axes: false, sliceLike: true, dimLabels: ["Lát"], metricLabels: ["Giá trị"] },
  funnel: { label: "Phễu", dims: [1, 1], metrics: [1, 1], axes: false, sliceLike: true, dimLabels: ["Giai đoạn"], metricLabels: ["Giá trị"],
    hint: "Các giai đoạn tự sắp từ lớn đến nhỏ." },
  treemap: { label: "Treemap", dims: [1, 2], metrics: [1, 1], axes: false, sliceLike: true, dimLabels: ["Nhóm", "Nhóm con"], metricLabels: ["Kích thước ô"],
    hint: "Diện tích ô theo số đo. Thêm chiều thứ hai để chia nhỏ mỗi nhóm." },
  scatter: { label: "Phân tán", dims: [1, 1], metrics: [2, 3], axes: true, dimLabels: ["Điểm (mỗi giá trị một chấm)"], metricLabels: ["Trục X", "Trục Y", "Kích thước bong bóng (tuỳ chọn)"],
    hint: "Số đo 1 là trục X, số đo 2 là trục Y. Thêm số đo 3 để thành biểu đồ bong bóng: giá trị càng lớn thì bong bóng càng to." },
  radar: { label: "Radar", dims: [1, 1], metrics: [3, 6], axes: false, dimLabels: ["Mỗi giá trị một vùng"], metricLabels: ["Cạnh 1", "Cạnh 2", "Cạnh 3", "Cạnh 4", "Cạnh 5", "Cạnh 6"],
    hint: "Mỗi số đo là một cạnh của radar (cần ít nhất 3)." },
  gauge: { label: "Đồng hồ", dims: [0, 0], metrics: [1, 1], axes: false, dimLabels: [], metricLabels: ["Giá trị"],
    hint: "Hiện một con số trên mặt đồng hồ. Đặt giá trị tối đa ở tab Kiểu dáng." },
  histogram: { label: "Histogram", dims: [1, 1], metrics: [0, 0], axes: true, dimLabels: ["Cột số cần chia khoảng"], metricLabels: ["Số dòng"],
    hint: "Chỉ cần một cột số: dữ liệu được chia thành các khoảng (bin) bằng nhau, mỗi cột là số dòng rơi vào khoảng đó. Chỉnh số khoảng, độ rộng và điểm bắt đầu ở tab Kiểu dáng." },
  heatmap: { label: "Bản đồ nhiệt", dims: [2, 2], metrics: [1, 1], axes: true, dimLabels: ["Trục X", "Trục Y"], metricLabels: ["Giá trị (độ đậm)"],
    hint: "Cần đúng 2 chiều: ô nào có số đo lớn thì màu đậm hơn." },
  table: { label: "Bảng", dims: [0, 3], metrics: [0, 6], axes: false, dimLabels: ["Cột nhóm"], metricLabels: ["Số đo"] },
};

/** Thứ tự hiện ở ô chọn loại / thanh thêm widget. */
export const CHART_TYPE_ORDER: ChartType[] = [
  "bar", "hbar", "stackedbar", "histogram", "line", "area", "pie", "funnel", "treemap", "scatter", "radar", "gauge", "heatmap", "table",
];

/** Loại chart đã đủ trường dữ liệu để vẽ chưa. */
export function hasEnoughFields(type: ChartType, dims: number, metrics: number): boolean {
  if (type === "table") return true;
  const s = CHART_SPECS[type];
  return dims >= s.dims[0] && metrics >= s.metrics[0];
}

/** Cắt bớt chiều/số đo thừa khi đổi sang loại chart có giới hạn nhỏ hơn. */
export function clampFields<T>(type: ChartType, dims: T[], metrics: T[]): { dims: T[]; metrics: T[] } {
  const s = CHART_SPECS[type];
  return { dims: dims.slice(0, s.dims[1]), metrics: metrics.slice(0, s.metrics[1]) };
}
