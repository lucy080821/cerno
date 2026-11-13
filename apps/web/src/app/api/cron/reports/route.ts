import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { syncDueSources } from "@/lib/google/sync";
import { requestOrigin } from "@/lib/auth/public-origin";
import { liveRunDeps } from "@/lib/server/reports/live";
import { runDueReports } from "@/lib/server/reports/run-due";
import { evaluateStaleRules } from "@/lib/server/alerts/evaluate";
import { liveAlertDeps } from "@/lib/server/alerts/live";
import { purgeOldReportImages } from "@/lib/server/mail/hosted-images";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  // Chưa cấu hình bí mật (hoặc quá ngắn) thì từ chối hết, để không vô tình mở công khai.
  if (secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Bộ hẹn giờ gọi định kỳ (vd mỗi 30 phút): gửi các báo cáo email đã đến hạn. Bảo vệ bằng `Authorization: Bearer <CRON_SECRET>`
 * (cùng khoá với /api/cron/sync). Trước khi gửi, cập nhật các nguồn Sheets đã quá chu kỳ để báo cáo dùng số mới nhất.
 * Sau cùng kiểm các luật cảnh báo "không có dữ liệu mới".
 * Chạy chồng hoặc gọi dày không gửi trùng: mỗi đăng ký được "thuê" 30 phút ngay trong DB khi nhận.
 */
async function handle(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Chưa cấu hình CRON_SECRET trên server." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Không có quyền." }, { status: 401 });
  try {
    // Lỗi đồng bộ không được chặn việc gửi báo cáo (báo cáo vẫn dùng dữ liệu đã có).
    let sync: unknown = null;
    try {
      sync = await syncDueSources();
    } catch {
      sync = { error: "sync_failed" };
    }
    const origin = requestOrigin(request);
    const summary = await runDueReports(liveRunDeps(origin));
    // Luật "không có dữ liệu mới trong X giờ" kiểm theo giờ, không cần dữ liệu đổi (lỗi không chặn phần còn lại).
    let stale: unknown = null;
    try {
      const r = await evaluateStaleRules(liveAlertDeps(origin));
      stale = { evaluated: r.evaluated, notified: r.notified, errors: r.errors };
    } catch {
      stale = { error: "stale_failed" };
    }
    // Dọn ảnh biểu đồ cũ trong email (làm hết sức, không ảnh hưởng kết quả).
    let purged = 0;
    try {
      purged = await purgeOldReportImages(createAdminClient());
    } catch {
      /* bỏ qua */
    }
    return NextResponse.json({ ...summary, sync, stale, purgedImages: purged });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lỗi" }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle; // một số dịch vụ hẹn giờ chỉ gọi được GET
