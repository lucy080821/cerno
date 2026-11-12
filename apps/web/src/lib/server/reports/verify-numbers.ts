import type { ReportFacts } from "./facts";

/**
 * Kiểm số trong bài AI viết: MỌI con số mang ý nghĩa số liệu phải có trong `ReportFacts` (cho phép làm tròn theo số chữ số
 * AI đã viết, định dạng Việt Nam 1.234,5, nghìn/triệu/tỷ, %, pp). Số không mang ý nghĩa số liệu thì bỏ qua:
 * số nguyên ≤ 10 trần ("3 điểm cần lưu ý"), ngày tháng, năm, độ dài khoảng thời gian ("30 ngày"), số thứ tự, mã dính liền chữ ("SP12").
 * Hạn chế đã biết: chỉ kiểm ĐỘ LỚN của số, không kiểm hướng ("tăng"/"giảm") hay số đó gắn với chỉ số nào.
 */

export interface ExtractedNumber {
  /** Đúng chữ trong bài (kèm đơn vị nếu có), để báo lại cho AI. */
  raw: string;
  /** Các cách hiểu giá trị (số mơ hồ như "1,234" có thể là 1,234 hoặc 1234), đã nhân đơn vị. */
  candidates: { value: number; tol: number }[];
  /** Không cần đối chiếu (ngày tháng, số nhỏ...). */
  skip: boolean;
}

const UNIT_MULT: Record<string, number> = {
  "nghìn": 1e3, "ngàn": 1e3, "k": 1e3,
  "triệu": 1e6, "tr": 1e6, "m": 1e6,
  "tỷ": 1e9, "tỉ": 1e9, "b": 1e9,
};
/** Đơn vị theo sau con số. Đơn vị một chữ (k/m/b) phải dính liền số, không có dấu cách. */
const UNIT_RE = /^(\s?)(nghìn|ngàn|triệu|tỷ|tỉ|tr|k|m|b|%|pp|đồng|vnđ|vnd|đ|₫)(?![\p{L}\p{N}])/iu;

const NUM_RE = /\d[\d.,]*\d|\d/g;

/** Vùng chữ coi là ngày tháng / số thứ tự: số nằm trong đó không cần đối chiếu. */
const SKIP_RANGES: RegExp[] = [
  /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, // 12/11, 12/11/2025, 12-11-2025
  /\b\d{1,2}[/-]\d{4}\b/g, // 10/2025
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g, // 2025-10-31
  /\b(?:ngày|tháng|quý|tuần|năm|thứ|lần|bước|mục|điểm|top|nhóm)\s+\d{1,4}\b/giu, // "tháng 10", "quý 3", "top 3"
  /\b\d{1,2}:\d{2}\b/g, // 14:30
  /\b\d{1,2}\s?(?:giờ|h)\b/giu, // 9 giờ, 9h
  /(?:^|\n)\s*\(?\d{1,2}[.)]\s/g, // "1. ", "2) " đầu dòng
];

function decimalsOf(s: string): number {
  const i = s.search(/[.,](?=\d+$)/);
  return i < 0 ? 0 : s.length - i - 1;
}

/** Các cách đọc một chuỗi số: giá trị và số chữ số thập phân. */
function readNumber(tok: string): { value: number; decimals: number }[] {
  const hasDot = tok.includes(".");
  const hasComma = tok.includes(",");
  const out: { value: number; decimals: number }[] = [];
  if (hasDot && hasComma) {
    const dec = tok.lastIndexOf(",") > tok.lastIndexOf(".") ? "," : ".";
    const other = dec === "," ? "." : ",";
    const v = Number(tok.split(other).join("").replace(dec, "."));
    if (Number.isFinite(v)) out.push({ value: v, decimals: decimalsOf(tok) });
    return out;
  }
  if (!hasDot && !hasComma) return [{ value: Number(tok), decimals: 0 }];
  const sep = hasDot ? "." : ",";
  const parts = tok.split(sep);
  const asThousands = () => ({ value: Number(parts.join("")), decimals: 0 });
  const asDecimal = () => ({ value: Number(`${parts[0]}.${parts.slice(1).join("")}`), decimals: parts[parts.length - 1].length });
  if (parts.length > 2) {
    out.push(asThousands());
  } else if (parts[1].length === 3 && parts[0].length <= 3) {
    // "1.234" / "1,234": mơ hồ giữa số thập phân và hàng nghìn. Thử cả hai.
    out.push(sep === "," ? asDecimal() : asThousands(), sep === "," ? asThousands() : asDecimal());
  } else {
    out.push(asDecimal());
  }
  return out.filter((c) => Number.isFinite(c.value));
}

/** Trích mọi con số trong văn bản kèm cách hiểu và cờ bỏ qua. */
export function extractNumbers(text: string): ExtractedNumber[] {
  const skipSpans: [number, number][] = [];
  for (const re of SKIP_RANGES) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) skipSpans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  const inSkip = (a: number, b: number) => skipSpans.some(([s, e]) => a >= s && b <= e);

  const out: ExtractedNumber[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const after = text.slice(end);
    const unitM = UNIT_RE.exec(after);
    let unit = unitM?.[2].toLowerCase();
    // k/m/b một chữ chỉ tính là đơn vị khi dính liền số.
    if (unit && unitM && unit.length === 1 && "kmb".includes(unit) && unitM[1] !== "") unit = undefined;
    const mult = unit ? UNIT_MULT[unit] ?? 1 : 1;
    const raw = unit && unitM ? text.slice(start, end + unitM[0].length) : m[0];
    const prev = start > 0 ? text[start - 1] : "";
    const glued = /\p{L}/u.test(prev); // "SP12", "Q3": mã, không phải số liệu
    const candidates = readNumber(m[0]).map((c) => ({
      value: c.value * mult,
      tol: 0.5 * mult * 10 ** -c.decimals + 1e-9,
    }));
    const plainSmall = !unit && candidates.length > 0 && candidates.every((c) => c.value <= 10 && Number.isInteger(c.value));
    const isYear = !unit && /^(19|20)\d{2}$/.test(m[0]) && /(?:năm|\/|-)\s*$/iu.test(text.slice(Math.max(0, start - 6), start));
    // "30 ngày", "4 tuần", "6 tháng": độ dài khoảng thời gian, không phải số liệu.
    const duration = !unit && candidates.every((c) => c.value <= 366) && /^\s?(?:ngày|tuần|tháng|quý|năm|giờ|phút)(?![\p{L}])/iu.test(after);
    out.push({ raw, candidates, skip: glued || plainSmall || isYear || duration || inSkip(start, end) });
  }
  return out;
}

/** Mọi độ lớn số có trong gói số liệu: các trường số, và các số đọc ra từ chuỗi hiển thị/nhãn. */
export function allowedMagnitudes(facts: ReportFacts): number[] {
  const set = new Set<number>();
  const visit = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) set.add(Math.abs(v));
    else if (typeof v === "string") {
      // Số ngày tháng/số nhỏ trong chuỗi không được coi là "số liệu có thật" (nếu không "30" của ngày 30/09 sẽ làm lọt "30%").
      for (const n of extractNumbers(v)) if (!n.skip) for (const c of n.candidates) set.add(Math.abs(c.value));
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "widgetId") visit(x);
  };
  // Kỳ báo cáo và thời điểm cập nhật chỉ là ngày tháng: không đưa vào danh sách số liệu cho phép.
  visit({ kpis: facts.kpis, movers: facts.movers, notes: facts.notes });
  return [...set];
}

export interface VerifyResult {
  ok: boolean;
  /** Các số (đúng chữ trong bài) không có trong gói số liệu. */
  unverified: string[];
}

/** Kiểm các đoạn văn của bài báo cáo với gói số liệu. */
export function verifyNumbers(texts: string[], facts: ReportFacts): VerifyResult {
  return verifyNumbersAllowed(texts, allowedMagnitudes(facts));
}

/** Như `verifyNumbers` nhưng với danh sách độ lớn số được phép cho trước (vd số của một cảnh báo). */
export function verifyNumbersAllowed(texts: string[], allowed: number[]): VerifyResult {
  const bad: string[] = [];
  for (const t of texts) {
    for (const n of extractNumbers(t)) {
      if (n.skip) continue;
      const found = n.candidates.some((c) => allowed.some((a) => Math.abs(a - Math.abs(c.value)) <= c.tol));
      if (!found && !bad.includes(n.raw)) bad.push(n.raw);
    }
  }
  return { ok: bad.length === 0, unverified: bad };
}
