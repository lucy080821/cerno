import { makeTranslator, type Dict } from "./translate";
import { EN_COMMON } from "./en/common";
import { EN_EDITOR } from "./en/editor";
import { EN_LANDING } from "./en/landing";
import { EN_LEGAL } from "./en/legal";
import { EN_ENGINE } from "./en/engine";

/** Toàn bộ từ điển Việt → Anh. Thêm chữ mới ở giao diện thì thêm vào một trong các file `en/*`. */
export const EN_DICT: Dict = { ...EN_COMMON, ...EN_EDITOR, ...EN_LANDING, ...EN_LEGAL, ...EN_ENGINE };

export const translateToEnglish = makeTranslator(EN_DICT);

/** Dịch một chuỗi sang tiếng Anh nếu `lang === "en"`; không có trong từ điển thì giữ nguyên. */
export function tr(text: string, lang: "vi" | "en"): string {
  return lang === "en" ? (translateToEnglish(text) ?? text) : text;
}
