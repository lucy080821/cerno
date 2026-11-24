import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costKey } from "@/lib/profit/catalog";
import { productKey, type FeeEstimator } from "@/lib/profit/order-profit";
import { DEFAULT_FEE_SETTINGS, FEE_CHANNEL, isSellerType, type FeePayload, type FeeSettings } from "@/lib/fees/constants";
import { estimateOrderFee } from "@/lib/fees/estimate";
import { MATCH_VERSION, suggestCategory } from "@/lib/fees/match";
import { categoryRate, tableInfo } from "@/lib/fees/shopee";
import { cleanShipRates, makeShipEstimator, type ShipEstimator, type ShipRates } from "@/lib/profit/shipping";

/**
 * Cài đặt và ngành hàng để ƯỚC TÍNH phí sàn Shopee (migration 0018). Thiếu bảng (chưa chạy migration) thì `available = false`:
 * các trang vẫn chạy, chỉ là không ước tính được.
 */
export interface FeeConfig {
  available: boolean;
  settings: FeeSettings;
  /** costKey(sku) → đường dẫn ngành hàng. */
  categories: Map<string, string>;
  /** Phí ship shop chịu ước tính theo kênh (migration 0020); độc lập với bảng phí sàn. */
  ship: { available: boolean; rates: ShipRates };
  /** Chữ ký nội dung, dùng làm khoá bộ nhớ đệm tính lãi. */
  signature: string;
}

const NO_SHIP = { available: false, rates: {} as ShipRates };
const EMPTY: FeeConfig = { available: false, settings: DEFAULT_FEE_SETTINGS, categories: new Map(), ship: NO_SHIP, signature: "none" };

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /fee_settings|product_fee_categories/.test(e.message ?? ""));

const sign = (settings: FeeSettings, categories: Map<string, string>, ship: ShipRates): string =>
  createHash("sha1").update(JSON.stringify([settings, [...categories.entries()].sort(), Object.entries(ship).sort(), MATCH_VERSION])).digest("hex").slice(0, 16);

const missingShipTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /shipping_costs/.test(e.message ?? ""));

/** Phí ship shop chịu theo kênh. Lỗi hoặc chưa có bảng thì coi như chưa nhập, không làm hỏng việc tính lãi. */
export async function loadShipRates(db: SupabaseClient, workspaceId: string): Promise<{ available: boolean; rates: ShipRates }> {
  try {
    const { data, error } = await db.from("shipping_costs").select("channel, per_order, per_return").eq("workspace_id", workspaceId);
    if (error) return { available: !missingShipTable(error), rates: {} };
    const raw: Record<string, { perOrder: number; perReturn: number }> = {};
    for (const r of (data ?? []) as { channel: string; per_order: number | string; per_return: number | string }[]) raw[r.channel] = { perOrder: Number(r.per_order), perReturn: Number(r.per_return) };
    return { available: true, rates: cleanShipRates(raw) };
  } catch {
    return NO_SHIP;
  }
}

export async function loadFeeConfig(db: SupabaseClient, workspaceId: string): Promise<FeeConfig> {
  try {
    const [s, c, ship] = await Promise.all([
      db.from("fee_settings").select("estimate_enabled, seller_type, new_seller").eq("workspace_id", workspaceId).maybeSingle(),
      db.from("product_fee_categories").select("sku, category").eq("workspace_id", workspaceId),
      loadShipRates(db, workspaceId),
    ]);
    // Bảng phí sàn chưa có (chưa chạy 0018) vẫn dùng được phí ship nếu có.
    if (s.error || c.error) return { ...EMPTY, ship, signature: sign(DEFAULT_FEE_SETTINGS, new Map(), ship.rates) };
    const settings: FeeSettings = s.data
      ? { enabled: !!s.data.estimate_enabled, sellerType: isSellerType(s.data.seller_type) ? s.data.seller_type : "non_mall", newSeller: !!s.data.new_seller }
      : DEFAULT_FEE_SETTINGS;
    const categories = new Map<string, string>(((c.data ?? []) as { sku: string; category: string }[]).map((r) => [costKey(r.sku), r.category]));
    return { available: true, settings, categories, ship, signature: sign(settings, categories, ship.rates) };
  } catch {
    return EMPTY;
  }
}

/**
 * Bộ ước tính phí cho `buildOrders`; undefined khi tắt hoặc chưa có bảng. Sản phẩm người bán chưa chọn ngành thì dùng ngành Cerno tự
 * nhận diện từ tên sản phẩm (lib/fees/match.ts; giao diện nhắc người bán kiểm tra lại); không nhận diện được thì chưa ước tính đơn đó.
 */
export function makeFeeEstimator(cfg: FeeConfig): FeeEstimator | undefined {
  if (!cfg.available || !cfg.settings.enabled) return undefined;
  const { sellerType, newSeller } = cfg.settings;
  return (o) => {
    if (o.channel !== FEE_CHANNEL) return null;
    const lines = o.lines.map((l) => {
      const key = productKey(l.sku, l.product);
      const chosen = key ? cfg.categories.get(costKey(key)) : undefined;
      const path = chosen ?? suggestCategory(sellerType, l.product ?? l.sku)?.path;
      return { gross: l.gross, ratePct: categoryRate(sellerType, path) };
    });
    return estimateOrderFee({ date: o.date, lines, buyerShipping: o.shippingIn, settings: { sellerType, newSeller } })?.total ?? null;
  };
}

/** Bộ ước tính phí ship shop chịu cho `buildOrders`; undefined khi chưa nhập kênh nào. */
export const makeShipCostEstimator = (cfg: FeeConfig): ShipEstimator | undefined => makeShipEstimator(cfg.ship.rates);

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

/**
 * Phần cấu hình phí gửi cho trình duyệt. `products` (key + tên) để gợi ý ngành cho sản phẩm chưa được người bán chọn ngành.
 */
export function feePayload(cfg: FeeConfig, products: { key: string; name: string }[] = []): FeePayload {
  const type = cfg.settings.sellerType;
  const suggestions: FeePayload["suggestions"] = {};
  for (const p of products) {
    const k = costKey(p.key);
    if (cfg.categories.has(k) || suggestions[k]) continue;
    const g = suggestCategory(type, p.name);
    if (g) suggestions[k] = { path: g.path, ratePct: g.ratePct, source: g.source };
  }
  return {
    ship: cfg.ship,
    suggestions,
    available: cfg.available,
    settings: cfg.settings,
    tableFrom: tableInfo(type).effectiveFrom,
    categories: Object.fromEntries([...cfg.categories].map(([k, path]) => [k, { path, ratePct: categoryRate(type, path) }])),
  };
}
