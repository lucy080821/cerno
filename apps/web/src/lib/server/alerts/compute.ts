import {
  evaluateCondition, type AlertCondition, type AlertMetric, type Evaluation, type FieldBinding, type Verdict,
} from "@dashboard/schema";
import { addDays, type CalcFieldDef, type QueryResult, type QuerySpec, type RowFilter } from "@dashboard/chart-engine";
import {
  historySpans, isSettled, previousSpan, spanLabel, windowSpan, type Span,
} from "./windows";

/**
 * Tính số liệu cho một luật cảnh báo bằng đúng engine của dashboard (`exec` thường là `executeQuery`), rồi đánh giá bằng
 * `evaluateCondition`. Không ghi trạng thái, không gửi thư: dùng chung cho "bây giờ có báo không?" lúc tạo luật và cho lúc chạy thật.
 */

export type Executor = (sourceId: string, spec: QuerySpec) => Promise<QueryResult>;

export interface ComputeDeps {
  exec: Executor;
  /** Trường tính toán của nguồn (dashboard.calculatedFields đã lọc theo nguồn). */
  calc: CalcFieldDef[];
  now: Date;
}

export interface WindowInfo {
  span: Span | null;
  label: string;
  prevSpan?: Span;
  prevLabel?: string;
}

export interface GroupHit {
  group: string;
  evaluation: Evaluation;
}

export type AlertComputation =
  | { kind: "single"; evaluation: Evaluation; info: WindowInfo }
  | { kind: "groups"; groupBy: string; violating: GroupHit[]; evaluated: number; insufficient: number; info: WindowInfo }
  /** Khoảng chưa kết thúc và chưa tới giờ chốt (`settleHour`): chưa đánh giá. */
  | { kind: "deferred"; settleHour: number; info: WindowInfo };

const SUM_LIKE = new Set(["sum", "count", "count_distinct"]);

type Leaf = Exclude<AlertCondition, { type: "per_group" } | { type: "stale" }>;

const toRowFilters = (m: AlertMetric): RowFilter[] =>
  m.filters.map((f) => ({
    column: f.column,
    values: f.values,
    ...(f.range ? { range: f.range } : {}),
    ...(f.dateRange ? { dateRange: f.dateRange } : {}),
  }));

const spanFilter = (column: string, span: Span): RowFilter => ({ column, values: [], dateRange: { from: span.from, to: span.to } });

/** Khoảng không có dòng nào: tổng/đếm là 0 (số thật), còn trung bình/nhỏ nhất/lớn nhất/trường tính toán thì "không có dữ liệu". */
function emptyIsZero(m: AlertMetric, calc: CalcFieldDef[]): boolean {
  if (calc.some((c) => c.name === m.metric.column)) return false;
  return SUM_LIKE.has(m.metric.aggregation ?? "sum");
}

class Runner {
  private startDate: Promise<string | null> | null = null;
  constructor(private m: AlertMetric, private d: ComputeDeps) {}

  get calc(): CalcFieldDef[] {
    return this.d.calc;
  }

  private filters(span: Span | null): RowFilter[] {
    const f = toRowFilters(this.m);
    if (span && this.m.dateColumn) f.push(spanFilter(this.m.dateColumn, span));
    return f;
  }

  private async aggregate(span: Span | null, dims: FieldBinding[]) {
    const r = await this.d.exec(this.m.sourceId, {
      mode: "aggregate", dims, metrics: [this.m.metric], filters: this.filters(span), calc: this.d.calc,
    });
    if (r.mode !== "aggregate") throw new Error("Truy vấn cảnh báo trả về kết quả không đúng dạng.");
    return r;
  }

  /** Ngày sớm nhất có dữ liệu: các kỳ nằm hoàn toàn TRƯỚC mốc này không được coi là "0" trong lịch sử. */
  dataStart(): Promise<string | null> {
    this.startDate ??= (async () => {
      if (!this.m.dateColumn) return null;
      const r = await this.d.exec(this.m.sourceId, { mode: "stats", column: this.m.dateColumn, calc: this.d.calc });
      return r.mode === "stats" ? (r.date?.min ?? null) : null;
    })();
    return this.startDate;
  }

  /** Giá trị của chỉ số trong một khoảng (null = không có dữ liệu). */
  async scalar(span: Span | null): Promise<{ value: number | null; matched: number }> {
    const r = await this.aggregate(span, []);
    if (r.matched === 0) return { value: emptyIsZero(this.m, this.d.calc) ? 0 : null, matched: 0 };
    const v = r.table.rows[0]?.values[0];
    return { value: typeof v === "number" && Number.isFinite(v) ? v : null, matched: r.matched };
  }

  /** Giá trị theo từng nhóm trong một khoảng. */
  async groups(span: Span | null): Promise<Map<string, number>> {
    const r = await this.aggregate(span, [{ column: this.m.groupBy! }]);
    const out = new Map<string, number>();
    for (const row of r.table.rows) {
      const v = row.values[0];
      if (typeof v === "number" && Number.isFinite(v)) out.set(String(row.keys[0] ?? "(trống)"), v);
    }
    return out;
  }

  /** Các kỳ lịch sử còn nằm trong phạm vi dữ liệu (bỏ kỳ trước ngày bắt đầu của dữ liệu). */
  async usableHistory(spans: Span[]): Promise<Span[]> {
    const start = await this.dataStart();
    return start ? spans.filter((s) => s.to >= start) : spans;
  }
}

/** Mức độ vi phạm để xếp nhóm nặng nhất lên đầu khi liệt kê. */
function severity(e: Evaluation, c: Leaf): number {
  if (c.type === "change") return Math.abs(e.changePct ?? 0);
  if (c.type === "anomaly") return Math.abs(e.z ?? 0) === Infinity ? Number.MAX_VALUE : Math.abs(e.z ?? 0);
  return Math.abs((e.value ?? 0) - c.value);
}

async function single(r: Runner, m: AlertMetric, c: Leaf, span: Span | null, info: WindowInfo): Promise<AlertComputation> {
  const cur = await r.scalar(span);
  if (c.type === "threshold") return { kind: "single", evaluation: evaluateCondition(c, { value: cur.value }), info };

  if (c.type === "change") {
    const prevSpan = previousSpan(m.window, span!, c.vs);
    info.prevSpan = prevSpan;
    info.prevLabel = spanLabel(m.window, prevSpan);
    const p = await r.scalar(prevSpan);
    return { kind: "single", evaluation: evaluateCondition(c, { value: cur.value, prev: p.matched === 0 ? null : p.value }), info };
  }

  const spans = await r.usableHistory(historySpans(m.window, span!, c.lookback));
  const history: number[] = [];
  for (const s of spans) {
    const v = (await r.scalar(s)).value;
    if (v !== null) history.push(v);
  }
  return { kind: "single", evaluation: evaluateCondition(c, { value: cur.value, history }), info };
}

async function perGroup(r: Runner, m: AlertMetric, c: Leaf, span: Span | null, info: WindowInfo): Promise<AlertComputation> {
  const zero = emptyIsZero(m, r.calc);
  const cur = await r.groups(span);
  const hits: GroupHit[] = [];
  let evaluated = 0;
  let insufficient = 0;
  const note = (group: string, e: Evaluation) => {
    evaluated++;
    if (e.verdict === "insufficient") insufficient++;
    else if (e.verdict === "firing") hits.push({ group, evaluation: e });
  };

  if (c.type === "threshold") {
    for (const [g, v] of cur) note(g, evaluateCondition(c, { value: v }));
  } else if (c.type === "change") {
    const prevSpan = previousSpan(m.window, span!, c.vs);
    info.prevSpan = prevSpan;
    info.prevLabel = spanLabel(m.window, prevSpan);
    const prev = await r.groups(prevSpan);
    for (const g of new Set([...cur.keys(), ...prev.keys()])) {
      const value = cur.get(g) ?? (zero ? 0 : null);
      note(g, evaluateCondition(c, { value, prev: prev.get(g) ?? null }));
    }
  } else {
    const spans = await r.usableHistory(historySpans(m.window, span!, c.lookback));
    const tables = await Promise.all(spans.map((s) => r.groups(s)));
    const names = new Set<string>(cur.keys());
    for (const t of tables) for (const g of t.keys()) names.add(g);
    for (const g of names) {
      const history: number[] = [];
      for (const t of tables) {
        const v = t.get(g) ?? (zero ? 0 : null);
        if (v !== null) history.push(v);
      }
      note(g, evaluateCondition(c, { value: cur.get(g) ?? (zero ? 0 : null), history }));
    }
  }

  hits.sort((a, b) => severity(b.evaluation, c) - severity(a.evaluation, c) || a.group.localeCompare(b.group));
  return { kind: "groups", groupBy: m.groupBy!, violating: hits, evaluated, insufficient, info };
}

/**
 * Tính một luật (không phải `stale`, luật đó kiểm bằng thời điểm dữ liệu đổi). Có thể ném lỗi khi truy vấn thất bại
 * (cột không còn tồn tại...): người gọi chuyển luật sang trạng thái lỗi.
 */
export async function computeAlert(m: AlertMetric, condition: Exclude<AlertCondition, { type: "stale" }>, deps: ComputeDeps): Promise<AlertComputation> {
  const span = windowSpan(m.window, deps.now);
  const info: WindowInfo = { span, label: spanLabel(m.window, span) };
  if (!isSettled(m.window, m.settleHour, deps.now)) return { kind: "deferred", settleHour: m.settleHour!, info };

  const runner = new Runner(m, deps);
  if (condition.type === "per_group") return perGroup(runner, m, condition.inner, span, info);
  return single(runner, m, condition, span, info);
}

export const verdictOf = (c: AlertComputation): Verdict | "deferred" =>
  c.kind === "deferred" ? "deferred" : c.kind === "single" ? c.evaluation.verdict : c.violating.length > 0 ? "firing" : c.evaluated === 0 || c.insufficient === c.evaluated ? "insufficient" : "ok";

// ---------------------------------------------------------------------------------------------

export interface ComputationSummary {
  kind: AlertComputation["kind"];
  /** firing | ok | insufficient | deferred */
  verdict: Verdict | "deferred";
  label: string;
  prevLabel?: string;
  value?: number | null;
  prev?: number | null;
  changePct?: number | null;
  z?: number | null;
  mean?: number;
  n?: number;
  reason?: string;
  settleHour?: number;
  groupBy?: string;
  evaluated?: number;
  insufficient?: number;
  /** Tối đa 5 nhóm vi phạm nặng nhất, cùng tổng số nhóm vi phạm. */
  groups?: { group: string; value: number | null; changePct?: number | null; z?: number | null }[];
  violatingCount?: number;
}

const finite = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** Bản tóm tắt gọn, an toàn để trả về trình duyệt ("Giá trị hiện tại … → bây giờ có báo không"). */
export function summarize(c: AlertComputation): ComputationSummary {
  const base = { kind: c.kind, verdict: verdictOf(c), label: c.info.label, ...(c.info.prevLabel ? { prevLabel: c.info.prevLabel } : {}) };
  if (c.kind === "deferred") return { ...base, settleHour: c.settleHour };
  if (c.kind === "single") {
    const e = c.evaluation;
    return {
      ...base, value: finite(e.value), prev: finite(e.prev), changePct: finite(e.changePct), z: finite(e.z), mean: e.mean, n: e.n, reason: e.reason,
    };
  }
  return {
    ...base,
    groupBy: c.groupBy,
    evaluated: c.evaluated,
    insufficient: c.insufficient,
    violatingCount: c.violating.length,
    groups: c.violating.slice(0, 5).map((g) => ({ group: g.group, value: finite(g.evaluation.value), changePct: finite(g.evaluation.changePct), z: finite(g.evaluation.z) })),
  };
}

// ---------------------------------------------------------------------------------------------

export interface AlertSeries {
  /** Nhãn trục từ cũ đến mới; phần tử cuối là kỳ hiện tại. */
  labels: string[];
  /** null = không có dữ liệu (vd kỳ nằm trước ngày dữ liệu bắt đầu). */
  values: (number | null)[];
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Chuỗi giá trị gần đây cho biểu đồ nhỏ trong email cảnh báo (tối đa `n` kỳ, kỳ hiện tại ở cuối).
 * Cửa sổ theo ngày (hôm nay/hôm qua): `n` ngày liên tiếp; tuần: các tuần trước; tháng: các tháng trước (cùng số ngày đã trôi qua).
 * null nếu luật không có khoảng thời gian (window = all) hoặc không có cột ngày.
 */
export async function computeSeries(m: AlertMetric, deps: ComputeDeps, n = 14): Promise<AlertSeries | null> {
  const span = windowSpan(m.window, deps.now);
  if (!span || !m.dateColumn) return null;
  const runner = new Runner(m, deps);

  let spans: Span[];
  let label: (s: Span) => string;
  if (m.window === "today" || m.window === "yesterday") {
    spans = Array.from({ length: n }, (_, k) => {
      const d = addDays(span.to, -k);
      return { from: d, to: d };
    });
    label = (s) => dm(s.from);
  } else {
    spans = [span, ...historySpans(m.window, span, n - 1)];
    label = m.window === "this_month" ? (s) => `${s.from.slice(5, 7)}/${s.from.slice(0, 4)}` : (s) => dm(s.from);
  }
  spans.reverse();

  const start = await runner.dataStart();
  const values: (number | null)[] = [];
  for (const s of spans) {
    values.push(start && s.to < start ? null : (await runner.scalar(s)).value);
  }
  return { labels: spans.map(label), values };
}
