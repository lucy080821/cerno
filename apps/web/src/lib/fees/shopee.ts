import { normalizeText } from "@dashboard/schema";
import data from "@/content/shopee-fees.json";
import type { SellerType } from "./constants";

/**
 * Biểu Phí Cố Định theo ngành hàng của Shopee (content/shopee-fees.json, từ file PDF Shopee công bố). CHỈ dùng ở máy chủ:
 * trình duyệt tìm ngành qua API /api/fees/categories. Đường dẫn ngành là "Cấp 1 › Cấp 2 › Cấp 3" (bỏ cấp trống).
 */
export interface FeeCategory {
  path: string;
  /** Mức Phí Cố Định (%), đã gồm GTGT 8%. */
  ratePct: number;
}

interface Table {
  effectiveFrom: string;
  source: string;
  list: (FeeCategory & { norm: string; leaf: string })[];
  byPath: Map<string, FeeCategory>;
}

const SEP = " › ";
const strings = data.strings as string[];
const build = (t: { effectiveFrom: string; source: string; rows: number[][] }): Table => {
  const list: Table["list"] = [];
  const byPath = new Map<string, FeeCategory>();
  for (const [a, b, c, rate] of t.rows) {
    const parts = [strings[a], b >= 0 ? strings[b] : "", c >= 0 ? strings[c] : ""].filter(Boolean);
    const path = parts.join(SEP);
    const cat = { path, ratePct: rate / 100 };
    byPath.set(normalizeText(path), cat);
    list.push({ ...cat, norm: normalizeText(path), leaf: normalizeText(parts[parts.length - 1]) });
  }
  return { effectiveFrom: t.effectiveFrom, source: t.source, list, byPath };
};

const TABLES: Record<SellerType, Table> = { non_mall: build(data.nonMall), mall: build(data.mall) };

/** Toàn bộ ngành của biểu phí (dùng để tự nhận diện ngành từ tên sản phẩm, lib/fees/match.ts). Không sửa mảng trả về. */
export const categoryList = (type: SellerType): readonly (FeeCategory & { norm: string; leaf: string })[] => TABLES[type].list;

export const tableInfo = (type: SellerType) => ({ effectiveFrom: TABLES[type].effectiveFrom, source: TABLES[type].source, count: TABLES[type].list.length });

/** Mức Phí Cố Định (%) của một ngành theo đường dẫn; null nếu không có trong biểu phí (vd đổi loại shop khiến tên ngành khác). */
export function categoryRate(type: SellerType, path: string | null | undefined): number | null {
  if (!path) return null;
  return TABLES[type].byPath.get(normalizeText(path))?.ratePct ?? null;
}

/**
 * Tìm ngành theo chữ gõ (không phân biệt dấu/hoa thường; mọi từ phải có mặt). Ưu tiên ngành cấp cuối khớp từ đầu,
 * rồi đường dẫn ngắn hơn. Tối đa `limit` kết quả.
 */
export function searchCategories(type: SellerType, query: string, limit = 20): FeeCategory[] {
  const tokens = normalizeText(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const hits: { c: Table["list"][number]; rank: number }[] = [];
  for (const c of TABLES[type].list) {
    if (!tokens.every((t) => c.norm.includes(t))) continue;
    const rank = (c.leaf.startsWith(tokens[0]) ? 0 : c.leaf.includes(tokens[0]) ? 1 : 2) * 1000 + c.path.length;
    hits.push({ c, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || (a.c.path < b.c.path ? -1 : 1));
  return hits.slice(0, limit).map(({ c }) => ({ path: c.path, ratePct: c.ratePct }));
}
