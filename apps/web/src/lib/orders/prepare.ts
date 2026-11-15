import { CHANNELS, INPUT_FIELDS, type Channel, type ColumnMapping } from "./canonical";
import { pickSheet, validateMapping, type Detection } from "./detect";
import { FileError, readSheets, type RawSheet } from "./files";
import { normalizeOrders, type NormalizeResult } from "./normalize";
import { PROFILES } from "./profiles";

export interface PrepareOptions {
  /** Tên sheet người dùng chọn; bỏ trống = tự chọn sheet hợp nhất. */
  sheet?: string;
  /** Ánh xạ người dùng đã chỉnh (chỉ số cột trong file); bỏ trống = theo nhận diện tự động. */
  mapping?: unknown;
  channel?: unknown;
}

export interface Prepared {
  filename: string;
  sheetNames: string[];
  sheet: string;
  headerRow: number;
  headers: string[];
  profile: Detection["profile"];
  profileLabel: string;
  channel: Channel | null;
  mapping: ColumnMapping;
  /** Điều còn thiếu để nhập được. Rỗng thì `normalized` có kết quả. */
  problems: string[];
  normalized: NormalizeResult | null;
}

const isChannel = (v: unknown): v is Channel => typeof v === "string" && (CHANNELS as readonly string[]).includes(v);

/** Ánh xạ từ client là dữ liệu không tin cậy: chỉ nhận trường đã biết, chỉ số nguyên trong phạm vi cột, tối đa 10 cột mỗi trường. */
export function sanitizeMapping(raw: unknown, columnCount: number): ColumnMapping | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: ColumnMapping = {};
  for (const field of INPUT_FIELDS) {
    const v = (raw as Record<string, unknown>)[field];
    if (!Array.isArray(v)) continue;
    const cols = [...new Set(v.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < columnCount))].slice(0, 10);
    if (cols.length) out[field] = field === "platformFee" ? cols : cols.slice(0, 1);
  }
  return out;
}

/** Đọc file, nhận diện, áp ánh xạ của người dùng (nếu có) và chuẩn hoá thử. Không ghi gì vào DB. */
export async function prepareImport(data: Uint8Array, filename: string, opts: PrepareOptions = {}): Promise<Prepared> {
  const sheets = await readSheets(data, filename);
  const chosen = chooseSheet(sheets, opts.sheet);
  if (!chosen) throw new FileError("Không tìm thấy bảng đơn hàng trong file. Dòng tiêu đề cần có ít nhất cột ngày đặt hàng và thành tiền.");
  const { sheet, detection } = chosen;

  const mapping = sanitizeMapping(opts.mapping, detection.headers.length) ?? detection.mapping;
  const channel = isChannel(opts.channel) ? opts.channel : detection.channel;
  const problems = validateMapping(mapping);
  if (!channel) problems.push("Chưa chọn kênh bán.");

  const normalized = problems.length === 0 && channel ? normalizeOrders(sheet.rows, detection.headerRow, mapping, channel) : null;
  if (normalized && normalized.rows.length === 0) problems.push("File không có dòng dữ liệu nào.");
  return {
    filename,
    sheetNames: sheets.map((s) => s.name),
    sheet: sheet.name,
    headerRow: detection.headerRow,
    headers: detection.headers,
    profile: detection.profile,
    profileLabel: PROFILES.find((p) => p.id === detection.profile)?.label ?? "",
    channel,
    mapping,
    problems,
    normalized: problems.length ? null : normalized,
  };
}

function chooseSheet(sheets: RawSheet[], wanted?: string) {
  if (wanted) {
    const only = sheets.filter((s) => s.name === wanted);
    if (only.length) {
      const picked = pickSheet(only);
      if (picked) return picked;
    }
  }
  return pickSheet(sheets);
}
