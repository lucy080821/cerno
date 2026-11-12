import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleAuthError, getAccessToken, readTab } from "./api";
import { hashValues, sheetToTable, type InferredColumn } from "./sheet-data";
import { isDue } from "./constants";
import { MAX_ROWS_PER_WORKSPACE } from "@/lib/limits";
import { invalidateSourceCache } from "@/lib/server/row-cache";

const CHUNK = 2000;
/** Số lần ghi song song khi nạp nguồn lớn (đủ nhanh, không dồn dập lên DB). */
const WRITE_CONCURRENCY = 4;
/** Mỗi lần bộ hẹn giờ chạy chỉ xử lý tối đa bấy nhiêu nguồn, để không vượt thời gian cho phép của một request. */
const MAX_PER_RUN = 20;

export interface SyncResult {
  columns: InferredColumn[];
  rowCount: number;
  truncated: boolean;
  /** false nếu nội dung sheet y hệt lần trước (không ghi lại dòng nào). */
  changed: boolean;
  syncedAt: string;
}

/**
 * Đọc lại tab Google Sheets và cập nhật bản sao trong source_rows.
 * Gọi sau khi đã kiểm tra quyền (người dùng sửa được workspace, hoặc bộ hẹn giờ đã xác thực bằng bí mật).
 * `accessToken` có thể truyền sẵn, nếu không sẽ tự lấy theo `userId`.
 *
 * - Sheet không đổi (so dấu vân tay nội dung): chỉ ghi nhận thời điểm cập nhật, không đụng tới dòng dữ liệu.
 * - Sheet có đổi: ghi đè TẠI CHỖ theo (source_id, row_index) rồi xoá phần dôi ra. Không bao giờ xoá hết trước,
 *   nên người đang xem dashboard không thấy bảng trống giữa chừng (có thể thấy lẫn dòng cũ/mới trong vài trăm ms).
 */
export async function syncSource(sourceId: string, userId: string, accessToken?: string): Promise<SyncResult> {
  const db = createAdminClient();
  const { data: src, error } = await db
    .from("data_sources")
    .select("id, workspace_id, spreadsheet_id, sheet_name, last_sync_hash, row_count, columns")
    .eq("id", sourceId)
    .single();
  if (error || !src) throw new Error("Không tìm thấy nguồn dữ liệu");

  // Ghi nhận lần thử trước khi gọi Google: nếu tiến trình chết giữa chừng thì lần sau vẫn tôn trọng thời gian chờ.
  await db.from("data_sources").update({ last_attempt_at: new Date().toISOString() }).eq("id", sourceId);

  try {
    const token = accessToken ?? (await getAccessToken(userId));
    const values = await readTab(token, src.spreadsheet_id, src.sheet_name);
    const baseHash = hashValues(values);
    const syncedAt = new Date().toISOString();

    // Hạn mức tổng số dòng của workspace: trừ đi các nguồn khác đã chiếm.
    const { data: others } = await db.from("data_sources").select("row_count").eq("workspace_id", src.workspace_id).neq("id", sourceId);
    const usedByOthers = (others ?? []).reduce((n, o) => n + (o.row_count ?? 0), 0);
    const allowed = Math.max(0, MAX_ROWS_PER_WORKSPACE - usedByOthers);

    // Dấu vân tay có kèm hạn mức nếu lần trước bị cắt theo hạn mức: hạn mức nới ra thì lần sau sẽ nạp lại đầy đủ hơn.
    if ((src.last_sync_hash === baseHash || src.last_sync_hash === `${baseHash}:q${allowed}`) && src.row_count > 0) {
      await db.from("data_sources").update({ last_synced_at: syncedAt }).eq("id", sourceId);
      return { columns: src.columns as InferredColumn[], rowCount: src.row_count, truncated: false, changed: false, syncedAt };
    }

    const table = sheetToTable(values);
    const { columns } = table;
    if (!columns.length) throw new Error("Sheet trống: dòng đầu tiên cần là tên cột.");
    if (allowed === 0) {
      throw new Error(`Đã hết hạn mức ${MAX_ROWS_PER_WORKSPACE.toLocaleString("vi-VN")} dòng dữ liệu cho cả tài khoản. Hãy xoá bớt nguồn khác hoặc thu nhỏ sheet.`);
    }
    const quotaCut = table.rows.length > allowed;
    const rows = quotaCut ? table.rows.slice(0, allowed) : table.rows;
    const truncated = table.truncated || quotaCut;
    const hash = quotaCut ? `${baseHash}:q${allowed}` : baseHash;

    // Ghi từng đoạn, vài đoạn song song (nguồn 200.000 dòng = 100 đoạn: tuần tự sẽ quá chậm).
    const starts: number[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) starts.push(i);
    let next = 0;
    let failure: string | null = null;
    await Promise.all(
      Array.from({ length: Math.min(WRITE_CONCURRENCY, starts.length) }, async () => {
        while (!failure && next < starts.length) {
          const i = starts[next++];
          const chunk = rows.slice(i, i + CHUNK).map((data, j) => ({ source_id: sourceId, row_index: i + j, data }));
          const up = await db.from("source_rows").upsert(chunk, { onConflict: "source_id,row_index" });
          if (up.error) failure = up.error.message;
        }
      }),
    );
    if (failure) throw new Error(failure);
    // Sheet ngắn lại: bỏ các dòng thừa ở cuối.
    const trim = await db.from("source_rows").delete().eq("source_id", sourceId).gte("row_index", rows.length);
    if (trim.error) throw new Error(trim.error.message);

    // Dấu vân tay ghi sau cùng: nếu bước nào ở trên lỗi thì lần sau vẫn ghi lại đầy đủ.
    await db
      .from("data_sources")
      .update({
        columns,
        row_count: rows.length,
        last_synced_at: syncedAt,
        last_sync_hash: hash,
        last_error: truncated
          ? quotaCut
            ? `Đã đạt hạn mức dòng của tài khoản: chỉ lấy ${rows.length.toLocaleString("vi-VN")} dòng đầu tiên.`
            : `Sheet quá lớn: chỉ lấy ${rows.length.toLocaleString("vi-VN")} dòng đầu tiên.`
          : null,
      })
      .eq("id", sourceId);
    // Dữ liệu đổi: bản sao trong bộ nhớ của server (nếu có) không còn đúng.
    invalidateSourceCache(sourceId);
    // Mốc "dữ liệu thật sự đổi" (khác last_synced_at) cho luật cảnh báo "không có dữ liệu mới". Ghi riêng và bỏ qua lỗi:
    // nếu migration 0013 chưa chạy thì đồng bộ vẫn hoạt động bình thường.
    await db.from("data_sources").update({ data_changed_at: syncedAt }).eq("id", sourceId);
    // Chạy các luật cảnh báo của nguồn. Lỗi cảnh báo KHÔNG được làm hỏng đồng bộ (bên trong đã bắt lỗi, ở đây bắt thêm cho chắc).
    try {
      const [{ evaluateAlertsForSource }, { liveAlertDeps }] = await Promise.all([
        import("@/lib/server/alerts/evaluate"),
        import("@/lib/server/alerts/live"),
      ]);
      await evaluateAlertsForSource(sourceId, liveAlertDeps());
    } catch (e) {
      console.error("[sync] alert evaluation failed:", e instanceof Error ? e.message : e);
    }
    return { columns, rowCount: rows.length, truncated, changed: true, syncedAt };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Lỗi không xác định";
    await db.from("data_sources").update({ last_error: msg }).eq("id", sourceId);
    throw e;
  }
}

export interface DueSyncSummary {
  checked: number;
  due: number;
  results: Array<{ id: string; ok: boolean; changed?: boolean; rows?: number; error?: string }>;
}

/**
 * Cập nhật mọi nguồn đã đến hạn (quá chu kỳ, mặc định 2 giờ). Bộ hẹn giờ gọi hàm này định kỳ (vd mỗi 30 phút);
 * mỗi nguồn dùng quyền Google của người đã kết nối nó (`created_by`). Nguồn tới hạn lâu nhất được xử lý trước.
 */
export async function syncDueSources(): Promise<DueSyncSummary> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("data_sources")
    .select("id, created_by, sync_interval_minutes, last_synced_at, last_attempt_at")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(500);
  if (error) throw new Error(error.message);

  const now = Date.now();
  const rows = data ?? [];
  const due = rows.filter((s) => s.created_by && isDue(s, now)).slice(0, MAX_PER_RUN);

  // Mỗi người dùng chỉ lấy access token một lần (hoặc ghi nhận lỗi một lần) trong một lượt chạy.
  const tokens = new Map<string, Promise<string>>();
  const tokenOf = (userId: string) => {
    if (!tokens.has(userId)) tokens.set(userId, getAccessToken(userId));
    return tokens.get(userId)!;
  };

  const results: DueSyncSummary["results"] = [];
  for (const s of due) {
    try {
      const token = await tokenOf(s.created_by!);
      const r = await syncSource(s.id, s.created_by!, token);
      results.push({ id: s.id, ok: true, changed: r.changed, rows: r.rowCount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Lỗi không xác định";
      // Lỗi lấy token xảy ra trước syncSource nên chưa được ghi: ghi ở đây để người dùng thấy lý do và để áp thời gian chờ.
      if (e instanceof GoogleAuthError) {
        await db
          .from("data_sources")
          .update({ last_error: msg, last_attempt_at: new Date().toISOString() })
          .eq("id", s.id);
      }
      results.push({ id: s.id, ok: false, error: msg });
    }
  }
  return { checked: rows.length, due: due.length, results };
}
