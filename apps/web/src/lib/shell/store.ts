import { create } from "zustand";

/**
 * Trạng thái khung chung của các trang sau đăng nhập: thanh bên (nút 3 gạch ở thanh trên) và khung chat AI bên phải.
 * `side`: "auto" = chưa chọn, theo màn hình (máy tính hiện, điện thoại ẩn); "open"/"closed" = người dùng đã chọn, nhớ ở localStorage.
 * Khung chat mặc định đóng. Đọc localStorage chỉ sau khi trang đã hiện (`init`) để lần vẽ đầu của server và trình duyệt khớp nhau.
 */
export type SideMode = "auto" | "open" | "closed";

const SIDE_KEY = "cerno.shell.side";
const CHAT_KEY = "cerno.shell.chat";
export const MOBILE_QUERY = "(max-width: 860px)";

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* localStorage bị chặn */
  }
};

/** Thanh bên đang hiện không (tính cả chế độ "auto" theo độ rộng màn hình). */
export function sideVisible(mode: SideMode, mobile: boolean): boolean {
  return mode === "auto" ? !mobile : mode === "open";
}

interface ShellState {
  side: SideMode;
  chat: boolean;
  /** Câu hỏi đang chờ khung chat nhận (từ ô tìm kiếm "Hỏi AI: ..."); `n` đổi mỗi lần để gửi lại cùng một câu vẫn kích hoạt. */
  ask: { text: string; n: number } | null;
  init: () => void;
  toggleSide: () => void;
  closeSide: () => void;
  setChat: (open: boolean) => void;
  askAi: (text: string) => void;
  clearAsk: () => void;
}

export const useShell = create<ShellState>((set, get) => ({
  side: "auto",
  chat: false,
  ask: null,
  init: () => {
    const s = read(SIDE_KEY);
    set({ side: s === "open" || s === "closed" ? s : "auto", chat: read(CHAT_KEY) === "1" });
  },
  toggleSide: () => {
    const mobile = typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
    const next: SideMode = sideVisible(get().side, mobile) ? "closed" : "open";
    write(SIDE_KEY, next);
    set({ side: next });
  },
  // Điện thoại: đóng ngăn kéo sau khi chọn một mục (không đổi lựa chọn đã nhớ cho máy tính).
  closeSide: () => {
    if (typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches && get().side === "open") set({ side: "auto" });
  },
  setChat: (open) => {
    write(CHAT_KEY, open ? "1" : "0");
    set({ chat: open });
  },
  askAi: (text) => {
    write(CHAT_KEY, "1");
    set((st) => ({ chat: true, ask: { text, n: (st.ask?.n ?? 0) + 1 } }));
  },
  clearAsk: () => set({ ask: null }),
}));
