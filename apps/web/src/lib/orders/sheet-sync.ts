import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Row } from "@dashboard/chart-engine";
import { GoogleAuthError, getAccessToken, readTab } from "@/lib/google/api";
import { isDue } from "@/lib/google/constants";
import { hashValues, maxRowsFor } from "@/lib/google/sheet-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { inWorkspaceQueue } from "@/lib/server/workspace-queue";
import { COL, ORDERS_SHEET_NAME, ORDERS_SPREADSHEET_ID, ORDER_COLUMNS, type ColumnMapping } from "./canonical";
import { ImportError, writeCanonicalOrders } from "./import";
import { mappingToNames, prepareSheetTable, sanitizeNamedMapping, type NamedMapping, type SheetPrepared } from "./sheet-table";

/**
 * Google Sheet làm nguồn ĐƠN HÀNG: mỗi tab (một kênh bán) được đọc lại, chuẩn hoá như file tải lên rồi THAY toàn bộ dòng của kênh đó trong
 * nguồn "Đơn hàng đa kênh". Sheet là bản đúng duy nhất nên không có bước gộp theo mã đơn: người dùng sửa hoặc xoá dòng trong Sheet thì số
 * liệu đổi theo ở lần đồng bộ sau. Nội dung gốc của Sheet không được lưu, chỉ các cột đã ánh xạ (xem migration 0022).
 */

export class SheetSyncError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export interface OrderSheetRow {
  id: string;
  workspace_id: string;
  spreadsheet_id: string;
  sheet_name: string;
  name: string;
  channel: string;
  mapping: unknown;
  created_by: string | null;
  sync_interval_minutes: number;
  last_synced_at: string | null;
  last_attempt_at: string | null;
  last_sync_hash: string | null;
  last_error: string | null;
  line_count: number;
  order_count: number;
  warnings: unknown;
}

export const ORDER_SHEET_COLUMNS =
  "id, workspace_id, spreadsheet_id, sheet_name, name, channel, mapping, created_by, sync_interval_minutes, last_synced_at, last_attempt_at, last_sync_hash, last_error, line_count, order_count, warnings";

export interface SheetDeps {
  admin: SupabaseClient;
  /** Đọc tab (mặc định gọi Google Sheets API); test truyền bản giả. */
  read?: typeof readTab;
  /** Lấy access token theo người dùng (mặc định đổi refresh token đã lưu). */
  token?: (userId: string) => Promise<string>;
}

/** Số dòng tối đa đọc từ một tab: bằng giới hạn dòng của nguồn đơn hàng (cộng vài dòng tiêu đề/ghi chú). */
const READ_CAP = maxRowsFor(ORDER_COLUMNS.length) + 20;
const MAX_PER_RUN = 10;

const live = (deps: Partial<SheetDeps> = {}) => ({
  admin: deps.admin ?? createAdminClient(),
  read: deps.read ?? readTab,
  token: deps.token ?? getAccessToken,
});

async function readValues(read: typeof readTab, token: string, row: Pick<OrderSheetRow, "spreadsheet_id" | "sheet_name">): Promise<string[][]> {
  const values = await read(token, row.spreadsheet_id, row.sheet_name, READ_CAP);
  if (values.length > READ_CAP) {
    throw new SheetSyncError(`Tab có quá nhiều dòng (tối đa khoảng ${(READ_CAP - 20).toLocaleString("vi-VN")} dòng đơn hàng). Hãy chuyển các đơn cũ sang một tab khác hoặc xoá bớt.`, 413);
  }
  return values;
}

const warningsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : []);

/** Dấu vân tay: nội dung tab + kênh + cột đã ánh xạ (đổi một trong ba thì phải ghi lại). */
const fingerprint = (values: string[][], row: Pick<OrderSheetRow, "channel" | "mapping">) => `${hashValues(values)}|${row.channel}|${JSON.stringify(row.mapping ?? {})}`;

async function canonicalHasRows(admin: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data } = await admin
    .from("data_sources")
    .select("row_count")
    .eq("workspace_id", workspaceId)
    .eq("spreadsheet_id", ORDERS_SPREADSHEET_ID)
    .eq("sheet_name", ORDERS_SHEET_NAME)
    .maybeSingle();
  return ((data?.row_count as number | undefined) ?? 0) > 0;
}

export interface OrderSheetSyncResult {
  changed: boolean;
  lines: number;
  orders: number;
  warnings: string[];
  syncedAt: string;
}

/** Thay các dòng của kênh bằng dữ liệu đã chuẩn bị của Sheet rồi ghi trạng thái. Caller đã kiểm `prepared` không có vấn đề. */
async function applyPrepared(admin: SupabaseClient, row: OrderSheetRow, prepared: SheetPrepared, hash: string): Promise<OrderSheetSyncResult> {
  const normalized = prepared.normalized;
  const channel = prepared.channel;
  if (!normalized || !channel) throw new SheetSyncError(prepared.problems[0] ?? "Tab chưa đủ thông tin để đồng bộ.");
  const incoming = normalized.rows;
  await inWorkspaceQueue(row.workspace_id, () =>
    writeCanonicalOrders({
      user: admin,
      admin,
      userId: row.created_by,
      workspaceId: row.workspace_id,
      build: (existing: Row[]) => [...existing.filter((r) => r[COL.channel] !== channel), ...incoming],
    }),
  );
  const syncedAt = new Date().toISOString();
  const warnings = [...prepared.warnings];
  const upd = await admin
    .from("order_sheets")
    .update({ last_synced_at: syncedAt, last_sync_hash: hash, last_error: null, line_count: incoming.length, order_count: normalized.stats.orders, warnings })
    .eq("id", row.id);
  if (upd.error) throw new Error(upd.error.message);
  return { changed: true, lines: incoming.length, orders: normalized.stats.orders, warnings, syncedAt };
}

/**
 * Đọc lại một tab đơn hàng và cập nhật nguồn "Đơn hàng đa kênh". Tab không đổi (so dấu vân tay) thì chỉ ghi giờ cập nhật. Lỗi (mất cột,
 * mã đơn hỏng, Google từ chối...) thì GIỮ NGUYÊN dữ liệu đang có, ghi lỗi vào `last_error` để người dùng thấy và sửa Sheet.
 * Người gọi phải đã kiểm quyền (người dùng sửa được workspace, hoặc bộ hẹn giờ đã xác thực).
 */
export async function syncOrderSheet(id: string, userId: string | null, tokenOverride?: string, deps: Partial<SheetDeps> = {}): Promise<OrderSheetSyncResult> {
  const { admin, read, token } = live(deps);
  const { data, error } = await admin.from("order_sheets").select(ORDER_SHEET_COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) throw new SheetSyncError("Không tìm thấy Sheet đơn hàng.", 404);
  const row = data as OrderSheetRow;
  const uid = userId ?? row.created_by;
  if (!uid) throw new SheetSyncError("Sheet này chưa gắn với tài khoản nào có quyền Google. Hãy nối lại Sheet.", 403);

  // Ghi nhận lần thử trước khi gọi Google: nếu tiến trình chết giữa chừng thì lần sau vẫn tôn trọng thời gian chờ.
  await admin.from("order_sheets").update({ last_attempt_at: new Date().toISOString() }).eq("id", id);
  try {
    const values = await readValues(read, tokenOverride ?? (await token(uid)), row);
    const hash = fingerprint(values, row);
    if (row.last_sync_hash === hash && !row.last_error && (await canonicalHasRows(admin, row.workspace_id))) {
      const syncedAt = new Date().toISOString();
      await admin.from("order_sheets").update({ last_synced_at: syncedAt }).eq("id", id);
      return { changed: false, lines: row.line_count, orders: row.order_count, warnings: warningsOf(row.warnings), syncedAt };
    }
    const prepared = prepareSheetTable(values, { channel: row.channel, named: sanitizeNamedMapping(row.mapping) });
    if (prepared.problems.length || !prepared.normalized) throw new SheetSyncError(prepared.problems[0] ?? "Tab chưa đủ thông tin để đồng bộ.");
    return await applyPrepared(admin, row, prepared, hash);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Lỗi không xác định";
    await admin.from("order_sheets").update({ last_error: msg }).eq("id", id);
    throw e;
  }
}

export interface ConnectArgs {
  /** Client của người dùng: RLS kiểm quyền thêm. */
  user: SupabaseClient;
  userId: string;
  workspaceId: string;
  token: string;
  spreadsheetId: string;
  sheetName: string;
  name: string;
  channel: string;
  /** Ánh xạ người dùng đã xem và chỉnh (chỉ số cột). */
  mapping: unknown;
}

export interface InspectResult {
  prepared: SheetPrepared;
  rows: number;
}

/** Đọc tab và chuẩn bị xem trước. KHÔNG ghi gì. */
export async function inspectOrderSheet(args: { token: string; spreadsheetId: string; sheetName: string; channel?: unknown; mapping?: unknown }, deps: Partial<SheetDeps> = {}): Promise<InspectResult> {
  const { read } = live(deps);
  const values = await readValues(read, args.token, { spreadsheet_id: args.spreadsheetId, sheet_name: args.sheetName });
  return { prepared: prepareSheetTable(values, { channel: args.channel, mapping: args.mapping }), rows: values.length };
}

/**
 * Nối một tab Sheet làm nguồn đơn hàng của một kênh rồi đồng bộ lần đầu (thay dữ liệu hiện có của kênh đó). Lần đồng bộ đầu lỗi thì
 * bỏ bản ghi vừa tạo để người dùng thử lại sạch sẽ.
 */
export async function connectOrderSheet(args: ConnectArgs, deps: Partial<SheetDeps> = {}): Promise<{ id: string } & OrderSheetSyncResult> {
  const { admin, read } = live(deps);
  const { user, workspaceId } = args;

  // Kiểm trước để báo lỗi dễ hiểu (ràng buộc duy nhất của DB chỉ cho mã lỗi chung).
  const sameChannel = await user.from("order_sheets").select("name").eq("workspace_id", workspaceId).eq("channel", args.channel).maybeSingle();
  if (sameChannel.data) throw new SheetSyncError(`Kênh ${args.channel} đã nối với Sheet "${sameChannel.data.name as string}". Mỗi kênh chỉ nối một Sheet: hãy ngắt kết nối Sheet cũ trước.`, 409);
  const sameTab = await user.from("order_sheets").select("channel").eq("workspace_id", workspaceId).eq("spreadsheet_id", args.spreadsheetId).eq("sheet_name", args.sheetName).maybeSingle();
  if (sameTab.data) throw new SheetSyncError(`Tab này đã được nối cho kênh ${sameTab.data.channel as string}.`, 409);

  const values = await readValues(read, args.token, { spreadsheet_id: args.spreadsheetId, sheet_name: args.sheetName });
  const prepared = prepareSheetTable(values, { channel: args.channel, mapping: args.mapping });
  if (prepared.problems.length || !prepared.normalized) throw new SheetSyncError(prepared.problems[0] ?? "Tab chưa đủ thông tin để nối.");

  const named: NamedMapping = mappingToNames(prepared.mapping as ColumnMapping, prepared.headers);
  const ins = await user
    .from("order_sheets")
    .insert({ workspace_id: workspaceId, spreadsheet_id: args.spreadsheetId, sheet_name: args.sheetName, name: args.name, channel: args.channel, mapping: named, created_by: args.userId })
    .select(ORDER_SHEET_COLUMNS)
    .single();
  if (ins.error || !ins.data) {
    if (ins.error?.code === "23505") throw new SheetSyncError("Kênh hoặc tab này đã được nối rồi.", 409);
    if (/giới hạn/i.test(ins.error?.message ?? "")) throw new SheetSyncError("Đã đạt giới hạn 8 Sheet đơn hàng.", 403);
    if (ins.error?.code === "42P01" || ins.error?.code === "PGRST205") throw new SheetSyncError("Cần chạy migration 0022_order_sheets.sql trên Supabase trước khi nối Sheet đơn hàng.", 409);
    throw new SheetSyncError(ins.error?.message ?? "Không nối được Sheet.", 500);
  }
  const row = ins.data as OrderSheetRow;
  try {
    const result = await applyPrepared(admin, row, prepared, fingerprint(values, { channel: args.channel, mapping: named }));
    return { id: row.id, ...result };
  } catch (e) {
    await user.from("order_sheets").delete().eq("id", row.id);
    throw e;
  }
}

export interface DueOrderSheetsSummary {
  checked: number;
  due: number;
  results: Array<{ id: string; ok: boolean; changed?: boolean; lines?: number; error?: string }>;
}

/** Cập nhật mọi Sheet đơn hàng đã đến hạn (bộ hẹn giờ gọi cùng lúc với đồng bộ Google Sheets thường). */
export async function syncDueOrderSheets(deps: Partial<SheetDeps> = {}): Promise<DueOrderSheetsSummary> {
  const { admin, token } = live(deps);
  const { data, error } = await admin
    .from("order_sheets")
    .select("id, created_by, sync_interval_minutes, last_synced_at, last_attempt_at")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(200);
  if (error) {
    // Chưa chạy migration 0022 thì không có gì để đồng bộ.
    if (error.code === "42P01" || error.code === "PGRST205") return { checked: 0, due: 0, results: [] };
    throw new Error(error.message);
  }
  const rows = data ?? [];
  const now = Date.now();
  const due = rows.filter((s) => s.created_by && isDue(s as Parameters<typeof isDue>[0], now)).slice(0, MAX_PER_RUN);

  const tokens = new Map<string, Promise<string>>();
  const tokenOf = (userId: string) => {
    if (!tokens.has(userId)) tokens.set(userId, token(userId));
    return tokens.get(userId)!;
  };
  const results: DueOrderSheetsSummary["results"] = [];
  for (const s of due) {
    try {
      const r = await syncOrderSheet(s.id as string, s.created_by as string, await tokenOf(s.created_by as string), deps);
      results.push({ id: s.id as string, ok: true, changed: r.changed, lines: r.lines });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Lỗi không xác định";
      // Lỗi lấy token xảy ra trước syncOrderSheet nên chưa được ghi: ghi ở đây để người dùng thấy lý do và áp thời gian chờ.
      if (e instanceof GoogleAuthError) {
        await admin.from("order_sheets").update({ last_error: msg, last_attempt_at: new Date().toISOString() }).eq("id", s.id as string);
      }
      results.push({ id: s.id as string, ok: false, error: msg });
    }
  }
  return { checked: rows.length, due: due.length, results };
}

export { ImportError };
