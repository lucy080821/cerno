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

// Đoạn nhỏ để mỗi truy vấn xong xa dưới giới hạn 8 giây của Supabase gói miễn phí.
const CHUNK = 2_000;

/** Đọc lại toàn bộ dòng đang có của nguồn (service role), theo từng đoạn 2.000 dòng, thử lại khi lỗi tạm thời. */
async function loadExistingRows(admin: SupabaseClient, sourceId: string, expected: number): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; from < expected; from += CHUNK) {
    let data: unknown = null;
    let failed = true;
    for (let attempt = 0; attempt < 3 && failed; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
      const res = await admin.rpc("source_rows_chunk", { p_source: sourceId, p_from: from, p_to: from + CHUNK });
      failed = !!res.error;
      data = res.data;
    }
    if (failed) throw new ImportError("Không đọc được dữ liệu đã lưu để gộp.", 502);
    for (const r of (data ?? []) as Row[]) rows.push(r);
  }
  return rows;
}

export interface CommitResult {
  sourceId: string;
  created: boolean;
  /** Tổng số dòng của nguồn sau khi ghi (mọi kênh). */
  totalRows: number;
}

/**
 * Ghi bảng đơn hàng mới của workspace vào nguồn "Đơn hàng đa kênh" (tạo nguồn nếu chưa có): đọc dòng đang có, để `build` quyết định
 * bảng mới (gộp file, hay thay dữ liệu một kênh theo Google Sheet), áp giá vốn và chi phí quảng cáo đã lưu, kiểm hạn mức rồi ghi.
 * Dùng chung cho tải file và đồng bộ Sheet. NGƯỜI GỌI phải giữ `inWorkspaceQueue` của workspace và đã kiểm quyền sửa.
 * `user` là client của người dùng (RLS kiểm quyền tạo nguồn); đồng bộ nền (bộ hẹn giờ) không có người dùng thì truyền `admin`.
 */
export async function writeCanonicalOrders(args: {
  user: SupabaseClient;
  admin: SupabaseClient;
  /** Người tạo nguồn khi nguồn chưa có (đồng bộ nền không biết người dùng thì null). */
  userId: string | null;
  workspaceId: string;
  build: (existing: Row[]) => Row[];
}): Promise<CommitResult> {
  const { user, admin, userId, workspaceId } = args;
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
    const withCosts = applyCatalogCosts(args.build(existing), catalog.map).rows;
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
        // Bộ nhớ đệm phía server khoá theo dấu vân tay này: mỗi lần ghi phải ra giá trị mới.
        last_sync_hash: `upload:${randomUUID()}`,
        last_error: null,
      })
      .eq("id", sourceId);
    if (upd.error) throw new ImportError(upd.error.message, 500);
    // Mốc "dữ liệu thật sự đổi" cho luật cảnh báo "không có dữ liệu mới": ghi riêng, bỏ qua lỗi nếu migration 0013 chưa chạy.
    await admin.from("data_sources").update({ data_changed_at: now }).eq("id", sourceId);
    invalidateSourceCache(sourceId);
    await evaluateAlertsAfterChange(sourceId);
    return { sourceId, created, totalRows: merged.length };
  } catch (e) {
    // Lần ghi đầu thất bại: bỏ nguồn rỗng vừa tạo để người dùng thử lại sạch sẽ.
    if (created) await user.from("data_sources").delete().eq("id", sourceId);
    throw e;
  }
}

/**
 * Kênh đang lấy dữ liệu từ một Google Sheet (bảng order_sheets) thì KHÔNG nhận file tải lên: hai nguồn cùng ghi một kênh sẽ chồng lên
 * nhau và lệch số. Chưa chạy migration 0022 (không có bảng) thì coi như không bị chặn.
 */
export async function assertChannelFreeForUpload(db: SupabaseClient, workspaceId: string, channel: string): Promise<void> {
  const { data, error } = await db.from("order_sheets").select("id, name").eq("workspace_id", workspaceId).eq("channel", channel).maybeSingle();
  if (error || !data) return;
  throw new ImportError(
    `Kênh ${channel} đang lấy dữ liệu từ Google Sheet "${data.name as string}". Hãy thêm dữ liệu vào Sheet đó (rồi bấm Cập nhật), hoặc ngắt kết nối Sheet ở trang Nguồn dữ liệu trước khi tải file lên.`,
    409,
  );
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
  const channel = prepared.channel;

  return inWorkspaceQueue(workspaceId, async () => {
    await assertChannelFreeForUpload(user, workspaceId, channel);
    const r = await writeCanonicalOrders({
      user,
      admin,
      userId,
      workspaceId,
      build: (existing) => mergeOrders(existing, normalized.rows, normalized.keyed),
    });
    return {
      sourceId: r.sourceId,
      created: r.created,
      channel,
      lines: normalized.rows.length,
      orders: normalized.stats.orders,
      totalRows: r.totalRows,
      stats: normalized.stats,
      warnings: normalized.warnings,
    };
  });
}
