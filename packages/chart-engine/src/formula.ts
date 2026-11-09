import type { Cell, Row } from "./aggregate";
import { toIsoDate } from "./filter";

/**
 * Trường tính toán (calculated field), giống Looker Studio.
 *
 * - Công thức THEO DÒNG (không có SUM/AVG...): tính cho từng dòng dữ liệu, ra một cột mới dùng như cột thường
 *   (làm dimension, hoặc bọc trong SUM/AVG như mọi cột số). Ví dụ: `[Doanh thu] - [Chi phí]`.
 * - Công thức TỔNG HỢP (có SUM/AVG/COUNT/MIN/MAX/COUNT_DISTINCT): tính trên cả nhóm dòng của từng cột/lát chart,
 *   chỉ dùng làm số đo. Ví dụ: `SUM([Doanh thu]) / SUM([Đơn hàng])`.
 *
 * Công thức được phân tích bằng parser riêng rồi chạy trên cây cú pháp: KHÔNG dùng eval/Function,
 * nên công thức do người dùng (hoặc AI) nhập không thể chạy mã tuỳ ý.
 */

export interface CalcFieldDef {
  id: string;
  name: string;
  expression: string;
}

// ---------------------------------------------------------------------------------------------
// Giới hạn an toàn

export const MAX_EXPRESSION_LENGTH = 1000;
const MAX_NODES = 300;
const MAX_DEPTH = 40;

class FormulaError extends Error {}

// ---------------------------------------------------------------------------------------------
// Từ vựng

type Tok =
  | { t: "num"; v: number; pos: number }
  | { t: "str"; v: string; pos: number }
  | { t: "id"; v: string; pos: number }
  | { t: "col"; v: string; pos: number }
  | { t: "op"; v: string; pos: number }
  | { t: "eof"; pos: number };

const isIdStart = (c: string) => /[\p{L}_]/u.test(c);
const isIdPart = (c: string) => /[\p{L}\p{N}_]/u.test(c);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const pos = i;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      if (src[j] === ".") { j++; while (j < src.length && /[0-9]/.test(src[j])) j++; }
      if (/[eE]/.test(src[j] ?? "") && /[0-9+-]/.test(src[j + 1] ?? "")) {
        j++;
        if (/[+-]/.test(src[j])) j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new FormulaError(`Số không hợp lệ: ${src.slice(i, j)}`);
      out.push({ t: "num", v, pos });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        s += src[j++];
      }
      if (j >= src.length) throw new FormulaError("Chuỗi chữ thiếu dấu nháy đóng.");
      out.push({ t: "str", v: s, pos });
      i = j + 1;
      continue;
    }
    if (c === "[") {
      const j = src.indexOf("]", i + 1);
      if (j < 0) throw new FormulaError("Tên cột thiếu dấu ] đóng.");
      const name = src.slice(i + 1, j).trim();
      if (!name) throw new FormulaError("Tên cột trong [ ] đang trống.");
      out.push({ t: "col", v: name, pos });
      i = j + 1;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdPart(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j), pos });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "<>", "!=", "=="].includes(two)) {
      out.push({ t: "op", v: two, pos });
      i += 2;
      continue;
    }
    if ("+-*/%&=<>(),".includes(c)) {
      out.push({ t: "op", v: c, pos });
      i++;
      continue;
    }
    throw new FormulaError(`Ký tự không hợp lệ "${c}" (tên cột có dấu cách phải viết trong [ ]).`);
  }
  out.push({ t: "eof", pos: src.length });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Cây cú pháp + parser

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "null" }
  | { k: "col"; name: string }
  | { k: "un"; op: "-" | "not"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

export const AGG_FUNCS = ["SUM", "AVG", "COUNT", "COUNT_DISTINCT", "MIN", "MAX"] as const;
const AGG_SET = new Set<string>(AGG_FUNCS);

/** [tối thiểu, tối đa] số tham số. Infinity = không giới hạn. */
const ARITY: Record<string, [number, number]> = {
  SUM: [1, 1], AVG: [1, 1], COUNT: [1, 1], COUNT_DISTINCT: [1, 1], MIN: [1, 1], MAX: [1, 1],
  ABS: [1, 1], ROUND: [1, 2], FLOOR: [1, 1], CEIL: [1, 1], SQRT: [1, 1], POWER: [2, 2], MOD: [2, 2],
  LEAST: [1, Infinity], GREATEST: [1, Infinity], SAFE_DIVIDE: [2, 3],
  IF: [3, 3], IFNULL: [2, 2], ISNULL: [1, 1],
  CONCAT: [1, Infinity], UPPER: [1, 1], LOWER: [1, 1], TRIM: [1, 1], LEFT: [2, 2], RIGHT: [2, 2],
  LENGTH: [1, 1], CONTAINS: [2, 2], TEXT: [1, 1], NUMBER: [1, 1],
  YEAR: [1, 1], MONTH: [1, 1], DAY: [1, 1], QUARTER: [1, 1], YEAR_MONTH: [1, 1], DATE_DIFF: [2, 2],
};

class Parser {
  private p = 0;
  private nodes = 0;
  constructor(private toks: Tok[]) {}

  private peek() { return this.toks[this.p]; }
  private next() { return this.toks[this.p++]; }
  private isOp(v: string) { const t = this.peek(); return t.t === "op" && t.v === v; }
  private isKw(v: string) { const t = this.peek(); return t.t === "id" && t.v.toUpperCase() === v; }
  private node<T extends Node>(n: T): T {
    if (++this.nodes > MAX_NODES) throw new FormulaError("Công thức quá dài/phức tạp.");
    return n;
  }

  parse(): Node {
    const n = this.or(0);
    const t = this.peek();
    if (t.t !== "eof") {
      const hint = t.t === "id" ? " Tên cột có dấu cách phải viết trong [ ], ví dụ [Doanh thu]." : "";
      throw new FormulaError(`Không hiểu "${tokText(t)}" ở vị trí ${t.pos + 1}.${hint}`);
    }
    return n;
  }

  private guard(depth: number) {
    if (depth > MAX_DEPTH) throw new FormulaError("Công thức lồng quá sâu.");
  }

  private or(d: number): Node {
    this.guard(d);
    let a = this.and(d + 1);
    while (this.isKw("OR")) { this.next(); a = this.node({ k: "bin", op: "OR", a, b: this.and(d + 1) }); }
    return a;
  }
  private and(d: number): Node {
    let a = this.not(d + 1);
    while (this.isKw("AND")) { this.next(); a = this.node({ k: "bin", op: "AND", a, b: this.not(d + 1) }); }
    return a;
  }
  private not(d: number): Node {
    this.guard(d);
    if (this.isKw("NOT")) { this.next(); return this.node({ k: "un", op: "not", a: this.not(d + 1) }); }
    return this.cmp(d + 1);
  }
  private cmp(d: number): Node {
    let a = this.concat(d + 1);
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && ["=", "==", "!=", "<>", "<", "<=", ">", ">="].includes(t.v)) {
        this.next();
        a = this.node({ k: "bin", op: t.v === "==" ? "=" : t.v === "<>" ? "!=" : t.v, a, b: this.concat(d + 1) });
      } else return a;
    }
  }
  private concat(d: number): Node {
    let a = this.add(d + 1);
    while (this.isOp("&")) { this.next(); a = this.node({ k: "bin", op: "&", a, b: this.add(d + 1) }); }
    return a;
  }
  private add(d: number): Node {
    let a = this.mul(d + 1);
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && (t.v === "+" || t.v === "-")) { this.next(); a = this.node({ k: "bin", op: t.v, a, b: this.mul(d + 1) }); }
      else return a;
    }
  }
  private mul(d: number): Node {
    let a = this.unary(d + 1);
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && (t.v === "*" || t.v === "/" || t.v === "%")) { this.next(); a = this.node({ k: "bin", op: t.v, a, b: this.unary(d + 1) }); }
      else return a;
    }
  }
  private unary(d: number): Node {
    this.guard(d);
    if (this.isOp("-")) { this.next(); return this.node({ k: "un", op: "-", a: this.unary(d + 1) }); }
    if (this.isOp("+")) { this.next(); return this.unary(d + 1); }
    return this.primary(d + 1);
  }
  private primary(d: number): Node {
    this.guard(d);
    const t = this.next();
    switch (t.t) {
      case "num": return this.node({ k: "num", v: t.v });
      case "str": return this.node({ k: "str", v: t.v });
      case "col": return this.node({ k: "col", name: t.v });
      case "op":
        if (t.v === "(") {
          const n = this.or(d + 1);
          if (!this.isOp(")")) throw new FormulaError("Thiếu dấu ) đóng ngoặc.");
          this.next();
          return n;
        }
        throw new FormulaError(`Không hiểu "${t.v}" ở vị trí ${t.pos + 1}.`);
      case "id": {
        const up = t.v.toUpperCase();
        if (this.isOp("(")) {
          this.next();
          const args: Node[] = [];
          if (!this.isOp(")")) {
            for (;;) {
              args.push(this.or(d + 1));
              if (this.isOp(",")) { this.next(); continue; }
              break;
            }
          }
          if (!this.isOp(")")) throw new FormulaError(`Hàm ${up} thiếu dấu ) đóng ngoặc.`);
          this.next();
          const ar = ARITY[up];
          if (!ar) throw new FormulaError(`Hàm "${t.v}" không tồn tại.`);
          if (args.length < ar[0] || args.length > ar[1]) {
            const want = ar[0] === ar[1] ? `${ar[0]}` : ar[1] === Infinity ? `ít nhất ${ar[0]}` : `${ar[0]}–${ar[1]}`;
            throw new FormulaError(`Hàm ${up} cần ${want} tham số, bạn đang đưa ${args.length}.`);
          }
          return this.node({ k: "call", fn: up, args });
        }
        if (up === "TRUE") return this.node({ k: "bool", v: true });
        if (up === "FALSE") return this.node({ k: "bool", v: false });
        if (up === "NULL") return this.node({ k: "null" });
        if (up === "AND" || up === "OR" || up === "NOT") throw new FormulaError(`Thiếu giá trị trước/sau "${up}".`);
        return this.node({ k: "col", name: t.v });
      }
      case "eof":
        throw new FormulaError("Công thức chưa đầy đủ (đang thiếu một giá trị ở cuối).");
    }
  }
}

function tokText(t: Tok): string {
  switch (t.t) {
    case "eof": return "(hết công thức)";
    case "num": return String(t.v);
    case "col": return `[${t.v}]`;
    case "str": return `"${t.v}"`;
    default: return t.v;
  }
}

// ---------------------------------------------------------------------------------------------
// Phân tích

export interface Analysis {
  kind: "row" | "agg";
  /** Tên các cột được tham chiếu (cột gốc hoặc trường tính toán khác). */
  refs: string[];
}

function analyze(ast: Node): Analysis {
  const refs = new Set<string>();
  let hasAgg = false;
  let bareCol: string | null = null;

  const walk = (n: Node, inAgg: boolean) => {
    switch (n.k) {
      case "col":
        refs.add(n.name);
        if (!inAgg && bareCol === null) bareCol = n.name;
        return;
      case "un": walk(n.a, inAgg); return;
      case "bin": walk(n.a, inAgg); walk(n.b, inAgg); return;
      case "call":
        if (AGG_SET.has(n.fn)) {
          if (inAgg) throw new FormulaError(`Không đặt hàm tổng hợp trong hàm tổng hợp (${n.fn} nằm trong một hàm SUM/AVG/...).`);
          hasAgg = true;
          for (const a of n.args) walk(a, true);
        } else for (const a of n.args) walk(a, inAgg);
        return;
      default:
    }
  };
  walk(ast, false);
  if (hasAgg && bareCol !== null) {
    throw new FormulaError(`Cột [${bareCol}] phải nằm trong hàm tổng hợp, ví dụ SUM([${bareCol}]), vì công thức này đã có SUM/AVG/...`);
  }
  return { kind: hasAgg ? "agg" : "row", refs: [...refs] };
}

/** Kiểm tra cú pháp một công thức độc lập. Trả về lỗi tiếng Việt, hoặc kiểu + các cột tham chiếu. */
export function parseFormula(expression: string): { ok: true; ast: Node; analysis: Analysis } | { ok: false; error: string } {
  const src = expression.trim();
  if (!src) return { ok: false, error: "Chưa nhập công thức." };
  if (src.length > MAX_EXPRESSION_LENGTH) return { ok: false, error: `Công thức dài quá ${MAX_EXPRESSION_LENGTH} ký tự.` };
  try {
    const ast = new Parser(tokenize(src)).parse();
    return { ok: true, ast, analysis: analyze(ast) };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message };
    return { ok: false, error: "Công thức không hợp lệ." };
  }
}

// ---------------------------------------------------------------------------------------------
// Tính giá trị

const num = (v: Cell | undefined): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Đọc số từ chữ, chịu được dạng VN "1.234,5" và dạng Mỹ "1,234.5". */
function parseLooseNumber(v: Cell | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/\s/g, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const str = (v: Cell | undefined) => (v === null || v === undefined ? "" : String(v));
const finite = (n: number): Cell => (Number.isFinite(n) ? n : null);

function compare(op: string, a: Cell, b: Cell): boolean {
  if (op === "=" || op === "!=") {
    let eq: boolean;
    if (a === null || b === null) eq = a === b;
    else if (typeof a === typeof b) eq = a === b;
    else eq = String(a) === String(b);
    return op === "=" ? eq : !eq;
  }
  if (a === null || b === null) return false;
  let c: number;
  if (typeof a === "number" && typeof b === "number") c = a - b;
  else {
    const x = String(a);
    const y = String(b);
    c = x < y ? -1 : x > y ? 1 : 0;
  }
  switch (op) {
    case "<": return c < 0;
    case "<=": return c <= 0;
    case ">": return c > 0;
    default: return c >= 0;
  }
}

function dayNumber(v: Cell): number | null {
  const iso = toIsoDate(v);
  if (!iso) return null;
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : null;
}

function aggregateOf(fn: string, vals: Cell[]): number {
  if (fn === "COUNT") return vals.filter((v) => v !== null && v !== "").length;
  if (fn === "COUNT_DISTINCT") return new Set(vals.filter((v) => v !== null && v !== "")).size;
  const nums = vals.map(num).filter((x): x is number => x !== null);
  if (nums.length === 0) return 0;
  switch (fn) {
    case "SUM": return nums.reduce((a, b) => a + b, 0);
    case "AVG": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "MIN": return nums.reduce((a, b) => (b < a ? b : a), nums[0]);
    default: return nums.reduce((a, b) => (b > a ? b : a), nums[0]);
  }
}

interface Ctx {
  row?: Row;
  /** Các dòng của nhóm đang tính (cho hàm tổng hợp). */
  rows?: Row[];
}

function ev(n: Node, ctx: Ctx): Cell {
  switch (n.k) {
    case "num": return n.v;
    case "str": return n.v;
    case "bool": return n.v;
    case "null": return null;
    case "col": return ctx.row?.[n.name] ?? null;
    case "un": {
      const a = ev(n.a, ctx);
      if (n.op === "not") return !(a === true);
      const x = num(a);
      return x === null ? null : -x;
    }
    case "bin": {
      if (n.op === "AND") return ev(n.a, ctx) === true && ev(n.b, ctx) === true;
      if (n.op === "OR") return ev(n.a, ctx) === true || ev(n.b, ctx) === true;
      const a = ev(n.a, ctx);
      const b = ev(n.b, ctx);
      if (n.op === "&") return str(a) + str(b);
      if (["=", "!=", "<", "<=", ">", ">="].includes(n.op)) return compare(n.op, a, b);
      const x = num(a);
      const y = num(b);
      if (x === null || y === null) return null;
      switch (n.op) {
        case "+": return finite(x + y);
        case "-": return finite(x - y);
        case "*": return finite(x * y);
        case "/": return y === 0 ? null : finite(x / y);
        default: return y === 0 ? null : finite(x % y);
      }
    }
    case "call": return call(n, ctx);
  }
}

function call(n: Extract<Node, { k: "call" }>, ctx: Ctx): Cell {
  const f = n.fn;
  if (AGG_SET.has(f)) {
    const rows = ctx.rows ?? [];
    return aggregateOf(f, rows.map((r) => ev(n.args[0], { row: r })));
  }
  const a = n.args.map((x) => ev(x, ctx));
  const n0 = () => num(a[0]);
  switch (f) {
    case "ABS": { const x = n0(); return x === null ? null : Math.abs(x); }
    case "ROUND": {
      const x = n0();
      if (x === null) return null;
      const d = Math.max(-6, Math.min(10, Math.trunc(num(a[1]) ?? 0)));
      const k = 10 ** d;
      return finite(Math.round(x * k) / k);
    }
    case "FLOOR": { const x = n0(); return x === null ? null : Math.floor(x); }
    case "CEIL": { const x = n0(); return x === null ? null : Math.ceil(x); }
    case "SQRT": { const x = n0(); return x === null || x < 0 ? null : Math.sqrt(x); }
    case "POWER": { const x = n0(); const y = num(a[1]); return x === null || y === null ? null : finite(x ** y); }
    case "MOD": { const x = n0(); const y = num(a[1]); return x === null || y === null || y === 0 ? null : finite(x % y); }
    case "LEAST":
    case "GREATEST": {
      const xs = a.map(num).filter((x): x is number => x !== null);
      if (xs.length === 0) return null;
      return f === "LEAST" ? Math.min(...xs) : Math.max(...xs);
    }
    case "SAFE_DIVIDE": {
      const x = n0(); const y = num(a[1]);
      if (x === null || y === null || y === 0) return a.length > 2 ? a[2] : null;
      return finite(x / y);
    }
    case "IF": return a[0] === true ? a[1] : a[2];
    case "IFNULL": return a[0] === null || a[0] === "" ? a[1] : a[0];
    case "ISNULL": return a[0] === null || a[0] === "";
    case "CONCAT": return a.map(str).join("");
    case "UPPER": return str(a[0]).toUpperCase();
    case "LOWER": return str(a[0]).toLowerCase();
    case "TRIM": return str(a[0]).trim();
    case "LEFT": return str(a[0]).slice(0, Math.max(0, Math.trunc(num(a[1]) ?? 0)));
    case "RIGHT": { const k = Math.max(0, Math.trunc(num(a[1]) ?? 0)); const s = str(a[0]); return k === 0 ? "" : s.slice(-k); }
    case "LENGTH": return str(a[0]).length;
    case "CONTAINS": return str(a[0]).toLowerCase().includes(str(a[1]).toLowerCase());
    case "TEXT": return str(a[0]);
    case "NUMBER": return parseLooseNumber(a[0]);
    case "YEAR": case "MONTH": case "DAY": case "QUARTER": case "YEAR_MONTH": {
      const iso = toIsoDate(a[0]);
      if (!iso) return null;
      const m = Number(iso.slice(5, 7));
      if (f === "YEAR") return Number(iso.slice(0, 4));
      if (f === "MONTH") return m;
      if (f === "DAY") return Number(iso.slice(8, 10));
      if (f === "QUARTER") return Math.ceil(m / 3);
      return iso.slice(0, 7);
    }
    case "DATE_DIFF": {
      const x = dayNumber(a[0]); const y = dayNumber(a[1]);
      return x === null || y === null ? null : x - y;
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Bộ trường đã biên dịch

export interface CompiledField {
  id: string;
  name: string;
  kind: "row" | "agg";
  ast: Node;
  refs: string[];
}

export interface CalcSet {
  /** Trường theo dòng, đã xếp theo thứ tự phụ thuộc (trường dùng trường khác thì đứng sau). */
  rowFields: CompiledField[];
  /** Trường tổng hợp, tra theo tên. */
  aggFields: Map<string, CompiledField>;
  /** Trường lỗi: tên → thông báo. Trường lỗi không được tính. */
  errors: Map<string, string>;
}

export const EMPTY_CALC: CalcSet = { rowFields: [], aggFields: new Map(), errors: new Map() };

/**
 * Biên dịch danh sách trường của một nguồn dữ liệu.
 * `baseColumns`: tên các cột gốc, để báo trùng tên. Tham chiếu tới cột không tồn tại không bị coi là lỗi cú pháp
 * ở đây (cột có thể đang tải), nhưng `validateRefs` giúp UI báo.
 */
export function compileCalcFields(defs: CalcFieldDef[], baseColumns: string[] = []): CalcSet {
  const errors = new Map<string, string>();
  const base = new Set(baseColumns);
  const parsed = new Map<string, CompiledField>();

  for (const d of defs) {
    const name = d.name.trim();
    if (!name) { errors.set(d.id, "Chưa đặt tên."); continue; }
    if (/[\[\]]/.test(name)) { errors.set(name, "Tên không được chứa [ hoặc ]."); continue; }
    if (base.has(name)) { errors.set(name, `Trùng tên với cột có sẵn "${name}".`); continue; }
    if (parsed.has(name) || errors.has(name)) { errors.set(name, `Có hai trường cùng tên "${name}".`); parsed.delete(name); continue; }
    const r = parseFormula(d.expression);
    if (!r.ok) { errors.set(name, r.error); continue; }
    parsed.set(name, { id: d.id, name, kind: r.analysis.kind, ast: r.ast, refs: r.analysis.refs });
  }

  // Kiểm tra tham chiếu giữa các trường tính toán.
  for (const f of parsed.values()) {
    for (const r of f.refs) {
      const dep = parsed.get(r);
      if (!dep) continue;
      if (dep.kind === "agg") {
        errors.set(f.name, `Không dùng được trường tổng hợp [${r}] trong công thức khác. Hãy viết lại công thức đầy đủ.`);
        break;
      }
    }
  }
  for (const name of errors.keys()) parsed.delete(name);

  // Sắp xếp phụ thuộc (DFS), phát hiện vòng lặp.
  const order: CompiledField[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (f: CompiledField, path: string[]): boolean => {
    if (state.get(f.name) === 2) return true;
    if (state.get(f.name) === 1) {
      const cycle = [...path.slice(path.indexOf(f.name)), f.name];
      for (const n of cycle) errors.set(n, `Vòng lặp: ${cycle.join(" → ")}.`);
      return false;
    }
    state.set(f.name, 1);
    let ok = true;
    for (const r of f.refs) {
      const dep = parsed.get(r);
      if (dep && dep.kind === "row" && !visit(dep, [...path, f.name])) ok = false;
    }
    state.set(f.name, 2);
    if (ok && !errors.has(f.name)) order.push(f);
    return ok;
  };
  for (const f of [...parsed.values()]) if (f.kind === "row") visit(f, []);
  // Trường phụ thuộc vào trường bị lỗi thì cũng bị loại (lặp tới khi không còn thay đổi).
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of order) {
      if (errors.has(f.name)) continue;
      const bad = f.refs.find((r) => errors.has(r) && !base.has(r));
      if (bad !== undefined) {
        errors.set(f.name, `Phụ thuộc vào trường bị lỗi [${bad}].`);
        changed = true;
      }
    }
  }
  const rowFields = order.filter((f) => !errors.has(f.name));
  const aggFields = new Map<string, CompiledField>();
  for (const f of parsed.values()) if (f.kind === "agg" && !errors.has(f.name)) aggFields.set(f.name, f);
  return { rowFields, aggFields, errors };
}

/** Tham chiếu tới cột không có trong dữ liệu (để UI cảnh báo). Chỉ gợi ý, không chặn lưu. */
export function unknownRefs(def: CalcFieldDef, knownColumns: string[]): string[] {
  const r = parseFormula(def.expression);
  if (!r.ok) return [];
  const known = new Set(knownColumns);
  return r.analysis.refs.filter((x) => !known.has(x));
}

/** Thêm các cột tính theo dòng vào từng dòng dữ liệu. Không đổi dòng gốc; trả về đúng `rows` nếu không có gì để thêm. */
export function materializeRows(rows: Row[], set: CalcSet): Row[] {
  if (set.rowFields.length === 0 || rows.length === 0) return rows;
  return rows.map((r) => {
    const out: Row = { ...r };
    for (const f of set.rowFields) out[f.name] = ev(f.ast, { row: out });
    return out;
  });
}

/** Giá trị của trường tổng hợp trên một nhóm dòng (null/không phải số thì thành 0). */
export function evalAggField(field: CompiledField, rows: Row[]): number {
  const v = ev(field.ast, { rows });
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Đoán kiểu cột của trường tính toán từ các dòng đã được tính (số/chữ/đúng-sai). */
export function inferCalcType(field: CompiledField, materialized: Row[]): "number" | "string" | "boolean" {
  if (field.kind === "agg") return "number";
  for (let i = 0; i < Math.min(materialized.length, 200); i++) {
    const v = materialized[i][field.name];
    if (typeof v === "number") return "number";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "string" && v !== "") return "string";
  }
  return "string";
}

/** Danh sách hàm cho bảng gợi ý trong UI. */
export const FUNCTION_DOCS: Array<{ group: string; name: string; sig: string; desc: string }> = [
  { group: "Tổng hợp", name: "SUM", sig: "SUM(x)", desc: "Tổng" },
  { group: "Tổng hợp", name: "AVG", sig: "AVG(x)", desc: "Trung bình" },
  { group: "Tổng hợp", name: "COUNT", sig: "COUNT(x)", desc: "Đếm ô có giá trị" },
  { group: "Tổng hợp", name: "COUNT_DISTINCT", sig: "COUNT_DISTINCT(x)", desc: "Đếm giá trị khác nhau" },
  { group: "Tổng hợp", name: "MIN", sig: "MIN(x)", desc: "Nhỏ nhất" },
  { group: "Tổng hợp", name: "MAX", sig: "MAX(x)", desc: "Lớn nhất" },
  { group: "Số", name: "ROUND", sig: "ROUND(x, số lẻ)", desc: "Làm tròn" },
  { group: "Số", name: "ABS", sig: "ABS(x)", desc: "Giá trị tuyệt đối" },
  { group: "Số", name: "FLOOR", sig: "FLOOR(x)", desc: "Làm tròn xuống" },
  { group: "Số", name: "CEIL", sig: "CEIL(x)", desc: "Làm tròn lên" },
  { group: "Số", name: "SQRT", sig: "SQRT(x)", desc: "Căn bậc hai" },
  { group: "Số", name: "POWER", sig: "POWER(x, mũ)", desc: "Luỹ thừa" },
  { group: "Số", name: "MOD", sig: "MOD(x, y)", desc: "Chia lấy dư" },
  { group: "Số", name: "LEAST", sig: "LEAST(a, b, …)", desc: "Nhỏ nhất trong các giá trị" },
  { group: "Số", name: "GREATEST", sig: "GREATEST(a, b, …)", desc: "Lớn nhất trong các giá trị" },
  { group: "Số", name: "SAFE_DIVIDE", sig: "SAFE_DIVIDE(a, b)", desc: "Chia, mẫu bằng 0 thì ra trống" },
  { group: "Điều kiện", name: "IF", sig: "IF(điều kiện, nếu đúng, nếu sai)", desc: "Rẽ nhánh" },
  { group: "Điều kiện", name: "IFNULL", sig: "IFNULL(x, giá trị thay)", desc: "Thay ô trống" },
  { group: "Điều kiện", name: "ISNULL", sig: "ISNULL(x)", desc: "Ô có trống không" },
  { group: "Chữ", name: "CONCAT", sig: "CONCAT(a, b, …)", desc: "Nối chữ (hoặc dùng a & b)" },
  { group: "Chữ", name: "UPPER", sig: "UPPER(s)", desc: "IN HOA" },
  { group: "Chữ", name: "LOWER", sig: "LOWER(s)", desc: "in thường" },
  { group: "Chữ", name: "TRIM", sig: "TRIM(s)", desc: "Cắt khoảng trắng hai đầu" },
  { group: "Chữ", name: "LEFT", sig: "LEFT(s, n)", desc: "n ký tự đầu" },
  { group: "Chữ", name: "RIGHT", sig: "RIGHT(s, n)", desc: "n ký tự cuối" },
  { group: "Chữ", name: "LENGTH", sig: "LENGTH(s)", desc: "Độ dài" },
  { group: "Chữ", name: "CONTAINS", sig: "CONTAINS(s, tìm)", desc: "Có chứa không (không phân biệt hoa thường)" },
  { group: "Chữ", name: "TEXT", sig: "TEXT(x)", desc: "Chuyển thành chữ" },
  { group: "Chữ", name: "NUMBER", sig: "NUMBER(s)", desc: "Chuyển chữ thành số" },
  { group: "Ngày", name: "YEAR", sig: "YEAR(ngày)", desc: "Năm" },
  { group: "Ngày", name: "MONTH", sig: "MONTH(ngày)", desc: "Tháng" },
  { group: "Ngày", name: "DAY", sig: "DAY(ngày)", desc: "Ngày trong tháng" },
  { group: "Ngày", name: "QUARTER", sig: "QUARTER(ngày)", desc: "Quý (1–4)" },
  { group: "Ngày", name: "YEAR_MONTH", sig: "YEAR_MONTH(ngày)", desc: "Năm-tháng, ví dụ 2026-03" },
  { group: "Ngày", name: "DATE_DIFF", sig: "DATE_DIFF(ngày1, ngày2)", desc: "Số ngày chênh lệch" },
];
