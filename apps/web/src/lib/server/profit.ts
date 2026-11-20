import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Row } from "@dashboard/chart-engine";
import { ORDERS_SHEET_NAME, ORDERS_SPREADSHEET_ID } from "@/lib/orders/canonical";
import { applyCatalogCosts, catalogMap, costKey, type CostEntry } from "@/lib/profit/catalog";
import { buildOrders, summarize, type OrderProfit, type ProfitSummary } from "@/lib/profit/order-profit";
import { getSourceMeta, getSourceRows, invalidateSourceCache } from "@/lib/server/row-cache";
import { loadFeeConfig, makeFeeEstimator, type FeeConfig } from "@/lib/server/fees";
import { writeSourceRows } from "@/lib/server/source-write";
import { inWorkspaceQueue } from "@/lib/server/workspace-queue";

/**
 * Phần server của các trang lãi từng đơn: tìm nguồn "Đơn hàng đa kênh" của workspace, nạp dòng (qua bộ nhớ đệm dùng chung
 * với truy vấn dashboard), đọc/ghi bảng giá vốn và ghi lại cột "Giá vốn" của nguồn khi bảng giá vốn đổi.
 */

export interface Catalog {
  /** false khi bảng product_costs chưa có (chưa chạy migration 0017). */
  available: boolean;
  entries: CostEntry[];
  map: Map<string, number>;
}

/** Bảng chưa tồn tại (chưa chạy migration). */
const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /product_costs/.test(e.message ?? ""));

export async function loadCatalog(db: SupabaseClient, workspaceId: string): Promise<Catalog> {
  try {
    const { data, error } = await db.from("product_costs").select("sku, name, unit_cost").eq("workspace_id", workspaceId);
    if (error) return { available: !missingTable(error), entries: [], map: new Map() };
    const entries = ((data ?? []) as { sku: string; name: string | null; unit_cost: number | string }[]).map((r) => ({
      sku: r.sku,
      name: r.name ?? "",
      unitCost: Number(r.unit_cost),
    }));
    return { available: true, entries, map: catalogMap(entries) };
  } catch {
    return { available: false, entries: [], map: new Map() };
  }
}

export interface OrdersSource {
  id: string;
  rowCount: number;
  lastSyncedAt: string | null;
}

/** Nguồn "Đơn hàng đa kênh" của workspace, đọc bằng client của người dùng (RLS kiểm quyền). */
export async function findOrdersSource(supabase: SupabaseClient, workspaceId: string): Promise<OrdersSource | null> {
  const { data } = await supabase
    .from("data_sources")
    .select("id, row_count, last_synced_at")
    .eq("workspace_id", workspaceId)
    .eq("spreadsheet_id", ORDERS_SPREADSHEET_ID)
    .eq("sheet_name", ORDERS_SHEET_NAME)
    .maybeSingle();
  return data ? { id: data.id as string, rowCount: (data.row_count as number) ?? 0, lastSyncedAt: (data.last_synced_at as string | null) ?? null } : null;
}

/** Mọi dòng của nguồn đơn hàng (phiên bản hiện tại). Gọi SAU khi đã kiểm quyền. */
export async function loadOrderRows(sourceId: string): Promise<Row[]> {
  const meta = await getSourceMeta(sourceId, true);
  if (!meta) return [];
  return getSourceRows(sourceId, meta);
}

const computed = new Map<string, { orders: OrderProfit[]; summary: ProfitSummary }>();

/**
 * Đơn + tổng hợp lãi của nguồn, nhớ theo phiên bản dữ liệu (tải file / lưu giá vốn thì phiên bản đổi, tự tính lại) và theo
 * cài đặt ước tính phí (`fees`; đổi cài đặt hoặc ngành hàng thì chữ ký đổi).
 */
export async function computeProfit(sourceId: string, fees?: FeeConfig): Promise<{ orders: OrderProfit[]; summary: ProfitSummary }> {
  const meta = await getSourceMeta(sourceId, true);
  if (!meta) return { orders: [], summary: summarize([]) };
  const key = `${sourceId}|${meta.version}|${fees?.signature ?? "none"}`;
  const hit = computed.get(key);
  if (hit) return hit;
  const orders = buildOrders(await getSourceRows(sourceId, meta), fees ? makeFeeEstimator(fees) : undefined);
  const result = { orders, summary: summarize(orders) };
  for (const k of computed.keys()) if (k.startsWith(`${sourceId}|`)) computed.delete(k);
  computed.set(key, result);
  if (computed.size > 50) computed.delete(computed.keys().next().value as string);
  return result;
}

const memberCache = new Map<string, { at: number; v: { workspaceId: string; editable: boolean } | null }>();
const MEMBER_TTL_MS = 60_000;

/**
 * Workspace của người dùng và quyền sửa, chỉ MỘT truy vấn (trước đây hai lần nối đuôi), nhớ 60 giây theo người dùng.
 * Chỉ để chọn workspace và hiện/ẩn nút sửa: dữ liệu vẫn được kiểm quyền bằng RLS ở các truy vấn sau, còn các route lưu
 * kiểm lại quyền sửa không qua bộ nhớ này.
 */
export async function membershipOf(supabase: SupabaseClient, userId: string): Promise<{ workspaceId: string; editable: boolean } | null> {
  const hit = memberCache.get(userId);
  if (hit && Date.now() - hit.at < MEMBER_TTL_MS) return hit.v;
  const { data, error } = await supabase.from("workspace_members").select("workspace_id, role").eq("user_id", userId).limit(1).maybeSingle();
  if (error) return null;
  const v = data ? { workspaceId: data.workspace_id as string, editable: data.role === "owner" || data.role === "editor" } : null;
  memberCache.set(userId, { at: Date.now(), v });
  if (memberCache.size > 2000) memberCache.delete(memberCache.keys().next().value as string);
  return v;
}

/** Như `computeProfit` nhưng tự nạp cài đặt ước tính phí của workspace (qua RLS bằng client của người dùng). */
export async function computeProfitFor(db: SupabaseClient, workspaceId: string, sourceId: string): Promise<{ orders: OrderProfit[]; summary: ProfitSummary; fees: FeeConfig }> {
  const fees = await loadFeeConfig(db, workspaceId);
  return { ...(await computeProfit(sourceId, fees)), fees };
}

/** Workspace của người dùng (thành viên bất kỳ vai trò; trang xem lãi cho mọi thành viên). */
export async function workspaceOf(supabase: SupabaseClient, userId: string, editable = false): Promise<string | null> {
  let q = supabase.from("workspace_members").select("workspace_id").eq("user_id", userId);
  if (editable) q = q.in("role", ["owner", "editor"]);
  const { data } = await q.limit(1).maybeSingle();
  return (data?.workspace_id as string | undefined) ?? null;
}

export interface SaveCostsResult {
  saved: number;
  removed: number;
  /** Số dòng đơn hàng đã được ghi lại giá vốn. */
  updatedRows: number;
}

/**
 * Lưu giá vốn (thêm/sửa `upserts`, xoá `removes`) bằng client của người dùng (RLS: owner/editor), rồi ghi lại cột "Giá vốn"
 * của nguồn đơn hàng bằng service role. Xếp hàng chung với việc tải file để hai lần ghi không đè nhau.
 * Xoá một sản phẩm khỏi bảng KHÔNG xoá giá vốn đã ghi vào đơn (giữ nguyên số cũ cho tới khi nhập giá mới hoặc tải lại file).
 */
export async function saveCosts(args: {
  user: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  workspaceId: string;
  upserts: CostEntry[];
  removes: string[];
}): Promise<SaveCostsResult> {
  const { user, admin, userId, workspaceId, upserts, removes } = args;
  return inWorkspaceQueue(workspaceId, async () => {
    if (upserts.length) {
      const now = new Date().toISOString();
      const { error } = await user.from("product_costs").upsert(
        upserts.map((e) => ({ workspace_id: workspaceId, sku: e.sku.trim(), name: (e.name ?? "").slice(0, 200), unit_cost: e.unitCost, updated_at: now, updated_by: userId })),
        { onConflict: "workspace_id,sku" },
      );
      if (error) throw Object.assign(new Error(error.message), { missingTable: missingTable(error) });
    }
    if (removes.length) {
      const { error } = await user.from("product_costs").delete().eq("workspace_id", workspaceId).in("sku", removes);
      if (error) throw Object.assign(new Error(error.message), { missingTable: missingTable(error) });
    }

    const src = await findOrdersSource(user, workspaceId);
    if (!src) return { saved: upserts.length, removed: removes.length, updatedRows: 0 };
    const catalog = await loadCatalog(admin, workspaceId);
    // Chỉ áp cho những sản phẩm vừa lưu: sản phẩm khác giữ nguyên.
    const touched = new Map([...catalog.map].filter(([k]) => upserts.some((u) => costKey(u.sku) === k)));
    const rows = await loadOrderRows(src.id);
    const { rows: next, changed } = applyCatalogCosts(rows, touched);
    if (changed > 0) {
      await writeSourceRows(admin, src.id, next);
      const now = new Date().toISOString();
      const upd = await admin.from("data_sources").update({ last_sync_hash: `upload:${randomUUID()}`, last_synced_at: now }).eq("id", src.id);
      if (upd.error) throw new Error(upd.error.message);
      await admin.from("data_sources").update({ data_changed_at: now }).eq("id", src.id);
      invalidateSourceCache(src.id);
    }
    return { saved: upserts.length, removed: removes.length, updatedRows: changed };
  });
}
