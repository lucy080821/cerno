import { normalizeText } from "@dashboard/schema";
import { CHANNELS, INPUT_FIELDS, type Channel, type ColumnMapping, type InputField } from "./canonical";
import { detectSheet, headerText, validateMapping, type Detection } from "./detect";
import type { RawCell, RawTable } from "./files";
import { normalizeOrders, type NormalizeResult } from "./normalize";
import { sanitizeMapping } from "./prepare";
import { PROFILES } from "./profiles";

/**
 * Chuẩn bị một tab Google Sheet (bảng chữ đã định dạng) cho nguồn "Đơn hàng đa kênh". Cùng bộ nhận diện và chuẩn hoá với file Excel/CSV
 * (detect.ts, normalize.ts), thêm ba việc riêng của Sheet:
 * 1. Ánh xạ cột lưu theo TÊN cột trong dòng tiêu đề (không theo chỉ số), nên chèn thêm cột vào Sheet không làm lệch.
 * 2. Khử dòng trùng: người dùng dán chồng khoảng ngày thì một đơn có thể xuất hiện hai lần; giữ dòng nằm DƯỚI (mới hơn). Dòng tiêu đề
 *    bị dán lặp lại ở giữa bảng cũng bị bỏ.
 * 3. Mã đơn bị Sheets đổi sang số khoa học (5.78E+17) là dữ liệu hỏng: báo lỗi thay vì nhập.
 * Hàm thuần, không đụng DB hay mạng.
 */

/** Trường → tên cột (đúng chữ trong dòng tiêu đề). Phí sàn có thể gồm nhiều cột. */
export type NamedMapping = Partial<Record<InputField, string[]>>;

const MAX_HEADER_SCAN = 15;
const isChannel = (v: unknown): v is Channel => typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
const norm = (c: RawCell): string => normalizeText(headerText(c));

/** Đổi ánh xạ theo chỉ số thành ánh xạ theo tên cột (để lưu). Cột không có tên thì bỏ qua. */
export function mappingToNames(mapping: ColumnMapping, headers: string[]): NamedMapping {
  const out: NamedMapping = {};
  for (const f of INPUT_FIELDS) {
    const names = (mapping[f] ?? []).map((i) => headers[i]?.trim()).filter((n): n is string => !!n);
    if (names.length) out[f] = names;
  }
  return out;
}

/** Đọc ánh xạ theo tên từ nơi không tin cậy (JSON trong DB): chỉ trường đã biết, tên là chữ ngắn, tối đa 10 cột mỗi trường. */
export function sanitizeNamedMapping(raw: unknown): NamedMapping {
  const out: NamedMapping = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const f of INPUT_FIELDS) {
    const v = (raw as Record<string, unknown>)[f];
    if (!Array.isArray(v)) continue;
    const names = [...new Set(v.filter((n): n is string => typeof n === "string" && n.trim() !== "" && n.length <= 200).map((n) => n.trim()))].slice(0, 10);
    if (names.length) out[f] = f === "platformFee" ? names : names.slice(0, 1);
  }
  return out;
}

export type ResolveResult = { headerRow: number; headers: string[]; mapping: ColumnMapping } | { error: string };

/**
 * Tìm dòng tiêu đề chứa đủ các tên cột đã lưu (trong 15 dòng đầu) và đổi về chỉ số cột. Tên trùng nhau thì lần lượt gán các cột
 * chưa dùng từ trái sang phải. Thiếu cột nào thì báo đúng tên cột đó (người dùng đã xoá hoặc đổi tên cột trong Sheet).
 */
export function resolveNamedMapping(named: NamedMapping, table: RawTable): ResolveResult {
  let best: { headerRow: number; headers: string[]; mapping: ColumnMapping; missing: string[] } | null = null;
  for (let r = 0; r < Math.min(table.length, MAX_HEADER_SCAN); r++) {
    const headers = table[r].map(headerText);
    if (headers.filter(Boolean).length < 2) continue;
    const normHeaders = headers.map(normalizeText);
    const used = new Set<number>();
    const mapping: ColumnMapping = {};
    const missing: string[] = [];
    for (const f of INPUT_FIELDS) {
      for (const name of named[f] ?? []) {
        const i = normHeaders.findIndex((h, idx) => h === normalizeText(name) && !used.has(idx));
        if (i < 0) {
          missing.push(name);
          continue;
        }
        used.add(i);
        (mapping[f] ??= []).push(i);
      }
    }
    if (!best || missing.length < best.missing.length) best = { headerRow: r, headers, mapping, missing };
    if (missing.length === 0) break;
  }
  if (!best) return { error: "Không tìm thấy dòng tiêu đề trong tab này." };
  if (best.missing.length) {
    const shown = [...new Set(best.missing)].slice(0, 3).map((n) => `"${n}"`).join(", ");
    return { error: `Không còn thấy cột ${shown} trong dòng tiêu đề của Sheet (có thể đã bị xoá hoặc đổi tên). Hãy đặt lại tên cột như cũ hoặc nối lại Sheet.` };
  }
  return { headerRow: best.headerRow, headers: best.headers, mapping: best.mapping };
}

const idKey = (c: RawCell): string => String(c ?? "").trim().replace(/^'+/, "").toLowerCase();

export interface CleanResult {
  table: RawTable;
  repeatedHeaders: number;
  duplicates: number;
}

/**
 * Bỏ dòng tiêu đề bị dán lặp và dòng trùng. Trùng = cùng mã đơn + SKU + phân loại + tên sản phẩm; giữ dòng nằm dưới cùng (dữ liệu dán
 * sau là bản mới hơn, ví dụ trạng thái đơn đã đổi). Dòng không có mã đơn không bao giờ bị coi là trùng. Thứ tự dòng còn lại giữ nguyên.
 */
export function cleanSheetTable(table: RawTable, headerRow: number, mapping: ColumnMapping): CleanResult {
  const headers = table[headerRow]?.map(norm) ?? [];
  const head = table.slice(0, headerRow + 1);
  let repeatedHeaders = 0;
  const body: RawCell[][] = [];
  for (const r of table.slice(headerRow + 1)) {
    const filled = r.map((c, i) => ({ t: norm(c), i })).filter((x) => x.t !== "");
    const same = filled.filter((x) => headers[x.i] && x.t === headers[x.i]).length;
    if (filled.length >= 2 && same / filled.length >= 0.6) {
      repeatedHeaders++;
      continue;
    }
    body.push(r);
  }

  const orderCol = mapping.orderId?.[0];
  if (orderCol === undefined) return { table: [...head, ...body], repeatedHeaders, duplicates: 0 };
  const parts = [orderCol, mapping.sku?.[0], mapping.variant?.[0], mapping.product?.[0]].filter((i): i is number => i !== undefined);
  const seen = new Set<string>();
  const keep: boolean[] = new Array(body.length).fill(true);
  let duplicates = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    const id = idKey(body[i][orderCol]);
    if (id === "") continue;
    const key = parts.map((p) => idKey(body[i][p])).join("\u0001");
    if (seen.has(key)) {
      keep[i] = false;
      duplicates++;
    } else seen.add(key);
  }
  return { table: [...head, ...body.filter((_, i) => keep[i])], repeatedHeaders, duplicates };
}

const SCIENTIFIC = /^\d+(\.\d+)?e\+\d+$/i;

/** Số mã đơn bị hiển thị dạng số khoa học (đã mất chữ số cuối, không dùng được để nhận ra đơn trùng). */
export function countScientificIds(table: RawTable, headerRow: number, mapping: ColumnMapping): number {
  const col = mapping.orderId?.[0];
  if (col === undefined) return 0;
  let n = 0;
  for (const r of table.slice(headerRow + 1)) if (SCIENTIFIC.test(String(r[col] ?? "").trim())) n++;
  return n;
}

export interface SheetPrepared {
  headerRow: number;
  headers: string[];
  profile: Detection["profile"];
  profileLabel: string;
  channel: Channel | null;
  /** Ánh xạ theo chỉ số cột (để chỉnh trên giao diện). */
  mapping: ColumnMapping;
  /** Ánh xạ theo tên cột (để lưu). */
  named: NamedMapping;
  problems: string[];
  /** Có kết quả khi `problems` rỗng. */
  normalized: NormalizeResult | null;
  duplicates: number;
  repeatedHeaders: number;
  /** Cảnh báo của chuẩn hoá cộng thêm ghi chú khử trùng. */
  warnings: string[];
}

export interface PrepareSheetOptions {
  channel?: unknown;
  /** Ánh xạ người dùng chỉnh trên giao diện (chỉ số cột). */
  mapping?: unknown;
  /** Ánh xạ đã lưu (theo tên cột): dùng cho các lần đồng bộ sau. */
  named?: NamedMapping | null;
}

const EMPTY = (problem: string, channel: Channel | null = null): SheetPrepared => ({
  headerRow: 0, headers: [], profile: "generic", profileLabel: "", channel, mapping: {}, named: {}, problems: [problem], normalized: null, duplicates: 0, repeatedHeaders: 0, warnings: [],
});

/** Nhận diện (hoặc áp ánh xạ đã lưu), khử trùng và chuẩn hoá một tab Sheet. Không ghi gì. */
export function prepareSheetTable(values: RawTable, opts: PrepareSheetOptions = {}): SheetPrepared {
  const channel = isChannel(opts.channel) ? opts.channel : null;
  if (!values.length) return EMPTY("Tab này trống: dòng đầu tiên cần là tên cột.", channel);

  let headerRow: number;
  let headers: string[];
  let mapping: ColumnMapping;
  let profile: Detection["profile"] = "generic";
  let detectedChannel: Channel | null = null;
  if (opts.named && Object.keys(opts.named).length) {
    const r = resolveNamedMapping(opts.named, values);
    if ("error" in r) return EMPTY(r.error, channel);
    ({ headerRow, headers, mapping } = r);
  } else {
    const d = detectSheet(values);
    if (!d) return EMPTY("Không tìm thấy bảng đơn hàng trong tab này. Dòng tiêu đề cần có ít nhất cột ngày đặt hàng và thành tiền.", channel);
    headerRow = d.headerRow;
    headers = d.headers;
    mapping = sanitizeMapping(opts.mapping, headers.length) ?? d.mapping;
    profile = d.profile;
    detectedChannel = d.channel;
  }
  const finalChannel = channel ?? detectedChannel;

  const problems = validateMapping(mapping);
  if (!finalChannel) problems.push("Chưa chọn kênh bán.");
  const base = {
    headerRow, headers, profile, profileLabel: PROFILES.find((p) => p.id === profile)?.label ?? "", channel: finalChannel, mapping, named: mappingToNames(mapping, headers),
  };

  const sci = countScientificIds(values, headerRow, mapping);
  if (sci > 0) {
    problems.push(
      `${sci.toLocaleString("vi-VN")} mã đơn đang bị Google Sheets hiển thị dạng số khoa học (ví dụ 5.78E+17) nên đã mất chữ số cuối và không dùng được. Hãy chọn cả cột mã đơn, vào Định dạng › Số › Văn bản thuần, rồi dán lại các mã đơn.`,
    );
  }
  if (problems.length || !finalChannel) return { ...base, problems, normalized: null, duplicates: 0, repeatedHeaders: 0, warnings: [] };

  const cleaned = cleanSheetTable(values, headerRow, mapping);
  const normalized = normalizeOrders(cleaned.table, headerRow, mapping, finalChannel);
  const warnings = [...normalized.warnings];
  if (cleaned.duplicates) {
    warnings.push(`Đã bỏ ${cleaned.duplicates.toLocaleString("vi-VN")} dòng trùng (cùng mã đơn, sản phẩm và phân loại): giữ dòng nằm dưới, là bản mới hơn.`);
  }
  if (cleaned.repeatedHeaders) warnings.push(`Đã bỏ ${cleaned.repeatedHeaders.toLocaleString("vi-VN")} dòng tiêu đề bị dán lặp lại ở giữa bảng.`);
  if (normalized.rows.length === 0) problems.push("Tab không có dòng dữ liệu nào.");
  return { ...base, problems, normalized: problems.length ? null : normalized, duplicates: cleaned.duplicates, repeatedHeaders: cleaned.repeatedHeaders, warnings };
}
