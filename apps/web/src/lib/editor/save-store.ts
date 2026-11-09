import { create } from "zustand";
import { createAutosaver, type Autosaver, type SaveStatus } from "./autosave";
import { useEditor } from "./store";
import { fetchDashboard, fetchRev, saveDashboard } from "@/lib/dashboards/api";

interface SaveState {
  status: SaveStatus;
  message?: string;
}

/** Trạng thái lưu để hiển thị ở thanh trên và banner. */
export const useSave = create<SaveState>(() => ({ status: "saved" }));

let current: { saver: Autosaver; id: string; stop: () => void } | null = null;

const UNSAVED: SaveStatus[] = ["dirty", "saving", "error", "conflict"];

/** Bắt đầu tự lưu dashboard `id`. `rev` là updated_at lúc mở. Trả hàm dừng. */
export function startAutosave(id: string, rev: string): () => void {
  stopAutosave();
  useSave.setState({ status: "saved", message: undefined });

  const saver = createAutosaver({
    rev,
    getDoc: () => useEditor.getState().doc,
    save: (doc, r) => saveDashboard(id, { ...doc, id }, r),
    onStatus: (status, message) => useSave.setState({ status, message }),
  });

  const unsub = useEditor.subscribe((st, prev) => {
    if (st.doc !== prev.doc) saver.notify();
  });
  // Rời trang khi còn thay đổi chưa lưu: hỏi lại. Ẩn tab thì lưu ngay.
  const onUnload = (e: BeforeUnloadEvent) => {
    if (UNSAVED.includes(saver.getStatus())) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  const onHide = () => {
    if (document.visibilityState === "hidden" && saver.getStatus() === "dirty") void saver.flush();
  };
  window.addEventListener("beforeunload", onUnload);
  document.addEventListener("visibilitychange", onHide);

  const stop = () => {
    window.removeEventListener("beforeunload", onUnload);
    document.removeEventListener("visibilitychange", onHide);
    unsub();
    saver.dispose();
    if (current?.saver === saver) current = null;
  };
  current = { saver, id, stop };
  return stop;
}

export function stopAutosave() {
  current?.stop();
}

/** Lưu ngay (nút "Lưu" hoặc Ctrl+S). */
export function saveNow() {
  return current?.saver.flush();
}

/** Xung đột: giữ bản của mình, ghi đè bản trên server. */
export async function resolveOverwrite() {
  if (!current) return;
  try {
    await current.saver.resolveOverwrite(await fetchRev(current.id));
  } catch (e) {
    useSave.setState({ status: "conflict", message: e instanceof Error ? e.message : "Lỗi" });
  }
}

/** Xung đột: bỏ thay đổi của mình, tải bản mới nhất từ server. */
export async function resolveReload() {
  if (!current) return;
  try {
    const { doc, rev } = await fetchDashboard(current.id);
    useEditor.getState().loadDoc(doc);
    current.saver.reset(rev);
  } catch (e) {
    useSave.setState({ status: "conflict", message: e instanceof Error ? e.message : "Lỗi" });
  }
}
