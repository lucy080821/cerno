import { addDays, addMonths } from "@dashboard/chart-engine";
import { VN_OFFSET_HOURS, type ReportFrequency } from "@dashboard/schema";

/** Một khoảng ngày (ISO yyyy-mm-dd, gồm cả hai đầu) kèm nhãn tiếng Việt để hiện trong email. */
export interface ReportSpan {
  from: string;
  to: string;
  label: string;
}

export interface ReportPeriods {
  cur: ReportSpan;
  prev: ReportSpan;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Ngày hôm nay theo giờ Việt Nam (yyyy-mm-dd) tại thời điểm `now`. */
export function todayVn(now: Date): string {
  return new Date(now.getTime() + VN_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

function day(iso: string): ReportSpan {
  return { from: iso, to: iso, label: `Ngày ${dmy(iso)}` };
}

function week(monday: string): ReportSpan {
  const sunday = addDays(monday, 6);
  return { from: monday, to: sunday, label: `Tuần ${dm(monday)} – ${dmy(sunday)}` };
}

function month(y: number, m: number): ReportSpan {
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}`, label: `Tháng ${pad(m)}/${y}` };
}

/**
 * Kỳ báo cáo và kỳ liền trước, luôn là kỳ ĐÃ TRỌN tại thời điểm gửi (giờ Việt Nam):
 * - hằng ngày: hôm qua và hôm kia;
 * - hằng tuần: tuần thứ Hai–Chủ nhật vừa qua và tuần trước đó;
 * - hằng tháng: tháng trước và tháng trước nữa (so theo tháng lịch, không theo "n ngày trước").
 */
export function reportPeriods(frequency: ReportFrequency, now: Date): ReportPeriods {
  const today = todayVn(now);
  if (frequency === "daily") return { cur: day(addDays(today, -1)), prev: day(addDays(today, -2)) };

  if (frequency === "weekly") {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Chủ nhật
    const monday = addDays(today, -((dow + 6) % 7));
    return { cur: week(addDays(monday, -7)), prev: week(addDays(monday, -14)) };
  }

  const first = `${today.slice(0, 8)}01`;
  const lastMonthStart = addMonths(first, -1);
  const prevMonthStart = addMonths(first, -2);
  const ym = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) });
  const a = ym(lastMonthStart);
  const b = ym(prevMonthStart);
  return { cur: month(a.y, a.m), prev: month(b.y, b.m) };
}
