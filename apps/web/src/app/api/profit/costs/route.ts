import { NextResponse } from "next/server";
import { z } from "@dashboard/schema";
import { sameOrigin } from "@/lib/account-utils";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { saveCosts, workspaceOf } from "@/lib/server/profit";
import { MAX_COST_ENTRIES, MAX_SKU_LENGTH, MAX_UNIT_COST } from "@/lib/profit/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const limited = createRateLimiter(20, 60_000);
const Sku = z.string().trim().min(1).max(MAX_SKU_LENGTH);
const Body = z.object({
  upserts: z.array(z.object({ sku: Sku, name: z.string().max(200).optional(), unitCost: z.number().finite().min(0).max(MAX_UNIT_COST) })).max(MAX_COST_ENTRIES).default([]),
  removes: z.array(Sku).max(MAX_COST_ENTRIES).default([]),
});

/** Lưu bảng giá vốn (owner/editor) rồi ghi lại cột "Giá vốn" của nguồn đơn hàng. */
export async function PUT(req: Request) {
  if (!sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 403 });
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn lưu quá nhanh, thử lại sau ít giây." }, { status: 429 });
  const workspaceId = await workspaceOf(supabase, auth.user.id, true);
  if (!workspaceId) return NextResponse.json({ error: "Bạn không có quyền sửa giá vốn của workspace này" }, { status: 403 });

  const text = await req.text();
  if (text.length > 600_000) return NextResponse.json({ error: "Yêu cầu quá lớn" }, { status: 413 });
  let parsed;
  try {
    parsed = Body.safeParse(JSON.parse(text));
  } catch {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: "Giá vốn không hợp lệ" }, { status: 400 });
  // Một SKU chỉ một giá: dòng sau thắng.
  const upserts = [...new Map(parsed.data.upserts.map((u) => [u.sku.trim(), { ...u, sku: u.sku.trim() }])).values()];

  try {
    const result = await saveCosts({ user: supabase, admin: createAdminClient(), userId: auth.user.id, workspaceId, upserts, removes: parsed.data.removes });
    return NextResponse.json(result);
  } catch (e) {
    if ((e as { missingTable?: boolean }).missingTable) {
      return NextResponse.json({ error: "Cần chạy migration 0017_product_costs.sql trên Supabase trước khi lưu giá vốn." }, { status: 409 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/5\.000 sản phẩm/.test(msg)) return NextResponse.json({ error: "Đã đạt giới hạn 5.000 sản phẩm trong bảng giá vốn." }, { status: 403 });
    console.error("[api/profit/costs]", msg);
    return NextResponse.json({ error: "Không lưu được giá vốn, thử lại sau." }, { status: 500 });
  }
}
