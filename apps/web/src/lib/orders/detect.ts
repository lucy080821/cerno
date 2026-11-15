import { normalizeText } from "@dashboard/schema";
import { INPUT_FIELDS, type Channel, type ColumnMapping, type InputField } from "./canonical";
import type { RawCell, RawSheet, RawTable } from "./files";
import { GENERIC, PROFILES, type Profile } from "./profiles";

export interface Detection {
  profile: Profile["id"];
  /** Kênh suy ra từ file; null thì người dùng tự chọn. */
  channel: Channel | null;
  /** Chỉ số dòng tiêu đề trong bảng (file xuất của sàn đôi khi có vài dòng ghi chú ở trên). */
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping;
  /** Điều còn thiếu để nhập được; rỗng = đủ. */
  problems: string[];
}

/** Thứ tự gán cột: trường quan trọng trước, để một cột không bị trường phụ giành mất. */
const ORDER: InputField[] = ["date", "orderId", "revenue", "status", "quantity", "product", "sku", "variant", "unitPrice", "province", "payment", "platformFee"];
const WEIGHT: Partial<Record<InputField, number>> = { date: 3, orderId: 3, revenue: 3, status: 2, quantity: 2, product: 2 };

export const headerText = (c: RawCell): string => (c instanceof Date ? "" : String(c ?? "").trim());

/** Gán cột của file cho từng trường theo hồ sơ. Trả về chỉ số cột, không phải tên (tên cột có thể trùng nhau). */
export function proposeMapping(profile: Profile, headers: string[]): ColumnMapping {
  const norm = headers.map(normalizeText);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of ORDER) {
    const names = profile.synonyms[field];
    if (!names) continue;
    if (profile.sumFields.includes(field)) {
      const cols = norm.map((h, i) => (names.includes(h) && !used.has(i) ? i : -1)).filter((i) => i >= 0);
      if (cols.length) {
        mapping[field] = cols;
        cols.forEach((i) => used.add(i));
      }
      continue;
    }
    for (const name of names) {
      const i = norm.findIndex((h, idx) => h === name && !used.has(idx));
      if (i >= 0) {
        mapping[field] = [i];
        used.add(i);
        break;
      }
    }
  }
  return mapping;
}

/** Thiếu gì thì không nhập được. Ngày đặt và (thành tiền hoặc đơn giá + số lượng) là tối thiểu để vẽ doanh thu theo thời gian. */
export function validateMapping(m: ColumnMapping): string[] {
  const has = (f: InputField) => (m[f]?.length ?? 0) > 0;
  const problems: string[] = [];
  if (!has("date")) problems.push("Chưa chọn cột ngày đặt hàng.");
  if (!has("revenue") && !has("unitPrice")) problems.push("Chưa chọn cột thành tiền (hoặc đơn giá kèm số lượng).");
  else if (!has("revenue") && !has("quantity")) problems.push("Chỉ có đơn giá thì cần thêm cột số lượng để tính thành tiền.");
  return problems;
}

const score = (m: ColumnMapping) => INPUT_FIELDS.reduce((n, f) => n + ((m[f]?.length ?? 0) > 0 ? (WEIGHT[f] ?? 1) : 0), 0);

/**
 * Tìm dòng tiêu đề và hồ sơ khớp nhất trong một sheet. Hồ sơ riêng của sàn thắng khi đủ cột đặc trưng; nếu không thì
 * dùng hồ sơ chung. Trả null nếu sheet không có dòng nào trông giống tiêu đề bảng đơn hàng.
 */
export function detectSheet(rows: RawTable): Detection | null {
  let best: { d: Detection; rank: number } | null = null;
  const limit = Math.min(rows.length, 15);
  for (let r = 0; r < limit; r++) {
    const headers = rows[r].map(headerText);
    if (headers.filter(Boolean).length < 2) continue;
    const norm = new Set(headers.map(normalizeText));
    for (const profile of PROFILES) {
      const specific = profile.signature.length > 0 && profile.signature.every((group) => group.some((n) => norm.has(n)));
      if (profile.id !== "generic" && !specific) continue;
      const mapping = proposeMapping(profile, headers);
      const s = score(mapping);
      if (s === 0) continue;
      const rank = s + (specific ? 100 : 0) - r * 0.01; // dòng trên cùng thắng khi điểm bằng nhau
      if (!best || rank > best.rank) {
        best = { rank, d: { profile: profile.id, channel: profile.channel, headerRow: r, headers, mapping, problems: validateMapping(mapping) } };
      }
    }
  }
  return best?.d ?? null;
}

/** Chọn sheet phù hợp nhất trong file nhiều sheet (ưu tiên sheet đủ điều kiện nhập, rồi đến điểm cao nhất). */
export function pickSheet(sheets: RawSheet[]): { sheet: RawSheet; detection: Detection } | null {
  let best: { sheet: RawSheet; detection: Detection; rank: number } | null = null;
  for (const sheet of sheets) {
    const detection = detectSheet(sheet.rows);
    if (!detection) continue;
    const rank = score(detection.mapping) + (detection.problems.length === 0 ? 1000 : 0) + (detection.profile !== "generic" ? 100 : 0);
    if (!best || rank > best.rank) best = { sheet, detection, rank };
  }
  return best ? { sheet: best.sheet, detection: best.detection } : null;
}

export { GENERIC };
