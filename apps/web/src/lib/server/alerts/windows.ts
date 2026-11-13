import { addDays, addMonths } from "@dashboard/chart-engine";
import { VN_OFFSET_HOURS, type AlertWindow } from "@dashboard/schema";

/**
 * Khoảng thời gian của cảnh báo, theo ngày giờ Việt Nam. Thuần (nhận `now`), không đọc đồng hồ máy.
 * Mọi khoảng là ngày ISO yyyy-mm-dd, GỒM CẢ hai đầu.
 *
 * - today: hôm nay (CHƯA kết thúc)            - yesterday: hôm qua (đã trọn)
 * - this_week: từ thứ Hai đến hôm nay (chưa trọn)   - this_month: từ ngày 1 đến hôm nay (chưa trọn)
 * - last_7d: 7 ngày TRỌN VẸN kết thúc hôm qua (không gồm hôm nay)
 */

export interface Span {
  from: string;
  to: string;
}

/** Ngày hôm nay theo giờ VN. */
export function todayVn(now: Date): string {
  return new Date(now.getTime() + VN_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/** Giờ hiện tại (0–23) theo giờ VN. */
export function hourVn(now: Date): number {
  return new Date(now.getTime() + VN_OFFSET_HOURS * 3_600_000).getUTCHours();
}

/** Khoảng đang tính chưa kết thúc (còn tăng thêm dữ liệu trong ngày/tuần/tháng). */
export const isIncomplete = (w: AlertWindow): boolean => w === "today" || w === "this_week" || w === "this_month";

const mondayOf = (iso: string): string => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Chủ nhật
  return addDays(iso, -((dow + 6) % 7));
};

/** Khoảng ngày của một cửa sổ; null với "all" (không giới hạn thời gian). */
export function windowSpan(w: AlertWindow, now: Date): Span | null {
  const today = todayVn(now);
  switch (w) {
    case "all": return null;
    case "today": return { from: today, to: today };
    case "yesterday": { const y = addDays(today, -1); return { from: y, to: y }; }
    case "this_week": return { from: mondayOf(today), to: today };
    case "this_month": return { from: `${today.slice(0, 8)}01`, to: today };
    case "last_7d": return { from: addDays(today, -7), to: addDays(today, -1) };
  }
}

/**
 * Chỉ báo khi đã tới giờ `settleHour` (giờ VN) với khoảng CHƯA kết thúc; khoảng đã trọn thì luôn đánh giá.
 * Không đặt `settleHour` = đánh giá ngay.
 */
export function isSettled(w: AlertWindow, settleHour: number | undefined, now: Date): boolean {
  if (settleHour === undefined || !isIncomplete(w)) return true;
  return hourVn(now) >= settleHour;
}

/**
 * Khoảng so sánh của `span`.
 * - prev_period: khoảng liền trước CÙNG ĐỘ DÀI. Khoảng chưa trọn (tuần/tháng đến hôm nay) so với phần tương ứng của kỳ trước
 *   (cùng số ngày đã trôi qua), không so với cả kỳ trước.
 * - prev_year: cùng khoảng một năm trước (tuần lùi 364 ngày để giữ nguyên thứ trong tuần).
 */
export function previousSpan(w: AlertWindow, span: Span, vs: "prev_period" | "prev_year"): Span {
  if (vs === "prev_year") {
    if (w === "this_week" || w === "last_7d") return { from: addDays(span.from, -364), to: addDays(span.to, -364) };
    return { from: addMonths(span.from, -12), to: addMonths(span.to, -12) };
  }
  switch (w) {
    case "this_month": return shiftMonths(span, -1);
    case "today":
    case "yesterday": return { from: addDays(span.from, -1), to: addDays(span.to, -1) };
    default: return { from: addDays(span.from, -7 * lengthWeeks(span)), to: addDays(span.to, -7 * lengthWeeks(span)) };
  }
}

/** Số tuần (làm tròn lên) của khoảng, để lùi đúng một "kỳ" với khoảng 7 ngày hoặc ngắn hơn. */
const lengthWeeks = (s: Span) => Math.max(1, Math.ceil((Date.parse(s.to) - Date.parse(s.from) + 86_400_000) / (7 * 86_400_000)));

/** Dịch khoảng đi `n` tháng, giữ ngày đầu tháng và kẹp ngày cuối về cuối tháng đích (31/3 − 1 tháng = 28/2). */
function shiftMonths(span: Span, n: number): Span {
  return { from: addMonths(span.from, n), to: addMonths(span.to, n) };
}

/**
 * Các kỳ trước CÙNG LOẠI để tính "bình thường" cho anomaly, gần nhất trước, đúng `lookback` kỳ:
 * - hôm nay/hôm qua: cùng THỨ trong các tuần trước (thứ Hai so với các thứ Hai trước);
 * - tuần này/7 ngày qua: các tuần trước (cùng độ dài, cùng thứ bắt đầu);
 * - tháng này: các tháng trước, cùng số ngày đã trôi qua (đến cùng ngày trong tháng).
 */
export function historySpans(w: AlertWindow, span: Span, lookback: number): Span[] {
  const out: Span[] = [];
  for (let k = 1; k <= lookback; k++) {
    if (w === "this_month") out.push(shiftMonths(span, -k));
    else out.push({ from: addDays(span.from, -7 * k), to: addDays(span.to, -7 * k) });
  }
  return out;
}

/** Số ngày của một khoảng (gồm cả hai đầu). */
export const spanDays = (s: Span): number => Math.round((Date.parse(s.to) - Date.parse(s.from)) / 86_400_000) + 1;

/** Nhãn dễ đọc cho email và giao diện, ví dụ "hôm nay (03/11/2025)", "7 ngày qua (27/10 – 02/11/2025)". */
export function spanLabel(w: AlertWindow, span: Span | null, lang: "vi" | "en" = "vi"): string {
  if (!span) return lang === "en" ? "all data" : "toàn bộ dữ liệu";
  const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const range = span.from === span.to ? dmy(span.from) : `${dm(span.from)} – ${dmy(span.to)}`;
  const names: Record<"vi" | "en", Record<AlertWindow, string>> = {
    vi: { all: "toàn bộ", today: "hôm nay", yesterday: "hôm qua", this_week: "tuần này", this_month: "tháng này", last_7d: "7 ngày qua" },
    en: { all: "all data", today: "today", yesterday: "yesterday", this_week: "this week", this_month: "this month", last_7d: "the last 7 days" },
  };
  return `${names[lang][w]} (${range})`;
}

