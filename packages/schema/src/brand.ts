/**
 * Bảng màu thương hiệu Cerno: NGUỒN DUY NHẤT cho màu logo và màu nhấn của giao diện (web và mobile).
 *
 * Các nơi không import được hằng số này (file CSS, file SVG) phải khớp giá trị ở đây; có test giữ cho chúng không lệch
 * (apps/web/src/lib/brand.test.ts). Muốn đổi màu thương hiệu: sửa ở đây, rồi sửa theo `--brand-*` ở globals.css và
 * các stop màu ở app/icon.svg, chạy test sẽ báo nếu còn chỗ sót.
 */
export const BRAND = {
  /** Nền của ô logo (xanh đen). */
  ink: "#14162b",
  /** Đầu gradient: tím xanh. Cũng là màu nhấn chính của giao diện. */
  violet: "#6d5efc",
  /** Cuối gradient: xanh ngọc. Cũng là màu chấm "đồng tử" của logo. */
  teal: "#19c3b1",
} as const;

/** Gradient của logo và nút chính (từ tím sang xanh ngọc), dạng chuỗi CSS. */
export const brandGradient = (angle = 135) => `linear-gradient(${angle}deg, ${BRAND.violet}, ${BRAND.teal})`;
