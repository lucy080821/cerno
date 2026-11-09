import type { ChartFormat, Dashboard, TextStyle, Widget } from "./dashboard";
import { widgetsOnPage } from "./pages";

export interface MobileItem {
  widgetId: string;
  /** Chiều cao (px) khi widget chiếm trọn chiều ngang màn hình. */
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Tự sinh layout mobile từ layout tự do trên web: một cột, đọc theo thứ tự
 * trên→dưới, trái→phải. Các widget có vị trí dọc chồng nhau (cùng "hàng") được
 * xếp theo x. Người dùng có thể ghi đè bằng widget.mobile.{order,hidden,height}.
 * Dashboard nhiều trang: truyền `pageId` để lấy layout của một trang (app mobile hiện mỗi trang một tab).
 */
export function deriveMobileLayout(dashboard: Dashboard, screenWidth = 390, pageId?: string): MobileItem[] {
  const scoped = pageId ? widgetsOnPage(dashboard, pageId) : dashboard.widgets;
  const visible = scoped.filter((w) => !w.hidden && !w.mobile?.hidden);
  const sorted = [...visible].sort(compareReadingOrder);

  // Widget có order thủ công đứng trước; còn lại giữ thứ tự đọc tự nhiên.
  const manual = sorted
    .filter((w) => w.mobile?.order !== undefined)
    .sort((a, b) => a.mobile!.order! - b.mobile!.order!);
  const auto = sorted.filter((w) => w.mobile?.order === undefined);

  return [...manual, ...auto].map((w) => ({
    widgetId: w.id,
    height: w.mobile?.height ?? autoHeight(w, screenWidth),
  }));
}

/**
 * Cỡ chữ trên mobile. Chữ thiết kế cho canvas rộng (vd tiêu đề 56px trên khung 700px) sẽ tràn màn hình hẹp,
 * nên thu theo tỉ lệ bề ngang rồi kẹp trong [14, 30]px: đủ đọc, không quá to.
 */
export function mobileFontSize(fontSize: number, designWidth: number, screenWidth: number): number {
  const k = Math.min(1, screenWidth / Math.max(1, designWidth));
  return Math.round(clamp(fontSize * k, 14, 30));
}

/**
 * Chữ của biểu đồ/bảng trên mobile: cỡ người dùng đặt cho desktop (vd tiêu đề 40px) sẽ nuốt hết thẻ nhỏ,
 * nên kẹp trần: tiêu đề 16px, trục/nhãn/chú giải 11px, bảng 12px. Chỉ hạ cỡ, không nâng cỡ nhỏ hơn lên.
 */
export function mobileChartFormat(f?: ChartFormat): ChartFormat | undefined {
  if (!f) return f;
  const cap = (st: TextStyle | undefined, max: number) =>
    st?.fontSize && st.fontSize > max ? { ...st, fontSize: max } : st;
  return {
    ...f,
    title: cap(f.title, 16),
    axis: cap(f.axis, 11),
    dataLabel: cap(f.dataLabel, 11),
    legend: cap(f.legend, 11),
    tableHeader: cap(f.tableHeader, 12),
    tableCell: cap(f.tableCell, 12),
  };
}

/** Con số KPI trên mobile: tự theo chiều cao thẻ (26–40px), cỡ người dùng đặt chỉ được nhỏ hơn mức đó. */
export function mobileKpiValueSize(height: number, custom?: number): number {
  const auto = Math.round(clamp(height * 0.4, 26, 40));
  return custom ? Math.min(custom, auto) : auto;
}

/** Tiêu đề KPI trên mobile: tối đa 14px. */
export function mobileKpiTitleSize(custom?: number): number {
  return Math.min(custom ?? 13, 14);
}

/** Chiều cao tự động theo loại widget: gọn và dễ đọc trên màn hình hẹp. */
function autoHeight(w: Widget, screenWidth: number): number {
  const c = w.config;
  if (c.kind === "text") {
    // Ước lượng số dòng sau khi chữ xuống dòng theo bề ngang màn hình (trung bình 0,55 lần cỡ chữ cho mỗi ký tự).
    const size = mobileFontSize(c.fontSize, w.w, screenWidth);
    const perLine = Math.max(8, Math.floor((screenWidth - 12) / (size * 0.55)));
    const lines = c.text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
    return Math.round(clamp(lines * size * 1.3 + 12, 32, 420));
  }
  // KPI: thẻ gọn (tiêu đề nhỏ + con số), không kéo cao theo bề ngang.
  if (c.kind === "kpi") return Math.round(clamp(w.h, 84, 104));
  // Ảnh/logo: giữ tỉ lệ nhưng không phóng to quá kích thước thiết kế (logo nhỏ không bị kéo thành cả màn hình).
  if (c.kind === "image") return Math.round(clamp(Math.min(screenWidth * (w.h / w.w), w.h), 80, 240));
  const byAspect = screenWidth * (w.h / w.w);
  return Math.round(clamp(byAspect, 200, 420));
}

function compareReadingOrder(a: Widget, b: Widget): number {
  // Cùng hàng nếu tâm dọc của cái này nằm trong khoảng dọc của cái kia.
  const aMid = a.y + a.h / 2;
  const bMid = b.y + b.h / 2;
  const sameRow = aMid >= b.y && aMid <= b.y + b.h && bMid >= a.y && bMid <= a.y + a.h;
  return sameRow ? a.x - b.x : a.y - b.y;
}
