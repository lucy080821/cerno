/**
 * Xuất từng trang của dashboard ra ảnh. Phần thuần (tính khung ảnh, tên file) ở đầu file và có test;
 * phần vẽ (DOM + html-to-image) nằm trong `ExportDialog.tsx`, chỗ gọi `rasterize`.
 */

export type ImageFormat = "png" | "jpeg" | "webp" | "svg";
export type Orientation = "landscape" | "portrait";

export const FORMATS: Array<{ value: ImageFormat; label: string; ext: string; mime: string }> = [
  { value: "png", label: "PNG (nét, nền đầy đủ)", ext: "png", mime: "image/png" },
  { value: "jpeg", label: "JPEG (nhẹ, không trong suốt)", ext: "jpg", mime: "image/jpeg" },
  { value: "webp", label: "WebP (nhẹ, hiện đại)", ext: "webp", mime: "image/webp" },
  { value: "svg", label: "SVG (phóng to không vỡ)", ext: "svg", mime: "image/svg+xml" },
];

/** Cạnh dài nhất của ảnh (px) để không vượt giới hạn canvas của trình duyệt. */
export const MAX_SIDE = 8192;

export const orientationOf = (w: number, h: number): Orientation => (h > w ? "portrait" : "landscape");

export interface SheetPlan {
  /** Kích thước ảnh cuối (px, chưa nhân độ nét). */
  width: number;
  height: number;
  /** Vị trí và cỡ của trang bên trong ảnh. */
  x: number;
  y: number;
  pageW: number;
  pageH: number;
  /** Trang không đổi hướng thì ảnh đúng bằng trang (không viền thừa). */
  exact: boolean;
}

/**
 * Khung ảnh: cùng hướng với trang thì ảnh CHÍNH LÀ kích thước trang. Khác hướng thì ảnh có kích thước đổi
 * chỗ rộng/cao, trang được thu vừa khung và đặt giữa (phần dư tô màu nền của trang).
 */
export function planSheet(pageW: number, pageH: number, want: Orientation): SheetPlan {
  if (orientationOf(pageW, pageH) === want || pageW === pageH) {
    return { width: pageW, height: pageH, x: 0, y: 0, pageW, pageH, exact: true };
  }
  const width = pageH;
  const height = pageW;
  const k = Math.min(width / pageW, height / pageH);
  const w = pageW * k;
  const h = pageH * k;
  return { width, height, x: (width - w) / 2, y: (height - h) / 2, pageW: w, pageH: h, exact: false };
}

/** Độ nét (số lần phóng) cho phép: giảm xuống nếu ảnh sẽ quá lớn. */
export function clampScale(scale: number, width: number, height: number): number {
  const max = MAX_SIDE / Math.max(width, height, 1);
  return Math.max(0.1, Math.min(scale, max));
}

/** Tên file an toàn trên Windows/macOS: bỏ ký tự cấm, giữ chữ có dấu. */
export function exportFileName(dashboard: string, page: string, index: number, total: number, ext: string): string {
  const clean = (t: string) =>
    t.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const base = clean(dashboard) || "dashboard";
  if (total <= 1) return `${base}.${ext}`;
  const p = clean(page) || `Trang ${index + 1}`;
  return `${base} - ${String(index + 1).padStart(2, "0")} ${p}.${ext}`;
}
