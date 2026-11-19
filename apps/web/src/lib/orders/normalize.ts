import { normalizeText } from "@dashboard/schema";
import { hourOf, toIsoDate, type Cell, type Row } from "@dashboard/chart-engine";
import { parseNumber } from "@/lib/google/sheet-data";
import { COL, isValidStatus, type ColumnMapping, type InputField, type OrderStatus } from "./canonical";
import type { RawCell, RawTable } from "./files";

const BLANK = /^(-|–|—|n\/a|na|null|none|#n\/a)$/i;

function text(c: RawCell): string | null {
  if (c === null || c === undefined) return null;
  if (c instanceof Date) return null;
  const s = String(c).trim();
  return s === "" || BLANK.test(s) ? null : s;
}

/** Mã đơn/SKU: bỏ dấu nháy đầu mà Excel thêm để giữ nguyên số dài ("'5767...") và khoảng trắng/tab. */
function idText(c: RawCell): { value: string | null; lossy: boolean } {
  if (typeof c === "number") return { value: Number.isFinite(c) ? String(c) : null, lossy: Math.abs(c) > Number.MAX_SAFE_INTEGER || !Number.isInteger(c) };
  const t = text(c);
  if (t === null) return { value: null, lossy: false };
  return { value: t.replace(/^'+/, "").trim() || null, lossy: false };
}

function num(c: RawCell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const t = text(c);
  return t === null ? null : parseNumber(t);
}

const headerOf = (c: RawCell): string => (c instanceof Date ? "" : String(c ?? "").trim());

const two = (n: number) => String(n).padStart(2, "0");

const SLASH_DATE = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})(.*)$/;

/**
 * File của gian hàng có thể ghi dd/mm/yyyy hoặc mm/dd/yyyy. Nhìn cả cột: có giá trị mà số đầu > 12 thì là ngày-tháng,
 * có giá trị mà số thứ hai > 12 (và không có số đầu > 12) thì là tháng-ngày. Mơ hồ thì theo kiểu Việt Nam (ngày trước).
 */
export function detectDateOrder(values: RawCell[]): "dmy" | "mdy" {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = SLASH_DATE.exec(v.trim());
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[3] > 12) mdy++;
  }
  return mdy > 0 && dmy === 0 ? "mdy" : "dmy";
}

/** Ngày đặt dạng "yyyy-mm-dd", kèm " hh:mm" khi ô có giờ (để gom theo giờ trong ngày được). */
function dateText(c: RawCell, order: "dmy" | "mdy" = "dmy"): string | null {
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return null;
    const day = `${c.getUTCFullYear()}-${two(c.getUTCMonth() + 1)}-${two(c.getUTCDate())}`;
    return c.getUTCHours() === 0 && c.getUTCMinutes() === 0 ? day : `${day} ${two(c.getUTCHours())}:${two(c.getUTCMinutes())}`;
  }
  let t = text(c);
  if (t === null) return null;
  if (order === "mdy") {
    const m = SLASH_DATE.exec(t);
    if (m) t = `${m[3]}${m[2]}${m[1]}${m[2]}${m[4]}${m[5]}`;
  }
  const day = toIsoDate(t);
  if (!day) return null;
  const h = hourOf(t);
  if (h === null) return day;
  const m = /(\d{1,2}):(\d{2})/.exec(t);
  return `${day} ${two(h)}:${m ? m[2] : "00"}`;
}

/** Trạng thái gốc của sàn → 4 trạng thái chung. `known=false` khi không nhận ra (tính là Chưa hoàn tất và báo cho người dùng). */
export function mapStatus(raw: string): { status: OrderStatus; known: boolean } {
  const n = normalizeText(raw);
  if (/(^| )(huy|cancel|cancelled|canceled)( |$)/.test(n)) return { status: "Đã hủy", known: true };
  if (/(hoan tra|hoan hang|tra hang|tra lai|hoan tien|return|refund|giao khong thanh cong|giao that bai|failed|undelivered)/.test(n)) return { status: "Hoàn trả", known: true };
  if (/(hoan thanh|completed|complete|da giao|da nhan|delivered|thanh cong)/.test(n)) return { status: "Hoàn thành", known: true };
  if (/(cho |dang |xu ly|van chuyen|unpaid|on hold|awaiting|in transit|to ship|shipped|ready|pending|processing|new)/.test(n)) return { status: "Chưa hoàn tất", known: true };
  return { status: "Chưa hoàn tất", known: false };
}

export interface NormalizeStats {
  lines: number;
  orders: number;
  skippedEmpty: number;
  missingDate: number;
  missingRevenue: number;
  /** Số dòng mô tả cột (ngay dưới tiêu đề) đã bỏ qua: một số file xuất của sàn có dòng này. */
  skippedDescription: number;
  byStatus: Record<OrderStatus, number>;
  dateMin: string | null;
  dateMax: string | null;
}

export interface NormalizeResult {
  rows: Row[];
  /** Có cột mã đơn: gộp theo mã đơn khi tải thêm file. Không có: file mới thay toàn bộ dữ liệu của kênh. */
  keyed: boolean;
  stats: NormalizeStats;
  /** Điều người dùng nên biết, đã viết sẵn bằng tiếng Việt. */
  warnings: string[];
}

interface Line {
  id: string | null;
  date: string | null;
  status: OrderStatus;
  rawStatus: string | null;
  sku: string | null;
  product: string | null;
  variant: string | null;
  quantity: number | null;
  revenue: number | null;
  fee: number | null;
  province: string | null;
  payment: string | null;
  discount: number | null;
  cost: number | null;
  shippingFee: number | null;
  adCost: number | null;
}

/**
 * Dòng mô tả cột: một số file xuất có dòng thứ hai giải thích từng cột ("Platform unique order ID.", "Ngày tạo đơn..."). Nhận ra khi
 * dòng ĐẦU TIÊN dưới tiêu đề có ngày là chữ không đọc được thành ngày, không có số nào ở cột số lượng, thành tiền, đơn giá, và có chữ giải thích ở ít nhất một cột trong số đó.
 */
function looksLikeDescriptionRow(r: RawCell[], mapping: ColumnMapping): boolean {
  const at = (f: InputField): RawCell => {
    const i = mapping[f]?.[0];
    return i === undefined ? undefined : r[i];
  };
  const d = at("date");
  if (typeof d !== "string" || d.trim() === "" || toIsoDate(d.trim()) !== null) return false;
  const cells = (["quantity", "revenue", "unitPrice"] as const).map(at);
  if (cells.some((c) => num(c) !== null)) return false;
  // Dòng dữ liệu thật thiếu tiền thì ô để TRỐNG; dòng mô tả thì có CHỮ giải thích ở các cột số.
  return cells.some((c) => text(c) !== null);
}

/**
 * Đưa bảng thô của sàn về cột chuẩn. Chỉ đọc đúng các cột trong `mapping` (không đọc tên/SĐT/địa chỉ người mua).
 * Cột cấp đơn (Số đơn, Số đơn hủy, Phí sàn) chỉ ghi ở dòng đầu của mỗi đơn để cộng không bị nhân lên;
 * Phí sàn chỉ tính cho đơn hợp lệ (đơn hủy/hoàn trả không mất phí).
 */
export function normalizeOrders(table: RawTable, headerRow: number, mapping: ColumnMapping, channel: string): NormalizeResult {
  const warnings: string[] = [];
  const first = (f: InputField, r: RawCell[]): RawCell => {
    const i = mapping[f]?.[0];
    return i === undefined ? undefined : r[i];
  };
  const keyed = (mapping.orderId?.length ?? 0) > 0;
  const hasStatus = (mapping.status?.length ?? 0) > 0;
  if (!hasStatus) warnings.push("File không có cột trạng thái: coi mọi đơn là Hoàn thành.");

  const stats: NormalizeStats = {
    lines: 0,
    orders: 0,
    skippedEmpty: 0,
    missingDate: 0,
    missingRevenue: 0,
    skippedDescription: 0,
    byStatus: { "Hoàn thành": 0, "Chưa hoàn tất": 0, "Đã hủy": 0, "Hoàn trả": 0 },
    dateMin: null,
    dateMax: null,
  };
  const dateOrder = detectDateOrder(table.slice(headerRow + 1).map((r) => first("date", r)));
  if (dateOrder === "mdy") warnings.push("Ngày trong file ghi theo kiểu tháng/ngày/năm: đã đọc theo kiểu đó.");
  const unknownStatuses = new Set<string>();
  let lossyIds = 0;
  let noId = 0;

  const lines: Line[] = [];
  const keys: string[] = [];
  let rawRevenueCount = 0;
  let firstDataRow = true;
  for (const r of table.slice(headerRow + 1)) {
    if (firstDataRow) {
      firstDataRow = false;
      if (looksLikeDescriptionRow(r, mapping)) {
        stats.skippedDescription++;
        continue;
      }
    }
    const cells = [first("orderId", r), first("date", r), first("revenue", r), first("unitPrice", r), first("product", r), first("sku", r)];
    if (cells.every((c) => text(c) === null && typeof c !== "number" && !(c instanceof Date))) {
      stats.skippedEmpty++;
      continue;
    }
    const idc = idText(first("orderId", r));
    if (idc.lossy) lossyIds++;
    if (keyed && idc.value === null) noId++;

    const rawStatus = hasStatus ? text(first("status", r)) : null;
    let status: OrderStatus = "Hoàn thành";
    if (hasStatus) {
      if (rawStatus === null) status = "Chưa hoàn tất";
      else {
        const m = mapStatus(rawStatus);
        status = m.status;
        if (!m.known) unknownStatuses.add(rawStatus);
      }
    }

    const quantity = num(first("quantity", r));
    const discount = num(first("discount", r));
    let revenue = num(first("revenue", r));
    if (revenue !== null) rawRevenueCount++;
    if (revenue === null) {
      // Không có thành tiền (hoặc ô công thức chưa có giá trị): tính từ đơn giá × số lượng, trừ giảm giá của dòng nếu có.
      const unit = num(first("unitPrice", r));
      if (unit !== null && quantity !== null) revenue = unit * quantity - (discount ?? 0);
    }
    const feeCols = mapping.platformFee ?? [];
    const feeVals = feeCols.map((i) => num(r[i])).filter((v): v is number => v !== null);

    const date = dateText(first("date", r), dateOrder);
    lines.push({
      id: idc.value,
      date,
      status,
      rawStatus,
      sku: idText(first("sku", r)).value,
      product: text(first("product", r)),
      variant: text(first("variant", r)),
      quantity,
      revenue,
      fee: feeVals.length ? feeVals.reduce((a, b) => a + b, 0) : null,
      province: text(first("province", r)),
      payment: text(first("payment", r)),
      discount,
      cost: num(first("cost", r)),
      shippingFee: num(first("shippingFee", r)),
      adCost: num(first("adCost", r)),
    });
    keys.push(keyed && idc.value !== null ? idc.value : `~${lines.length}`);
  }

  // Giá trị cấp đơn lấy từ dòng đầu tiên của đơn (phí: dòng đầu tiên có giá trị).
  const firstLine = new Map<string, number>();
  const orderFee = new Map<string, number>();
  const orderShip = new Map<string, number>();
  const orderAd = new Map<string, number>();
  keys.forEach((k, i) => {
    if (!firstLine.has(k)) firstLine.set(k, i);
    if (!orderFee.has(k) && lines[i].fee !== null) orderFee.set(k, lines[i].fee as number);
    if (!orderShip.has(k) && lines[i].shippingFee !== null) orderShip.set(k, lines[i].shippingFee as number);
    if (!orderAd.has(k) && lines[i].adCost !== null) orderAd.set(k, lines[i].adCost as number);
  });

  const rows: Row[] = lines.map((l, i) => {
    const isFirst = firstLine.get(keys[i]) === i;
    const head = lines[firstLine.get(keys[i]) as number];
    const valid = isValidStatus(l.status);
    if (l.date === null) stats.missingDate++;
    else {
      if (stats.dateMin === null || l.date < stats.dateMin) stats.dateMin = l.date;
      if (stats.dateMax === null || l.date > stats.dateMax) stats.dateMax = l.date;
    }
    if (l.revenue === null) stats.missingRevenue++;
    stats.byStatus[l.status]++;
    return {
      [COL.channel]: channel,
      [COL.orderId]: keyed && l.id !== null ? l.id : null,
      [COL.date]: l.date,
      [COL.status]: l.status,
      [COL.rawStatus]: l.rawStatus,
      [COL.sku]: l.sku,
      [COL.product]: l.product,
      [COL.variant]: l.variant,
      [COL.quantity]: l.quantity,
      [COL.revenue]: l.revenue,
      [COL.netRevenue]: l.revenue === null ? null : valid ? l.revenue : 0,
      [COL.orders]: isFirst ? (isValidStatus(head.status) ? 1 : 0) : 0,
      [COL.cancelledOrders]: isFirst ? (isValidStatus(head.status) ? 0 : 1) : 0,
      // Đơn hủy/hoàn trả không phát sinh phí sàn: bỏ cả khi file còn ghi phí ước tính cho đơn đó.
      [COL.platformFee]: isFirst && isValidStatus(head.status) ? orderFee.get(keys[i]) ?? null : null,
      [COL.province]: l.province,
      [COL.payment]: l.payment,
      [COL.discount]: l.discount,
      // Phí vận chuyển khách trả chỉ có với đơn hợp lệ; chi phí quảng cáo đã chi dù đơn có hủy hay không.
      [COL.shippingFee]: isFirst && valid ? orderShip.get(keys[i]) ?? null : null,
      [COL.cost]: l.cost === null ? null : valid ? l.cost : 0,
      [COL.adCost]: isFirst ? orderAd.get(keys[i]) ?? null : null,
    };
  });
  stats.lines = rows.length;
  stats.orders = firstLine.size;

  if (stats.skippedDescription) warnings.push("Đã bỏ qua dòng mô tả cột nằm ngay dưới tiêu đề.");
  if (stats.missingDate) warnings.push(`${stats.missingDate.toLocaleString("vi-VN")} dòng không đọc được ngày đặt: các dòng này không lên biểu đồ theo thời gian.`);
  if (stats.missingRevenue) warnings.push(`${stats.missingRevenue.toLocaleString("vi-VN")} dòng không có thành tiền: không được tính vào doanh thu.`);
  if (unknownStatuses.size) {
    const list = [...unknownStatuses].slice(0, 5).map((s) => `"${s}"`).join(", ");
    warnings.push(`Có trạng thái chưa nhận ra (${list}${unknownStatuses.size > 5 ? "…" : ""}): tạm tính là Chưa hoàn tất.`);
  }
  const revCol = mapping.revenue?.[0];
  if (revCol !== undefined && lines.length > 0 && rawRevenueCount === 0) {
    const name = headerOf(table[headerRow]?.[revCol]) || `Cột ${revCol + 1}`;
    warnings.push(`Cột "${name}" không có giá trị nào (thường là ô công thức chưa được tính): doanh thu tạm tính từ đơn giá × số lượng. Hãy mở file bằng Excel, lưu lại rồi tải lên nếu muốn dùng số liệu gốc.`);
  }
  if (lossyIds) warnings.push("Mã đơn bị Excel đổi sang dạng số nên có thể sai. Hãy xuất lại file và đừng mở bằng Excel trước khi tải lên.");
  if (noId) warnings.push(`${noId.toLocaleString("vi-VN")} dòng không có mã đơn: coi mỗi dòng là một đơn và không gộp trùng được khi tải lại file.`);
  return { rows, keyed, stats, warnings };
}

export type { Cell };
