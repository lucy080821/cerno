import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costKey, findByKey } from "@/lib/profit/catalog";
import { productKey, type FeeEstimator } from "@/lib/profit/order-profit";
import {
  DEFAULT_FEE_SETTINGS, FEE_PLATFORMS, defaultRatePct, MAX_AFFILIATE_PCT, isFeePlatform, isSellerType,
  type FeePayload, type FeePlatform, type FeeSettings, type ManualFeeRate, type PlatformFeePayload, type SellerType,
} from "@/lib/fees/constants";
import { estimateManualFee, estimateOrderFee, estimateTiktokFee } from "@/lib/fees/estimate";
import { MATCH_VERSION, suggestCategory } from "@/lib/fees/match";
import { categoryRate, tableInfo } from "@/lib/fees/tables";
import { CHANNELS } from "@/lib/orders/canonical";
import { cleanShipRates, makeShipEstimator, type ShipEstimator, type ShipRates } from "@/lib/profit/shipping";

/**
 * Cài đặt, ngành hàng và phí tự nhập để ƯỚC TÍNH phí sàn (migration 0018, 0021). Thiếu bảng (chưa chạy migration) thì `available = false`:
 * các trang vẫn chạy, chỉ là không ước tính được. Chưa chạy 0021 (`multiPlatform = false`) thì chỉ có Shopee.
 */
export interface FeeConfig {
  available: boolean;
  /** Đã chạy migration 0021: ngành theo từng sàn, cài đặt TikTok Shop. */
  multiPlatform: boolean;
  settings: FeeSettings;
  /** Theo sàn: costKey(sku) → đường dẫn ngành hàng. */
  categories: Record<FeePlatform, Map<string, string>>;
  /** Phí tự nhập cho các kênh không có biểu phí (migration 0021). */
  manual: { available: boolean; rates: Record<string, ManualFeeRate> };
  /** Phí ship shop chịu ước tính theo kênh (migration 0020); độc lập với bảng phí sàn. */
  ship: { available: boolean; rates: ShipRates };
  /** costKey(sku) của các ngành do AI phân (chưa được người bán xác nhận), theo sàn; có từ migration 0026. */
  aiSourced?: Record<FeePlatform, Set<string>>;
  /** Đã chạy migration 0026 (cột `source` của product_fee_categories). */
  sourceColumn?: boolean;
  /** Chữ ký nội dung, dùng làm khoá bộ nhớ đệm tính lãi. */
  signature: string;
}

const NO_SHIP = { available: false, rates: {} as ShipRates };
const NO_MANUAL = { available: false, rates: {} as Record<string, ManualFeeRate> };
const emptyCategories = (): FeeConfig["categories"] => ({ Shopee: new Map(), "TikTok Shop": new Map() });

const isMissing = (e: { code?: string; message?: string } | null | undefined, re: RegExp) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || re.test(e.message ?? ""));
const isMissingColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|Could not find the .* column/i.test(e.message ?? ""));

const EMPTY: FeeConfig = {
  available: false, multiPlatform: false, settings: DEFAULT_FEE_SETTINGS, categories: emptyCategories(), manual: NO_MANUAL, ship: NO_SHIP, signature: "none",
};

const sign = (cfg: Pick<FeeConfig, "settings" | "categories" | "manual" | "ship">): string =>
  createHash("sha1")
    .update(JSON.stringify([
      cfg.settings,
      FEE_PLATFORMS.map((p) => [...cfg.categories[p].entries()].sort()),
      Object.entries(cfg.manual.rates).sort(),
      Object.entries(cfg.ship.rates).sort(),
      MATCH_VERSION,
    ]))
    .digest("hex")
    .slice(0, 16);

/** Phí ship shop chịu theo kênh. Lỗi hoặc chưa có bảng thì coi như chưa nhập, không làm hỏng việc tính lãi. */
export async function loadShipRates(db: SupabaseClient, workspaceId: string): Promise<{ available: boolean; rates: ShipRates }> {
  try {
    const { data, error } = await db.from("shipping_costs").select("channel, per_order, per_return").eq("workspace_id", workspaceId);
    if (error) return { available: !isMissing(error, /shipping_costs/), rates: {} };
    const raw: Record<string, { perOrder: number; perReturn: number }> = {};
    for (const r of (data ?? []) as { channel: string; per_order: number | string; per_return: number | string }[]) raw[r.channel] = { perOrder: Number(r.per_order), perReturn: Number(r.per_return) };
    return { available: true, rates: cleanShipRates(raw) };
  } catch {
    return NO_SHIP;
  }
}

/** Kênh được nhập phí tự nhập: mọi kênh trừ các sàn đã có biểu phí. */
export const isManualChannel = (v: unknown): v is string => typeof v === "string" && (CHANNELS as readonly string[]).includes(v) && !isFeePlatform(v);
export const MAX_MANUAL_PCT = { commission: 60, payment: 20 };
export const MAX_MANUAL_PER_ORDER = 1_000_000;

const okNum = (n: unknown, max: number): number => (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max ? n : 0);

/** Giữ các kênh hợp lệ có ít nhất một mức khác 0. */
export function cleanManualRates(raw: unknown): Record<string, ManualFeeRate> {
  const out: Record<string, ManualFeeRate> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [ch, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isManualChannel(ch) || !v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const commissionPct = Math.round(okNum(r.commissionPct, MAX_MANUAL_PCT.commission) * 100) / 100;
    const paymentPct = Math.round(okNum(r.paymentPct, MAX_MANUAL_PCT.payment) * 100) / 100;
    const perOrder = Math.round(okNum(r.perOrder, MAX_MANUAL_PER_ORDER));
    if (commissionPct > 0 || paymentPct > 0 || perOrder > 0) out[ch] = { commissionPct, paymentPct, perOrder };
  }
  return out;
}

export async function loadManualRates(db: SupabaseClient, workspaceId: string): Promise<FeeConfig["manual"]> {
  try {
    const { data, error } = await db.from("channel_fee_rates").select("channel, commission_pct, payment_pct, per_order").eq("workspace_id", workspaceId);
    if (error) return { available: !isMissing(error, /channel_fee_rates/), rates: {} };
    const raw: Record<string, ManualFeeRate> = {};
    for (const r of (data ?? []) as { channel: string; commission_pct: number | string; payment_pct: number | string; per_order: number | string }[]) {
      raw[r.channel] = { commissionPct: Number(r.commission_pct), paymentPct: Number(r.payment_pct), perOrder: Number(r.per_order) };
    }
    return { available: true, rates: cleanManualRates(raw) };
  } catch {
    return NO_MANUAL;
  }
}

const pct = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_AFFILIATE_PCT ? n : 0;
};

export async function loadFeeConfig(db: SupabaseClient, workspaceId: string): Promise<FeeConfig> {
  try {
    const [s, c, manual, ship] = await Promise.all([
      db.from("fee_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
      db.from("product_fee_categories").select("sku, category, channel, source").eq("workspace_id", workspaceId),
      loadManualRates(db, workspaceId),
      loadShipRates(db, workspaceId),
    ]);
    // Chưa chạy 0026 thì cột source chưa có; chưa chạy 0021 thì cột channel chưa có (mọi dòng là của Shopee). Đọc lại bớt cột tương ứng.
    let multiPlatform = !c.error;
    let sourceColumn = !c.error;
    let catRows = (c.data ?? []) as { sku: string; category: string; channel?: string; source?: string }[];
    let catError = c.error;
    if (c.error && isMissingColumn(c.error)) {
      sourceColumn = false;
      const noSource = await db.from("product_fee_categories").select("sku, category, channel").eq("workspace_id", workspaceId);
      if (!noSource.error) {
        catError = null;
        catRows = (noSource.data ?? []) as { sku: string; category: string; channel?: string }[];
      } else if (isMissingColumn(noSource.error)) {
        const legacy = await db.from("product_fee_categories").select("sku, category").eq("workspace_id", workspaceId);
        catError = legacy.error;
        catRows = (legacy.data ?? []) as { sku: string; category: string }[];
        multiPlatform = false;
      } else catError = noSource.error;
    }
    // Bảng phí sàn chưa có (chưa chạy 0018) vẫn dùng được phí ship / phí tự nhập nếu có.
    if (s.error || catError) {
      const partial = { ...EMPTY, manual, ship };
      return { ...partial, signature: sign(partial) };
    }
    const row = s.data as Record<string, unknown> | null;
    const settings: FeeSettings = row
      ? {
          enabled: !!row.estimate_enabled,
          sellerType: isSellerType(row.seller_type) ? row.seller_type : "non_mall",
          newSeller: !!row.new_seller,
          tiktokSellerType: isSellerType(row.tiktok_seller_type) ? row.tiktok_seller_type : "non_mall",
          tiktokAffiliatePct: pct(row.tiktok_affiliate_pct),
        }
      : DEFAULT_FEE_SETTINGS;
    const categories = emptyCategories();
    const aiSourced: Record<FeePlatform, Set<string>> = { Shopee: new Set(), "TikTok Shop": new Set() };
    for (const r of catRows) {
      const p: FeePlatform = isFeePlatform(r.channel) ? r.channel : "Shopee";
      categories[p].set(costKey(r.sku), r.category);
      if (r.source === "ai") aiSourced[p].add(costKey(r.sku));
    }
    const cfg = { available: true, multiPlatform, settings, categories, manual, ship, aiSourced, sourceColumn };
    return { ...cfg, signature: sign(cfg) };
  } catch {
    return EMPTY;
  }
}

export const sellerTypeOf = (s: FeeSettings, p: FeePlatform): SellerType => (p === "Shopee" ? s.sellerType : s.tiktokSellerType);

/** Ngành hàng của một sản phẩm: người bán đã chọn (kể cả thừa hưởng từ mã gốc) hoặc Cerno tự nhận diện từ tên. */
export interface CategoryChoice {
  path: string;
  source: "chosen" | "suggested";
}

/**
 * Ngành hàng của một sản phẩm trên MỘT sàn có biểu phí. Dùng chung cho ước tính phí sàn và cho báo cáo (AI, trang lãi) nên cùng một
 * sản phẩm luôn ra cùng một ngành. Không phụ thuộc công tắc "ước tính phí": nhận diện theo tên chạy được kể cả khi chưa bật.
 */
export function categoryFor(cfg: FeeConfig, platform: FeePlatform, key: string | null, name: string | null): CategoryChoice | null {
  const chosen = key ? findByKey(cfg.categories[platform], key) : undefined;
  if (chosen !== undefined) return { path: chosen, source: "chosen" };
  const guess = suggestCategory(platform, sellerTypeOf(cfg.settings, platform), name ?? key);
  return guess ? { path: guess.path, source: "suggested" } : null;
}

/** Ngành hàng của một sản phẩm tổng hợp từ các đơn (có thể bán ở nhiều kênh): lấy theo sàn đầu tiên (Shopee rồi TikTok Shop) xác định được ngành; kênh khác không có biểu ngành. */
export function categoryOfProduct(cfg: FeeConfig, p: { key: string; name: string; channels: string[] }): (CategoryChoice & { platform: FeePlatform }) | null {
  for (const platform of FEE_PLATFORMS) {
    if (!p.channels.includes(platform)) continue;
    const c = categoryFor(cfg, platform, p.key, p.name);
    if (c) return { ...c, platform };
  }
  return null;
}

/**
 * Bộ ước tính phí cho `buildOrders`; undefined khi không có gì để ước tính. Có ba nguồn:
 * - Shopee, TikTok Shop (khi bật ước tính): biểu phí theo ngành. Sản phẩm người bán chưa chọn ngành thì dùng ngành Cerno tự nhận diện
 *   từ tên (lib/fees/match.ts; giao diện nhắc kiểm tra lại). Shopee chưa rõ ngành thì chưa ước tính đơn đó; TikTok Shop chưa rõ ngành
 *   thì dùng mức phí mặc định của TikTok.
 * - Kênh khác (Lazada, Tiki...): tỷ lệ phí người bán tự nhập.
 */
export function makeFeeEstimator(cfg: FeeConfig): FeeEstimator | undefined {
  const platformsOn = cfg.available && cfg.settings.enabled;
  const manual = cfg.manual.rates;
  if (!platformsOn && Object.keys(manual).length === 0) return undefined;
  const s = cfg.settings;
  /** Mức phí theo ngành của từng dòng đơn trên một sàn. */
  const lineRates = (platform: FeePlatform, o: Parameters<FeeEstimator>[0]) =>
    o.lines.map((l) => ({
      gross: l.gross,
      ratePct: categoryRate(platform, sellerTypeOf(s, platform), categoryFor(cfg, platform, productKey(l.sku, l.product), l.product ?? l.sku)?.path),
    }));
  return (o) => {
    if (o.channel === "Shopee" && platformsOn) {
      // Sản phẩm chưa rõ ngành dùng mức mặc định (trung vị của biểu phí) thay vì bỏ trống phí.
      return estimateOrderFee({ date: o.date, lines: lineRates("Shopee", o), buyerShipping: o.shippingIn, settings: { sellerType: s.sellerType, newSeller: s.newSeller }, defaultRatePct: defaultRatePct("Shopee", s.sellerType) })?.total ?? null;
    }
    if (o.channel === "TikTok Shop" && platformsOn) {
      return estimateTiktokFee({ date: o.date, returned: o.status === "Hoàn trả", lines: lineRates("TikTok Shop", o), buyerShipping: o.shippingIn, settings: s })?.total ?? null;
    }
    const rate = manual[o.channel];
    if (rate && !isFeePlatform(o.channel)) return estimateManualFee(rate, o.lines, o.status === "Hoàn trả");
    return null;
  };
}

/** Bộ ước tính phí ship shop chịu cho `buildOrders`; undefined khi chưa nhập kênh nào. */
export const makeShipCostEstimator = (cfg: FeeConfig): ShipEstimator | undefined => makeShipEstimator(cfg.ship.rates);

export interface SaveFeeConfigArgs {
  user: SupabaseClient;
  userId: string;
  workspaceId: string;
  /** Đã chạy migration 0021 (xem FeeConfig.multiPlatform). */
  multiPlatform: boolean;
  settings?: FeeSettings;
  platform: FeePlatform;
  upserts: { sku: string; category: string; /** "ai" = AI phân ngành, chưa xác nhận (cần migration 0026). Mặc định "user". */ source?: "user" | "ai" }[];
  removes: string[];
  /** Đã chạy migration 0026 (xem FeeConfig.sourceColumn). */
  sourceColumn?: boolean;
}

/** Ném lỗi có `missingTable` (chưa chạy 0018) hoặc `needsMulti` (cần 0021). */
const fail = (error: { code?: string; message: string }, extra: { needsMulti?: boolean; needsSource?: boolean } = {}): never => {
  throw Object.assign(new Error(error.message), { missingTable: isMissing(error, /fee_settings|product_fee_categories/), ...extra });
};

/** Lưu cài đặt và ngành hàng bằng client của người dùng (RLS: owner/editor). */
export async function saveFeeConfig(a: SaveFeeConfigArgs): Promise<void> {
  const now = new Date().toISOString();
  const needMulti = () => fail({ message: "needs migration 0021" }, { needsMulti: true });
  if (a.settings) {
    const base = { workspace_id: a.workspaceId, estimate_enabled: a.settings.enabled, seller_type: a.settings.sellerType, new_seller: a.settings.newSeller, updated_at: now, updated_by: a.userId };
    const tiktokChanged = a.settings.tiktokSellerType !== DEFAULT_FEE_SETTINGS.tiktokSellerType || a.settings.tiktokAffiliatePct !== DEFAULT_FEE_SETTINGS.tiktokAffiliatePct;
    if (!a.multiPlatform && tiktokChanged) needMulti();
    const row = a.multiPlatform ? { ...base, tiktok_seller_type: a.settings.tiktokSellerType, tiktok_affiliate_pct: a.settings.tiktokAffiliatePct } : base;
    const { error } = await a.user.from("fee_settings").upsert(row, { onConflict: "workspace_id" });
    if (error) fail(error);
  }
  if (a.upserts.length) {
    if (!a.multiPlatform && a.platform !== "Shopee") needMulti();
    if (!a.sourceColumn && a.upserts.some((u) => u.source === "ai")) fail({ message: "needs migration 0026" }, { needsSource: true });
    const rows = a.upserts.map((u) => {
      // Có cột source thì luôn ghi rõ: người bán chọn/xác nhận lại một ngành AI phân thì nó trở thành "user".
      const r = { workspace_id: a.workspaceId, sku: u.sku.trim(), category: u.category, updated_at: now, updated_by: a.userId, ...(a.sourceColumn ? { source: u.source ?? "user" } : {}) };
      return a.multiPlatform ? { ...r, channel: a.platform } : r;
    });
    const { error } = await a.user.from("product_fee_categories").upsert(rows, { onConflict: a.multiPlatform ? "workspace_id,sku,channel" : "workspace_id,sku" });
    if (error) fail(error);
  }
  if (a.removes.length) {
    if (!a.multiPlatform && a.platform !== "Shopee") needMulti();
    let q = a.user.from("product_fee_categories").delete().eq("workspace_id", a.workspaceId).in("sku", a.removes);
    if (a.multiPlatform) q = q.eq("channel", a.platform);
    const { error } = await q;
    if (error) fail(error);
  }
}

/** Lưu phí tự nhập theo kênh (kênh có cả ba mức bằng 0 thì xoá). */
export async function saveManualRates(a: { user: SupabaseClient; userId: string; workspaceId: string; rates: Record<string, ManualFeeRate> }): Promise<{ saved: number; removed: number }> {
  const upserts: { channel: string; r: ManualFeeRate }[] = [];
  const removes: string[] = [];
  for (const [channel, raw] of Object.entries(a.rates)) {
    const r = cleanManualRates({ [channel]: raw })[channel];
    if (r) upserts.push({ channel, r });
    else removes.push(channel);
  }
  const now = new Date().toISOString();
  const wrap = (error: { code?: string; message: string }) => {
    throw Object.assign(new Error(error.message), { missingTable: isMissing(error, /channel_fee_rates/) });
  };
  if (upserts.length) {
    const { error } = await a.user.from("channel_fee_rates").upsert(
      upserts.map((u) => ({ workspace_id: a.workspaceId, channel: u.channel, commission_pct: u.r.commissionPct, payment_pct: u.r.paymentPct, per_order: u.r.perOrder, updated_at: now, updated_by: a.userId })),
      { onConflict: "workspace_id,channel" },
    );
    if (error) wrap(error);
  }
  if (removes.length) {
    const { error } = await a.user.from("channel_fee_rates").delete().eq("workspace_id", a.workspaceId).in("channel", removes);
    if (error && !isMissing(error, /channel_fee_rates/)) wrap(error);
  }
  return { saved: upserts.length, removed: removes.length };
}

export interface PayloadProduct {
  key: string;
  name: string;
  /** Các kênh sản phẩm có đơn. */
  channels: string[];
}

/**
 * Phần cấu hình phí gửi cho trình duyệt. `products` (key, tên, kênh) để gợi ý ngành cho sản phẩm chưa được người bán chọn ngành và
 * để mã biến thể thừa hưởng ngành của mã gốc.
 */
export function feePayload(cfg: FeeConfig, products: PayloadProduct[] = []): FeePayload {
  const platforms = {} as Record<FeePlatform, PlatformFeePayload>;
  for (const p of FEE_PLATFORMS) {
    const type = sellerTypeOf(cfg.settings, p);
    const cats = cfg.categories[p];
    const categories: PlatformFeePayload["categories"] = {};
    const ai = cfg.aiSourced?.[p];
    for (const [k, path] of cats) categories[k] = { path, ratePct: categoryRate(p, type, path), ...(ai?.has(k) ? { ai: true } : {}) };
    const suggestions: PlatformFeePayload["suggestions"] = {};
    for (const pr of products) {
      if (!pr.channels.includes(p)) continue;
      const k = costKey(pr.key);
      if (categories[k] || suggestions[k]) continue;
      const inherited = findByKey(cats, pr.key); // biến thể thừa hưởng ngành của mã gốc
      if (inherited !== undefined) {
        categories[k] = { path: inherited, ratePct: categoryRate(p, type, inherited) };
        continue;
      }
      const g = suggestCategory(p, type, pr.name);
      if (g) suggestions[k] = { path: g.path, ratePct: g.ratePct, source: g.source };
    }
    platforms[p] = { sellerType: type, tableFrom: tableInfo(p, type).effectiveFrom, defaultRatePct: defaultRatePct(p, type), categories, suggestions };
  }
  return { ship: cfg.ship, available: cfg.available, multiPlatform: cfg.multiPlatform, settings: cfg.settings, platforms, manual: cfg.manual };
}
