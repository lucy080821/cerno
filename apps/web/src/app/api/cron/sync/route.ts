import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { syncDueSources } from "@/lib/google/sync";

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
 * Bộ hẹn giờ gọi định kỳ (vd mỗi 30 phút): tự cập nhật các nguồn Google Sheets đã quá chu kỳ (mặc định 2 giờ).
 * Bảo vệ bằng `Authorization: Bearer <CRON_SECRET>`. Chạy lặp không gây hại: nguồn chưa đến hạn thì bị bỏ qua.
 */
async function handle(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Chưa cấu hình CRON_SECRET trên server." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Không có quyền." }, { status: 401 });
  try {
    return NextResponse.json(await syncDueSources());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lỗi" }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle; // một số dịch vụ hẹn giờ chỉ gọi được GET
