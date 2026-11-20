import { normalizeText } from "@dashboard/schema";
import { toIsoDate, type Row } from "@dashboard/chart-engine";

/**
 * Câu gợi ý ở khung chat AI, dựng từ CHÍNH dữ liệu của dashboard: tên cột, kiểu cột, giá trị thật (kênh nào nhiều nhất, tháng mới
 * nhất), và chỉ gợi ý thêm biểu đồ/bộ lọc/KPI khi dashboard chưa có. Hàm thuần, có test. Dữ liệu chưa tải (rows rỗng) thì vẫn gợi ý
 * theo tên và kiểu cột.
 */
export interface SuggestColumn {
  name: string;
  type: string;
}

export interface SuggestWidget {
  kind: string;
  dimensions: string[];
  metrics: string[];
  chartType?: string;
}

export interface SuggestInput {
  columns: SuggestColumn[];
  rows: Row[];
  widgets: SuggestWidget[];
  filterColumns: string[];
  selected: { label: string; hasForecast: boolean } | null;
  canEdit: boolean;
}

const ID_LIKE = /(^| )(ma|id|sku|stt|sdt|email|dia chi|so dien thoai|ten khach|nguoi mua|nguoi nhan|username)( |$)/;
const METRIC_PRIORITY = [
  /doanh thu|doanh so|revenue|sales|gmv/, /loi nhuan|lai|profit/, /chi phi|chi tieu|cost|spend/, /luot xem|view|click|impression/,
  /chuyen doi|conversion|don hang|orders|so don/, /tong|amount|total/,
];
const DIM_PRIORITY = [
  /kenh|channel|nen tang|san/, /san pham|product|mat hang/, /danh muc|nganh|category/, /khu vuc|tinh|thanh pho|region|city/,
  /chien dich|campaign/, /trang thai|status/, /loai|nhom|type|group/,
];

const rank = (name: string, list: RegExp[]): number => {
  const n = normalizeText(name);
  const i = list.findIndex((r) => r.test(n));
  return i < 0 ? list.length : i;
};
const idLike = (name: string) => ID_LIKE.test(normalizeText(name));
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Cột chữ dùng được làm chiều phân tích: không phải mã/định danh, có vài giá trị khác nhau (2–40) và không gần như mỗi dòng một giá trị. */
function usableDimension(name: string, rows: Row[]): { name: string; distinct: number; top: string[] } | null {
  if (idLike(name)) return null;
  const count = new Map<string, number>();
  let filled = 0;
  for (const r of rows) {
    const v = text(r[name]);
    if (v === null) continue;
    filled++;
    count.set(v, (count.get(v) ?? 0) + 1);
  }
  if (rows.length === 0) return { name, distinct: 0, top: [] };
  if (count.size < 2 || count.size > 40) return null;
  if (filled >= 20 && count.size / filled > 0.6) return null;
  const top = [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([v]) => v);
  return { name, distinct: count.size, top };
}

/** Tháng mới nhất có dữ liệu ("11/2026") và khoảng ngày theo ngày (số ngày) của cột ngày. */
function dateInfo(name: string, rows: Row[]): { latestMonth: string | null; spanDays: number } {
  let min = "";
  let max = "";
  for (const r of rows) {
    const iso = toIsoDate(r[name]);
    if (!iso) continue;
    if (!min || iso < min) min = iso;
    if (!max || iso > max) max = iso;
  }
  if (!max) return { latestMonth: null, spanDays: 0 };
  const days = Math.round((Date.parse(max) - Date.parse(min)) / 86_400_000);
  return { latestMonth: `${Number(max.slice(5, 7))}/${max.slice(0, 4)}`, spanDays: Number.isFinite(days) ? days : 0 };
}

const has = (widgets: SuggestWidget[], p: (w: SuggestWidget) => boolean) => widgets.some(p);

export function buildSuggestions(input: SuggestInput, max = 4): string[] {
  const { columns, rows, widgets, filterColumns, selected, canEdit } = input;

  const metrics = columns
    .filter((c) => c.type === "number" && !idLike(c.name))
    .sort((a, b) => rank(a.name, METRIC_PRIORITY) - rank(b.name, METRIC_PRIORITY))
    .map((c) => c.name);
  const dims = columns
    .filter((c) => c.type === "string")
    .map((c) => usableDimension(c.name, rows))
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => rank(a.name, DIM_PRIORITY) - rank(b.name, DIM_PRIORITY));
  const dateCol = columns.find((c) => c.type === "date")?.name ?? null;

  const m1 = metrics[0] ?? null;
  const m2 = metrics[1] ?? m1;
  const d1 = dims[0] ?? null;
  const d2 = dims[1] ?? null;

  // ---- Câu hỏi phân tích (không sửa dashboard) ----
  const ask: string[] = [];
  if (selected) {
    if (selected.hasForecast) ask.push(`Giải thích dự báo của "${selected.label}" đang chọn: hướng đi, mùa vụ và độ tin cậy?`);
    ask.push(`Phân tích "${selected.label}" đang chọn: xu hướng và điểm đáng chú ý?`);
  }
  if (m1 && d1) ask.push(`${m1} nhiều nhất ở ${d1.name} nào?`);
  if (m1 && d1 && d1.top.length >= 2) ask.push(`So sánh ${d1.top[0]} và ${d1.top[1]} về ${m1}.`);
  if (m1 && dateCol) ask.push(`${m1} thay đổi thế nào theo ${dateCol}?`);
  if (m2) ask.push(`Có điểm bất thường nào trong ${m2} không?`);
  if (m1 && d2) ask.push(`${d2.name} nào có ${m1} thấp nhất?`);
  if (ask.length < 2) ask.push("Tóm tắt nhanh dashboard này.", "Dữ liệu này có điểm gì đáng chú ý?");

  // ---- Yêu cầu sửa dashboard (chỉ gợi ý cái chưa có) ----
  const edit: string[] = [];
  if (canEdit) {
    if (selected) edit.push("Tắt đường lưới và bật nhãn dữ liệu cho chart đang chọn.");
    if (m1 && d1 && !has(widgets, (w) => w.kind === "chart" && w.dimensions.includes(d1.name) && w.metrics.includes(m1))) {
      edit.push(d1.distinct > 0 && d1.distinct <= 6 ? `Thêm biểu đồ tròn ${m1} theo ${d1.name}.` : `Thêm biểu đồ cột ${m1} theo ${d1.name}.`);
    }
    if (m1 && dateCol && !has(widgets, (w) => w.kind === "chart" && w.dimensions.includes(dateCol) && w.metrics.includes(m1))) {
      const { spanDays } = dateInfo(dateCol, rows);
      edit.push(spanDays > 60 ? `Thêm biểu đồ đường ${m1} theo tháng.` : `Thêm biểu đồ đường ${m1} theo ngày.`);
    }
    if (d1 && !filterColumns.includes(d1.name)) edit.push(`Thêm bộ lọc theo ${d1.name}.`);
    if (dateCol && !filterColumns.includes(dateCol)) {
      const { latestMonth } = dateInfo(dateCol, rows);
      if (latestMonth) edit.push(`Chỉ xem dữ liệu tháng ${latestMonth}.`);
    }
    if (m1 && !has(widgets, (w) => w.kind === "kpi" && w.metrics.includes(m1))) edit.push(`Thêm thẻ KPI tổng ${m1}.`);
  }

  // Pha trộn: tối đa 2 câu sửa khi được phép (còn lại là câu hỏi), thiếu bên nào thì bên kia bù.
  const takeEdit = canEdit ? Math.min(2, edit.length) : 0;
  const out = [...ask.slice(0, max - takeEdit), ...edit.slice(0, takeEdit)];
  for (const q of [...ask.slice(max - takeEdit), ...edit.slice(takeEdit)]) if (out.length < max && !out.includes(q)) out.push(q);
  return [...new Set(out)].slice(0, max);
}
