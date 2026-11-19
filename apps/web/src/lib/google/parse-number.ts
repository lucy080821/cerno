/** Đọc số kiểu Việt Nam ("1.234,5", "120.000đ") lẫn kiểu Anh. Không phụ thuộc thư viện Node nên dùng được ở trình duyệt. */
/** "1.234.567" / "1,234.5" / "12%" / "1.200đ" → số. Trả null nếu không phải số. */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/\s|[đ₫$€%]|vnd|vnđ/gi, "");
  if (!s || !/^[-+]?[\d.,]+$/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    // Dấu xuất hiện sau cùng là dấu thập phân.
    s = s.lastIndexOf(".") > s.lastIndexOf(",") ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (commas > 1 || dots > 1) {
    s = s.replace(/[.,]/g, "");
  } else if (commas === 1) {
    // "1,234" (đúng 3 chữ số sau) coi là hàng nghìn, còn lại là thập phân kiểu VN.
    s = /,\d{3}$/.test(s) ? s.replace(",", "") : s.replace(",", ".");
  } else if (dots === 1 && /\.\d{3}$/.test(s) && !/^[-+]?0\./.test(s)) {
    s = s.replace(".", "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
