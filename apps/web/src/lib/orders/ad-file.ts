import { normalizeText } from "@dashboard/schema";
import { parseNumber } from "@/lib/google/parse-number";
import { ALL_CHANNELS, MAX_AD_ENTRIES, MAX_DAILY_SPEND, summarizeAdSpend, type AdChannelSummary, type AdSpendEntry } from "@/lib/profit/ad-spend";
import { CHANNELS } from "./canonical";
import { headerText } from "./detect";
import { FileError, readSheets, type RawCell, type RawSheet, type RawTable } from "./files";
import { dateText, detectDateOrder } from "./normalize";

/**
 * Đọc file báo cáo chi phí quảng cáo THEO NGÀY (Shopee Ads, Facebook/Meta Ads, TikTok Ads hoặc bảng tự ghi) thành danh sách
 * (kênh, ngày, số tiền). Chỉ cần hai cột: ngày và chi phí; thêm cột kênh nếu một file có nhiều kênh. Nhiều dòng cùng ngày
 * (nhiều chiến dịch) được cộng lại. Việc chia chi phí cho từng đơn nằm ở `lib/profit/ad-spend.ts`.
 */

import { AD_FIELDS, type AdField, type AdMapping } from "./ad-fields";

export { AD_FIELDS, AD_LABELS } from "./ad-fields";
export type { AdField, AdMapping } from "./ad-fields";

const EXACT: Record<AdField, string[]> = {
  date: ["ngay", "date", "day", "ngay bao cao", "thoi gian", "ngay chay", "ngay hien thi", "reporting starts", "ngay bat dau", "start date", "by day"],
  spend: ["chi phi", "chi tieu", "chi phi quang cao", "tong chi phi", "so tien da chi tieu", "so tien chi tieu", "expense", "spend", "cost", "ad spend", "amount spent", "total cost", "tien da chi", "so tien da chi", "chi phi vnd", "amount spent vnd"],
  channel: ["kenh", "nen tang", "platform", "kenh ban", "channel", "san"],
};
/** Tên gần đúng; cột "chi phí trên mỗi kết quả/CPC/CPM..." không phải chi phí tổng nên bị loại. */
const FUZZY: Partial<Record<AdField, RegExp>> = {
  date: /^(ngay|date|day)( |$)/,
  spend: /(chi phi|chi tieu|amount spent|spend|expense|^cost)/,
};
const FUZZY_DENY: Partial<Record<AdField, RegExp>> = {
  spend: /(moi|tren|\bper\b|cpc|cpm|cpa|cpr|cpp|cost per|ty le|roas|gia )/,
};

export function proposeAdMapping(headers: string[]): AdMapping {
  const norm = headers.map(normalizeText);
  const used = new Set<number>();
  const mapping: AdMapping = {};
  for (const f of AD_FIELDS) {
    for (const name of EXACT[f]) {
      const i = norm.findIndex((h, idx) => h === name && !used.has(idx));
      if (i >= 0) {
        mapping[f] = i;
        used.add(i);
        break;
      }
    }
  }
  for (const f of AD_FIELDS) {
    if (mapping[f] !== undefined) continue;
    const re = FUZZY[f];
    if (!re) continue;
    const deny = FUZZY_DENY[f];
    const cands = norm
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => !used.has(i) && h !== "" && re.test(h) && !(deny && deny.test(h)))
      .sort((a, b) => a.h.length - b.h.length || a.i - b.i);
    if (cands.length) {
      mapping[f] = cands[0].i;
      used.add(cands[0].i);
    }
  }
  return mapping;
}

export interface AdDetection {
  headerRow: number;
  headers: string[];
  mapping: AdMapping;
}

/** Tìm dòng tiêu đề (trong 15 dòng đầu) có đủ cột ngày và chi phí; file có vài dòng ghi chú ở trên vẫn đọc được. */
export function detectAdSheet(rows: RawTable): AdDetection | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const headers = rows[r].map(headerText);
    if (headers.filter(Boolean).length < 2) continue;
    const mapping = proposeAdMapping(headers);
    if (mapping.date !== undefined && mapping.spend !== undefined) return { headerRow: r, headers, mapping };
  }
  return null;
}

/** Tên kênh trong file → tên kênh chuẩn của đơn hàng. */
export function adChannelOf(raw: string): string | null {
  const n = normalizeText(raw);
  if (!n) return null;
  if (n.includes("shopee")) return "Shopee";
  if (n.includes("tiktok") || n.includes("tik tok")) return "TikTok Shop";
  if (n.includes("lazada")) return "Lazada";
  if (/(facebook|^fb$|meta|instagram)/.test(n)) return "Facebook";
  return null;
}

function amountOf(c: RawCell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (c === null || c === undefined || c instanceof Date || typeof c === "boolean") return null;
  const t = String(c).trim();
  if (t === "" || /^(-|–|—|n\/a|na|null)$/i.test(t)) return null;
  return parseNumber(t);
}

export interface AdParse {
  entries: AdSpendEntry[];
  warnings: string[];
  /** Số dòng dữ liệu trong file (không tính dòng trống). */
  rows: number;
}

/** Đổi bảng thành các dòng (kênh, ngày, tiền) đã cộng theo ngày. `channel` = kênh chọn khi file không có cột kênh. */
export function parseAdRows(rows: RawTable, headerRow: number, mapping: AdMapping, channel: string | null): AdParse {
  const warnings: string[] = [];
  const body = rows.slice(headerRow + 1).filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
  const dateCol = mapping.date as number;
  const spendCol = mapping.spend as number;
  const order = detectDateOrder(body.map((r) => r[dateCol]));
  const sums = new Map<string, AdSpendEntry>();
  let noDate = 0;
  let noAmount = 0;
  let negative = 0;
  let unknownChannel = 0;
  const today = new Date();
  const limit = `${today.getUTCFullYear() + 1}-12-31`;
  for (const r of body) {
    const d = dateText(r[dateCol], order);
    if (!d) {
      noDate++;
      continue;
    }
    const day = d.slice(0, 10);
    if (day > limit || day < "2000-01-01") {
      noDate++;
      continue;
    }
    const amount = amountOf(r[spendCol]);
    if (amount === null) {
      noAmount++;
      continue;
    }
    if (amount < 0) {
      negative++;
      continue;
    }
    let ch = channel;
    if (mapping.channel !== undefined) {
      const raw = headerText(r[mapping.channel]);
      const known = raw ? adChannelOf(raw) : null;
      if (known) ch = known;
      else if (raw) {
        ch = "Khác";
        unknownChannel++;
      }
    }
    if (!ch) continue;
    const key = `${ch}\u0000${day}`;
    const cur = sums.get(key);
    if (cur) cur.amount += amount;
    else sums.set(key, { channel: ch, day, amount });
  }
  const entries = [...sums.values()].map((e) => ({ ...e, amount: Math.round(e.amount) })).sort((a, b) => a.day.localeCompare(b.day) || a.channel.localeCompare(b.channel));
  if (noDate) warnings.push(`Bỏ qua ${noDate} dòng không có ngày hợp lệ (thường là dòng tổng cộng hoặc ghi chú).`);
  if (noAmount) warnings.push(`Bỏ qua ${noAmount} dòng không có số tiền.`);
  if (negative) warnings.push(`Bỏ qua ${negative} dòng có số tiền âm.`);
  if (unknownChannel) warnings.push(`${unknownChannel} dòng có tên kênh không nhận ra, đã xếp vào kênh "Khác".`);
  return { entries, warnings, rows: body.length };
}

export interface AdPrepared {
  filename: string;
  sheetNames: string[];
  sheet: string;
  headers: string[];
  mapping: AdMapping;
  /** Kênh người dùng chọn (hoặc ALL_CHANNELS); null nếu chưa chọn. */
  channel: string | null;
  problems: string[];
  entries: AdSpendEntry[];
  warnings: string[];
  summary: { days: number; total: number; dateMin: string | null; dateMax: string | null; rows: number; byChannel: AdChannelSummary[] } | null;
}

export interface AdPrepareOptions {
  sheet?: string;
  channel?: unknown;
  mapping?: unknown;
}

export const isAdChannel = (v: unknown): v is string => typeof v === "string" && (v === ALL_CHANNELS || (CHANNELS as readonly string[]).includes(v));

/** Ánh xạ từ client là dữ liệu không tin cậy: chỉ nhận trường đã biết và chỉ số nguyên trong phạm vi cột. */
export function sanitizeAdMapping(raw: unknown, columnCount: number): AdMapping | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: AdMapping = {};
  for (const f of AD_FIELDS) {
    const v = (raw as Record<string, unknown>)[f];
    if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < columnCount) out[f] = v as number;
  }
  return out;
}

function chooseSheet(sheets: RawSheet[], wanted?: string): { sheet: RawSheet; detection: AdDetection } | null {
  const list = wanted && sheets.some((s) => s.name === wanted) ? sheets.filter((s) => s.name === wanted) : sheets;
  for (const sheet of list) {
    const detection = detectAdSheet(sheet.rows);
    if (detection) return { sheet, detection };
  }
  return null;
}

/** Đọc file, nhận diện cột, áp ánh xạ/kênh của người dùng và gom theo ngày. Không ghi gì vào DB. */
export async function prepareAdSpend(data: Uint8Array, filename: string, opts: AdPrepareOptions = {}): Promise<AdPrepared> {
  const sheets = await readSheets(data, filename);
  const chosen = chooseSheet(sheets, opts.sheet);
  if (!chosen) throw new FileError("Không tìm thấy bảng chi phí quảng cáo trong file. Dòng tiêu đề cần có cột ngày và cột chi phí.");
  const { sheet, detection } = chosen;
  const mapping = sanitizeAdMapping(opts.mapping, detection.headers.length) ?? detection.mapping;
  const channel = isAdChannel(opts.channel) ? opts.channel : null;
  const problems: string[] = [];
  if (mapping.date === undefined) problems.push("Chưa chọn cột ngày.");
  if (mapping.spend === undefined) problems.push("Chưa chọn cột chi phí.");
  if (mapping.date !== undefined && mapping.date === mapping.spend) problems.push("Cột ngày và cột chi phí phải khác nhau.");
  if (mapping.channel === undefined && !channel) problems.push("Chưa chọn kênh nhận chi phí quảng cáo.");

  let entries: AdSpendEntry[] = [];
  let warnings: string[] = [];
  let rows = 0;
  if (problems.length === 0) {
    const parsed = parseAdRows(sheet.rows, detection.headerRow, mapping, channel);
    entries = parsed.entries;
    warnings = parsed.warnings;
    rows = parsed.rows;
    if (entries.length === 0) problems.push("Không đọc được ngày nào có chi phí. Kiểm tra lại cột ngày và cột chi phí.");
    else if (entries.length > MAX_AD_ENTRIES) problems.push(`File có ${entries.length.toLocaleString("vi-VN")} dòng (ngày × kênh), vượt giới hạn ${MAX_AD_ENTRIES.toLocaleString("vi-VN")}.`);
    else if (entries.some((e) => e.amount > MAX_DAILY_SPEND)) problems.push("Có ngày chi phí lớn bất thường (trên 10 tỷ đồng). Kiểm tra lại cột chi phí.");
    else if (entries.every((e) => e.amount === 0)) problems.push("Mọi ngày đều có chi phí bằng 0.");
  }
  const ok = problems.length === 0;
  return {
    filename,
    sheetNames: sheets.map((s) => s.name),
    sheet: sheet.name,
    headers: detection.headers,
    mapping,
    channel,
    problems,
    entries: ok ? entries : [],
    warnings,
    summary: ok
      ? {
          days: new Set(entries.map((e) => e.day)).size,
          total: entries.reduce((n, e) => n + e.amount, 0),
          dateMin: entries[0]?.day ?? null,
          dateMax: entries[entries.length - 1]?.day ?? null,
          rows,
          byChannel: summarizeAdSpend(entries),
        }
      : null,
  };
}
