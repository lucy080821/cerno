/**
 * Địa chỉ gốc của website (không có dấu "/" cuối), dùng cho canonical, sitemap, Open Graph và dữ liệu có cấu trúc.
 * Đặt `NEXT_PUBLIC_SITE_URL` (ví dụ https://tenmien.com) TRƯỚC khi build. Chưa đặt thì dùng localhost để dev chạy được;
 * nhớ đặt khi deploy, nếu không Google sẽ thấy địa chỉ localhost trong sitemap và canonical.
 */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/**
 * Chuỗi JSON an toàn để nhúng vào thẻ <script type="application/ld+json">: thay "<" bằng dạng thoát để nội dung
 * không thể đóng thẻ script, và thoát hai ký tự ngắt dòng đặc biệt của Unicode.
 */
export function jsonLd(data: unknown): string {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(data).replace(/</g, "\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029");
}
