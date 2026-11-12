import type { AlertCondition, AlertState } from "./notify";

/**
 * Đánh giá luật cảnh báo: phần THUẦN (không DB, không AI, không đồng hồ ẩn). Việc lấy số liệu (giá trị, kỳ trước, lịch sử)
 * do server làm bằng đúng engine của dashboard rồi đưa vào đây; hàm trong file này chỉ trả lời "có báo không" và "có gửi thư không".
 */

type Leaf = Exclude<AlertCondition, { type: "per_group" } | { type: "stale" }>;

export type Verdict = "firing" | "ok" | "insufficient";

export interface Evaluation {
  verdict: Verdict;
  /** Giá trị hiện tại của chỉ số (null = không có dữ liệu). */
  value: number | null;
  /** change: giá trị kỳ so sánh. */
  prev?: number | null;
  /** change: % thay đổi có dấu (âm = giảm). */
  changePct?: number | null;
  /** anomaly: điểm z, trung bình và độ lệch chuẩn của các kỳ trước, số kỳ dùng. */
  z?: number | null;
  mean?: number;
  sd?: number;
  n?: number;
  /** Vì sao chưa đánh giá được (verdict = insufficient). */
  reason?: "no_data" | "no_base" | "not_enough_history";
}

/** Ngưỡng |z| theo độ nhạy: nhạy hơn thì ngưỡng thấp hơn. */
export const Z_THRESHOLD = { low: 3, medium: 2.5, high: 2 } as const;
/** Số kỳ lịch sử tối thiểu để tính bất thường; ít hơn thì "chưa đủ dữ liệu", không báo. */
export const MIN_HISTORY = 4;
/** Độ lệch chuẩn tối thiểu = 5% của |trung bình|: chuỗi gần như phẳng thì dao động nhỏ không bị coi là bất thường. */
export const MIN_REL_SD = 0.05;
const EPS = 1e-9;

export interface AnomalyScore {
  z: number;
  mean: number;
  sd: number;
  n: number;
  /** Lịch sử phẳng hoàn toàn (độ lệch bằng 0, trung bình bằng 0): mọi giá trị khác đều là bất thường (z = ±Infinity). */
  flat: boolean;
}

/**
 * Điểm bất thường của `value` so với `history` (các kỳ trước CÙNG LOẠI). null nếu có ít hơn MIN_HISTORY kỳ hợp lệ.
 * z = (giá trị − trung bình) / max(độ lệch chuẩn mẫu, 5% × |trung bình|).
 */
export function anomalyScore(value: number, history: number[]): AnomalyScore | null {
  const h = history.filter((x) => Number.isFinite(x));
  if (h.length < MIN_HISTORY || !Number.isFinite(value)) return null;
  const n = h.length;
  const mean = h.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(h.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const eff = Math.max(sd, Math.abs(mean) * MIN_REL_SD);
  if (eff === 0) {
    const same = Math.abs(value - mean) < EPS;
    return { z: same ? 0 : value > mean ? Infinity : -Infinity, mean, sd, n, flat: true };
  }
  return { z: (value - mean) / eff, mean, sd, n, flat: false };
}

export interface EvalInput {
  value: number | null;
  /** change: giá trị ở kỳ so sánh (null = kỳ đó không có dữ liệu). */
  prev?: number | null;
  /** anomaly: giá trị của các kỳ trước cùng loại. */
  history?: number[];
}

/** Đánh giá MỘT điều kiện (ngưỡng, thay đổi, bất thường) với số liệu đã lấy. Không áp dụng cho per_group/stale. */
export function evaluateCondition(c: Leaf, input: EvalInput): Evaluation {
  const { value } = input;
  if (value === null || value === undefined || !Number.isFinite(value)) return { verdict: "insufficient", value: null, reason: "no_data" };

  if (c.type === "threshold") {
    const firing = c.op === "lt" ? value < c.value : c.op === "lte" ? value <= c.value : c.op === "gt" ? value > c.value : value >= c.value;
    return { verdict: firing ? "firing" : "ok", value };
  }

  if (c.type === "change") {
    const prev = input.prev;
    if (prev === null || prev === undefined || !Number.isFinite(prev) || prev === 0) return { verdict: "insufficient", value, prev: prev ?? null, reason: "no_base" };
    const pct = ((value - prev) / Math.abs(prev)) * 100;
    const firing = c.op === "drop_pct" ? -pct >= c.value - EPS : pct >= c.value - EPS;
    return { verdict: firing ? "firing" : "ok", value, prev, changePct: pct };
  }

  const score = anomalyScore(value, input.history ?? []);
  if (!score) return { verdict: "insufficient", value, reason: "not_enough_history", n: (input.history ?? []).filter(Number.isFinite).length };
  const t = Z_THRESHOLD[c.sensitivity];
  const dir = c.direction ?? "both";
  const firing = dir === "up" ? score.z >= t : dir === "down" ? score.z <= -t : Math.abs(score.z) >= t;
  return { verdict: firing ? "firing" : "ok", value, z: score.z, mean: score.mean, sd: score.sd, n: score.n };
}

// ---------------------------------------------------------------------------------------------
// Trạng thái và quyết định gửi thư
// ---------------------------------------------------------------------------------------------

export type Notify = "fire" | "remind" | "recover" | null;

export interface AlertStateIn {
  state: AlertState;
  /** Lần gần nhất đã GỬI cảnh báo (báo lần đầu hoặc nhắc lại); null nếu chưa từng. */
  lastTriggeredAt: Date | null;
}

export interface AlertStateOut {
  state: AlertState;
  notify: Notify;
  lastTriggeredAt: Date | null;
}

const MIN = 60_000;
const cooledDown = (last: Date | null, now: Date, cooldownMin: number) => !last || now.getTime() - last.getTime() >= cooldownMin * MIN;

/**
 * Chuyển trạng thái và quyết định có gửi thư không.
 * - firing: gửi khi chưa từng báo hoặc đã qua `cooldownMin` kể từ lần báo trước (báo lần đầu, hoặc nhắc lại sau thời gian chờ).
 *   Vì vậy một luật chập chờn (ok→firing→ok→firing) cũng không gửi dồn dập trong thời gian chờ.
 * - firing → ok: gửi "đã trở lại bình thường" nếu `notifyRecover`.
 * - Đang tạm hoãn (`snoozeUntil` còn hiệu lực): KHÔNG gửi gì, nhưng trạng thái vẫn cập nhật; khi hết hoãn mà vẫn firing thì được nhắc.
 * - insufficient/error: chỉ đổi trạng thái, không gửi (lỗi được báo riêng một lần).
 */
export function nextAlertState(
  prev: AlertStateIn,
  verdict: Verdict | "error",
  now: Date,
  cooldownMin: number,
  notifyRecover: boolean,
  snoozeUntil: Date | null,
): AlertStateOut {
  const snoozed = !!snoozeUntil && snoozeUntil.getTime() > now.getTime();
  const state: AlertState = verdict === "firing" ? "firing" : verdict === "ok" ? "ok" : verdict === "insufficient" ? "insufficient" : "error";
  let notify: Notify = null;
  let last = prev.lastTriggeredAt;

  if (verdict === "firing" && !snoozed && cooledDown(prev.lastTriggeredAt, now, cooldownMin)) {
    notify = prev.state === "firing" ? "remind" : "fire";
    last = now;
  } else if (verdict === "ok" && prev.state === "firing" && notifyRecover && !snoozed) {
    notify = "recover";
  }
  return { state, notify, lastTriggeredAt: last };
}

// ---------------------------------------------------------------------------------------------
// Luật "theo từng nhóm"
// ---------------------------------------------------------------------------------------------

/** Trạng thái từng nhóm đang vi phạm: từ lúc nào, và lần gần nhất đã báo. */
export interface GroupEntry {
  since: string;
  notifiedAt: string | null;
}
export type GroupState = Record<string, GroupEntry>;

/** Số nhóm tối đa liệt kê trong một email. */
export const MAX_GROUPS_LISTED = 20;

/**
 * Quyết định nhóm nào được liệt kê trong email lần này.
 * - Nhóm MỚI vi phạm: báo ngay. Nhóm đã vi phạm từ trước: chỉ nhắc lại khi qua `cooldownMin` kể từ lần báo của chính nó.
 * - Nhóm hết vi phạm: bị bỏ khỏi trạng thái (lần sau vi phạm lại sẽ tính là mới) và trả về ở `recovered`.
 * - Đang tạm hoãn: không báo nhóm nào (trạng thái vẫn cập nhật).
 * - Quá `maxList` nhóm cần báo: chỉ đánh dấu đã báo cho `maxList` nhóm đầu (theo thứ tự `violating`); số còn lại sẽ được báo lần sau.
 */
export function nextGroupState(
  prev: GroupState,
  violating: string[],
  now: Date,
  cooldownMin: number,
  snoozeUntil: Date | null,
  maxList = MAX_GROUPS_LISTED,
): { state: GroupState; notify: string[]; recovered: string[] } {
  const snoozed = !!snoozeUntil && snoozeUntil.getTime() > now.getTime();
  const nowIso = now.toISOString();
  const seen = new Set<string>();
  // Không dùng {} thường: tên nhóm lấy từ dữ liệu có thể là "__proto__"/"constructor".
  const state = Object.create(null) as GroupState;
  const notify: string[] = [];

  for (const g of violating) {
    if (seen.has(g)) continue;
    seen.add(g);
    const old = Object.prototype.hasOwnProperty.call(prev, g) ? prev[g] : undefined;
    const entry: GroupEntry = old ?? { since: nowIso, notifiedAt: null };
    const due = !entry.notifiedAt || now.getTime() - Date.parse(entry.notifiedAt) >= cooldownMin * MIN;
    if (due && !snoozed && notify.length < maxList) {
      notify.push(g);
      entry.notifiedAt = nowIso;
    }
    state[g] = { ...entry };
  }
  const recovered = Object.keys(prev).filter((g) => !seen.has(g));
  return { state, notify, recovered };
}
