import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Row } from "@dashboard/chart-engine";
import { maxRowsFor } from "@/lib/google/sheet-data";
import { MAX_ROWS_PER_WORKSPACE, MAX_SOURCES_PER_WORKSPACE } from "@/lib/limits";
import { evaluateAlertsAfterChange } from "@/lib/server/alerts/after-change";
import { invalidateSourceCache } from "@/lib/server/row-cache";
import { writeSourceRows } from "@/lib/server/source-write";
import { ORDERS_SHEET_NAME, ORDERS_SOURCE_NAME, ORDERS_SPREADSHEET_ID, ORDER_COLUMNS } from "./canonical";
import { mergeOrders } from "./merge";
import { applyAdSpend } from "@/lib/profit/ad-spend";
import { applyCatalogCosts } from "@/lib/profit/catalog";
import { loadAdSpend } from "@/lib/server/ad-spend";
import { loadCatalog } from "@/lib/server/profit";
import { inWorkspaceQueue } from "@/lib/server/workspace-queue";
import type { NormalizeStats } from "./normalize";
import type { Prepared } from "./prepare";

export class ImportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface ImportResult {
  sourceId: string;
  /** true nếu lần này tạo mới nguồn "Đơn hàng đa kênh". */
  created: boolean;
  channel: string;
  lines: number;
  orders: number;
  /** Tổng số dòng của nguồn sau khi gộp (mọi kênh). */
  totalRows: number;
  stats: NormalizeStats;
  warnings: string[];
}

const CHUNK = 10_000;

/** Đọc lại toàn bộ dòng đang có của nguồn (service role), theo từng đoạn 10.000 dòng. */
async function loadExistingRows(admin: SupabaseClient, sourceId: string, expected: number): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; from < expected; from += CHUNK) {
    const { data, error } = await admin.rpc("source_rows_chunk", { p_source: sourceId, p_from: from, p_to: from + CHUNK });
    if (error) throw new ImportError("Không đọc được dữ liệu đã lưu để gộp.", 502);
    rows.push(...((data ?? []) as Row[]));
  }
  return rows;
}

/**
 * Gộp file đã chuẩn bị vào nguồn "Đơn hàng đa kênh" của workspace (tạo nguồn nếu chưa có).
 * `user` là client của người dùng (RLS kiểm quyền tạo nguồn), `admin` là service role để ghi `source_rows`.
 * Người gọi phải đã kiểm người dùng được sửa workspace.
 */
export function importOrders(args: {
  user: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  workspaceId: string;
  prepared: Prepared;
}): Promise<ImportResult> {
  const { user, admin, userId, workspaceId, prepared } = args;
  const normalized = prepared.normalized;
  if (!normalized || !prepared.channel) throw new ImportError(prepared.problems[0] ?? "File chưa đủ thông tin để nhập.", 400);

  return inWorkspaceQueue(workspaceId, async () => {
    const sel = () =>
      user
        .from("data_sources")
        .select("id, row_count")
        .eq("workspace_id", workspaceId)
        .eq("spreadsheet_id", ORDERS_SPREADSHEET_ID)
        .eq("sheet_name", ORDERS_SHEET_NAME)
        .maybeSingle();

    let { data: src } = await sel();
    let created = false;
    if (!src) {
      const { count } = await user.from("data_sources").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      if ((count ?? 0) >= MAX_SOURCES_PER_WORKSPACE) throw new ImportError(`Đã đạt giới hạn ${MAX_SOURCES_PER_WORKSPACE} nguồn dữ liệu (bản miễn phí).`, 403);
      const ins = await user
        .from("data_sources")
        .insert({
          workspace_id: workspaceId,
          spreadsheet_id: ORDERS_SPREADSHEET_ID,
          sheet_name: ORDERS_SHEET_NAME,
          name: ORDERS_SOURCE_NAME,
          created_by: userId,
          columns: ORDER_COLUMNS,
        })
        .select("id, row_count")
        .single();
      if (ins.error) {
        if (ins.error.code !== "23505") throw new ImportError(ins.error.message, 500);
        src = (await sel()).data; // tạo trùng lúc đồng thời: dùng nguồn vừa có
      } else {
        src = ins.data;
        created = true;
      }
    }
    if (!src) throw new ImportError("Không tạo được nguồn dữ liệu.", 500);
    const sourceId = src.id as string;

    try {
      const existing = created ? [] : await loadExistingRows(admin, sourceId, (src.row_count as number) ?? 0);
      // Giá vốn người dùng đã nhập ở trang "Sản phẩm và giá vốn" áp cho cả đơn mới lẫn đơn cũ.
      const catalog = await loadCatalog(admin, workspaceId);
      const withCosts = applyCatalogCosts(mergeOrders(existing, normalized.rows, normalized.keyed), catalog.map).rows;
      // Chi phí quảng cáo theo ngày (trang "Chi phí") được chia lại cho cả đơn mới lẫn đơn cũ vì tỉ lệ doanh thu trong ngày đã đổi.
      const merged = applyAdSpend(withCosts, (await loadAdSpend(admin, workspaceId)).entries).rows;

      const perSource = maxRowsFor(ORDER_COLUMNS.length);
      if (merged.length > perSource) {
        throw new ImportError(`Tổng số dòng đơn hàng sẽ là ${merged.length.toLocaleString("vi-VN")}, vượt giới hạn ${perSource.toLocaleString("vi-VN")} dòng của một nguồn. Hãy xóa nguồn rồi chỉ tải khoảng thời gian gần đây.`, 413);
      }
      const { data: others } = await admin.from("data_sources").select("row_count").eq("workspace_id", workspaceId).neq("id", sourceId);
      const usedByOthers = (others ?? []).reduce((n, o) => n + ((o.row_count as number) ?? 0), 0);
      if (usedByOthers + merged.length > MAX_ROWS_PER_WORKSPACE) {
        throw new ImportError(`Vượt hạn mức ${MAX_ROWS_PER_WORKSPACE.toLocaleString("vi-VN")} dòng dữ liệu của cả tài khoản. Hãy xóa bớt nguồn khác hoặc chỉ tải khoảng thời gian gần đây.`, 413);
      }

      await writeSourceRows(admin, sourceId, merged);
      const now = new Date().toISOString();
      const upd = await admin
        .from("data_sources")
        .update({
          columns: ORDER_COLUMNS,
          row_count: merged.length,
          last_synced_at: now,
          // Bộ nhớ đệm phía server khoá theo dấu vân tay này: mỗi lần nhập phải ra giá trị mới.
          last_sync_hash: `upload:${randomUUID()}`,
          last_error: null,
        })
        .eq("id", sourceId);
      if (upd.error) throw new ImportError(upd.error.message, 500);
      // Mốc "dữ liệu thật sự đổi" cho luật cảnh báo "không có dữ liệu mới": ghi riêng, bỏ qua lỗi nếu migration 0013 chưa chạy.
      await admin.from("data_sources").update({ data_changed_at: now }).eq("id", sourceId);
      invalidateSourceCache(sourceId);
      await evaluateAlertsAfterChange(sourceId);

      return {
        sourceId,
        created,
        channel: prepared.channel as string,
        lines: normalized.rows.length,
        orders: normalized.stats.orders,
        totalRows: merged.length,
        stats: normalized.stats,
        warnings: normalized.warnings,
      };
    } catch (e) {
      // Lần nhập đầu thất bại: bỏ nguồn rỗng vừa tạo để người dùng thử lại sạch sẽ.
      if (created) await user.from("data_sources").delete().eq("id", sourceId);
      throw e;
    }
  });
}
