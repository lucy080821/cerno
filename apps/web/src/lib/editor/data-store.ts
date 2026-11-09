import { create } from "zustand";
import { materializeRows, type CalcSet, type Row } from "@dashboard/chart-engine";

export type LoadStatus = "loading" | "ready" | "error";

/**
 * Nguồn có tới chừng này dòng trở xuống thì tải hết về trình duyệt và gộp tại máy. Nhiều hơn thì KHÔNG tải về:
 * server gộp số liệu cho từng widget (xem lib/editor/remote-query.ts), trình duyệt chỉ giữ ~500 dòng mẫu.
 */
export const LOCAL_ROW_LIMIT = 20_000;
/** Số dòng mẫu giữ ở trình duyệt cho nguồn lớn (đoán kiểu cột tính toán, xem thử công thức). */
export const SAMPLE_ROWS_REMOTE = 500;

interface DataState {
  rows: Record<string, Row[]>;
  status: Record<string, LoadStatus>;
  /** Thời điểm (ISO) server cập nhật dữ liệu lần cuối mà bản sao trong trình duyệt tương ứng. */
  syncedAt: Record<string, string | null>;
  /** Trường tính toán đã biên dịch, theo nguồn dữ liệu (đặt bởi syncCalc ở calc.ts). */
  calc: Record<string, CalcSet>;
  setCalc: (calc: Record<string, CalcSet>) => void;
  /** Số dòng thật của từng nguồn (biết sau khi liệt kê nguồn). Lớn hơn LOCAL_ROW_LIMIT = nguồn lớn, tính ở server. */
  meta: Record<string, { rowCount: number }>;
  /** Tăng khi dữ liệu của MỘT nguồn đổi: khoá làm mới các truy vấn server của nguồn đó. */
  epoch: Record<string, number>;
  /** Đường dẫn gửi truy vấn server: /api/query (đã đăng nhập) hoặc /api/embed/<mã>/query (xem công khai). */
  queryBase: string;
  setMeta: (id: string, rowCount: number) => void;
  bumpEpoch: (id: string) => void;
  setQueryBase: (base: string) => void;
  /** Tăng mỗi khi dữ liệu đổi: component dùng làm dependency của useMemo để tính lại. */
  version: number;
  setRows: (id: string, rows: Row[], syncedAt?: string | null) => void;
  setStatus: (id: string, s: LoadStatus) => void;
  /** Sheet không đổi nên không cần tải lại dòng, chỉ ghi nhận đã kiểm tra lúc này. */
  touchSynced: (id: string, syncedAt: string) => void;
}

/** Kho dữ liệu của các nguồn Google Sheets đã tải về trình duyệt (nguồn mẫu nằm ở sample-data.ts). */
export const useData = create<DataState>((set) => ({
  rows: {},
  status: {},
  syncedAt: {},
  version: 0,
  meta: {},
  epoch: {},
  queryBase: "/api/query",
  setMeta: (id, rowCount) =>
    set((s) => (s.meta[id]?.rowCount === rowCount ? s : { meta: { ...s.meta, [id]: { rowCount } }, version: s.version + 1 })),
  bumpEpoch: (id) => set((s) => ({ epoch: { ...s.epoch, [id]: (s.epoch[id] ?? 0) + 1 } })),
  setQueryBase: (base) => set({ queryBase: base }),
  calc: {},
  setCalc: (calc) => set((s) => ({ calc, version: s.version + 1 })),
  setRows: (id, rows, syncedAt) =>
    set((s) => ({
      rows: { ...s.rows, [id]: rows },
      epoch: { ...s.epoch, [id]: (s.epoch[id] ?? 0) + 1 },
      status: { ...s.status, [id]: "ready" },
      syncedAt: syncedAt === undefined ? s.syncedAt : { ...s.syncedAt, [id]: syncedAt },
      version: s.version + 1,
    })),
  setStatus: (id, st) => set((s) => ({ status: { ...s.status, [id]: st }, version: s.version + 1 })),
  touchSynced: (id, syncedAt) => set((s) => ({ syncedAt: { ...s.syncedAt, [id]: syncedAt } })),
}));

export const useDataVersion = () => useData((s) => s.version);

export const cachedRows = (id: string): Row[] | undefined => useData.getState().rows[id];

// Dòng đã thêm cột tính toán, nhớ lại theo (dòng gốc, bộ trường) để giữ nguyên tham chiếu giữa các lần gọi:
// nhờ đó useMemo/applyFilters phía sau không tính lại vô ích.
const matCache = new Map<string, { raw: Row[]; set: CalcSet | undefined; out: Row[] }>();

/** Thêm các cột tính theo dòng của `sourceId` vào `raw`. Không có trường tính toán thì trả đúng `raw`. */
export function withCalculatedColumns(sourceId: string, raw: Row[]): Row[] {
  const set = useData.getState().calc[sourceId];
  if (!set || set.rowFields.length === 0) return raw;
  const hit = matCache.get(sourceId);
  if (hit && hit.raw === raw && hit.set === set) return hit.out;
  const out = materializeRows(raw, set);
  matCache.set(sourceId, { raw, set, out });
  return out;
}

/** Nguồn này là nguồn lớn (tính ở server) không? Nguồn mẫu và nguồn chưa biết số dòng luôn là nhỏ. */
export const isRemoteSource = (id: string): boolean =>
  (useData.getState().meta[id]?.rowCount ?? 0) > LOCAL_ROW_LIMIT;

/** Hook cùng ý nghĩa với isRemoteSource (cập nhật khi số dòng được biết/đổi). */
export const useIsRemote = (id: string): boolean => useData((s) => (s.meta[id]?.rowCount ?? 0) > LOCAL_ROW_LIMIT);
