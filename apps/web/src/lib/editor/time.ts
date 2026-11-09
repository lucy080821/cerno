/** "vừa xong", "5 phút trước", "2 giờ trước", hoặc ngày giờ nếu quá 24 giờ. Chuỗi ISO không hợp lệ trả về "chưa có". */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "chưa có";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "chưa có";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 45) return "vừa xong";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  // Tự ghép chuỗi (không dùng toLocaleString) để định dạng cố định, không phụ thuộc phiên bản ICU của trình duyệt/Node.
  const d = new Date(t);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
