import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/account-utils";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { isAdChannel } from "@/lib/orders/ad-file";
import { summarizeAdSpend } from "@/lib/profit/ad-spend";
import { deleteAdSpend, loadAdSpend } from "@/lib/server/ad-spend";
import { membershipOf, workspaceOf } from "@/lib/server/profit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const limited = createRateLimiter(20, 60_000);

/** Tóm tắt chi phí quảng cáo đã nhập, theo kênh (số ngày, tổng tiền, khoảng thời gian). */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  const member = await membershipOf(supabase, auth.user.id);
  if (!member) return NextResponse.json({ error: "Bạn chưa có workspace" }, { status: 403 });
  const data = await loadAdSpend(supabase, member.workspaceId);
  return NextResponse.json({ available: data.available, editable: member.editable, channels: summarizeAdSpend(data.entries) });
}

/** Xoá chi phí quảng cáo của một kênh (`?channel=Shopee` hoặc `*`). */
export async function DELETE(req: Request) {
  if (!sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 403 });
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn thao tác quá nhanh, thử lại sau ít giây." }, { status: 429 });
  const channel = new URL(req.url).searchParams.get("channel");
  if (!isAdChannel(channel)) return NextResponse.json({ error: "Kênh không hợp lệ" }, { status: 400 });
  const workspaceId = await workspaceOf(supabase, auth.user.id, true);
  if (!workspaceId) return NextResponse.json({ error: "Bạn không có quyền sửa chi phí của workspace này" }, { status: 403 });
  try {
    return NextResponse.json(await deleteAdSpend({ user: supabase, admin: createAdminClient(), workspaceId, channel }));
  } catch (e) {
    if ((e as { missingTable?: boolean }).missingTable) return NextResponse.json({ error: "Cần chạy migration 0019_ad_spend.sql trên Supabase trước." }, { status: 409 });
    console.error("[api/ads DELETE]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Không xóa được, thử lại sau." }, { status: 500 });
  }
}
