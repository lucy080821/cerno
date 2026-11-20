import { NextResponse, type NextRequest } from "next/server";
import { prepareAdSpend } from "@/lib/orders/ad-file";
import { FileError } from "@/lib/orders/csv";
import { readUpload, requireEditor } from "@/lib/orders/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { saveAdSpend } from "@/lib/server/ad-spend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const limited = createRateLimiter(12, 10 * 60 * 1000);

/** Lưu chi phí quảng cáo từ file rồi chia cho các đơn hàng theo ngày và kênh. */
export async function POST(request: NextRequest) {
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn thao tác quá nhanh, thử lại sau ít phút." }, { status: 429 });
  const up = await readUpload(request);
  if (up instanceof NextResponse) return up;
  try {
    const p = await prepareAdSpend(up.data, up.filename, up.opts);
    if (p.problems.length || !p.summary) return NextResponse.json({ error: p.problems[0] ?? "File chưa đủ thông tin để nhập." }, { status: 400 });
    const result = await saveAdSpend({ user: auth.supabase, admin: createAdminClient(), userId: auth.user.id, workspaceId: auth.workspaceId, entries: p.entries });
    return NextResponse.json({ ...result, days: p.summary.days, total: p.summary.total, dateMin: p.summary.dateMin, dateMax: p.summary.dateMax, warnings: p.warnings });
  } catch (e) {
    if (e instanceof FileError) return NextResponse.json({ error: e.message }, { status: 422 });
    if ((e as { missingTable?: boolean }).missingTable) return NextResponse.json({ error: "Cần chạy migration 0019_ad_spend.sql trên Supabase trước khi nhập chi phí quảng cáo." }, { status: 409 });
    const msg = e instanceof Error ? e.message : String(e);
    if (/20\.000 dòng/.test(msg)) return NextResponse.json({ error: "Đã đạt giới hạn 20.000 dòng chi phí quảng cáo." }, { status: 403 });
    console.error("[api/ads/import]", msg);
    return NextResponse.json({ error: "Không nhập được file, thử lại sau." }, { status: 500 });
  }
}
