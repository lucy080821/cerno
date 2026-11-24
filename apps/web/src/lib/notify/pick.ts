/** Chọn dashboard đang quản lý ở trang Cảnh báo / Báo cáo định kỳ. Hàm thuần. */
export interface DashOption {
  id: string;
  name: string;
}

/**
 * Thứ tự ưu tiên: dashboard trên địa chỉ (?d=) → dashboard đã chọn lần trước → nếu chỉ có một dashboard thì chọn luôn → chưa chọn.
 * Id không còn tồn tại (đã xoá) thì bị bỏ qua.
 */
export function pickDashboard(list: DashOption[], fromUrl: string | null | undefined, remembered: string | null | undefined): string | null {
  const has = (id: string | null | undefined): id is string => !!id && list.some((d) => d.id === id);
  if (has(fromUrl)) return fromUrl;
  if (has(remembered)) return remembered;
  return list.length === 1 ? list[0].id : null;
}
