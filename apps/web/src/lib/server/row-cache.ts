import "server-only";
import type { Row } from "@dashboard/chart-engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Bản sao dòng dữ liệu của các nguồn lớn trong bộ nhớ của server, để truy vấn gộp không phải đọc lại DB mỗi lần.
 * Mỗi nguồn gắn với "phiên bản" (dấu vân tay nội dung lúc đồng bộ): đồng bộ ra dữ liệu mới thì tự nạp lại.
 *
 * Giới hạn bộ nhớ: tổng số dòng giữ lại tối đa ROW_CACHE_MAX_ROWS (mặc định 300.000, tức vài trăm MB); vượt thì bỏ
 * nguồn ít dùng nhất. Bộ nhớ này nằm trong tiến trình Node (Hostinger chạy một tiến trình liên tục); chạy nhiều tiến trình
 * thì mỗi tiến trình có bản riêng.
 */

const LOAD_CHUNK = 10_000;
const LOAD_CONCURRENCY = 3;
const META_TTL_MS = 5_000;

const maxRows = () => {
  const n = Number(process.env.ROW_CACHE_MAX_ROWS);
  return Number.isFinite(n) && n > 0 ? n : 300_000;
};

export interface SourceMeta {
  version: string;
  rowCount: number;
  workspaceId: string;
}

interface Entry {
  version: string;
  rows: Row[];
  lastUsed: number;
}

const entries = new Map<string, Entry>();
const loading = new Map<string, Promise<Row[]>>();
const metas = new Map<string, { at: number; meta: SourceMeta | null }>();

/** Phiên bản + số dòng + workspace của một nguồn (nhớ 5 giây để một trang nhiều widget không gọi DB lặp lại). */
export async function getSourceMeta(sourceId: string, fresh = false): Promise<SourceMeta | null> {
  const hit = metas.get(sourceId);
  if (!fresh && hit && Date.now() - hit.at < META_TTL_MS) return hit.meta;
  const { data } = await createAdminClient()
    .from("data_sources")
    .select("workspace_id, row_count, last_sync_hash, last_synced_at")
    .eq("id", sourceId)
    .maybeSingle();
  const meta: SourceMeta | null = data
    ? { version: data.last_sync_hash ?? data.last_synced_at ?? "0", rowCount: data.row_count ?? 0, workspaceId: data.workspace_id }
    : null;
  metas.set(sourceId, { at: Date.now(), meta });
  if (metas.size > 2000) metas.delete(metas.keys().next().value as string);
  return meta;
}

/** Giữ tổng số dòng trong cache dưới giới hạn bằng cách bỏ nguồn ít dùng nhất (không bao giờ bỏ nguồn vừa nạp). */
function evict(keep: string) {
  let total = 0;
  for (const e of entries.values()) total += e.rows.length;
  const cap = maxRows();
  while (total > cap && entries.size > 1) {
    let oldest: string | null = null;
    for (const [k, e] of entries) {
      if (k !== keep && (oldest === null || e.lastUsed < entries.get(oldest)!.lastUsed)) oldest = k;
    }
    if (oldest === null) break;
    total -= entries.get(oldest)!.rows.length;
    entries.delete(oldest);
  }
}

async function loadAll(sourceId: string, rowCount: number): Promise<Row[]> {
  const db = createAdminClient();
  const starts: number[] = [];
  for (let i = 0; i < rowCount; i += LOAD_CHUNK) starts.push(i);
  const parts: Row[][] = new Array(starts.length);
  let next = 0;
  let failure: string | null = null;
  await Promise.all(
    Array.from({ length: Math.min(LOAD_CONCURRENCY, starts.length) }, async () => {
      while (!failure && next < starts.length) {
        const idx = next++;
        const { data, error } = await db.rpc("source_rows_chunk", {
          p_source: sourceId,
          p_from: starts[idx],
          p_to: starts[idx] + LOAD_CHUNK,
        });
        if (error) failure = error.message;
        else parts[idx] = Array.isArray(data) ? (data as Row[]) : [];
      }
    }),
  );
  if (failure) throw new Error(`Không nạp được dữ liệu nguồn: ${failure}`);
  return parts.flat();
}

/**
 * Toàn bộ dòng của nguồn (đúng phiên bản hiện tại). Gọi sau khi đã xác thực quyền truy cập nguồn.
 * Nhiều yêu cầu đồng thời cho cùng một nguồn chỉ nạp một lần.
 */
export async function getSourceRows(sourceId: string, meta: SourceMeta): Promise<Row[]> {
  const hit = entries.get(sourceId);
  if (hit && hit.version === meta.version) {
    hit.lastUsed = Date.now();
    return hit.rows;
  }
  const key = `${sourceId}|${meta.version}`;
  let p = loading.get(key);
  if (!p) {
    p = loadAll(sourceId, meta.rowCount).finally(() => loading.delete(key));
    loading.set(key, p);
  }
  const rows = await p;
  // Nếu trong lúc nạp nguồn lại được đồng bộ thì bản vừa nạp có thể lẫn cũ/mới: không giữ lại.
  const now = await getSourceMeta(sourceId, true);
  if (now && now.version === meta.version) {
    entries.set(sourceId, { version: meta.version, rows, lastUsed: Date.now() });
    evict(sourceId);
  }
  return rows;
}

/** Bỏ bản sao (và thông tin phiên bản) của một nguồn: gọi khi vừa đồng bộ dữ liệu mới. */
export function invalidateSourceCache(sourceId: string) {
  entries.delete(sourceId);
  metas.delete(sourceId);
}
