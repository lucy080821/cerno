import { createHash } from "node:crypto";
import type { Cell, Row } from "@dashboard/chart-engine";

export type ColumnType = "string" | "number" | "date" | "boolean";
export interface InferredColumn {
  name: string;
  type: ColumnType;
  /** Đơn vị suy ra từ định dạng (vd cột thời lượng h:mm:ss được đổi sang số giây). */
  unit?: string;
}

/** Cột thời lượng: chuyển sang số giây để cộng/trung bình được. */
type Kind = ColumnType | "duration";

export const MAX_ROWS = 200_000;
export const MAX_COLUMNS = 60;
/**
 * Tổng số ô (dòng × cột) tối đa mỗi nguồn: giữ bộ nhớ của server trong tầm kiểm soát (mỗi ô tốn ~50-100 byte khi nạp).
 * Sheet nhiều cột thì số dòng bị giảm tương ứng, ví dụ 20 cột → tối đa 100.000 dòng.
 */
export const MAX_CELLS = 2_000_000;

/** Số dòng dữ liệu tối đa cho một sheet có `columns` cột. */
export const maxRowsFor = (columns: number) => Math.max(1, Math.min(MAX_ROWS, Math.floor(MAX_CELLS / Math.max(1, columns))));

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DURATION = /^\d{1,3}:[0-5]\d(:[0-5]\d)?$/;
/** Ô điền chữ thay cho "không có dữ liệu": coi như rỗng khi đoán kiểu và khi lưu. */
const PLACEHOLDER = /^(-|–|—|n\/a|na|null|none|#n\/a|#div\/0!|#value!|#ref!)$/i;
const isBlank = (v: string) => v.trim() === "" || PLACEHOLDER.test(v.trim());

/** "h:mm:ss" hoặc "m:ss" → số giây. */
export function parseDuration(raw: string): number | null {
  const t = raw.trim();
  if (!DURATION.test(t)) return null;
  const p = t.split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}
const DATE_VN = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

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

function cellKind(v: string): Kind {
  const t = v.trim();
  if (/^(true|false|đúng|sai)$/i.test(t)) return "boolean";
  if (DATE_ISO.test(t) || DATE_VN.test(t)) return "date";
  if (DURATION.test(t)) return "duration";
  if (parseNumber(t) !== null) return "number";
  return "string";
}

/** Đoán kiểu cột: cần ≥ 90% ô có dữ liệu cùng một kiểu (ô rỗng và "-", "n/a"... không tính). */
export function inferKind(values: string[]): Kind {
  const filled = values.filter((v) => !isBlank(v));
  if (!filled.length) return "string";
  const count: Record<Kind, number> = { string: 0, number: 0, date: 0, boolean: 0, duration: 0 };
  for (const v of filled) count[cellKind(v)]++;
  for (const t of ["date", "boolean", "duration", "number"] as const) if (count[t] / filled.length >= 0.9) return t;
  return "string";
}

export function inferType(values: string[]): ColumnType {
  const k = inferKind(values);
  return k === "duration" ? "number" : k;
}

function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h.trim() || `Cột ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/**
 * `values` là mảng 2 chiều từ Sheets API (dòng đầu = tiêu đề, ô là chuỗi đã định dạng).
 * Trả về cột đã nhận diện kiểu và các dòng đã chuyển kiểu.
 */
export function sheetToTable(values: string[][]): { columns: InferredColumn[]; rows: Row[]; truncated: boolean } {
  if (!values.length) return { columns: [], rows: [], truncated: false };
  const headers = dedupeHeaders(values[0].slice(0, MAX_COLUMNS).map(String));
  const body = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const rowCap = maxRowsFor(headers.length);
  const truncated = body.length > rowCap;
  const used = body.slice(0, rowCap);

  const kinds = headers.map((_, ci) => inferKind(used.map((r) => String(r[ci] ?? ""))));
  const columns: InferredColumn[] = headers.map((name, ci) => ({
    name,
    type: kinds[ci] === "duration" ? "number" : kinds[ci],
    ...(kinds[ci] === "duration" ? { unit: "giây" } : {}),
  }));

  const rows = used.map((r) => {
    const row: Row = {};
    headers.forEach((name, ci) => {
      const raw = String(r[ci] ?? "").trim();
      const kind = kinds[ci];
      let v: Cell = isBlank(raw) ? null : raw;
      if (v !== null && kind === "number") v = parseNumber(raw);
      else if (v !== null && kind === "duration") v = parseDuration(raw);
      else if (v !== null && kind === "boolean") v = /^(true|đúng)$/i.test(raw);
      row[name] = v;
    });
    return row;
  });
  return { columns, rows, truncated };
}

/**
 * Dấu vân tay nội dung sheet (SHA-256 của mảng giá trị gốc từ Sheets API). Hai lần đọc cho cùng dấu vân tay
 * nghĩa là sheet không đổi, nên không cần ghi lại hàng nghìn dòng. Chỉ dùng ở server.
 */
export function hashValues(values: string[][]): string {
  // Băm từng đoạn thay vì JSON.stringify cả mảng một lần: với hàng trăm nghìn dòng, chuỗi JSON khổng lồ làm tốn RAM.
  const h = createHash("sha256");
  for (let i = 0; i < values.length; i += 5000) h.update(JSON.stringify(values.slice(i, i + 5000)));
  return h.update(`#${values.length}`).digest("hex");
}
