import type { DateRange } from "@/lib/profit/period";
import { activeKey, NAV, type NavItem } from "./nav";

/** Trang có chọn khoảng thời gian (thanh PeriodBar): AI cần biết để hiểu "tháng này", "ở đây". */
const PERIOD_PAGES = new Set(["overview", "profit", "costs", "returns", "orders"]);

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Mô tả ngắn trang người dùng đang xem, gửi kèm câu hỏi ở khung chat AI để AI hiểu "ở đây", "tháng này".
 * Trang không có trong thanh bên (editor, trang công khai...) thì không có mô tả. Hàm thuần.
 */
export function pageContext(pathname: string | null, range: DateRange | null): string | undefined {
  const key = activeKey(pathname);
  const page = NAV.find((n): n is NavItem => "key" in n && n.key === key);
  if (!page) return undefined;
  let text = `Người dùng đang xem trang "${page.label}" của Cerno.`;
  if (PERIOD_PAGES.has(page.key)) {
    text += range ? ` Khoảng thời gian đang chọn trên trang: ${dmy(range.from)} đến ${dmy(range.to)}.` : " Khoảng thời gian đang chọn trên trang: tất cả.";
  }
  return text;
}
