import type { BuiltEmail } from "./invite-email";

/**
 * Email báo cáo/cảnh báo dùng chung khung chữ với bản theo dashboard ("Mở dashboard", "của dashboard này"...). Với luật/đăng ký
 * theo CỬA HÀNG (không có dashboard) đổi các cụm cố định đó cho đúng nghĩa. Chỉ đổi các câu mẫu của hệ thống, không đụng chữ do người dùng đặt
 * ngoài các cụm này.
 */
const PAIRS: [RegExp, string][] = [
  [/của dashboard (?=["“])/g, "của cửa hàng "],
  [/the dashboard (?=["“])/g, "the store "],
  [/Mở dashboard/g, "Mở Cerno"],
  [/Open dashboard/g, "Open Cerno"],
  [/của dashboard này/g, "của cửa hàng này"],
  [/this dashboard(?:'|&#39;|&#x27;)s/g, "this store's"],
  [/^Dashboard: /gm, "Cửa hàng: "],
  [/xem trong dashboard/g, "xem trong Cerno"],
  [/see the dashboard/g, "see Cerno"],
];

const swap = (s: string) => PAIRS.reduce((acc, [re, to]) => acc.replace(re, to), s);

export function storeWording(m: BuiltEmail): BuiltEmail {
  return { ...m, subject: swap(m.subject), html: swap(m.html), text: swap(m.text) };
}
