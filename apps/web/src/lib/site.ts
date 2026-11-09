/** Thông tin thương hiệu, đổi ở đây là cập nhật toàn site. */
export const site = {
  name: "Cerno",
  tagline: "Biến dữ liệu thành dashboard đẹp, đặt tự do như bạn muốn",
  description:
    "Kết nối Google Sheets, thiết kế dashboard kéo-thả tự do với 13 loại biểu đồ, bộ lọc và trợ lý AI. Chia sẻ bằng link hoặc nhúng vào website.",

  /**
   * Thông tin hiển thị trên Chính sách quyền riêng tư và Điều khoản. Đặt bằng biến môi trường (trước khi build),
   * nếu chưa đặt thì trang hiện dòng nhắc rõ ràng để không vô tình công bố thiếu thông tin liên hệ.
   */
  legal: {
    operator: process.env.NEXT_PUBLIC_OPERATOR_NAME || "[điền tên đơn vị vận hành: NEXT_PUBLIC_OPERATOR_NAME]",
    contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "[điền email liên hệ: NEXT_PUBLIC_CONTACT_EMAIL]",
    updated: "08/11/2026",
  },
};
