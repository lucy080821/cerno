import type { KpiCompare } from "@dashboard/schema";
import { formatGrowth, type CompareResult } from "@dashboard/chart-engine";
import type { ProfitSummary } from "@/lib/profit/order-profit";
import { fitFactsSize, num, type FactNumber, type KpiFact, type MoverFact, type ReportFacts, type TopFact } from "@/lib/server/reports/facts";
import type { ReportPeriods } from "@/lib/server/reports/period";

/**
 * Gói số liệu của BÁO CÁO THEO CỬA HÀNG: bộ chỉ số cố định lấy từ cùng phép tính với các trang lãi (`summarize`), không phụ thuộc dashboard.
 * Hàm thuần: nhận tổng hợp của kỳ hiện tại và kỳ trước, trả `ReportFacts` đúng dạng báo cáo dashboard dùng (nên AI viết báo cáo, kiểm số
 * và email dùng lại nguyên). Mọi con số do code tính; AI chỉ diễn giải số trong gói này.
 */

const MAX_NAME = 40;
const TOP = 3;
const TOPS = 5;

interface Def {
  id: string;
  title: string;
  /** null = không tính được trong kỳ này. */
  get(s: ProfitSummary): number | null;
  show: KpiCompare["show"];
  goodWhen: KpiCompare["goodWhen"];
}

/** Đơn hợp lệ (không hủy, không hoàn trả): khớp cột "Số đơn" của nguồn đơn hàng. */
export const validOrders = (s: ProfitSummary) => s.orders - s.cancelled - s.returned;

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export const REPORT_DEFS: Def[] = [
  { id: "revenue", title: "Doanh thu thực", get: (s) => s.allRevenue, show: "percent", goodWhen: "up" },
  { id: "profit", title: "Lãi", get: (s) => (s.computable > 0 ? s.profit : null), show: "percent", goodWhen: "up" },
  { id: "margin", title: "Biên lãi (%)", get: (s) => (s.margin === null ? null : Math.round(s.margin * 1000) / 10), show: "pp", goodWhen: "up" },
  { id: "orders", title: "Số đơn", get: validOrders, show: "percent", goodWhen: "up" },
  { id: "cancelRate", title: "Tỷ lệ hủy (%)", get: (s) => pct(s.cancelled, s.orders), show: "pp", goodWhen: "down" },
  { id: "returnRate", title: "Tỷ lệ hoàn trả (%)", get: (s) => pct(s.returned, s.orders - s.cancelled), show: "pp", goodWhen: "down" },
  { id: "adsRatio", title: "Quảng cáo / doanh thu (%)", get: (s) => pct(s.adCost, s.revenue), show: "pp", goodWhen: "down" },
  { id: "lossOrders", title: "Số đơn lỗ", get: (s) => (s.computable > 0 ? s.loss : null), show: "percent", goodWhen: "down" },
];

function kpiOf(d: Def, cur: ProfitSummary, prev: ProfitSummary): KpiFact {
  const c = cur.orders > 0 ? d.get(cur) : null;
  const p = prev.orders > 0 ? d.get(prev) : null;
  const cmp: KpiCompare = { to: "prev_period", dateColumn: "", grain: "month", show: d.show, goodWhen: d.goodWhen, toDate: false };
  const cr: CompareResult | null = c === null ? null : { current: c, previous: p, label: "so với kỳ trước", cur: { from: "", to: "" }, prev: { from: "", to: "" } };
  const g = formatGrowth(cr, cmp);
  return {
    widgetId: `ws-${d.id}`,
    title: d.title,
    value: c === null ? null : num(c),
    prev: p === null ? null : num(p),
    diff: c !== null && p !== null ? num(c - p) : null,
    growthPct: c !== null && p !== null && p !== 0 ? Math.round(((c - p) / Math.abs(p)) * 1000) / 10 : null,
    growthText: g.text,
    dir: g.dir,
    tone: g.tone,
    kind: "number",
  };
}

const cut = (s: string) => (s.length > MAX_NAME ? s.slice(0, MAX_NAME - 1) + "…" : s);

/** Giá trị theo nhóm của hai kỳ → top nhóm tăng và top nhóm giảm (theo chênh lệch tuyệt đối). */
function movers(chart: string, dimension: string, metric: string, cur: Map<string, number>, prev: Map<string, number>): MoverFact | null {
  const rows = [...new Set([...cur.keys(), ...prev.keys()])].map((name) => {
    const v = cur.get(name) ?? 0;
    return { name: cut(name), v, d: v - (prev.get(name) ?? 0) };
  });
  const mk = (r: { name: string; v: number; d: number }) => ({ name: r.name, value: num(r.v), delta: num(r.d) });
  const up = rows.filter((r) => r.d > 0).sort((a, b) => b.d - a.d || a.name.localeCompare(b.name)).slice(0, TOP).map(mk);
  const down = rows.filter((r) => r.d < 0).sort((a, b) => a.d - b.d || a.name.localeCompare(b.name)).slice(0, TOP).map(mk);
  return up.length || down.length ? { chart, dimension, metric, up, down } : null;
}

const channelProfit = (s: ProfitSummary) => new Map(s.channels.map((c) => [c.channel, c.profit]));
/** Doanh thu theo sản phẩm (đơn hợp lệ); sản phẩm không có doanh thu thì bỏ. */
const productRevenue = (s: ProfitSummary) => new Map(s.products.filter((p) => p.revenue > 0).map((p) => [p.name, p.revenue]));

function top(chart: string, dimension: string, metric: string, m: Map<string, number>): TopFact | null {
  const items = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOPS).map(([name, v]) => ({ name: cut(name), value: num(v) as FactNumber }));
  return items.length ? { chart, dimension, metric, items } : null;
}

export function buildStoreReportFacts(p: {
  cur: ProfitSummary;
  prev: ProfitSummary;
  periods: ReportPeriods;
  updatedAt: string | null;
  mode?: "compare" | "overview";
}): ReportFacts {
  const overview = p.mode === "overview";
  const notes: string[] = [];
  const kpis = REPORT_DEFS.map((d) => kpiOf(d, p.cur, p.prev));
  if (p.cur.orders === 0) notes.push("Không có đơn hàng nào trong kỳ báo cáo.");
  if (p.cur.missingCost > 0) notes.push(`${p.cur.missingCost.toLocaleString("vi-VN")} đơn chưa có giá vốn nên chưa tính vào Lãi.`);
  if (p.cur.feeEstimated > 0) notes.push(`Phí sàn của ${p.cur.feeEstimated.toLocaleString("vi-VN")} đơn là số ước tính theo biểu phí.`);

  const mv: MoverFact[] = [];
  const tops: TopFact[] = [];
  if (overview) {
    const a = top("Kênh bán", "Kênh", "Lãi", channelProfit(p.cur));
    const b = top("Sản phẩm", "Sản phẩm", "Doanh thu thực", productRevenue(p.cur));
    if (a) tops.push(a);
    if (b) tops.push(b);
  } else {
    const a = movers("Kênh bán", "Kênh", "Lãi", channelProfit(p.cur), channelProfit(p.prev));
    const b = movers("Sản phẩm", "Sản phẩm", "Doanh thu thực", productRevenue(p.cur), productRevenue(p.prev));
    if (a) mv.push(a);
    if (b) mv.push(b);
  }

  const shown: KpiFact[] = overview
    ? kpis.map((k) => ({ ...k, prev: null, diff: null, growthPct: null, growthText: "", dir: null, tone: "neutral" as const }))
    : kpis;
  return fitFactsSize({
    ...(overview ? { mode: "overview" as const } : {}),
    period: p.periods.cur,
    prevPeriod: p.periods.prev,
    updatedAt: p.updatedAt,
    kpis: shown,
    movers: mv,
    ...(overview ? { tops } : {}),
    notes,
  });
}
