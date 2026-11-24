import { normalizeText } from "@dashboard/schema";
import { SEARCH_ENTRIES, type SearchEntry } from "./entries";

/**
 * Tìm trang/hành động theo từ khoá, không phân biệt dấu và hoa thường ("loi nhuan" ra "Lãi lỗ"). Hàm thuần.
 * Mỗi từ người dùng gõ phải khớp ít nhất một từ của mục (đứng đầu từ > nằm trong từ > gõ sai một ký tự với từ ≥ 4 chữ);
 * từ khớp ở nhãn được cộng điểm cao hơn từ khớp ở từ khoá ẩn; mục không khớp đủ mọi từ bị loại.
 */
const MAX_QUERY_CHARS = 80;

const words = (s: string) => normalizeText(s).split(" ").filter(Boolean);

/** Khoảng cách chỉnh sửa tối đa 1 (thêm, bớt, đổi một ký tự, hoặc đảo hai ký tự liền nhau). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // đổi một ký tự
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // đảo hai ký tự
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

/** Điểm một từ gõ vào so với danh sách từ; 0 = không khớp. */
function tokenScore(token: string, list: string[]): number {
  let best = 0;
  for (const w of list) {
    if (w === token) best = Math.max(best, 4);
    else if (w.startsWith(token)) best = Math.max(best, 3);
    else if (token.length >= 3 && w.includes(token)) best = Math.max(best, 2);
    else if (token.length >= 4 && w.length >= 3 && withinOneEdit(token, w)) best = Math.max(best, 1);
  }
  return best;
}

export function scoreEntry(tokens: string[], e: SearchEntry): number {
  const label = words(e.label);
  const rest = [...words(e.hint ?? ""), ...words(e.keywords)];
  let total = 0;
  for (const t of tokens) {
    const inLabel = tokenScore(t, label);
    const inRest = tokenScore(t, rest);
    if (!inLabel && !inRest) return 0;
    total += Math.max(inLabel * 2, inRest);
  }
  // Gõ đúng đầu nhãn thì lên trước.
  if (normalizeText(e.label).startsWith(tokens.join(" "))) total += 6;
  return total;
}

/** Trang trước hành động khi điểm bằng nhau (trang là thứ người ta thường tìm). */
export function searchEntries(query: string, limit = 8, entries: SearchEntry[] = SEARCH_ENTRIES): SearchEntry[] {
  const tokens = words(query.slice(0, MAX_QUERY_CHARS));
  if (!tokens.length) return [];
  return entries
    .map((e, i) => ({ e, i, s: scoreEntry(tokens, e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.e.kind === b.e.kind ? 0 : a.e.kind === "page" ? -1 : 1) || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}

/** Gợi ý khi chưa gõ gì: các trang hay dùng. */
export const SUGGESTED_IDS = ["page:overview", "page:profit", "page:orders", "page:products", "page:ai", "act:import-orders"];
export const suggestedEntries = (): SearchEntry[] => SUGGESTED_IDS.map((id) => SEARCH_ENTRIES.find((e) => e.id === id)).filter((e): e is SearchEntry => !!e);
