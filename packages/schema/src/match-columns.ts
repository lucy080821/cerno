import type { Slot } from "./template";

export interface ColumnInfo {
  name: string;
  type: "string" | "number" | "date" | "boolean";
}

export interface MatchResult {
  /** khoá vai → tên cột thật */
  mapping: Record<string, string>;
  /** khoá vai → độ tin cậy 0..1 (chỉ có với vai đã khớp) */
  confidence: Record<string, number>;
  /** khoá vai chưa khớp được cột nào (cả bắt buộc lẫn tuỳ chọn) */
  unmatched: string[];
}

/** Dưới ngưỡng này coi là không khớp. */
export const MIN_MATCH_SCORE = 0.4;

/** Từ viết tắt thường gặp trong Sheet của doanh nghiệp Việt (đã bỏ dấu). */
const ABBREVIATIONS: Record<string, string[]> = {
  dt: ["doanh", "thu"],
  sl: ["so", "luong"],
  nv: ["nhan", "vien"],
  kh: ["khach", "hang"],
  ck: ["chiet", "khau"],
  hd: ["hoa", "don"],
  dh: ["don", "hang"],
  sp: ["san", "pham"],
  gv: ["gia", "von"],
  ln: ["loi", "nhuan"],
  tt: ["thanh", "toan"],
  nvbh: ["nhan", "vien", "ban", "hang"],
  nhh: ["nhom", "hang", "hoa"],
  dvt: ["don", "vi", "tinh"],
  tp: ["thanh", "pho"],
  sdt: ["so", "dien", "thoai"],
};

/** Bỏ dấu tiếng Việt, đ→d, chữ thường, ký tự lạ thành dấu cách. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(" ") : [];
}

function expand(ts: string[]): string[] {
  return ts.flatMap((t) => ABBREVIATIONS[t] ?? [t]);
}

/** Các cách đọc của một cụm: nguyên bản và bản đã mở rộng viết tắt. */
function variants(s: string): string[][] {
  const base = tokens(s);
  if (!base.length) return [];
  const exp = expand(base);
  return exp.join(" ") === base.join(" ") ? [base] : [base, exp];
}

function containsRun(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((t, j) => hay[i + j] === t)) return true;
  }
  return false;
}

function scoreTokens(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  if (a.join(" ") === b.join(" ")) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (containsRun(long, short)) return 0.55 + 0.35 * (short.length / long.length);
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  if (!inter) return 0;
  return 0.7 * (inter / (sa.size + sb.size - inter));
}

/** Điểm khớp 0..1 giữa một vai và tên một cột (chưa xét kiểu). */
export function scoreSlotAgainstName(slot: Slot, columnName: string): number {
  const cols = variants(columnName);
  if (!cols.length) return 0;
  const phrases = [slot.key.replace(/_/g, " "), slot.label, ...slot.synonyms].flatMap(variants);
  let best = 0;
  for (const p of phrases) for (const c of cols) best = Math.max(best, scoreTokens(p, c));
  return best;
}

/**
 * Tự khớp vai với cột thật, không dùng AI. Bắt buộc trùng kiểu (cột boolean không khớp vai nào),
 * mỗi cột chỉ dùng một lần, ưu tiên cặp điểm cao nhất (hoà thì vai bắt buộc, vai đứng trước, cột đứng trước).
 */
export function matchColumns(slots: Slot[], columns: ColumnInfo[]): MatchResult {
  const pairs: { si: number; ci: number; score: number }[] = [];
  slots.forEach((s, si) => {
    columns.forEach((c, ci) => {
      if (c.type !== s.type) return;
      const score = scoreSlotAgainstName(s, c.name);
      if (score >= MIN_MATCH_SCORE) pairs.push({ si, ci, score });
    });
  });
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      Number(slots[b.si].required) - Number(slots[a.si].required) ||
      a.si - b.si ||
      a.ci - b.ci,
  );
  const mapping: Record<string, string> = {};
  const confidence: Record<string, number> = {};
  const usedSlot = new Set<number>();
  const usedCol = new Set<number>();
  for (const p of pairs) {
    if (usedSlot.has(p.si) || usedCol.has(p.ci)) continue;
    usedSlot.add(p.si);
    usedCol.add(p.ci);
    mapping[slots[p.si].key] = columns[p.ci].name;
    confidence[slots[p.si].key] = Math.round(p.score * 100) / 100;
  }
  return { mapping, confidence, unmatched: slots.filter((_, i) => !usedSlot.has(i)).map((s) => s.key) };
}
