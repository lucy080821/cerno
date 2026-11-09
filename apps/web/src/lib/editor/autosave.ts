import type { Dashboard } from "@dashboard/schema";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

export type SaveResult =
  | { ok: true; rev: string }
  | { ok: false; kind: "conflict" }
  | { ok: false; kind: "error"; message: string };

export interface AutosaveOptions {
  save: (doc: Dashboard, rev: string) => Promise<SaveResult>;
  getDoc: () => Dashboard;
  onStatus: (status: SaveStatus, message?: string) => void;
  /** Phiên bản (updated_at của server) mà bản đang mở dựa trên. */
  rev: string;
  /** Chờ bao lâu sau lần sửa cuối rồi mới lưu (ms). */
  delay?: number;
  /** Thử lại sau bao lâu khi lưu lỗi (ms). */
  retryDelay?: number;
}

/**
 * Bộ tự lưu: gom nhiều lần sửa thành một lần lưu, không bao giờ chạy hai lần lưu song song,
 * lưu lại nếu có sửa trong lúc đang lưu, thử lại khi lỗi, và dừng hẳn khi có xung đột
 * (người dùng phải chọn ghi đè hoặc tải bản mới). Tách khỏi store/Supabase để dễ kiểm thử.
 */
export function createAutosaver(o: AutosaveOptions) {
  const delay = o.delay ?? 1500;
  const retryDelay = o.retryDelay ?? 5000;
  let rev = o.rev;
  let status: SaveStatus = "saved";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight = false;
  let again = false;
  let disposed = false;

  const set = (s: SaveStatus, message?: string) => {
    status = s;
    o.onStatus(s, message);
  };
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (ms: number) => {
    clear();
    timer = setTimeout(() => void run(), ms);
  };

  async function run(): Promise<void> {
    if (disposed || status === "conflict") return;
    if (inflight) {
      again = true;
      return;
    }
    clear();
    inflight = true;
    again = false;
    set("saving");
    const doc = o.getDoc();
    let r: SaveResult;
    try {
      r = await o.save(doc, rev);
    } catch (e) {
      r = { ok: false, kind: "error", message: e instanceof Error ? e.message : "Lỗi không xác định" };
    }
    inflight = false;
    if (disposed) return;
    if (r.ok) {
      rev = r.rev;
      if (again || o.getDoc() !== doc) {
        set("dirty");
        schedule(delay);
      } else set("saved");
    } else if (r.kind === "conflict") {
      set("conflict");
    } else {
      set("error", r.message);
      schedule(retryDelay);
    }
  }

  return {
    /** Gọi mỗi khi dashboard thay đổi. */
    notify() {
      if (disposed || status === "conflict") return;
      if (inflight) {
        again = true;
        return;
      }
      set("dirty");
      schedule(delay);
    },
    /** Lưu ngay (đóng tab, chuyển trang). */
    flush: () => run(),
    /** Sau khi chọn "ghi đè": dùng phiên bản server mới nhất rồi lưu tiếp. */
    resolveOverwrite(latestRev: string) {
      rev = latestRev;
      status = "dirty";
      return run();
    },
    /** Sau khi tải bản mới từ server: bỏ mọi thay đổi chờ lưu. */
    reset(latestRev: string) {
      clear();
      rev = latestRev;
      again = false;
      set("saved");
    },
    getStatus: () => status,
    dispose() {
      disposed = true;
      clear();
    },
  };
}

export type Autosaver = ReturnType<typeof createAutosaver>;
