/**
 * Tuỳ chọn bố cục của editor (thu gọn bảng trái, độ rộng bảng phải). Chỉ là thói quen của từng người xem nên lưu ở
 * localStorage của trình duyệt, không lưu vào dashboard. Mọi thao tác đọc/ghi đều bọc try/catch (chế độ riêng tư,
 * bị chặn lưu trữ...) và luôn có giá trị mặc định hợp lệ.
 */
export const RIGHT_MIN = 260;
export const RIGHT_MAX = 720;
export const RIGHT_DEFAULT = 300;

const KEY = "cerno.editor.layout.v1";

export interface LayoutPrefs {
  leftOpen: boolean;
  rightWidth: number;
}

/** Giới hạn độ rộng bảng phải: tối thiểu RIGHT_MIN, tối đa RIGHT_MAX và không quá 60% bề ngang cửa sổ. */
export function clampRightWidth(w: number, windowWidth?: number): number {
  const byWindow = windowWidth && windowWidth > 0 ? Math.floor(windowWidth * 0.6) : RIGHT_MAX;
  const max = Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, byWindow));
  const v = Number.isFinite(w) ? Math.round(w) : RIGHT_DEFAULT;
  return Math.min(max, Math.max(RIGHT_MIN, v));
}

export function loadLayoutPrefs(): LayoutPrefs {
  const def: LayoutPrefs = { leftOpen: true, rightWidth: RIGHT_DEFAULT };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return def;
    const j = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      leftOpen: typeof j.leftOpen === "boolean" ? j.leftOpen : def.leftOpen,
      rightWidth: typeof j.rightWidth === "number" ? clampRightWidth(j.rightWidth) : def.rightWidth,
    };
  } catch {
    return def;
  }
}

export function saveLayoutPrefs(patch: Partial<LayoutPrefs>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...loadLayoutPrefs(), ...patch }));
  } catch {
    /* không lưu được thì thôi: lần sau về mặc định */
  }
}
