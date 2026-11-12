import { AlertDraft, AlertRuleInput, type AlertFilter, type AlertState, type AlertWindow } from "@dashboard/schema";
import { formatNumber } from "@dashboard/chart-engine";

/** Phần thuần của giao diện cảnh báo: biểu mẫu, chuyển qua lại với luật, nhãn trạng thái, gợi ý rủi ro báo sớm. */

export type ConditionKind = "threshold" | "change" | "anomaly" | "stale";
export type Aggregation = "sum" | "avg" | "count" | "min" | "max" | "count_distinct";

export const WINDOW_NAMES: Record<AlertWindow, string> = {
  today: "hôm nay", yesterday: "hôm qua", this_week: "tuần này", this_month: "tháng này", last_7d: "7 ngày qua", all: "toàn bộ dữ liệu",
};
export const WINDOW_ORDER: AlertWindow[] = ["today", "yesterday", "this_week", "this_month", "last_7d", "all"];
export const AGG_NAMES: Record<Aggregation, string> = {
  sum: "Tổng", avg: "Trung bình", count: "Số dòng", min: "Nhỏ nhất", max: "Lớn nhất", count_distinct: "Số giá trị khác nhau",
};
export const KIND_NAMES: Record<ConditionKind, string> = {
  threshold: "Vượt ngưỡng", change: "Thay đổi so với kỳ trước", anomaly: "Bất thường", stale: "Không có dữ liệu mới",
};
export const OP_NAMES = { lt: "thấp hơn", lte: "thấp hơn hoặc bằng", gt: "cao hơn", gte: "cao hơn hoặc bằng" } as const;
export const COOLDOWNS: { minutes: number; label: string }[] = [
  { minutes: 60, label: "1 giờ" }, { minutes: 180, label: "3 giờ" }, { minutes: 360, label: "6 giờ" }, { minutes: 720, label: "12 giờ" },
  { minutes: 1440, label: "1 ngày" }, { minutes: 4320, label: "3 ngày" }, { minutes: 10080, label: "7 ngày" },
];
export const MAX_RECIPIENTS = 20;

export interface SchemaSource {
  id: string;
  name: string;
  columns: { name: string; type: string }[];
}
export interface AlertSchema {
  sources: SchemaSource[];
  calc: { name: string; sourceId: string }[];
}

export interface AlertForm {
  /** Có = đang sửa một luật đã lưu. */
  id?: string;
  name: string;
  source_prompt: string | null;
  widget_id: string | null;
  sourceId: string;
  column: string;
  aggregation: Aggregation;
  window: AlertWindow;
  dateColumn: string;
  filters: AlertFilter[];
  kind: ConditionKind;
  perGroup: boolean;
  groupBy: string;
  op: keyof typeof OP_NAMES;
  value: string;
  changeOp: "drop_pct" | "rise_pct";
  changeValue: string;
  vs: "prev_period" | "prev_year";
  sensitivity: "low" | "medium" | "high";
  lookback: number;
  direction: "up" | "down" | "both";
  staleHours: string;
  settleHour: number | null;
  /** Danh sách email, cách nhau bằng dấu phẩy/chấm phẩy/xuống dòng. */
  recipients: string;
  cooldown_minutes: number;
  notify_recover: boolean;
  enabled: boolean;
}

/** Điền sẵn khi tạo cảnh báo từ widget KPI. */
export interface AlertPrefill {
  sourceId: string;
  column: string;
  aggregation?: Aggregation;
  widgetId?: string;
  name?: string;
}

/** Đọc số kiểu Việt Nam/Anh gõ tay: "10000000", "10.000.000", "12,5", "1,234.5". null nếu không phải số. */
export function parseNumberInput(text: string): number | null {
  let s = text.trim().replace(/\s+/g, "");
  if (!s || !/^[-+]?[\d.,]+$/.test(s)) return null;
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const colsOf = (schema: AlertSchema, sourceId: string) => schema.sources.find((s) => s.id === sourceId)?.columns ?? [];
const calcOf = (schema: AlertSchema, sourceId: string) => schema.calc.filter((c) => c.sourceId === sourceId).map((c) => c.name);

/** Cột có thể làm chỉ số/nhóm... của một nguồn, theo loại. */
export function columnChoices(schema: AlertSchema, sourceId: string) {
  const cols = colsOf(schema, sourceId);
  const calc = calcOf(schema, sourceId);
  return {
    metric: [...cols.map((c) => c.name), ...calc],
    numeric: cols.filter((c) => c.type === "number").map((c) => c.name),
    date: cols.filter((c) => c.type === "date").map((c) => c.name),
    group: [...cols.filter((c) => c.type !== "date" && c.type !== "number").map((c) => c.name), ...cols.filter((c) => c.type === "number").map((c) => c.name)],
    calc,
  };
}

export function emptyAlertForm(schema: AlertSchema, me: string, prefill?: AlertPrefill): AlertForm {
  const sourceId = prefill?.sourceId ?? schema.sources[0]?.id ?? "";
  const ch = columnChoices(schema, sourceId);
  return {
    name: prefill?.name ?? "",
    source_prompt: null,
    widget_id: prefill?.widgetId ?? null,
    sourceId,
    column: prefill?.column ?? ch.numeric[0] ?? ch.metric[0] ?? "",
    aggregation: prefill?.aggregation ?? "sum",
    window: ch.date.length ? "today" : "all",
    dateColumn: ch.date[0] ?? "",
    filters: [],
    kind: "threshold",
    perGroup: false,
    groupBy: "",
    op: "lt",
    value: "",
    changeOp: "drop_pct",
    changeValue: "20",
    vs: "prev_period",
    sensitivity: "medium",
    lookback: 8,
    direction: "both",
    staleHours: "24",
    settleHour: null,
    recipients: me,
    cooldown_minutes: 360,
    notify_recover: false,
    enabled: true,
  };
}

const fmt = (n: number) => String(n).replace(".", ",");

type RuleLike = {
  id?: string;
  name: string;
  source_prompt?: string | null;
  widget_id?: string | null;
  metric: unknown;
  condition: unknown;
  recipients?: string[];
  cooldown_minutes?: number;
  notify_recover?: boolean;
  enabled?: boolean;
};

/** Luật (đã lưu hoặc bản nháp AI) thành biểu mẫu. Dữ liệu hỏng thì trả biểu mẫu trống có tên luật. */
export function formFromRule(r: RuleLike, schema: AlertSchema, me: string): AlertForm {
  const base = emptyAlertForm(schema, me);
  const p = AlertDraft.safeParse({ metric: r.metric, condition: r.condition });
  if (!p.success) return { ...base, id: r.id, name: r.name };
  const m = p.data.metric;
  const c = p.data.condition;
  const leaf = c.type === "per_group" ? c.inner : c;
  const f: AlertForm = {
    ...base,
    id: r.id,
    name: r.name,
    source_prompt: r.source_prompt ?? null,
    widget_id: r.widget_id ?? null,
    sourceId: m.sourceId,
    column: m.metric.column,
    aggregation: (m.metric.aggregation ?? "sum") as Aggregation,
    window: m.window,
    dateColumn: m.dateColumn ?? base.dateColumn,
    filters: m.filters,
    perGroup: c.type === "per_group",
    groupBy: m.groupBy ?? "",
    settleHour: m.settleHour ?? null,
    recipients: (r.recipients ?? [me]).join(", "),
    cooldown_minutes: r.cooldown_minutes ?? 360,
    notify_recover: r.notify_recover ?? false,
    enabled: r.enabled ?? true,
    kind: leaf.type,
  };
  if (leaf.type === "threshold") Object.assign(f, { op: leaf.op, value: fmt(leaf.value) });
  else if (leaf.type === "change") Object.assign(f, { changeOp: leaf.op, changeValue: fmt(leaf.value), vs: leaf.vs });
  else if (leaf.type === "anomaly") Object.assign(f, { sensitivity: leaf.sensitivity, lookback: leaf.lookback, direction: leaf.direction });
  else if (leaf.type === "stale") Object.assign(f, { staleHours: String(leaf.hours), window: "all" });
  return f;
}

/** Tách danh sách email: dấu phẩy, chấm phẩy, khoảng trắng, xuống dòng; chữ thường, bỏ trùng. */
export function splitEmails(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
}

export type FormResult = { ok: true; input: AlertRuleInput } | { ok: false; error: string };

/** Biểu mẫu thành luật gửi API. Người không phải chủ luôn gửi tới email của chính mình. */
export function formToRuleInput(f: AlertForm, opts: { isOwner: boolean; me: string }): FormResult {
  if (!f.name.trim()) return { ok: false, error: "Hãy đặt tên cho cảnh báo." };
  if (!f.sourceId) return { ok: false, error: "Hãy chọn nguồn dữ liệu." };
  const stale = f.kind === "stale";
  if (!stale && !f.column) return { ok: false, error: "Hãy chọn cột cho chỉ số." };

  let condition: unknown;
  if (f.kind === "threshold") {
    const v = parseNumberInput(f.value);
    if (v === null) return { ok: false, error: "Hãy nhập ngưỡng là một con số." };
    condition = { type: "threshold", op: f.op, value: v };
  } else if (f.kind === "change") {
    const v = parseNumberInput(f.changeValue);
    if (v === null || v <= 0) return { ok: false, error: "Hãy nhập phần trăm thay đổi lớn hơn 0." };
    condition = { type: "change", op: f.changeOp, value: v, vs: f.vs };
  } else if (f.kind === "anomaly") {
    condition = { type: "anomaly", sensitivity: f.sensitivity, lookback: f.lookback, direction: f.direction };
  } else {
    const h = parseNumberInput(f.staleHours);
    if (h === null || !Number.isInteger(h) || h < 1) return { ok: false, error: "Hãy nhập số giờ là số nguyên từ 1 trở lên." };
    condition = { type: "stale", hours: h };
  }
  if (f.perGroup && !stale) {
    if (!f.groupBy) return { ok: false, error: "Hãy chọn cột để báo theo từng nhóm." };
    condition = { type: "per_group", inner: condition };
  }

  const windowed = !stale && f.window !== "all";
  const recipients = opts.isOwner ? splitEmails(f.recipients) : [opts.me];
  if (recipients.length === 0) return { ok: false, error: "Hãy nhập ít nhất một email người nhận." };
  if (recipients.length > MAX_RECIPIENTS) return { ok: false, error: `Tối đa ${MAX_RECIPIENTS} người nhận.` };
  if (recipients.some((e) => !/^\S+@\S+\.\S+$/.test(e))) return { ok: false, error: "Có email người nhận không hợp lệ." };

  const raw = {
    name: f.name.trim(),
    source_prompt: f.source_prompt,
    widget_id: f.widget_id,
    metric: {
      sourceId: f.sourceId,
      metric: { column: stale ? "" : f.column, ...(stale ? {} : { aggregation: f.aggregation }) },
      filters: stale ? [] : f.filters,
      ...(windowed && f.dateColumn ? { dateColumn: f.dateColumn } : {}),
      window: stale ? "all" : f.window,
      ...(f.perGroup && !stale ? { groupBy: f.groupBy } : {}),
      ...(f.settleHour !== null && windowed ? { settleHour: f.settleHour } : {}),
    },
    condition,
    recipients,
    cooldown_minutes: f.cooldown_minutes,
    notify_recover: f.notify_recover,
    enabled: f.enabled,
  };
  const parsed = AlertRuleInput.safeParse(raw);
  return parsed.success ? { ok: true, input: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ." };
}

/** Chỉ số + điều kiện của biểu mẫu (để kiểm tra "bây giờ có báo không" mà không cần người nhận). */
export function formToDraft(f: AlertForm): { ok: true; draft: AlertDraft } | { ok: false; error: string } {
  const r = formToRuleInput(f, { isOwner: false, me: "x@x.com" });
  if (!r.ok) return r;
  return { ok: true, draft: { metric: r.input.metric, condition: r.input.condition } };
}

// ---------------------------------------------------------------------------------------------

/** Khoảng đo chưa kết thúc cộng điều kiện dễ báo sớm: gợi ý đặt "Chỉ báo sau giờ …". */
export function earlyAlarmRisk(f: AlertForm): boolean {
  if (f.kind === "stale" || !(f.window === "today" || f.window === "this_week" || f.window === "this_month")) return false;
  if (f.kind === "threshold") return f.op === "lt" || f.op === "lte";
  if (f.kind === "change") return f.changeOp === "drop_pct";
  return f.direction !== "up";
}

export type StateKey = "disabled" | "snoozed" | "ok" | "firing" | "error" | "insufficient";

export const STATE_LABELS: Record<StateKey, string> = {
  disabled: "Đã tắt", snoozed: "Tạm hoãn", ok: "Bình thường", firing: "Đang báo", error: "Lỗi", insufficient: "Chưa đủ dữ liệu",
};

/** Trạng thái hiển thị của một luật (tạm hoãn và đã tắt được ưu tiên). */
export function stateKey(r: { enabled: boolean; snooze_until: string | null; last_state: AlertState }, now: Date): StateKey {
  if (!r.enabled) return "disabled";
  if (r.snooze_until && Date.parse(r.snooze_until) > now.getTime()) return "snoozed";
  return r.last_state;
}

export interface PreviewParts {
  /** single | groups | deferred */
  kind: "single" | "groups" | "deferred";
  verdict: "firing" | "ok" | "insufficient" | "deferred";
  /** Giá trị đã định dạng (kind = single), hoặc "3/20" nhóm vi phạm (groups). */
  valueText: string | null;
  label: string;
  reason?: string;
  settleHour?: number;
  groups?: { group: string; valueText: string }[];
}

type SummaryLike = {
  kind: "single" | "groups" | "deferred";
  verdict: "firing" | "ok" | "insufficient" | "deferred";
  label: string;
  value?: number | null;
  reason?: string;
  settleHour?: number;
  evaluated?: number;
  violatingCount?: number;
  groups?: { group: string; value: number | null }[];
};

const num = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : formatNumber(Math.round(n * 100) / 100));

/** Tóm tắt kết quả tính (từ API) thành các phần hiển thị: "Giá trị hiện tại … → bây giờ có báo không". */
export function previewParts(s: SummaryLike): PreviewParts {
  if (s.kind === "deferred") return { kind: "deferred", verdict: "deferred", valueText: null, label: s.label, settleHour: s.settleHour };
  if (s.kind === "groups") {
    return {
      kind: "groups", verdict: s.verdict, valueText: `${s.violatingCount ?? 0}/${s.evaluated ?? 0}`, label: s.label,
      groups: (s.groups ?? []).map((g) => ({ group: g.group, valueText: num(g.value) })),
    };
  }
  return { kind: "single", verdict: s.verdict, valueText: s.value === null || s.value === undefined ? null : num(s.value), label: s.label, reason: s.reason };
}
