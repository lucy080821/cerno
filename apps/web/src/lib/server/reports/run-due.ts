import { nextRunAt, type ReportFrequency } from "@dashboard/schema";
import type { MailMessage, SendResult } from "@/lib/server/mail";
import { composeReport, createComposeCaches, type ComposeDeps, type ComposeMeta } from "./compose";

/**
 * Chạy các báo cáo đến hạn (gọi từ cron). Mỗi lượt: nhận tối đa `limit` đăng ký (đã "thuê" 30 phút trong DB nên cron chạy
 * chồng không gửi trùng) → xử lý TUẦN TỰ từng người nhận → ghi nhật ký → đặt lại lịch kế tiếp.
 * Một người lỗi không làm hỏng người khác. Mọi phụ thuộc được truyền vào để kiểm thử không cần DB/SMTP/AI.
 */

export const MAX_PER_RUN = 20;
/** Gửi thất bại lần đầu thì thử lại sau 1 giờ; thất bại lần nữa thì bỏ qua kỳ này, đợi kỳ sau. */
export const RETRY_MARKER = "Gửi thất bại, sẽ thử lại sau 1 giờ.";
const RETRY_MS = 3_600_000;

export interface DueSub {
  id: string;
  dashboard_id: string;
  recipient_email: string;
  recipient_name: string;
  prompt: string;
  frequency: ReportFrequency;
  weekday: number | null;
  month_day: number | null;
  hour_vn: number;
  widget_ids: string[];
  include_images: boolean;
  link_mode: "view_link" | "login";
  /** Thiếu ở dữ liệu cũ (trước migration 0016) = compare. */
  report_type?: "compare" | "overview";
  last_error: string | null;
}

export interface LogEntry {
  kind: "report";
  ref_id: string;
  dashboard_id: string;
  recipient: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  meta: Record<string, unknown>;
}

export interface FinishPatch {
  next_run_at?: string | null;
  last_sent_at?: string;
  last_error?: string | null;
  enabled?: boolean;
}

export interface RunDeps {
  compose: ComposeDeps;
  claim(limit: number): Promise<DueSub[]>;
  isOptedOut(email: string, subId: string): Promise<boolean>;
  send(m: MailMessage): Promise<SendResult>;
  /** Còn được gửi thêm email hôm nay không (hạn mức email theo gói). Bỏ trống = không giới hạn. */
  mailAllowed?(dashboardId: string): Promise<boolean>;
  log(e: LogEntry): Promise<void>;
  finish(id: string, patch: FinishPatch): Promise<void>;
  /** Link huỷ nhận cho một đăng ký, hoặc null nếu chưa cấu hình UNSUBSCRIBE_SECRET (khi đó KHÔNG được gửi). */
  unsubscribeLinks(sub: DueSub): { pageUrl: string; apiUrl: string } | null;
  now(): Date;
}

export interface RunSummary {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "Lỗi không xác định").slice(0, 300);

export async function runDueReports(deps: RunDeps, limit = MAX_PER_RUN): Promise<RunSummary> {
  const subs = await deps.claim(Math.max(1, Math.min(limit, MAX_PER_RUN)));
  const sum: RunSummary = { claimed: subs.length, sent: 0, failed: 0, skipped: 0 };
  const caches = createComposeCaches();

  for (const sub of subs) {
    const base = { kind: "report" as const, ref_id: sub.id, dashboard_id: sub.dashboard_id, recipient: sub.recipient_email };
    const next = () => nextRunAt({ frequency: sub.frequency, weekday: sub.weekday, month_day: sub.month_day, hour_vn: sub.hour_vn }, deps.now()).toISOString();
    try {
      if (await deps.isOptedOut(sub.recipient_email, sub.id)) {
        await deps.log({ ...base, status: "skipped", meta: { reason: "optout" } });
        await deps.finish(sub.id, { enabled: false, next_run_at: null });
        sum.skipped++;
        continue;
      }

      const links = deps.unsubscribeLinks(sub);
      if (!links) {
        // Không có link huỷ nhận hợp lệ thì không gửi (quy tắc: luôn có link huỷ nhận).
        await deps.log({ ...base, status: "failed", error: "Chưa cấu hình UNSUBSCRIBE_SECRET", meta: {} });
        await deps.finish(sub.id, { last_error: "Máy chủ chưa cấu hình link huỷ nhận.", next_run_at: next() });
        sum.failed++;
        continue;
      }

      // Hạn mức email mỗi ngày của workspace (theo gói): hết thì bỏ qua báo cáo kỳ này, ghi rõ lý do.
      if (deps.mailAllowed && !(await deps.mailAllowed(sub.dashboard_id))) {
        await deps.log({ ...base, status: "skipped", meta: { reason: "daily_limit" } });
        await deps.finish(sub.id, { last_error: "Đã đạt giới hạn email trong ngày của gói; báo cáo kỳ này bị bỏ qua.", next_run_at: next() });
        sum.skipped++;
        continue;
      }

      const r = await composeReport(deps.compose, sub.dashboard_id, sub, { now: deps.now(), caches, unsubscribeUrl: links.pageUrl });
      if (!r.ok) {
        const gone = r.error.includes("không còn tồn tại");
        await deps.log({ ...base, status: "failed", error: r.error, meta: {} });
        await deps.finish(sub.id, gone ? { enabled: false, next_run_at: null, last_error: r.error } : { last_error: r.error, next_run_at: next() });
        sum.failed++;
        continue;
      }

      const sent = await deps.send({
        to: sub.recipient_email,
        subject: r.email.subject,
        html: r.email.html,
        text: r.email.text,
        images: r.images,
        headers: { "List-Unsubscribe": `<${links.apiUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      const meta: Record<string, unknown> = { ...(r.meta satisfies ComposeMeta) };

      if (sent.ok) {
        await deps.log({ ...base, status: "sent", meta });
        await deps.finish(sub.id, { last_sent_at: deps.now().toISOString(), last_error: null, next_run_at: next() });
        sum.sent++;
      } else {
        const notConfigured = sent.code === "not_configured";
        const error = notConfigured ? "Máy chủ chưa cấu hình gửi email." : "Không gửi được email.";
        await deps.log({ ...base, status: "failed", error, meta: { ...meta, code: sent.code } });
        // Lỗi tạm thời (SMTP): thử lại sau 1 giờ một lần; lỗi cấu hình hoặc lỗi lặp lại: đợi kỳ sau.
        const retry = !notConfigured && sub.last_error !== RETRY_MARKER;
        await deps.finish(sub.id, {
          last_error: retry ? RETRY_MARKER : error,
          next_run_at: retry ? new Date(deps.now().getTime() + RETRY_MS).toISOString() : next(),
        });
        sum.failed++;
      }
    } catch (e) {
      sum.failed++;
      try {
        await deps.log({ ...base, status: "failed", error: msg(e), meta: {} });
        await deps.finish(sub.id, { last_error: msg(e), next_run_at: next() });
      } catch {
        /* không ghi được trạng thái: lần "thuê" 30 phút sẽ hết hạn và dòng được nhận lại */
      }
    }
  }
  return sum;
}
