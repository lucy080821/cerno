/** Chuẩn hoá email để so khớp với email Google của người đăng nhập (chữ thường, bỏ khoảng trắng). Trả về null nếu sai dạng. */
export function normalizeEmail(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (s.length > 254) return null;
  // Cố ý chặt hơn RFC: một địa chỉ Gmail/Google Workspace thông thường. Không khoảng trắng, đúng một dấu @, có tên miền có dấu chấm.
  if (!/^[^\s@,;<>()"']+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}
