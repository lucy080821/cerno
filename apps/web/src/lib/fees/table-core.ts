import { normalizeText } from "@dashboard/schema";

/** Phần dùng chung của các biểu phí theo ngành hàng (Shopee, TikTok Shop): dựng bảng, tra mức phí, tìm ngành. CHỈ dùng ở máy chủ. */
export interface FeeCategory {
  path: string;
  /** Mức phí (%) của ngành. */
  ratePct: number;
}
export type TableEntry = FeeCategory & { norm: string; leaf: string };
export interface Table {
  effectiveFrom: string;
  source: string;
  list: TableEntry[];
  byPath: Map<string, FeeCategory>;
}

export const SEP = " › ";

/** `parts` = các cấp của ngành (đã bỏ cấp trống). */
export function buildTable(effectiveFrom: string, source: string, items: { parts: string[]; ratePct: number }[]): Table {
  const list: TableEntry[] = [];
  const byPath = new Map<string, FeeCategory>();
  for (const { parts, ratePct } of items) {
    const path = parts.join(SEP);
    const norm = normalizeText(path);
    const cat = { path, ratePct };
    byPath.set(norm, cat); // đường dẫn trùng sau khi bỏ dấu/hoa thường: dòng sau thắng khi tra; cả hai vẫn nằm trong `list`
    list.push({ ...cat, norm, leaf: normalizeText(parts[parts.length - 1]) });
  }
  return { effectiveFrom, source, list, byPath };
}

export const rateIn = (t: Table, path: string | null | undefined): number | null => (path ? (t.byPath.get(normalizeText(path))?.ratePct ?? null) : null);

/**
 * Tìm ngành theo chữ gõ (không phân biệt dấu/hoa thường; mọi từ phải có mặt). Ưu tiên ngành cấp cuối khớp từ đầu,
 * rồi đường dẫn ngắn hơn.
 */
export function searchIn(t: Table, query: string, limit: number): FeeCategory[] {
  const tokens = normalizeText(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const hits: { c: TableEntry; rank: number }[] = [];
  for (const c of t.list) {
    if (!tokens.every((x) => c.norm.includes(x))) continue;
    const rank = (c.leaf.startsWith(tokens[0]) ? 0 : c.leaf.includes(tokens[0]) ? 1 : 2) * 1000 + c.path.length;
    hits.push({ c, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || (a.c.path < b.c.path ? -1 : 1));
  return hits.slice(0, limit).map(({ c }) => ({ path: c.path, ratePct: c.ratePct }));
}
