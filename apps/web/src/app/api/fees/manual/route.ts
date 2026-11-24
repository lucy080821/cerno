import { NextResponse } from "next/server";
import { z } from "@dashboard/schema";
import { sameOrigin } from "@/lib/account-utils";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { workspaceOf } from "@/lib/server/profit";
import { isManualChannel, MAX_MANUAL_PCT, MAX_MANUAL_PER_ORDER, saveManualRates } from "@/lib/server/fees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limited = createRateLimiter(30, 60_000);
const Body = z.object({
  rates: z.record(
    z.string(),
    z.object({
      commissionPct: z.number().finite().min(0).max(MAX_MANUAL_PCT.commission),
      paymentPct: z.number().finite().min(0).max(MAX_MANUAL_PCT.payment),
      perOrder: z.number().finite().min(0).max(MAX_MANUAL_PER_ORDER),
    }),
  ),
});

/**
 * Lưu phí sàn người bán tự nhập cho các kênh chưa có biểu phí (Lazada, Tiki...): `rates[kênh] = {commissionPct, paymentPct, perOrder}`.
 * Kênh có cả ba mức bằng 0 thì bị xoá. Chỉ owner/editor. Chỉ dùng cho đơn mà file không ghi phí.
 */
export async function PUT(req: Request) {
  if (!sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 403 });
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn lưu quá nhanh, thử lại sau ít giây." }, { status: 429 });
  const workspaceId = await workspaceOf(supabase, auth.user.id, true);
  if (!workspaceId) return NextResponse.json({ error: "Bạn không có quyền sửa chi phí của workspace này" }, { status: 403 });

  const text = await req.text();
  if (text.length > 20_000) return NextResponse.json({ error: "Yêu cầu quá lớn" }, { status: 413 });
  let parsed;
  try {
    parsed = Body.safeParse(JSON.parse(text));
  } catch {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: "Tỷ lệ hoặc số tiền không hợp lệ" }, { status: 400 });
  if (Object.keys(parsed.data.rates).some((c) => !isManualChannel(c))) return NextResponse.json({ error: "Kênh không hợp lệ" }, { status: 400 });

  try {
    const r = await saveManualRates({ user: supabase, userId: auth.user.id, workspaceId, rates: parsed.data.rates });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if ((e as { missingTable?: boolean }).missingTable) {
      return NextResponse.json({ error: "Cần chạy migration 0021_multi_platform_fees.sql trên Supabase trước khi lưu phí sàn tự nhập." }, { status: 409 });
    }
    console.error("[api/fees/manual]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "Không lưu được, thử lại sau." }, { status: 500 });
  }
}
