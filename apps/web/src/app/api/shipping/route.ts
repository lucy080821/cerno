import { NextResponse } from "next/server";
import { z } from "@dashboard/schema";
import { sameOrigin } from "@/lib/account-utils";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { workspaceOf } from "@/lib/server/profit";
import { isShipChannel, MAX_SHIP_AMOUNT } from "@/lib/profit/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limited = createRateLimiter(30, 60_000);
const Amount = z.number().finite().min(0).max(MAX_SHIP_AMOUNT);
const Body = z.object({ rates: z.record(z.string(), z.object({ perOrder: Amount, perReturn: Amount })) });

const missing = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "PGRST205" || /shipping_costs/.test(e.message ?? "");

/**
 * Lưu phí vận chuyển shop chịu (ước tính) theo kênh: `rates[kênh] = {perOrder, perReturn}` (đồng). Kênh có cả hai số bằng 0 thì bị
 * xoá. Chỉ owner/editor. Lãi được tính lại ở lần tải trang kế tiếp (khoá bộ nhớ đệm có cả mức phí ship).
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
  if (!parsed.success) return NextResponse.json({ error: "Số tiền không hợp lệ" }, { status: 400 });

  const upserts: { channel: string; perOrder: number; perReturn: number }[] = [];
  const removes: string[] = [];
  for (const [channel, r] of Object.entries(parsed.data.rates)) {
    if (!isShipChannel(channel)) return NextResponse.json({ error: "Kênh không hợp lệ" }, { status: 400 });
    const perOrder = Math.round(r.perOrder);
    const perReturn = Math.round(r.perReturn);
    if (perOrder === 0 && perReturn === 0) removes.push(channel);
    else upserts.push({ channel, perOrder, perReturn });
  }

  const now = new Date().toISOString();
  if (upserts.length) {
    const { error } = await supabase.from("shipping_costs").upsert(
      upserts.map((u) => ({ workspace_id: workspaceId, channel: u.channel, per_order: u.perOrder, per_return: u.perReturn, updated_at: now, updated_by: auth.user.id })),
      { onConflict: "workspace_id,channel" },
    );
    if (error) {
      if (missing(error)) return NextResponse.json({ error: "Cần chạy migration 0020_shipping_costs.sql trên Supabase trước khi lưu phí vận chuyển." }, { status: 409 });
      console.error("[api/shipping]", error.message);
      return NextResponse.json({ error: "Không lưu được, thử lại sau." }, { status: 500 });
    }
  }
  if (removes.length) {
    const { error } = await supabase.from("shipping_costs").delete().eq("workspace_id", workspaceId).in("channel", removes);
    if (error && !missing(error)) {
      console.error("[api/shipping]", error.message);
      return NextResponse.json({ error: "Không lưu được, thử lại sau." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, saved: upserts.length, removed: removes.length });
}
