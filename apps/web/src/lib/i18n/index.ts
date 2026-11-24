import { makeTranslator, type Dict } from "./translate";
import { EN_COMMON } from "./en/common";
import { EN_EDITOR } from "./en/editor";
import { EN_LANDING } from "./en/landing";
import { EN_LEGAL } from "./en/legal";
import { EN_ENGINE } from "./en/engine";
import { EN_ORDERS } from "./en/orders";
import { EN_TEMPLATES } from "./en/templates";
import { EN_NOTIFY } from "./en/notify";
import { EN_PROFIT } from "./en/profit";
import { EN_SHELL } from "./en/shell";
import { EN_AI } from "./en/ai";
import { EN_FEES } from "./en/fees";

/** Toàn bộ từ điển Việt → Anh. Thêm chữ mới ở giao diện thì thêm vào một trong các file `en/*`. */
export const EN_DICT: Dict = { ...EN_COMMON, ...EN_EDITOR, ...EN_LANDING, ...EN_LEGAL, ...EN_ENGINE, ...EN_TEMPLATES, ...EN_NOTIFY, ...EN_ORDERS, ...EN_PROFIT, ...EN_SHELL, ...EN_FEES, ...EN_AI };

export const translateToEnglish = makeTranslator(EN_DICT);

/** Dịch một chuỗi sang tiếng Anh nếu `lang === "en"`; không có trong từ điển thì giữ nguyên. */
export function tr(text: string, lang: "vi" | "en"): string {
  return lang === "en" ? (translateToEnglish(text) ?? text) : text;
}
