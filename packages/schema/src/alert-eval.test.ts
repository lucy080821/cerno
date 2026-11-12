import { describe, expect, it } from "vitest";
import {
  MAX_GROUPS_LISTED, MIN_HISTORY, Z_THRESHOLD, anomalyScore, evaluateCondition, nextAlertState, nextGroupState,
  type AlertStateIn, type GroupState,
} from "./alert-eval";
import { AlertCondition } from "./notify";

const cond = (c: unknown) => AlertCondition.parse(c) as Exclude<AlertCondition, { type: "per_group" } | { type: "stale" }>;

describe("evaluateCondition: threshold", () => {
  const t = (op: string, value: number) => cond({ type: "threshold", op, value });
  it("lt, lte, gt, gte và đúng biên", () => {
    expect(evaluateCondition(t("lt", 10), { value: 9 }).verdict).toBe("firing");
    expect(evaluateCondition(t("lt", 10), { value: 10 }).verdict).toBe("ok");
    expect(evaluateCondition(t("lte", 10), { value: 10 }).verdict).toBe("firing");
    expect(evaluateCondition(t("gt", 10), { value: 10 }).verdict).toBe("ok");
    expect(evaluateCondition(t("gt", 10), { value: 10.01 }).verdict).toBe("firing");
    expect(evaluateCondition(t("gte", 10), { value: 10 }).verdict).toBe("firing");
  });
  it("giá trị 0 và số âm là số thật, không phải 'thiếu dữ liệu'", () => {
    expect(evaluateCondition(t("lt", 5), { value: 0 }).verdict).toBe("firing");
    expect(evaluateCondition(t("lt", -1), { value: -5 }).verdict).toBe("firing");
  });
  it("không có dữ liệu (null/NaN/Infinity) → chưa đủ dữ liệu, không báo", () => {
    for (const v of [null, Number.NaN, Infinity]) expect(evaluateCondition(t("lt", 10), { value: v })).toMatchObject({ verdict: "insufficient", reason: "no_data", value: null });
  });
});

describe("evaluateCondition: change", () => {
  const drop = (v: number) => cond({ type: "change", op: "drop_pct", value: v, vs: "prev_period" });
  const rise = (v: number) => cond({ type: "change", op: "rise_pct", value: v, vs: "prev_period" });
  it("giảm ≥ ngưỡng thì báo, kể cả đúng ngưỡng", () => {
    expect(evaluateCondition(drop(20), { value: 79, prev: 100 })).toMatchObject({ verdict: "firing", changePct: -21 });
    expect(evaluateCondition(drop(20), { value: 80, prev: 100 }).verdict).toBe("firing"); // đúng 20%
    expect(evaluateCondition(drop(20), { value: 81, prev: 100 }).verdict).toBe("ok");
    expect(evaluateCondition(drop(20), { value: 120, prev: 100 }).verdict).toBe("ok"); // tăng không phải giảm
  });
  it("tăng ≥ ngưỡng thì báo", () => {
    expect(evaluateCondition(rise(30), { value: 130, prev: 100 }).verdict).toBe("firing");
    expect(evaluateCondition(rise(30), { value: 129, prev: 100 }).verdict).toBe("ok");
    expect(evaluateCondition(rise(30), { value: 50, prev: 100 }).verdict).toBe("ok");
  });
  it("chịu được sai số số thực (đúng 10% không bị bỏ sót)", () => {
    expect(evaluateCondition(drop(10), { value: 0.9, prev: 1 }).verdict).toBe("firing");
    expect(evaluateCondition(drop(30), { value: 0.7, prev: 1 }).verdict).toBe("firing");
  });
  it("kỳ so sánh trống hoặc bằng 0 → không có mốc, không báo (không chia cho 0)", () => {
    expect(evaluateCondition(drop(20), { value: 5, prev: null })).toMatchObject({ verdict: "insufficient", reason: "no_base" });
    expect(evaluateCondition(drop(20), { value: 5 })).toMatchObject({ verdict: "insufficient", reason: "no_base" });
    expect(evaluateCondition(rise(20), { value: 5, prev: 0 })).toMatchObject({ verdict: "insufficient", reason: "no_base" });
  });
  it("kỳ trước âm vẫn tính theo giá trị tuyệt đối của mốc", () => {
    // từ -100 xuống -120: thấp hơn 20% (so với |−100|)
    expect(evaluateCondition(drop(20), { value: -120, prev: -100 })).toMatchObject({ verdict: "firing", changePct: -20 });
  });
  it("giá trị hiện tại không có → chưa đủ dữ liệu", () => {
    expect(evaluateCondition(drop(20), { value: null, prev: 100 }).verdict).toBe("insufficient");
  });
});

describe("anomalyScore", () => {
  it("cần tối thiểu 4 kỳ hợp lệ; số không hợp lệ bị bỏ", () => {
    expect(MIN_HISTORY).toBe(4);
    expect(anomalyScore(10, [1, 2, 3])).toBeNull();
    expect(anomalyScore(10, [1, 2, 3, Number.NaN, Infinity])).toBeNull();
    expect(anomalyScore(Number.NaN, [1, 2, 3, 4])).toBeNull();
    expect(anomalyScore(10, [1, 2, 3, 4])).not.toBeNull();
  });
  it("trung bình, độ lệch chuẩn mẫu và z", () => {
    const s = anomalyScore(16, [10, 12, 14, 16, 18])!;
    expect(s.mean).toBe(14);
    expect(s.sd).toBeCloseTo(Math.sqrt(10), 10); // (16+4+0+4+16)/4 = 10
    expect(s.z).toBeCloseTo(2 / Math.sqrt(10), 10);
    expect(s.n).toBe(5);
    expect(s.flat).toBe(false);
  });
  it("lịch sử gần như phẳng: sàn 5% trung bình, không báo vì dao động nhỏ", () => {
    // sd thật = 0, nhưng sàn = 5% × 100 = 5 → z = 1
    expect(anomalyScore(105, [100, 100, 100, 100])!.z).toBeCloseTo(1, 10);
  });
  it("lịch sử phẳng bằng 0: mọi giá trị khác 0 là bất thường (±Infinity), bằng 0 thì bình thường", () => {
    expect(anomalyScore(0, [0, 0, 0, 0])).toMatchObject({ z: 0, flat: true });
    expect(anomalyScore(3, [0, 0, 0, 0])).toMatchObject({ z: Infinity, flat: true });
    expect(anomalyScore(-3, [0, 0, 0, 0])).toMatchObject({ z: -Infinity, flat: true });
  });
});

describe("evaluateCondition: anomaly", () => {
  const hist = [100, 102, 98, 101, 99, 100, 103, 97]; // trung bình 100, sd mẫu = 2
  const a = (sensitivity: string, direction?: string) => cond({ type: "anomaly", sensitivity, lookback: 8, ...(direction ? { direction } : {}) });
  it("giá trị bình thường thì không báo; lệch xa thì báo", () => {
    expect(evaluateCondition(a("medium"), { value: 101, history: hist }).verdict).toBe("ok");
    expect(evaluateCondition(a("medium"), { value: 120, history: hist })).toMatchObject({ verdict: "firing" });
    expect(evaluateCondition(a("medium"), { value: 120, history: hist }).z).toBeGreaterThan(Z_THRESHOLD.medium);
  });
  it("độ nhạy: cùng một lệch, nhạy cao báo còn nhạy thấp thì không", () => {
    // sd thật = 2 nhưng sàn 5% × 100 = 5 → z = (v − 100) / 5
    expect(evaluateCondition(a("high"), { value: 111, history: hist }).verdict).toBe("firing"); // z = 2,2 ≥ 2
    expect(evaluateCondition(a("medium"), { value: 111, history: hist }).verdict).toBe("ok"); // < 2,5
    expect(evaluateCondition(a("medium"), { value: 113, history: hist }).verdict).toBe("firing"); // z = 2,6
    expect(evaluateCondition(a("low"), { value: 113, history: hist }).verdict).toBe("ok"); // < 3
    expect(evaluateCondition(a("low"), { value: 116, history: hist }).verdict).toBe("firing"); // z = 3,2
  });
  it("hướng: mặc định cả hai chiều; up chỉ báo khi tăng; down chỉ báo khi giảm", () => {
    expect(evaluateCondition(a("medium"), { value: 80, history: hist }).verdict).toBe("firing"); // both
    expect(evaluateCondition(a("medium", "up"), { value: 80, history: hist }).verdict).toBe("ok");
    expect(evaluateCondition(a("medium", "up"), { value: 120, history: hist }).verdict).toBe("firing");
    expect(evaluateCondition(a("medium", "down"), { value: 120, history: hist }).verdict).toBe("ok");
    expect(evaluateCondition(a("medium", "down"), { value: 80, history: hist }).verdict).toBe("firing");
  });
  it("chưa đủ 4 kỳ → chưa đủ dữ liệu, không báo", () => {
    expect(evaluateCondition(a("high"), { value: 999, history: [1, 2, 3] })).toMatchObject({ verdict: "insufficient", reason: "not_enough_history", n: 3 });
    expect(evaluateCondition(a("high"), { value: 999 })).toMatchObject({ verdict: "insufficient", reason: "not_enough_history" });
  });
  it("đúng 4 kỳ thì đánh giá được", () => {
    expect(evaluateCondition(a("high"), { value: 1000, history: [10, 11, 9, 10] }).verdict).toBe("firing");
  });
  it("ví dụ thực tế: số đơn huỷ tăng bất thường (direction=up)", () => {
    const cancels = [4, 5, 3, 4, 6, 5, 4, 5];
    expect(evaluateCondition(a("medium", "up"), { value: 5, history: cancels }).verdict).toBe("ok");
    expect(evaluateCondition(a("medium", "up"), { value: 14, history: cancels }).verdict).toBe("firing");
  });
});

describe("AlertCondition: direction mặc định", () => {
  it("anomaly không khai báo hướng thì là both", () => {
    expect((AlertCondition.parse({ type: "anomaly", sensitivity: "low", lookback: 4 }) as { direction: string }).direction).toBe("both");
  });
});

// ---------------------------------------------------------------------------------------------

describe("nextAlertState", () => {
  const NOW = new Date("2025-11-03T10:00:00Z");
  const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
  const st = (state: AlertStateIn["state"], last: Date | null = null): AlertStateIn => ({ state, lastTriggeredAt: last });
  const run = (prev: AlertStateIn, verdict: Parameters<typeof nextAlertState>[1], over: { cooldown?: number; recover?: boolean; snooze?: Date | null } = {}) =>
    nextAlertState(prev, verdict, NOW, over.cooldown ?? 360, over.recover ?? false, over.snooze ?? null);

  it("ok → firing: gửi 'fire' và ghi lần báo", () => {
    expect(run(st("ok"), "firing")).toEqual({ state: "firing", notify: "fire", lastTriggeredAt: NOW });
  });
  it("firing trong thời gian chờ: không gửi, giữ nguyên lần báo cũ", () => {
    const last = ago(60);
    expect(run(st("firing", last), "firing")).toEqual({ state: "firing", notify: null, lastTriggeredAt: last });
  });
  it("hết thời gian chờ: nhắc lại", () => {
    expect(run(st("firing", ago(361)), "firing")).toEqual({ state: "firing", notify: "remind", lastTriggeredAt: NOW });
    expect(run(st("firing", ago(360)), "firing").notify).toBe("remind"); // đúng 360 phút
    expect(run(st("firing", ago(359)), "firing").notify).toBeNull();
  });
  it("chập chờn ok→firing→ok→firing trong thời gian chờ không gửi dồn", () => {
    const last = ago(30);
    expect(run(st("ok", last), "firing")).toEqual({ state: "firing", notify: null, lastTriggeredAt: last });
    expect(run(st("ok", ago(400)), "firing").notify).toBe("fire");
  });
  it("firing → ok: chỉ gửi 'recover' khi bật notify_recover", () => {
    expect(run(st("firing", ago(10)), "ok", { recover: true })).toEqual({ state: "ok", notify: "recover", lastTriggeredAt: ago(10) });
    expect(run(st("firing", ago(10)), "ok", { recover: false }).notify).toBeNull();
    expect(run(st("ok"), "ok", { recover: true }).notify).toBeNull(); // đã bình thường rồi
  });
  it("đang tạm hoãn: không gửi gì (cả báo lẫn trở lại bình thường), trạng thái vẫn cập nhật", () => {
    const snooze = new Date(NOW.getTime() + 3_600_000);
    expect(run(st("ok"), "firing", { snooze })).toEqual({ state: "firing", notify: null, lastTriggeredAt: null });
    expect(run(st("firing", ago(10)), "ok", { recover: true, snooze }).notify).toBeNull();
  });
  it("hết hạn tạm hoãn mà vẫn firing: được nhắc (vì chưa từng báo trong lúc hoãn)", () => {
    const expired = new Date(NOW.getTime() - 1000);
    expect(run(st("firing", ago(500)), "firing", { snooze: expired }).notify).toBe("remind");
    expect(run(st("firing", ago(500)), "firing", { snooze: new Date(NOW.getTime()) }).notify).toBe("remind"); // đúng lúc hết hạn
  });
  it("insufficient / error: chỉ đổi trạng thái, không gửi, không đổi lần báo", () => {
    const last = ago(10);
    expect(run(st("firing", last), "insufficient")).toEqual({ state: "insufficient", notify: null, lastTriggeredAt: last });
    expect(run(st("ok", last), "error")).toEqual({ state: "error", notify: null, lastTriggeredAt: last });
  });
  it("từ chưa đủ dữ liệu/lỗi sang firing là báo lần đầu ('fire', không phải 'remind')", () => {
    expect(run(st("insufficient"), "firing").notify).toBe("fire");
    expect(run(st("error"), "firing").notify).toBe("fire");
  });
});

describe("nextGroupState", () => {
  const NOW = new Date("2025-11-03T10:00:00Z");
  const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
  const entry = (since: string, notifiedAt: string | null) => ({ since, notifiedAt });

  it("nhóm mới vi phạm thì báo, và ghi lại thời điểm", () => {
    const r = nextGroupState({}, ["Hà Nội", "Huế"], NOW, 360, null);
    expect(r.notify).toEqual(["Hà Nội", "Huế"]);
    expect(r.state["Hà Nội"]).toEqual({ since: NOW.toISOString(), notifiedAt: NOW.toISOString() });
    expect(r.recovered).toEqual([]);
  });
  it("nhóm cũ vẫn vi phạm trong thời gian chờ: không báo lại; nhóm mới thì báo", () => {
    const prev: GroupState = { "Hà Nội": entry(ago(100), ago(100)) };
    const r = nextGroupState(prev, ["Hà Nội", "Đà Nẵng"], NOW, 360, null);
    expect(r.notify).toEqual(["Đà Nẵng"]);
    expect(r.state["Hà Nội"]).toEqual(prev["Hà Nội"]); // không đổi
  });
  it("hết thời gian chờ thì nhắc lại nhóm cũ", () => {
    const prev: GroupState = { "Hà Nội": entry(ago(1000), ago(361)) };
    const r = nextGroupState(prev, ["Hà Nội"], NOW, 360, null);
    expect(r.notify).toEqual(["Hà Nội"]);
    expect(r.state["Hà Nội"].since).toBe(ago(1000)); // 'since' giữ nguyên
    expect(r.state["Hà Nội"].notifiedAt).toBe(NOW.toISOString());
  });
  it("nhóm hết vi phạm bị bỏ khỏi trạng thái và nằm trong recovered; vi phạm lại là nhóm mới", () => {
    const prev: GroupState = { "Hà Nội": entry(ago(100), ago(100)), "Huế": entry(ago(100), ago(100)) };
    const r = nextGroupState(prev, ["Huế"], NOW, 360, null);
    expect(r.recovered).toEqual(["Hà Nội"]);
    expect(Object.keys(r.state)).toEqual(["Huế"]);
    const again = nextGroupState(r.state, ["Huế", "Hà Nội"], NOW, 360, null);
    expect(again.notify).toEqual(["Hà Nội"]); // quay lại = mới
  });
  it("đang tạm hoãn: không báo nhóm nào nhưng vẫn ghi nhận nhóm vi phạm; hết hoãn thì báo", () => {
    const snooze = new Date(NOW.getTime() + 3_600_000);
    const r = nextGroupState({}, ["A"], NOW, 360, snooze);
    expect(r.notify).toEqual([]);
    expect(r.state.A).toEqual({ since: NOW.toISOString(), notifiedAt: null });
    expect(nextGroupState(r.state, ["A"], new Date(NOW.getTime() + 2 * 3_600_000), 360, snooze).notify).toEqual(["A"]);
  });
  it(`liệt kê tối đa ${MAX_GROUPS_LISTED} nhóm; phần còn lại báo ở lần sau`, () => {
    const many = Array.from({ length: 30 }, (_, i) => `G${String(i).padStart(2, "0")}`);
    const r1 = nextGroupState({}, many, NOW, 360, null);
    expect(r1.notify).toHaveLength(MAX_GROUPS_LISTED);
    expect(r1.notify[0]).toBe("G00");
    expect(Object.values(r1.state).filter((e) => e.notifiedAt === null)).toHaveLength(10);
    const later = new Date(NOW.getTime() + 60_000);
    const r2 = nextGroupState(r1.state, many, later, 360, null);
    expect(r2.notify).toEqual(many.slice(20)); // đúng 10 nhóm chưa được báo
  });
  it("tên nhóm trùng lặp chỉ tính một lần; danh sách rỗng thì mọi nhóm cũ là recovered", () => {
    expect(nextGroupState({}, ["A", "A", "A"], NOW, 360, null).notify).toEqual(["A"]);
    const prev: GroupState = { A: entry(ago(5), ago(5)) };
    expect(nextGroupState(prev, [], NOW, 360, null)).toEqual({ state: {}, notify: [], recovered: ["A"] });
  });
  it("tên nhóm giống thuộc tính đặc biệt (__proto__, constructor) vẫn an toàn", () => {
    const r = nextGroupState({}, ["__proto__", "constructor"], NOW, 360, null);
    expect(r.notify).toEqual(["__proto__", "constructor"]);
    expect(({} as Record<string, unknown>).since).toBeUndefined();
  });
});
