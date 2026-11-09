/**
 * Kích thước tối thiểu để một chart có trục danh mục vẫn đọc được (không dính nhãn, không cột mỏng như sợi chỉ).
 * Trên màn hình hẹp (điện thoại), chart cần nhiều chỗ hơn chiều rộng/cao khung thì được đặt trong vùng cuộn thay vì bóp
 * nhỏ. Hàm thuần, không phụ thuộc DOM nên web (xem trước mobile) và app mobile (WebView) dùng chung.
 */

type Axis = { type?: string; data?: unknown[] } | undefined;

/** Chỗ dành cho nhãn trục, lề, chú giải quanh vùng vẽ. */
const PAD_ACROSS = 72;
const PAD_DOWN = 64;

const categoryCount = (axis: unknown): number => {
  const a = (Array.isArray(axis) ? axis[0] : axis) as Axis;
  return a?.type === "category" && Array.isArray(a.data) ? a.data.length : 0;
};

export interface ChartMinSize {
  /** Chiều rộng tối thiểu (px), hoặc null nếu chart này không cần cuộn ngang. */
  minW: number | null;
  /** Chiều cao tối thiểu (px), hoặc null nếu chart này không cần cuộn dọc. */
  minH: number | null;
}

/** Bề rộng tối thiểu của MỘT mục trên trục ngang, tuỳ loại chart và số series cạnh nhau. */
function perCategoryAcross(chartType: string, seriesCount: number): number {
  switch (chartType) {
    case "bar": return Math.max(40, seriesCount * 16 + 12); // cột đứng cạnh nhau theo nhóm
    case "stackedbar": return 40; // cột chồng, chỉ một cột mỗi mục
    case "heatmap": return 40;
    case "line":
    case "area": return 32;
    default: return 36;
  }
}

/** Chiều cao tối thiểu của MỘT mục trên trục dọc (cột ngang, heatmap). */
function perCategoryDown(chartType: string, seriesCount: number): number {
  return chartType === "hbar" ? Math.max(28, seriesCount * 14 + 10) : 26;
}

/** Chart nào có thể cần cuộn: chỉ những loại có trục danh mục. Pie, phễu, gauge, radar, treemap, scatter thì không. */
export function chartMinSize(chartType: string, option: Record<string, unknown>): ChartMinSize {
  const series = Array.isArray(option.series) ? option.series.length : 1;
  const nx = categoryCount(option.xAxis);
  const ny = categoryCount(option.yAxis);
  return {
    minW: nx > 0 ? Math.ceil(nx * perCategoryAcross(chartType, series) + PAD_ACROSS) : null,
    minH: ny > 0 ? Math.ceil(ny * perCategoryDown(chartType, series) + PAD_DOWN) : null,
  };
}

/**
 * Phần cần cuộn của một chart trong khung `availW × availH`: kích thước vùng vẽ rộng hơn khung theo từng chiều,
 * hoặc null nếu vừa khung (dung sai vài px để không bật cuộn vì sai số làm tròn).
 */
export function chartScrollSize(
  chartType: string,
  option: Record<string, unknown>,
  availW: number,
  availH: number,
): { w: number | null; h: number | null } | null {
  const { minW, minH } = chartMinSize(chartType, option);
  const w = minW !== null && minW > availW + 6 ? minW : null;
  const h = minH !== null && minH > availH + 6 ? minH : null;
  return w === null && h === null ? null : { w, h };
}
