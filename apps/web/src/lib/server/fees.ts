import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costKey } from "@/lib/profit/catalog";
import { productKey, type FeeEstimator } from "@/lib/profit/order-profit";
import { DEFAULT_FEE_SETTINGS, FEE_CHANNEL, isSellerType, type FeePayload, type FeeSettings } from "@/lib/fees/constants";
import { estimateOrderFee } from "@/lib/fees/estimate";
import { categoryRate, tableInfo } from "@/lib/fees/shopee";

/**
 * Cài đặt và ngành hàng để ƯỚC TÍNH phí sàn Shopee (migration 0018). Thiếu bảng (chưa chạy migration) thì `available = false`:
 * các trang vẫn chạy, chỉ là không ước tính được.
 */
export interface FeeConfig {
  available: boolean;
  settings: FeeSettings;
  /** costKey(sku) → đường dẫn ngành hàng. */
  categories: Map<string, string>;
  /** Chữ ký nội dung, dùng làm khoá bộ nhớ đệm tính lãi. */
  signature: string;
}

const EMPTY: FeeConfig = { available: false, settings: DEFAULT_FEE_SETTINGS, categories: new Map(), signature: "none" };

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /fee_settings|product_fee_categories/.test(e.message ?? ""));

const sign = (settings: FeeSettings, categories: Map<string, string>): string =>
  createHash("sha1").update(JSON.stringify([settings, [...categories.entries()].sort()])).digest("hex").slice(0, 16);

export async function loadFeeConfig(db: SupabaseClient, workspaceId: string): Promise<FeeConfig> {
  try {
    const [s, c] = await Promise.all([
      db.from("fee_settings").select("estimate_enabled, seller_type, new_seller").eq("workspace_id", workspaceId).maybeSingle(),
      db.from("product_fee_categories").select("sku, category").eq("workspace_id", workspaceId),
    ]);
    if (s.error || c.error) return missingTable(s.error ?? c.error) ? EMPTY : { ...EMPTY, available: false };
    const settings: FeeSettings = s.data
      ? { enabled: !!s.data.estimate_enabled, sellerType: isSellerType(s.data.seller_type) ? s.data.seller_type : "non_mall", newSeller: !!s.data.new_seller }
      : DEFAULT_FEE_SETTINGS;
    const categories = new Map<string, string>(((c.data ?? []) as { sku: string; category: string }[]).map((r) => [costKey(r.sku), r.category]));
    return { available: true, settings, categories, signature: sign(settings, categories) };
  } catch {
    return EMPTY;
  }
}

/** Bộ ước tính phí cho `buildOrders`; undefined khi tắt, chưa có bảng hoặc chưa chọn ngành nào. */
export function makeFeeEstimator(cfg: FeeConfig): FeeEstimator | undefined {
  if (!cfg.available || !cfg.settings.enabled || cfg.categories.size === 0) return undefined;
  const { sellerType, newSeller } = cfg.settings;
  return (o) => {
    if (o.channel !== FEE_CHANNEL) return null;
    const lines = o.lines.map((l) => {
      const key = productKey(l.sku, l.product);
      const path = key ? cfg.categories.get(costKey(key)) : undefined;
      return { gross: l.gross, ratePct: categoryRate(sellerType, path) };
    });
    return estimateOrderFee({ date: o.date, lines, buyerShipping: o.shippingIn, settings: { sellerType, newSeller } })?.total ?? null;
  };
}

export interface SaveFeeConfigArgs {
  user: SupabaseClient;
  userId: string;
  workspaceId: string;
  settings?: FeeSettings;
  upserts: { sku: string; category: string }[];
  removes: string[];
}

/** Lưu cài đặt và ngành hàng bằng client của người dùng (RLS: owner/editor). Ném lỗi có `missingTable` nếu chưa chạy migration 0018. */
export async function saveFeeConfig(a: SaveFeeConfigArgs): Promise<void> {
  const now = new Date().toISOString();
  const fail = (error: { code?: string; message: string }) => {
    throw Object.assign(new Error(error.message), { missingTable: missingTable(error) });
  };
  if (a.settings) {
    const { error } = await a.user.from("fee_settings").upsert(
      { workspace_id: a.workspaceId, estimate_enabled: a.settings.enabled, seller_type: a.settings.sellerType, new_seller: a.settings.newSeller, updated_at: now, updated_by: a.userId },
      { onConflict: "workspace_id" },
    );
    if (error) fail(error);
  }
  if (a.upserts.length) {
    const { error } = await a.user.from("product_fee_categories").upsert(
      a.upserts.map((u) => ({ workspace_id: a.workspaceId, sku: u.sku.trim(), category: u.category, updated_at: now, updated_by: a.userId })),
      { onConflict: "workspace_id,sku" },
    );
    if (error) fail(error);
  }
  if (a.removes.length) {
    const { error } = await a.user.from("product_fee_categories").delete().eq("workspace_id", a.workspaceId).in("sku", a.removes);
    if (error) fail(error);
  }
}

/** Phần cấu hình phí gửi cho trình duyệt. */
export function feePayload(cfg: FeeConfig): FeePayload {
  const type = cfg.settings.sellerType;
  return {
    available: cfg.available,
    settings: cfg.settings,
    tableFrom: tableInfo(type).effectiveFrom,
    categories: Object.fromEntries([...cfg.categories].map(([k, path]) => [k, { path, ratePct: categoryRate(type, path) }])),
  };
}
