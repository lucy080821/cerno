import { normalizeText } from "@dashboard/schema";
import type { SellerType } from "./constants";
import { categoryList, categoryRate, type FeeCategory } from "./shopee";

/**
 * Tự nhận diện ngành hàng trong biểu Phí Cố Định của Shopee từ TÊN sản phẩm, để người bán không phải chọn tay từng sản phẩm.
 * Đây là ĐOÁN, không phải sự thật: giao diện luôn đánh dấu "tự nhận diện" và nhắc người bán kiểm tra lại, vì ngành khác thì mức
 * phí cố định khác. Không đoán được thì trả null (không bịa ngành).
 *
 * Cách làm: (1) vài cụm từ phổ biến mà biểu phí không có ngành trùng tên ("áo thun", "bình giữ nhiệt", "đèn bàn") có đường dẫn cố
 * định (`ALIASES`, kiểm bằng test là có trong biểu phí); (2) còn lại chấm điểm từng ngành theo mức trùng từ giữa tên sản phẩm và
 * tên ngành cấp cuối (tách các lựa chọn "A, B & C" thành từng cụm), cộng điểm khi tên ngành nằm trọn trong tên sản phẩm, và trừ
 * điểm cho các ngành chuyên biệt (Mẹ & Bé, xe cộ, máy ảnh) khi tên sản phẩm không nhắc tới. Dưới `MIN_SCORE` thì bỏ. Hòa điểm thì
 * lấy ngành có mức phí CAO hơn (không ước tính thấp phí).
 */

/** Đổi khi thay thuật toán hoặc bảng cụm từ: là một phần khoá bộ nhớ đệm tính lãi (lib/server/fees.ts). */
export const MATCH_VERSION = 1;
export const MIN_SCORE = 0.5;

export type MatchSource = "alias" | "name";
export interface CategoryGuess extends FeeCategory {
  source: MatchSource;
}

/** Cụm từ đã bỏ dấu (khớp theo ranh giới từ) → đường dẫn ngành. Chỉ liệt kê cụm mà việc đoán theo từ không ra đúng ngành. */
export const ALIASES: { phrases: string[]; path: string }[] = [
  { phrases: ["ao thun", "ao phong", "t shirt", "tshirt"], path: "Thời Trang Nam › Áo › Khác" },
  { phrases: ["binh giu nhiet", "binh nuoc", "binh dung nuoc"], path: "Nhà cửa & Đời sống › Bộ đồ bàn ăn › Bình nước" },
  { phrases: ["den ban", "den led", "den hoc", "den ngu", "den trang tri"], path: "Nhà cửa & Đời sống › Đèn" },
];

const STOP = new Set(["cho", "va", "khac", "phu", "kien", "cua", "the", "loai", "bo", "cai", "chiec", "co", "voi", "de", "dung", "hang", "chinh", "khong", "mau", "combo", "set", "size", "new", "hot", "sale"]);
/** Ngành cấp 1 chuyên biệt: chỉ chọn khi tên sản phẩm nhắc tới chính ngành cấp 1 đó. */
const NICHE_L1 = new Set(["me be", "mo to xe may", "phu tung phu kien xe co gioi", "cameras flycam", "o to", "thoi trang tre em tre so sinh"]);

const fold = (s: string): string => normalizeText(s);
const VI_MARKS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/**
 * Tách từ. Chế độ "strict" giữ dấu để "son" (son môi) không lẫn với "sơn" (sơn tường); chỉ khi tên sản phẩm hoàn toàn không có dấu
 * (người bán gõ "ao thun") mới so sánh bỏ dấu cả hai phía.
 */
const words = (s: string, strict: boolean): string[] =>
  strict ? s.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean) : fold(s).split(/[^a-z0-9]+/).filter(Boolean);
const informative = (s: string, strict: boolean): string[] => words(s, strict).filter((w) => w.length > 1 && !/\d/.test(w) && !STOP.has(fold(w)));

function containsSeq(a: string[], b: string[]): boolean {
  if (!b.length || b.length > a.length) return false;
  for (let i = 0; i + b.length <= a.length; i++) if (b.every((w, k) => a[i + k] === w)) return true;
  return false;
}

interface Mode {
  alts: string[][];
  parents: Set<string>;
  nicheTokens: Set<string>;
}
interface Feat {
  cat: FeeCategory;
  niche: boolean;
  strict: Mode;
  folded: Mode;
}

const FEATS = new Map<SellerType, Feat[]>();
function feats(type: SellerType): Feat[] {
  let f = FEATS.get(type);
  if (f) return f;
  f = [];
  for (const c of categoryList(type)) {
    const segs = c.path.split(" › ");
    const leaf = segs[segs.length - 1];
    const mode = (strict: boolean): Mode => ({
      alts: leaf.split(/[,&/]/).map((x) => informative(x, strict)).filter((t) => t.length > 0),
      parents: new Set(segs.slice(0, -1).flatMap((x) => informative(x, strict))),
      nicheTokens: new Set(informative(segs[0], strict)),
    });
    const strict = mode(true);
    if (!strict.alts.length) continue; // "Khác"...
    f.push({ cat: { path: c.path, ratePct: c.ratePct }, niche: NICHE_L1.has(words(segs[0], false).join(" ")), strict, folded: mode(false) });
  }
  FEATS.set(type, f);
  return f;
}

function score(p: string[], m: Mode, niche: boolean): number {
  let best = 0;
  let leafHit = new Set<string>();
  for (const alt of m.alts) {
    const hit = new Set(alt.filter((w) => p.includes(w)));
    if (!hit.size) continue;
    // Hệ số Dice giữa từ của tên sản phẩm và từ của tên ngành: một từ chung chung ("Bàn", "Kem") không thắng được ngành khớp nhiều từ hơn.
    let s = (2 * hit.size) / (p.length + alt.length);
    // Cụm khớp liền nhau chiếm ít nhất nửa tên sản phẩm (hoặc tên sản phẩm nằm trọn trong tên ngành) thì cộng thêm.
    if ((containsSeq(p, alt) && alt.length / p.length >= 0.5) || containsSeq(alt, p)) s += 0.15;
    if (s > best) {
      best = s;
      leafHit = hit;
    }
  }
  if (best === 0) return 0;
  const parentHits = p.filter((w) => m.parents.has(w) && !leafHit.has(w)).length;
  best += Math.min(0.2, 0.1 * parentHits);
  if (niche && !p.some((w) => m.nicheTokens.has(w))) best -= 0.5;
  return best;
}

const CACHE = new Map<string, CategoryGuess | null>();

/** Đoán ngành hàng của một sản phẩm theo tên. null nếu không đủ tin cậy. */
export function suggestCategory(type: SellerType, productName: string | null | undefined): CategoryGuess | null {
  const name = (productName ?? "").trim();
  if (!name) return null;
  const key = `${type}\u0000${name}`;
  const hit = CACHE.get(key);
  if (hit !== undefined) return hit;
  const result = compute(type, name);
  if (CACHE.size > 5000) CACHE.clear();
  CACHE.set(key, result);
  return result;
}

function compute(type: SellerType, name: string): CategoryGuess | null {
  const norm = ` ${words(name, false).join(" ")} `;
  for (const a of ALIASES) {
    if (a.phrases.some((ph) => norm.includes(` ${ph} `))) {
      const ratePct = categoryRate(type, a.path);
      if (ratePct !== null) return { path: a.path, ratePct, source: "alias" };
    }
  }
  const strict = VI_MARKS.test(name);
  const p = informative(name, strict);
  if (!p.length) return null;
  let top: { f: Feat; s: number }[] = [];
  let topScore = 0;
  for (const f of feats(type)) {
    const s = score(p, strict ? f.strict : f.folded, f.niche);
    if (s < MIN_SCORE) continue;
    if (s > topScore + 0.01) {
      topScore = s;
      top = [{ f, s }];
    } else if (s >= topScore - 0.01) {
      top.push({ f, s });
      topScore = Math.max(topScore, s);
    }
  }
  if (!top.length) return null;
  top.sort((a, b) => b.f.cat.ratePct - a.f.cat.ratePct || a.f.cat.path.length - b.f.cat.path.length || (a.f.cat.path < b.f.cat.path ? -1 : 1));
  return { ...top[0].f.cat, source: "name" };
}
