import { NextResponse } from "next/server";
import { z } from "@dashboard/schema";
import { sameOrigin } from "@/lib/account-utils";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { workspaceOf } from "@/lib/server/profit";
import { loadFeeConfig, saveFeeConfig } from "@/lib/server/fees";
import { MAX_AFFILIATE_PCT, MAX_CATEGORY_LENGTH, FEE_PLATFORMS } from "@/lib/fees/constants";
import { categoryRate } from "@/lib/fees/tables";
import { sellerTypeOf } from "@/lib/server/fees";
import { MAX_COST_ENTRIES, MAX_SKU_LENGTH } from "@/lib/profit/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limited = createRateLimiter(30, 60_000);
const Sku = z.string().trim().min(1).max(MAX_SKU_LENGTH);
const Body = z.object({
  settings: z
    .object({
      enabled: z.boolean(),
      sellerType: z.enum(["non_mall", "mall"]),
      newSeller: z.boolean(),
      tiktokSellerType: z.enum(["non_mall", "mall"]).default("non_mall"),
      tiktokAffiliatePct: z.number().finite().min(0).max(MAX_AFFILIATE_PCT).default(0),
    })
    .optional(),
  /** Sàn mà `upserts` / `removes` áp dụng (mặc định Shopee). */
  platform: z.enum(FEE_PLATFORMS).default("Shopee"),
  upserts: z.array(z.object({ sku: Sku, category: z.string().trim().min(1).max(MAX_CATEGORY_LENGTH) })).max(MAX_COST_ENTRIES).default([]),
  removes: z.array(Sku).max(MAX_COST_ENTRIES).default([]),
});

/** Lưu cài đặt ước tính phí sàn và ngành hàng của sản phẩm (owner/editor). Tính lại lãi tự động ở lần tải trang kế tiếp. */
export async function PUT(req: Request) {
  if (!sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 403 });
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn lưu quá nhanh, thử lại sau ít giây." }, { status: 429 });
  const workspaceId = await workspaceOf(supabase, auth.user.id, true);
  if (!workspaceId) return NextResponse.json({ error: "Bạn không có quyền sửa cài đặt phí của workspace này" }, { status: 403 });

  const text = await req.text();
  if (text.length > 900_000) return NextResponse.json({ error: "Yêu cầu quá lớn" }, { status: 413 });
  let parsed;
  try {
    parsed = Body.safeParse(JSON.parse(text));
  } catch {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  const { settings, removes, platform } = parsed.data;
  const upserts = [...new Map(parsed.data.upserts.map((u) => [u.sku.trim(), { ...u, sku: u.sku.trim() }])).values()];

  const current = await loadFeeConfig(supabase, workspaceId);
  // Ngành phải có trong biểu phí của loại shop đang dùng (đang lưu, hoặc loại mới nếu đổi cùng lúc).
  if (upserts.length) {
    const type = sellerTypeOf(settings ?? current.settings, platform);
    const bad = upserts.find((u) => categoryRate(platform, type, u.category) === null);
    if (bad) return NextResponse.json({ error: `Ngành hàng "${bad.category}" không có trong biểu phí của loại shop đã chọn.` }, { status: 400 });
  }

  try {
    await saveFeeConfig({ user: supabase, userId: auth.user.id, workspaceId, multiPlatform: current.multiPlatform, settings, platform, upserts, removes });
    return NextResponse.json({ ok: true, saved: upserts.length, removed: removes.length });
  } catch (e) {
    if ((e as { needsMulti?: boolean }).needsMulti) {
      return NextResponse.json({ error: "Cần chạy migration 0021_multi_platform_fees.sql trên Supabase trước khi lưu cài đặt TikTok Shop hoặc ngành hàng của TikTok Shop." }, { status: 409 });
    }
    if ((e as { missingTable?: boolean }).missingTable) {
      return NextResponse.json({ error: "Cần chạy migration 0018_shopee_fee_estimate.sql trên Supabase trước khi lưu cài đặt phí." }, { status: 409 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/giới hạn .* dòng|5\.000 sản phẩm/.test(msg)) return NextResponse.json({ error: "Đã đạt giới hạn số dòng trong bảng ngành hàng." }, { status: 403 });
    console.error("[api/fees]", msg);
    return NextResponse.json({ error: "Không lưu được, thử lại sau." }, { status: 500 });
  }
}
