import type { Cell, Row } from "@dashboard/chart-engine";
import { COL, isValidStatus, type OrderStatus } from "@/lib/orders/canonical";
import { parseNumber } from "@/lib/google/parse-number";
import { productKey } from "./order-profit";

/**
 * Bảng giá vốn theo sản phẩm (khoá = SKU, không có SKU thì tên sản phẩm). Giá vốn người dùng nhập ở đây được GHI VÀO cột
 * "Giá vốn" của nguồn "Đơn hàng đa kênh" (giá vốn mỗi cái × số lượng, 0 với đơn hủy/hoàn trả), nên mọi dashboard, trường
 * tính toán và báo cáo đều thấy ngay mà không cần ghép bảng lúc xem. Giá vốn trong bảng này THẮNG giá vốn có sẵn trong file.
 */

export interface CostEntry {
  sku: string;
  name?: string;
  unitCost: number;
}

export const MAX_COST_ENTRIES = 5000;
export const MAX_SKU_LENGTH = 120;
export const MAX_UNIT_COST = 1_000_000_000;

export const costKey = (s: string) => s.trim().toLowerCase();

/**
 * Các khoá "cha" của một mã SKU biến thể: bỏ dần phần đuôi sau dấu "-" hoặc "_" ("ao-001-ae" → "ao-001"). Shopee thường ghi SKU
 * theo phân loại (AO-001-AE) còn TikTok Shop ghi SKU gốc (AO-001): nhờ vậy giá vốn và ngành hàng nhập cho mã gốc áp dụng cho mọi
 * biến thể. Khoá cha phải dài ít nhất 3 ký tự và tối đa 3 lần bỏ đuôi, để không khớp nhầm với mã quá ngắn.
 */
export function parentKeys(key: string): string[] {
  const out: string[] = [];
  let k = costKey(key);
  for (let i = 0; i < 3; i++) {
    const cut = Math.max(k.lastIndexOf("-"), k.lastIndexOf("_"));
    if (cut < 3) break;
    k = k.slice(0, cut);
    out.push(k);
  }
  return out;
}

/** Khoá của mục khớp với `key`: khoá đúng trước, rồi lần lượt các khoá cha; undefined nếu không có. */
export function matchedKey<T>(m: Map<string, T>, key: string): string | undefined {
  const exact = costKey(key);
  if (m.has(exact)) return exact;
  return parentKeys(key).find((p) => m.has(p));
}

/** Tra theo khoá đúng trước, rồi lần lượt các khoá cha. */
export function findByKey<T>(m: Map<string, T>, key: string): T | undefined {
  const k = matchedKey(m, key);
  return k === undefined ? undefined : m.get(k);
}

export function catalogMap(entries: CostEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) if (e.sku.trim() && Number.isFinite(e.unitCost) && e.unitCost >= 0) m.set(costKey(e.sku), e.unitCost);
  return m;
}

const num = (c: Cell | undefined): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);
const str = (c: Cell | undefined): string | null => (typeof c === "string" && c.trim() !== "" ? c.trim() : null);

/**
 * Áp bảng giá vốn vào các dòng. Trả về bản sao (không sửa mảng gốc) và số dòng đã đổi. `only` (tuỳ chọn): chỉ áp cho dòng mà mục
 * khớp trong bảng nằm trong tập khoá này (dùng khi chỉ vừa sửa vài SKU; biến thể có giá riêng không bị mã gốc đè lên).
 */
export function applyCatalogCosts(rows: Row[], catalog: Map<string, number>, only?: Set<string>): { rows: Row[]; changed: number } {
  if (catalog.size === 0) return { rows, changed: 0 };
  let changed = 0;
  const out = rows.map((r) => {
    const key = productKey(str(r[COL.sku]), str(r[COL.product]));
    if (!key) return r;
    const hit = matchedKey(catalog, key);
    if (hit === undefined || (only && !only.has(hit))) return r;
    const unit = catalog.get(hit) as number;
    const qty = num(r[COL.quantity]);
    const valid = isValidStatus((r[COL.status] as OrderStatus) ?? "Hoàn thành");
    const cost = !valid ? 0 : qty === null ? null : Math.round(unit * qty);
    if (r[COL.cost] === cost) return r;
    changed++;
    return { ...r, [COL.cost]: cost };
  });
  return { rows: out, changed };
}

/**
 * Đọc giá vốn dán từ Excel/Google Sheets: mỗi dòng "SKU<tab>giá vốn" (hoặc cách bằng dấu chấm phẩy, hai dấu cách trở lên,
 * dấu phẩy khi giá không có dấu phẩy). Số đọc theo kiểu Việt Nam ("120.000", "120000đ") lẫn kiểu Anh.
 */
export function parseCostPaste(text: string): { items: CostEntry[]; errors: string[] } {
  const items: CostEntry[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.slice(0, MAX_COST_ENTRIES).entries()) {
    let parts = line.split(/\t|;|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      const m = /^(.*\S)\s+([-+]?[\d.,]+\s*(?:đ|₫|vnđ|vnd)?)$/i.exec(line);
      if (m) parts = [m[1], m[2]];
    }
    if (parts.length < 2) {
      if (i === 0) continue; // dòng tiêu đề
      errors.push(`Dòng ${i + 1}: cần mã SKU và giá vốn`);
      continue;
    }
    const sku = parts[0];
    const cost = parseNumber(parts[parts.length - 1]);
    if (cost === null && i === 0) continue; // dòng tiêu đề ("SKU / Giá vốn")
    if (cost === null || cost < 0 || cost > MAX_UNIT_COST) {
      errors.push(`Dòng ${i + 1}: giá vốn "${parts[parts.length - 1]}" không hợp lệ`);
      continue;
    }
    if (sku.length > MAX_SKU_LENGTH) {
      errors.push(`Dòng ${i + 1}: mã SKU quá dài`);
      continue;
    }
    items.push({ sku, unitCost: cost });
  }
  return { items, errors };
}
