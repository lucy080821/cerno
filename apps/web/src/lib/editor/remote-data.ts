import type { Dashboard, DataSource } from "@dashboard/schema";
import type { Row } from "@dashboard/chart-engine";
import { SAMPLE_ROWS_REMOTE, isRemoteSource, useData } from "./data-store";
import { useEditor } from "./store";

export interface RemoteSource {
  id: string;
  name: string | null;
  sheet_name: string;
  spreadsheet_id: string;
  columns: DataSource["columns"];
  row_count: number;
  last_synced_at: string | null;
}

/** Danh sách nguồn đã kết nối của người dùng. null nếu chưa đăng nhập hoặc lỗi mạng. */
export async function fetchSources(): Promise<RemoteSource[] | null> {
  try {
    const res = await fetch("/api/sources", { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { sources: RemoteSource[] }).sources;
  } catch {
    return null;
  }
}

/**
 * Tải dữ liệu của một nguồn vào kho. Trả true nếu thành công.
 * Nguồn nhỏ: tải hết về để gộp tại máy. Nguồn lớn (> LOCAL_ROW_LIMIT dòng): chỉ tải ~500 dòng mẫu; số liệu cho chart
 * do server tính theo từng truy vấn. `rowCount` là số dòng đã biết (từ danh sách nguồn hoặc kết quả đồng bộ).
 */
export async function loadRows(id: string, rowCount?: number): Promise<boolean> {
  const { setRows, setStatus, setMeta } = useData.getState();
  if (rowCount !== undefined) setMeta(id, rowCount);
  const remote = isRemoteSource(id);
  setStatus(id, "loading");
  try {
    const url = remote ? `/api/sources/${id}/rows?limit=${SAMPLE_ROWS_REMOTE}` : `/api/sources/${id}/rows`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { rows: Row[]; syncedAt: string | null };
    setRows(id, json.rows, json.syncedAt);
    return true;
  } catch {
    setStatus(id, "error");
    return false;
  }
}

export function toDocSource(r: RemoteSource): DataSource {
  return {
    id: r.id,
    type: "google_sheets",
    spreadsheetId: r.spreadsheet_id,
    sheetName: r.name ?? r.sheet_name,
    columns: r.columns,
  };
}

/**
 * Cập nhật danh sách cột của các nguồn trong dashboard theo bản mới trên server (đồng bộ lại có thể đổi kiểu cột).
 * Chỉ đổi doc khi cột thật sự khác: tránh kích hoạt lưu vô ích. Không ghi vào lịch sử hoàn tác.
 */
function patchColumns(byId: Map<string, DataSource["columns"]>) {
  const changed = useEditor.getState().doc.sources.some((s) => {
    const cols = s.type === "google_sheets" ? byId.get(s.id) : undefined;
    return !!cols && JSON.stringify(cols) !== JSON.stringify(s.columns);
  });
  if (!changed) return;
  useEditor.setState((st) => ({
    doc: {
      ...st.doc,
      sources: st.doc.sources.map((s) => {
        const cols = s.type === "google_sheets" ? byId.get(s.id) : undefined;
        return cols ? { ...s, columns: cols } : s;
      }),
    },
  }));
}

export interface SyncOutcome {
  ok: boolean;
  /** true nếu sheet có thay đổi so với lần trước; false nếu y hệt. */
  changed?: boolean;
  error?: string;
}

/**
 * "Cập nhật ngay": bảo server đọc lại Google Sheets, rồi tải dữ liệu mới về nếu sheet có đổi.
 * Sheet không đổi thì không tải lại gì (nhanh và không làm biểu đồ vẽ lại).
 */
export async function syncNow(id: string): Promise<SyncOutcome> {
  try {
    const res = await fetch("/api/sources/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: id }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      changed?: boolean;
      syncedAt?: string;
      rowCount?: number;
      columns?: DataSource["columns"];
    };
    if (!res.ok) return { ok: false, error: json.error ?? "Không cập nhật được." };
    if (json.columns) patchColumns(new Map([[id, json.columns]]));
    if (json.changed === false && json.syncedAt) {
      useData.getState().touchSynced(id, json.syncedAt);
      return { ok: true, changed: false };
    }
    const loaded = await loadRows(id, json.rowCount);
    return loaded ? { ok: true, changed: true } : { ok: false, error: "Đã cập nhật nhưng chưa tải được dữ liệu mới về." };
  } catch {
    return { ok: false, error: "Lỗi mạng, thử lại sau." };
  }
}

/**
 * Sau khi mở dashboard: tải dữ liệu cho mọi nguồn Google Sheets trong đó và cập nhật danh sách cột.
 */
export async function hydrateSources(doc: Dashboard): Promise<void> {
  const sheets = doc.sources.filter((s) => s.type === "google_sheets");
  if (!sheets.length) return;
  const remote = await fetchSources();
  const byId = new Map((remote ?? []).map((r) => [r.id, r]));
  await Promise.all(sheets.map((s) => {
    if (remote && !byId.has(s.id)) {
      useData.getState().setStatus(s.id, "error"); // nguồn đã bị xoá khỏi tài khoản
      return Promise.resolve(false);
    }
    return loadRows(s.id, byId.get(s.id)?.row_count);
  }));
  if (!remote) return;
  patchColumns(new Map(remote.map((r) => [r.id, r.columns])));
}
