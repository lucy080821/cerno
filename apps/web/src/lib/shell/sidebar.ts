/** Phần thuần của thanh bên (AppShell): tên cửa hàng, chữ viết tắt, dòng kênh bán, thanh hạn mức nguồn. Có test. */

/** Hậu tố mà trigger tạo workspace cá nhân (migration 0002) gắn vào tên: "Lan Anh – cá nhân". */
const PERSONAL_SUFFIX = /\s*[–-]\s*cá nhân\s*$/i;

/** Tên hiển thị của cửa hàng: tên workspace bỏ hậu tố "– cá nhân"; không có thì dùng tên người dùng. */
export function shopName(workspaceName: string | null | undefined, userName: string): string {
  const ws = (workspaceName ?? "").replace(PERSONAL_SUFFIX, "").trim();
  return ws || userName.trim() || "Cửa hàng của bạn";
}

/** Hai chữ cái đầu (theo chữ cái đầu của từ đầu và từ cuối), viết hoa. Email thì lấy phần trước @. */
export function initialsOf(name: string): string {
  const base = name.includes("@") ? name.split("@")[0] : name;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return "C";
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? "" : [...words[0]][1] ?? "";
  return (first + last).toLocaleUpperCase("vi-VN");
}

/** Dòng kênh bán dưới tên cửa hàng: tối đa 3 kênh nhiều đơn nhất, còn lại gộp "+N". Rỗng = chưa có dữ liệu đơn hàng. */
export function channelLine(channels: { channel: string; orders: number }[]): string {
  const names = [...channels].sort((a, b) => b.orders - a.orders).map((c) => c.channel).filter((c) => c && c.trim());
  if (!names.length) return "";
  const shown = names.slice(0, 3).join(" · ");
  return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
}

/** Tỉ lệ đã dùng (0–1) cho thanh tiến độ hạn mức. */
export function usageRatio(used: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(1, used / max));
}

/** Số trên huy hiệu: ẩn khi 0, quá 99 thì "99+". */
export function badgeText(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}
