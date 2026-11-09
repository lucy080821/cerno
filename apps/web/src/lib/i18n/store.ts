import { create } from "zustand";

export type Lang = "vi" | "en";
export const LANG_KEY = "cerno.lang";

const isLang = (v: unknown): v is Lang => v === "vi" || v === "en";

const YEAR = 60 * 60 * 24 * 365;

function readCookie(): Lang | null {
  try {
    const m = /(?:^|; )cerno\.lang=([^;]*)/.exec(document.cookie);
    return m && isLang(m[1]) ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Ngôn ngữ đã chọn lần trước trên trình duyệt này: localStorage trước, cookie làm dự phòng (khi localStorage bị chặn
 * hoặc bị xoá riêng). Chưa chọn lần nào thì mặc định tiếng Việt.
 */
export function readSavedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (isLang(v)) return v;
  } catch {
    /* chặn lưu trữ: thử cookie */
  }
  return readCookie() ?? "vi";
}

/** Ghi lựa chọn vào localStorage và cookie chức năng (1 năm). Không ghi lên tài khoản: xem `saveAccountLang`. */
export function writeSavedLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* bỏ qua */
  }
  try {
    document.cookie = `${LANG_KEY}=${lang}; max-age=${YEAR}; path=/; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  } catch {
    /* bỏ qua */
  }
}

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLang = create<LangState>((set) => ({
  // Máy chủ và lần vẽ đầu luôn là "vi" để HTML khớp lúc hydrate; I18nRoot nạp lựa chọn đã lưu ngay sau đó.
  lang: "vi",
  setLang: (lang) => {
    writeSavedLang(lang);
    set({ lang });
    // Đang đăng nhập thì nhớ luôn ở tài khoản để máy khác dùng đúng ngôn ngữ này.
    void import("./account").then((m) => m.saveAccountLang(lang));
  },
}));

/** Dịch một chuỗi trong mã (ví dụ thông báo tạo bằng code, không qua DOM). Cần truyền hàm dịch đã dựng sẵn. */
export const isEnglish = () => useLang.getState().lang === "en";
