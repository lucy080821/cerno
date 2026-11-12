import type { Dashboard, FieldBinding, KpiCompare, Widget } from "@dashboard/schema";
import {
  bindingLabel, calcDefsFor, chartFields, formatByKind, formatCompactByKind, formatGrowth, specForWidget,
  type CompareResult, type MetricKind, type QueryResult, type QuerySpec, type RowFilter,
} from "@dashboard/chart-engine";
import type { ReportPeriods, ReportSpan } from "./period";

/**
 * Gói số liệu cho báo cáo email. KHÔNG dùng AI: mọi con số do engine tính (cùng `executeQuery`/`aggregate` với dashboard),
 * AI sau này chỉ được DIỄN GIẢI các số có trong gói này (xem verify-numbers.ts).
 */

export const MAX_FACTS_BYTES = 6000;
const MAX_KPIS = 12;
const MAX_MOVER_CHARTS = 4;
const MAX_MOVERS_PER_SIDE = 3;
const MOVER_TYPES = new Set(["bar", "hbar", "stackedbar", "pie", "funnel", "treemap"]);

export type Executor = (sourceId: string, spec: QuerySpec) => Promise<QueryResult>;

export interface FactNumber {
  value: number;
  /** Đầy đủ, kiểu Việt Nam: "125.430.000". */
  text: string;
  /** Gọn, kiểu Việt Nam: "125,4 triệu". */
  short: string;
}

export interface KpiFact {
  /** Widget KPI gốc (để vẽ thẻ KPI). Không gửi cho AI. */
  widgetId: string;
  title: string;
  /** null = không có dòng dữ liệu nào trong kỳ. */
  value: FactNumber | null;
  /** null = kỳ trước không có dữ liệu. */
  prev: FactNumber | null;
  /** Chênh lệch tuyệt đối so với kỳ trước (kỳ này − kỳ trước); null khi một trong hai kỳ không có dữ liệu hoặc số đo là ngày. */
  diff: FactNumber | null;
  /** % tăng trưởng so với kỳ trước (làm tròn 1 số lẻ); null khi không tính được (kỳ trước trống hoặc bằng 0). */
  growthPct: number | null;
  /** Chữ hiển thị theo cấu hình so kỳ của KPI ("+12,3%", "+0,5 pp"); rỗng nếu không tính được. */
  growthText: string;
  dir: "up" | "down" | "flat" | null;
  tone: "good" | "bad" | "neutral";
  kind: MetricKind;
}

export interface MoverItem {
  name: string;
  value: FactNumber;
  delta: FactNumber;
}

export interface MoverFact {
  chart: string;
  dimension: string;
  metric: string;
  up: MoverItem[];
  down: MoverItem[];
}

export interface ReportFacts {
  period: ReportSpan;
  prevPeriod: ReportSpan;
  /** Lần đồng bộ dữ liệu gần nhất (ISO), null nếu không biết. */
  updatedAt: string | null;
  kpis: KpiFact[];
  movers: MoverFact[];
  notes: string[];
}

// ---------------------------------------------------------------------------------------------

const VI = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** "125,4 triệu" / "2,3 tỷ" / "45,2 nghìn" / "980". */
export function viShort(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return `${VI.format(n / 1e9)} tỷ`;
  if (a >= 1e6) return `${VI.format(n / 1e6)} triệu`;
  if (a >= 1e4) return `${VI.format(n / 1e3)} nghìn`;
  return VI.format(n);
}

function num(value: number, kind: MetricKind = "number"): FactNumber {
  const r = Math.round(value * 100) / 100;
  return {
    value: r,
    text: formatByKind(r, kind),
    short: kind === "date" ? formatCompactByKind(r, kind) : viShort(r),
  };
}

/** Cột ngày dùng để cắt kỳ cho một widget: cột so kỳ của KPI, cột ngày của chart, hoặc cột ngày đầu tiên của nguồn. */
export function dateColumnFor(widget: Widget, doc: Dashboard): string | null {
  const c = widget.config;
  if (c.kind === "kpi" && c.compare?.dateColumn) return c.compare.dateColumn;
  if (c.kind !== "kpi" && c.kind !== "chart") return null;
  const src = doc.sources.find((s) => s.id === c.sourceId);
  const dateCols = new Set((src?.columns ?? []).filter((x) => x.type === "date").map((x) => x.name));
  if (c.kind === "chart") {
    const d = c.dimensions.find((x) => dateCols.has(x.column));
    if (d) return d.column;
  }
  return src?.columns.find((x) => x.type === "date")?.name ?? null;
}

export const periodFilter =(column: string, span: ReportSpan): RowFilter => ({ column, values: [], dateRange: { from: span.from, to: span.to } });

const readingOrder = (a: Widget, b: Widget) => a.y - b.y || a.x - b.x;

const DEFAULT_COMPARE = (dateColumn: string): KpiCompare => ({
  to: "prev_period", dateColumn, grain: "month", show: "percent", goodWhen: "up", toDate: false,
});

/** Giá trị số đo đầu tiên của kết quả gộp không chiều, hoặc null nếu không có dòng nào khớp. */
function scalar(r: QueryResult): { value: number; kind: MetricKind } | null {
  if (r.mode !== "aggregate" || r.matched === 0) return null;
  return { value: r.table.rows[0]?.values[0] ?? 0, kind: r.table.metricKinds?.[0] ?? "number" };
}

async function kpiFact(w: Widget, doc: Dashboard, periods: ReportPeriods, exec: Executor, notes: string[]): Promise<KpiFact | null> {
  const c = w.config;
  if (c.kind !== "kpi") return null;
  const title = c.title?.trim() || bindingLabel(c.metric, true);
  const dateCol = dateColumnFor(w, doc);
  const calc = calcDefsFor(doc.calculatedFields, c.sourceId);
  const base = specForWidget(w, [], calc);
  if (!base || base.spec.mode !== "aggregate") return null;
  const { compare: _drop, ...plain } = base.spec;
  void _drop;

  const run = (span: ReportSpan | null) =>
    exec(base.sourceId, { ...plain, filters: span && dateCol ? [periodFilter(dateCol, span)] : [] });

  if (!dateCol) notes.push(`"${title}" không có cột ngày nên được tính trên toàn bộ dữ liệu, không theo kỳ.`);
  const cur = scalar(await run(dateCol ? periods.cur : null));
  const prev = dateCol ? scalar(await run(periods.prev)) : null;
  const kind = cur?.kind ?? prev?.kind ?? "number";

  const cmp = c.compare ?? DEFAULT_COMPARE(dateCol ?? "");
  const cr: CompareResult | null = cur
    ? {
        current: cur.value,
        previous: prev ? prev.value : null,
        label: "so với kỳ trước",
        cur: { from: periods.cur.from, to: periods.cur.to },
        prev: { from: periods.prev.from, to: periods.prev.to },
        ...(kind === "date" ? { kind } : {}),
      }
    : null;
  const g = formatGrowth(cr, cmp);
  const growthPct = cur && prev && kind !== "date" && prev.value !== 0
    ? Math.round(((cur.value - prev.value) / Math.abs(prev.value)) * 1000) / 10
    : null;

  return {
    widgetId: w.id,
    title,
    value: cur ? num(cur.value, kind) : null,
    prev: prev ? num(prev.value, kind) : null,
    diff: cur && prev && kind !== "date" ? num(cur.value - prev.value) : null,
    growthPct,
    growthText: g.text,
    dir: g.dir,
    tone: g.tone,
    kind,
  };
}

async function moverFact(w: Widget, doc: Dashboard, periods: ReportPeriods, exec: Executor): Promise<MoverFact | null> {
  const c = w.config;
  if (c.kind !== "chart" || !MOVER_TYPES.has(c.chartType)) return null;
  const f = chartFields(c);
  if (!f || !f.dimensions[0] || !f.metrics[0]) return null;
  const dim: FieldBinding = f.dimensions[0];
  const metric: FieldBinding = f.metrics[0];
  const src = doc.sources.find((s) => s.id === c.sourceId);
  // Chiều là ngày thì "top tăng/giảm theo nhóm" không có nghĩa.
  if (src?.columns.find((x) => x.name === dim.column)?.type === "date" || dim.grain) return null;
  const dateCol = dateColumnFor(w, doc);
  if (!dateCol) return null;
  const calc = calcDefsFor(doc.calculatedFields, c.sourceId);

  const run = (span: ReportSpan) =>
    exec(c.sourceId, { mode: "aggregate", dims: [dim], metrics: [metric], filters: [periodFilter(dateCol, span)], selfId: w.id, calc });
  const [rc, rp] = [await run(periods.cur), await run(periods.prev)];
  if (rc.mode !== "aggregate" || rp.mode !== "aggregate" || rc.truncated || rp.truncated) return null;
  const kind = rc.table.metricKinds?.[0] ?? rp.table.metricKinds?.[0] ?? "number";
  if (kind === "date") return null;

  const values = new Map<string, { cur: number; prev: number }>();
  const add = (t: typeof rc.table, field: "cur" | "prev") => {
    for (const row of t.rows) {
      const key = String(row.keys[0] ?? "(trống)");
      const e = values.get(key) ?? { cur: 0, prev: 0 };
      e[field] = row.values[0] ?? 0;
      values.set(key, e);
    }
  };
  add(rc.table, "cur");
  add(rp.table, "prev");

  const items = [...values.entries()]
    .map(([name, v]) => ({ name, cur: v.cur, delta: v.cur - v.prev }))
    .filter((x) => x.delta !== 0);
  const item = (x: { name: string; cur: number; delta: number }): MoverItem => ({ name: x.name.slice(0, 60), value: num(x.cur), delta: num(x.delta) });
  const up = items.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name)).slice(0, MAX_MOVERS_PER_SIDE).map(item);
  const down = items.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta || a.name.localeCompare(b.name)).slice(0, MAX_MOVERS_PER_SIDE).map(item);
  if (!up.length && !down.length) return null;
  return {
    chart: c.title?.trim() || `${bindingLabel(metric, true)} theo ${bindingLabel(dim, false)}`,
    dimension: bindingLabel(dim, false),
    metric: bindingLabel(metric, true),
    up,
    down,
  };
}

/** Rút gọn gói số liệu cho vừa `maxBytes`: bớt dòng movers, rồi bớt chart, rồi bớt KPI. Ghi chú lại nếu có cắt. */
export function fitFactsSize(facts: ReportFacts, maxBytes = MAX_FACTS_BYTES): ReportFacts {
  const size = (f: ReportFacts) => new TextEncoder().encode(JSON.stringify(f)).length;
  if (size(facts) <= maxBytes) return facts;
  const f: ReportFacts = structuredClone(facts);
  const mark = () => {
    const note = "Một phần số liệu đã được rút gọn cho vừa độ dài báo cáo.";
    if (!f.notes.includes(note)) f.notes.push(note);
  };
  mark();
  for (const per of [2, 1]) {
    if (size(f) <= maxBytes) return f;
    for (const m of f.movers) { m.up = m.up.slice(0, per); m.down = m.down.slice(0, per); }
  }
  while (size(f) > maxBytes && f.movers.length) f.movers.pop();
  while (size(f) > maxBytes && f.kpis.length > 1) f.kpis.pop();
  while (size(f) > maxBytes && f.notes.length > 1) f.notes.splice(f.notes.length - 2, 1);
  return f;
}

/**
 * Tính gói số liệu cho một dashboard và kỳ báo cáo. `exec` thường là `executeQuery` của server (có cache theo phiên bản dữ liệu).
 * KPI: giá trị ở kỳ này và kỳ trước + tăng trưởng (cùng cách định dạng/sắc thái như KPI so kỳ trên dashboard).
 * Movers: với các chart có chiều dạng chữ, top 3 nhóm tăng và top 3 nhóm giảm nhiều nhất giữa hai kỳ.
 * Bộ lọc dashboard không được áp (giá trị lọc không lưu trong dashboard).
 */
export async function buildReportFacts(p: {
  doc: Dashboard;
  periods: ReportPeriods;
  exec: Executor;
  updatedAt?: string | null;
}): Promise<ReportFacts> {
  const { doc, periods, exec } = p;
  const notes: string[] = [];
  const visible = doc.widgets.filter((w) => !w.hidden).sort(readingOrder);

  const kpis: KpiFact[] = [];
  for (const w of visible) {
    if (kpis.length >= MAX_KPIS) break;
    const k = await kpiFact(w, doc, periods, exec, notes);
    if (k) kpis.push(k);
  }
  const movers: MoverFact[] = [];
  for (const w of visible) {
    if (movers.length >= MAX_MOVER_CHARTS) break;
    const m = await moverFact(w, doc, periods, exec);
    if (m) movers.push(m);
  }
  if (kpis.length > 0 && kpis.every((k) => k.value === null)) notes.push("Không có dữ liệu nào trong kỳ báo cáo.");
  if (kpis.length === 0 && movers.length === 0) notes.push("Dashboard chưa có KPI hoặc biểu đồ nào để tổng hợp số liệu.");

  return fitFactsSize({
    period: periods.cur,
    prevPeriod: periods.prev,
    updatedAt: p.updatedAt ?? null,
    kpis,
    movers,
    notes,
  });
}
