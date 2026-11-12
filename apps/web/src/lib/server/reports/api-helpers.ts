import { nextRunAt, type ReportSubscriptionInput } from "@dashboard/schema";
import type { InlineImage } from "@/lib/server/mail";

/** Thay `cid:xxx` bằng ảnh nhúng dạng data URI để xem trước trong trình duyệt (email thật vẫn dùng đính kèm CID). */
export function inlineCidImages(html: string, images: InlineImage[]): string {
  let out = html;
  for (const i of images) {
    out = out.split(`cid:${i.cid}`).join(`data:${i.contentType};base64,${i.content.toString("base64")}`);
  }
  return out;
}

/** Cột người dùng được ghi vào report_subscriptions (khớp column grant ở migration 0012). */
export function subscriptionColumns(i: ReportSubscriptionInput) {
  return {
    recipient_email: i.recipient_email,
    recipient_name: i.recipient_name,
    prompt: i.prompt,
    frequency: i.frequency,
    weekday: i.frequency === "weekly" ? (i.weekday ?? null) : null,
    month_day: i.frequency === "monthly" ? (i.month_day ?? null) : null,
    hour_vn: i.hour_vn,
    widget_ids: i.widget_ids,
    include_images: i.include_images,
    link_mode: i.link_mode,
    enabled: i.enabled,
  };
}

/** Lịch chạy kế tiếp (do server đặt bằng service role): đang tắt thì không có lịch. */
export function scheduleFor(i: ReportSubscriptionInput, now: Date): { next_run_at: string | null; last_error: null } {
  return { next_run_at: i.enabled ? nextRunAt(i, now).toISOString() : null, last_error: null };
}

/** Email thử gửi cho CHÍNH người đang đăng nhập: không có link huỷ nhận thật, tiêu đề đánh dấu là thư thử. */
export const testSubject = (subject: string) => `[Thư thử] ${subject}`.slice(0, 160);
