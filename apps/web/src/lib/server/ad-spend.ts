import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adKey, applyAdSpend, clearAdSpend, MAX_AD_ENTRIES, type AdSpendEntry } from "@/lib/profit/ad-spend";
import { commitOrderRows, findOrdersSource, loadOrderRows } from "@/lib/server/profit";
import { inWorkspaceQueue } from "@/lib/server/workspace-queue";

/**
 * Phần server của chi phí quảng cáo theo ngày: đọc/ghi bảng `ad_spend` và ghi lại cột "Chi phí quảng cáo" của nguồn đơn hàng
 * (xem `lib/profit/ad-spend.ts` về cách chia). Xếp hàng chung với việc tải file đơn và lưu giá vốn để các lần ghi không đè nhau.
 */

export interface AdSpendData {
  /** false khi bảng ad_spend chưa có (chưa chạy migration 0019). */
  available: boolean;
  entries: AdSpendEntry[];
}

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /ad_spend/.test(e.message ?? ""));

const PAGE = 1000;

/** Toàn bộ chi phí quảng cáo của workspace (phân trang 1.000 dòng). Lỗi/thiếu bảng thì trả rỗng, không làm hỏng việc gọi. */
export async function loadAdSpend(db: SupabaseClient, workspaceId: string): Promise<AdSpendData> {
  const entries: AdSpendEntry[] = [];
  try {
    for (let from = 0; from < MAX_AD_ENTRIES; from += PAGE) {
      const { data, error } = await db
        .from("ad_spend")
        .select("channel, day, amount")
        .eq("workspace_id", workspaceId)
        .order("day", { ascending: true })
        .order("channel", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return { available: !missingTable(error), entries: [] };
      const page = (data ?? []) as { channel: string; day: string; amount: number | string }[];
      for (const r of page) entries.push({ channel: r.channel, day: r.day, amount: Number(r.amount) });
      if (page.length < PAGE) break;
    }
    return { available: true, entries };
  } catch {
    return { available: false, entries: [] };
  }
}

export interface SaveAdSpendResult {
  saved: number;
  /** Số đơn được ghi chi phí quảng cáo (trên toàn bộ dữ liệu). */
  orders: number;
  /** Số dòng đơn hàng đã đổi. */
  updatedRows: number;
  /** Chi phí của file này mà không có đơn nào để chia (chưa tải file đơn của ngày đó hoặc kênh đó không có đơn). */
  unallocated: { days: number; total: number; from: string | null; to: string | null };
}

const emptyUnallocated = { days: 0, total: 0, from: null, to: null };

/**
 * Lưu chi phí quảng cáo (ghi đè theo kênh + ngày) bằng client của người dùng (RLS: owner/editor), rồi chia lại cho các đơn.
 * Chạy lại toàn bộ bảng cho nguồn đơn hàng nên kết quả luôn khớp với dữ liệu đang có.
 */
export function saveAdSpend(args: { user: SupabaseClient; admin: SupabaseClient; userId: string; workspaceId: string; entries: AdSpendEntry[] }): Promise<SaveAdSpendResult> {
  const { user, admin, userId, workspaceId, entries } = args;
  return inWorkspaceQueue(workspaceId, async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < entries.length; i += PAGE) {
      const { error } = await user.from("ad_spend").upsert(
        entries.slice(i, i + PAGE).map((e) => ({ workspace_id: workspaceId, channel: e.channel, day: e.day, amount: e.amount, updated_at: now, updated_by: userId })),
        { onConflict: "workspace_id,channel,day" },
      );
      if (error) throw Object.assign(new Error(error.message), { missingTable: missingTable(error) });
    }
    const src = await findOrdersSource(user, workspaceId);
    if (!src) return { saved: entries.length, orders: 0, updatedRows: 0, unallocated: summarizeUnallocated(entries) };
    const all = await loadAdSpend(admin, workspaceId);
    const rows = await loadOrderRows(src.id);
    const res = applyAdSpend(rows, all.entries);
    if (res.changed > 0) await commitOrderRows(admin, src.id, res.rows);
    const mine = new Set(entries.map(adKey));
    return { saved: entries.length, orders: res.orders, updatedRows: res.changed, unallocated: summarizeUnallocated(res.unallocated.filter((e) => mine.has(adKey(e)))) };
  });
}

function summarizeUnallocated(list: AdSpendEntry[]): SaveAdSpendResult["unallocated"] {
  if (list.length === 0) return emptyUnallocated;
  const days = list.map((e) => e.day).sort();
  return { days: new Set(days).size, total: list.reduce((n, e) => n + e.amount, 0), from: days[0], to: days[days.length - 1] };
}

/**
 * Xoá chi phí quảng cáo của một kênh (hoặc `*`). Các đơn mà chi phí đó từng phủ tới được đưa về trống (giá trị gốc trong file
 * đơn hàng đã bị thay khi chia nên không khôi phục được), rồi chia lại phần còn lại của các kênh khác.
 */
export function deleteAdSpend(args: { user: SupabaseClient; admin: SupabaseClient; workspaceId: string; channel: string }): Promise<{ removed: number; updatedRows: number }> {
  const { user, admin, workspaceId, channel } = args;
  return inWorkspaceQueue(workspaceId, async () => {
    const all = await loadAdSpend(admin, workspaceId);
    const gone = all.entries.filter((e) => e.channel === channel);
    if (gone.length === 0) return { removed: 0, updatedRows: 0 };
    const { error } = await user.from("ad_spend").delete().eq("workspace_id", workspaceId).eq("channel", channel);
    if (error) throw Object.assign(new Error(error.message), { missingTable: missingTable(error) });
    const src = await findOrdersSource(user, workspaceId);
    if (!src) return { removed: gone.length, updatedRows: 0 };
    const rows = await loadOrderRows(src.id);
    const cleared = clearAdSpend(rows, gone);
    const res = applyAdSpend(cleared.rows, all.entries.filter((e) => e.channel !== channel));
    if (cleared.changed + res.changed > 0) await commitOrderRows(admin, src.id, res.rows);
    return { removed: gone.length, updatedRows: cleared.changed + res.changed };
  });
}
