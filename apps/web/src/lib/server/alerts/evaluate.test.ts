import { describe, expect, it } from "vitest";
import { runQuery, type Row } from "@dashboard/chart-engine";
import type { MailMessage, SendResult } from "@/lib/server/mail";
import {
  evaluateAlertsForSource, evaluateStaleRules, processRule,
  type AlertCtx, type AlertDeps, type AlertLog, type RuleRow,
} from "./evaluate";

/** Giờ VN. 13/11/2025 là thứ Năm. */
const vn = (y: number, m: number, d: number, h = 22, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 7, min));

const metricOf = (over: Record<string, unknown> = {}) => ({
  sourceId: "s", metric: { column: "DT", aggregation: "sum" }, filters: [], dateColumn: "Ngày", window: "today", ...over,
});

let seq = 0;
function rule(over: Partial<RuleRow> = {}, metric: Record<string, unknown> = {}, condition: unknown = { type: "threshold", op: "lt", value: 10_000_000 }): RuleRow {
  return {
    id: `rule-${++seq}`, dashboard_id: "dash", created_by: "user-1", name: "Doanh thu thấp", metric: metricOf(metric), condition,
    recipients: ["an@example.com"], cooldown_minutes: 360, notify_recover: false, enabled: true, snooze_until: null,
    last_state: "ok", last_value: null, last_triggered_at: null, last_error: null, group_state: {}, ...over,
  };
}

const ctxOf = (over: Partial<AlertCtx> = {}): AlertCtx => ({
  dashboardName: "Bán hàng", ownerId: "owner-1",
  sources: [{ id: "s", columns: [{ name: "Ngày", type: "date" }, { name: "DT", type: "number" }, { name: "Tỉnh", type: "string" }] }],
  calc: [], calcDefs: () => [], ...over,
});

interface H {
  deps: AlertDeps; rules: Map<string, RuleRow>; mails: MailMessage[]; logs: AlertLog[]; now: Date; rows: Row[];
  sendResult: (m: MailMessage) => SendResult; saves: string[]; explainCalls: number; ctx: AlertCtx | null; changedAt: string | null;
  opted: Set<string>; linksOk: boolean; creatorMails: number;
}

function harness(rules: RuleRow[], rows: Row[], now: Date, over: Partial<AlertDeps> = {}): H {
  const h: H = {
    deps: undefined as unknown as AlertDeps, rules: new Map(rules.map((r) => [r.id, r])), mails: [], logs: [], now, rows,
    sendResult: () => ({ ok: true }), saves: [], explainCalls: 0, ctx: ctxOf(), changedAt: null, opted: new Set(), linksOk: true, creatorMails: 0,
  };
  h.deps = {
    now: () => h.now,
    rulesForSource: async () => [...h.rules.values()].filter((r) => (r.condition as { type: string }).type !== "stale"),
    staleRules: async () => [...h.rules.values()].filter((r) => (r.condition as { type: string }).type === "stale"),
    context: async () => h.ctx,
    exec: async (_id, spec) => runQuery(h.rows, spec),
    dataChangedAt: async () => h.changedAt,
    isOptedOut: async (email) => h.opted.has(email),
    send: async (m) => { h.mails.push(m); return h.sendResult(m); },
    log: async (e) => { h.logs.push(e); },
    save: async (id, patch) => { h.saves.push(id); const r = h.rules.get(id)!; Object.assign(r, patch); },
    creatorEmail: async () => "chu@example.com",
    viewToken: async () => "TOKEN",
    links: (r, email) => (h.linksOk ? {
      pageUrl: `https://cerno.cloud/unsubscribe?t=unsub-${r.id}-${email}`, apiUrl: `https://cerno.cloud/api/unsubscribe?t=unsub-${r.id}`,
      snoozeUrl: `https://cerno.cloud/unsubscribe?t=snooze-${r.id}`, muteUrl: `https://cerno.cloud/unsubscribe?t=mute-${r.id}`,
    } : null),
    origin: "https://cerno.cloud",
    ...over,
  };
  return h;
}

const row = (iso: string, dt: number, extra: Record<string, unknown> = {}): Row => ({ Ngày: iso, DT: dt, ...extra }) as Row;
const LOW = [row("2025-11-13", 4_000_000), row("2025-11-13", 3_000_000), row("2025-11-12", 50_000_000)]; // hôm nay 7 triệu
const OK = [row("2025-11-13", 40_000_000)];

const run = (h: H, sourceId = "s") => evaluateAlertsForSource(sourceId, h.deps);

describe("luật ngưỡng: gửi, thời gian chờ, nhắc lại", () => {
  it("ok → firing: gửi MỘT email đúng nội dung, có ảnh mini chart, link tạm hoãn/tắt/huỷ, List-Unsubscribe", async () => {
    const r = rule();
    const h = harness([r], LOW, vn(2025, 11, 13, 22));
    const s = await run(h);
    expect(s).toMatchObject({ evaluated: 1, notified: 1 });
    expect(h.mails).toHaveLength(1);
    const m = h.mails[0];
    expect(m.to).toBe("an@example.com");
    expect(m.subject).toBe("[Cảnh báo · Alert] Doanh thu thấp");
    expect(m.html).toContain("Tổng DT hôm nay (13/11/2025) thấp hơn 10.000.000");
    expect(m.html).toContain("7.000.000");
    expect(m.html).toContain('href="https://cerno.cloud/view/TOKEN"');
    expect(m.html).toContain("unsubscribe?t=snooze-" + r.id);
    expect(m.html).toContain("unsubscribe?t=mute-" + r.id);
    expect(m.images).toHaveLength(1);
    expect(m.images![0]).toMatchObject({ contentType: "image/png", cid: "alert-chart@cerno.report" });
    expect(m.html).toContain("cid:alert-chart@cerno.report");
    expect(m.headers).toEqual({ "List-Unsubscribe": `<https://cerno.cloud/api/unsubscribe?t=unsub-${r.id}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(h.rules.get(r.id)).toMatchObject({ last_state: "firing", last_value: 7_000_000, last_error: null, last_triggered_at: h.now.toISOString() });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({ kind: "alert", ref_id: r.id, dashboard_id: "dash", recipient: "an@example.com", status: "sent", meta: { notify: "fire", verdict: "firing" } });
  });

  it("cập nhật lại ngay (vẫn vi phạm): KHÔNG gửi thêm", async () => {
    const h = harness([rule()], LOW, vn(2025, 11, 13, 22));
    await run(h);
    h.now = vn(2025, 11, 13, 22, 5);
    const s = await run(h);
    expect(s.notified).toBe(0);
    expect(h.mails).toHaveLength(1);
  });

  it("hết thời gian chờ (6 giờ) mà vẫn vi phạm: nhắc lại", async () => {
    const h = harness([rule({ cooldown_minutes: 360 })], LOW, vn(2025, 11, 13, 10));
    await run(h);
    h.now = vn(2025, 11, 13, 16, 1);
    await run(h);
    expect(h.mails).toHaveLength(2);
    expect(h.mails[1].subject).toBe("[Cảnh báo · Alert] Doanh thu thấp (nhắc lại · reminder)");
  });

  it("trở lại bình thường: không gửi nếu tắt notify_recover; gửi 'Đã bình thường' nếu bật", async () => {
    const off = harness([rule({ notify_recover: false })], LOW, vn(2025, 11, 13, 22));
    await run(off);
    off.rows = OK;
    off.now = vn(2025, 11, 13, 23);
    await run(off);
    expect(off.mails).toHaveLength(1);
    expect([...off.rules.values()][0].last_state).toBe("ok");

    const on = harness([rule({ notify_recover: true })], LOW, vn(2025, 11, 13, 22));
    await run(on);
    on.rows = OK;
    on.now = vn(2025, 11, 13, 23);
    await run(on);
    expect(on.mails).toHaveLength(2);
    expect(on.mails[1].subject).toBe("[Đã bình thường · Back to normal] Doanh thu thấp");
    expect(on.mails[1].images).toBeUndefined(); // thư "đã bình thường" không kèm ảnh
  });

  it("dữ liệu bình thường từ đầu: không gửi, trạng thái ok", async () => {
    const h = harness([rule()], OK, vn(2025, 11, 13, 22));
    const s = await run(h);
    expect(s.notified).toBe(0);
    expect(h.mails).toEqual([]);
    expect([...h.rules.values()][0]).toMatchObject({ last_state: "ok", last_value: 40_000_000 });
  });
});

describe("tạm hoãn, người nhận, cấu hình", () => {
  it("đang tạm hoãn: không gửi; hết hoãn mà vẫn vi phạm: gửi", async () => {
    const snooze = vn(2025, 11, 14, 22).toISOString(); // hoãn tới 22:00 ngày 14
    const h = harness([rule({ snooze_until: snooze })], LOW, vn(2025, 11, 13, 22));
    await run(h);
    expect(h.mails).toEqual([]);
    expect([...h.rules.values()][0].last_state).toBe("firing");
    h.rows = [row("2025-11-14", 1_000)];
    h.now = vn(2025, 11, 14, 22, 1);
    await run(h);
    expect(h.mails).toHaveLength(1);
  });

  it("gửi cho mọi người nhận (không trùng), bỏ người đã huỷ nhận và ghi 'skipped'", async () => {
    const h = harness([rule({ recipients: ["an@example.com", "AN@example.com", "binh@example.com", "chi@example.com"] })], LOW, vn(2025, 11, 13, 22));
    h.opted.add("binh@example.com");
    await run(h);
    expect(h.mails.map((m) => m.to)).toEqual(["an@example.com", "chi@example.com"]);
    expect(h.logs.map((l) => [l.recipient, l.status])).toEqual([["an@example.com", "sent"], ["binh@example.com", "skipped"], ["chi@example.com", "sent"]]);
  });

  it("chưa cấu hình link huỷ nhận: KHÔNG gửi, ghi failed, và không tính là đã báo (sẽ thử lại)", async () => {
    const h = harness([rule()], LOW, vn(2025, 11, 13, 22));
    h.linksOk = false;
    await run(h);
    expect(h.mails).toEqual([]);
    expect(h.logs[0]).toMatchObject({ status: "failed", error: "Chưa cấu hình UNSUBSCRIBE_SECRET" });
    const r = [...h.rules.values()][0];
    expect(r.last_triggered_at).toBeNull();
    expect(r.last_error).toMatch(/Không gửi được/);
    h.linksOk = true;
    h.now = vn(2025, 11, 13, 22, 30);
    await run(h);
    expect(h.mails).toHaveLength(1); // lần sau gửi được
  });

  it("gửi mail lỗi: không ghi là đã báo → lần sau thử lại; có người gửi được thì tính là đã báo", async () => {
    const h = harness([rule()], LOW, vn(2025, 11, 13, 22));
    h.sendResult = () => ({ ok: false, code: "send_failed" });
    await run(h);
    expect([...h.rules.values()][0].last_triggered_at).toBeNull();
    h.sendResult = () => ({ ok: true });
    h.now = vn(2025, 11, 13, 22, 10);
    await run(h);
    expect(h.mails).toHaveLength(2); // lần đầu lỗi, lần hai gửi được
    expect([...h.rules.values()][0].last_triggered_at).not.toBeNull();
  });

  it("luật tắt, dashboard đã xoá: bỏ qua", async () => {
    const h = harness([rule({ enabled: false })], LOW, vn(2025, 11, 13, 22));
    expect(await run(h)).toMatchObject({ evaluated: 0 });
    const g = harness([rule()], LOW, vn(2025, 11, 13, 22));
    g.ctx = null;
    expect(await run(g)).toMatchObject({ evaluated: 0 });
    expect(g.mails).toEqual([]);
  });

  it("khoảng chưa kết thúc và chưa tới giờ chốt (settleHour): chưa đánh giá, không gửi", async () => {
    const h = harness([rule({}, { settleHour: 21 })], LOW, vn(2025, 11, 13, 9));
    await run(h);
    expect(h.mails).toEqual([]);
    h.now = vn(2025, 11, 13, 21);
    await run(h);
    expect(h.mails).toHaveLength(1);
  });
});

describe("hạn mức email trong ngày (theo gói)", () => {
  it("hết hạn mức: không gửi, ghi skipped daily_limit, KHÔNG tính là đã báo (khi có hạn mức lại thì gửi)", async () => {
    let allowed = false;
    const h = harness([rule()], LOW, vn(2025, 11, 13, 22), { mailAllowed: async () => allowed });
    await run(h);
    expect(h.mails).toEqual([]);
    expect(h.logs[0]).toMatchObject({ status: "skipped", meta: { reason: "daily_limit" } });
    expect([...h.rules.values()][0].last_triggered_at).toBeNull();
    allowed = true;
    h.now = vn(2025, 11, 13, 22, 30);
    await run(h);
    expect(h.mails).toHaveLength(1);
  });
});

describe("AI giải thích (tuỳ chọn)", () => {
  it("chỉ chạy khi cảnh báo BẬT LÊN (fire), không chạy khi nhắc lại hay đã bình thường; câu giải thích có trong thư", async () => {
    let calls = 0;
    const h = harness([rule({ notify_recover: true })], LOW, vn(2025, 11, 13, 10), { explain: async () => { calls++; return "Doanh thu hôm nay mới đạt 7.000.000."; } });
    await run(h);
    expect(calls).toBe(1);
    expect(h.mails[0].html).toContain("Nhận định:</strong> Doanh thu hôm nay mới đạt 7.000.000.");
    h.now = vn(2025, 11, 13, 17); // nhắc lại
    await run(h);
    h.rows = OK;
    h.now = vn(2025, 11, 13, 18); // bình thường
    await run(h);
    expect(h.mails).toHaveLength(3);
    expect(calls).toBe(1);
  });
  it("thư song ngữ: câu điều kiện, nhãn khoảng đo và nhận định có bản tiếng Anh", async () => {
    const h = harness([rule()], LOW, vn(2025, 11, 13, 10), {
      explain: async () => ({ vi: "Doanh thu hôm nay mới đạt 7.000.000.", en: "Revenue today is only 7.000.000." }),
    });
    await run(h);
    const html = h.mails[0].html;
    expect(html).toContain("ENGLISH VERSION");
    expect(html).toContain("Nhận định:</strong> Doanh thu hôm nay mới đạt 7.000.000.");
    expect(html).toContain("Insight:</strong> Revenue today is only 7.000.000.");
    expect(html).toMatch(/Total .* today \(13\/11\/2025\) is below/);
    expect(html).toContain("Measured period");
  });
  it("AI lỗi (ném lỗi) thì bỏ qua, thư vẫn gửi đủ nội dung", async () => {
    const h = harness([rule()], LOW, vn(2025, 11, 13, 22), { explain: async () => { throw new Error("AI chết"); } });
    await run(h);
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].html).not.toContain("Nhận định");
  });
});

describe("lỗi cấu hình luật", () => {
  it("cột bị xoá/đổi tên: chuyển sang trạng thái lỗi, báo NGƯỜI TẠO một lần, không báo lại ở lần sau", async () => {
    const h = harness([rule()], LOW, vn(2025, 11, 13, 22));
    h.ctx = ctxOf({ sources: [{ id: "s", columns: [{ name: "Ngày", type: "date" }, { name: "Doanh số", type: "number" }] }] }); // DT biến mất
    await run(h);
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].to).toBe("chu@example.com");
    expect(h.mails[0].subject).toBe("[Lỗi cảnh báo · Alert error] Doanh thu thấp");
    expect(h.mails[0].html).toContain("DT");
    expect([...h.rules.values()][0]).toMatchObject({ last_state: "error" });
    expect([...h.rules.values()][0].last_error).toContain('Cột "DT"');
    h.now = vn(2025, 11, 13, 23);
    await run(h);
    expect(h.mails).toHaveLength(1); // chỉ MỘT lần
    // sửa lại cột → chạy bình thường, thoát trạng thái lỗi
    h.ctx = ctxOf();
    h.now = vn(2025, 11, 13, 23, 30);
    await run(h);
    expect(h.mails).toHaveLength(2);
    expect(h.mails[1].subject).toBe("[Cảnh báo · Alert] Doanh thu thấp");
    expect([...h.rules.values()][0].last_state).toBe("firing");
  });

  it("luật lưu sai dạng (schema đổi) cũng chuyển sang lỗi, không ném", async () => {
    const h = harness([rule({ condition: { type: "xoa_het" } })], LOW, vn(2025, 11, 13, 22));
    const s = await run(h);
    expect(s.errors).toBe(1);
    expect([...h.rules.values()][0].last_state).toBe("error");
  });

  it("truy vấn lỗi tạm thời: giữ nguyên trạng thái, ghi nhận, không gửi", async () => {
    const h = harness([rule({ last_state: "firing", last_triggered_at: vn(2025, 11, 13, 10).toISOString() })], LOW, vn(2025, 11, 13, 22), {
      exec: async () => { throw new Error("DB sập"); },
    });
    await run(h);
    const r = [...h.rules.values()][0];
    expect(r.last_state).toBe("firing");
    expect(r.last_error).toMatch(/thử lại/);
    expect(r.last_error).not.toContain("DB sập");
    expect(h.mails).toEqual([]);
  });
});

describe("không làm hỏng đồng bộ", () => {
  it("một luật ném lỗi bất ngờ không ảnh hưởng luật khác; hàm không bao giờ ném", async () => {
    const a = rule({ name: "A" });
    const b = rule({ name: "B" });
    const h = harness([a, b], LOW, vn(2025, 11, 13, 22));
    h.deps.save = async (id, patch) => {
      if (id === a.id) throw new Error("ghi DB lỗi");
      Object.assign(h.rules.get(id)!, patch);
    };
    const s = await run(h);
    expect(s.errors).toBe(1);
    expect(h.rules.get(b.id)!.last_state).toBe("firing");
  });
  it("không đọc được danh sách luật: trả kết quả rỗng thay vì ném", async () => {
    const h = harness([], LOW, vn(2025, 11, 13, 22), { rulesForSource: async () => { throw new Error("DB"); } });
    await expect(run(h)).resolves.toMatchObject({ evaluated: 0, errors: 1 });
  });
  it("nguồn không có luật nào", async () => {
    expect(await run(harness([], LOW, vn(2025, 11, 13, 22)))).toEqual({ evaluated: 0, notified: 0, errors: 0, outcomes: [] });
  });
});

describe("luật theo từng nhóm", () => {
  const pg = { type: "per_group", inner: { type: "threshold", op: "lt", value: 10 } };
  const data = (extra: Row[] = []) => [
    row("2025-11-13", 5, { Tỉnh: "Hà Nội" }), row("2025-11-13", 50, { Tỉnh: "Huế" }), row("2025-11-13", 1, { Tỉnh: "Đà Nẵng" }), ...extra,
  ];

  it("liệt kê các nhóm vi phạm (nặng nhất trước) trong MỘT email", async () => {
    const h = harness([rule({}, { groupBy: "Tỉnh" }, pg)], data(), vn(2025, 11, 13, 22));
    await run(h);
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].html).toContain("Các Tỉnh vi phạm");
    expect(h.mails[0].html.indexOf("Đà Nẵng")).toBeLessThan(h.mails[0].html.indexOf("Hà Nội"));
    expect(h.mails[0].html).not.toContain("Huế: <strong>");
    expect(h.mails[0].images).toBeUndefined(); // luật theo nhóm không kèm ảnh
  });

  it("nhóm mới vi phạm thì gửi; nhóm cũ vẫn vi phạm trong thời gian chờ thì không gửi lại", async () => {
    const h = harness([rule({}, { groupBy: "Tỉnh" }, pg)], data(), vn(2025, 11, 13, 20));
    await run(h);
    expect(h.mails).toHaveLength(1);
    // cập nhật lại: không đổi → không gửi
    h.now = vn(2025, 11, 13, 21);
    await run(h);
    expect(h.mails).toHaveLength(1);
    // một nhóm MỚI vi phạm (Huế tụt xuống 2) → gửi, chỉ liệt kê nhóm mới
    h.rows = data().map((r) => (r.Tỉnh === "Huế" ? { ...r, DT: 2 } : r));
    h.now = vn(2025, 11, 13, 22);
    await run(h);
    expect(h.mails).toHaveLength(2);
    expect(h.mails[1].html).toContain("Huế: <strong>");
    expect(h.mails[1].html).not.toContain("Hà Nội: <strong>");
    expect(h.mails[1].html).not.toContain("Đà Nẵng: <strong>");
  });

  it("tên nhóm giống thuộc tính đặc biệt không làm hỏng trạng thái", async () => {
    const h = harness([rule({}, { groupBy: "Tỉnh" }, pg)], [row("2025-11-13", 1, { Tỉnh: "__proto__" })], vn(2025, 11, 13, 22));
    await run(h);
    expect(h.mails).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call([...h.rules.values()][0].group_state, "__proto__")).toBe(true);
  });
});

describe("luật 'không có dữ liệu mới trong X giờ' (cron)", () => {
  const stale = (over: Partial<RuleRow> = {}) => rule({ name: "Dữ liệu ngừng cập nhật", ...over }, { window: "all", dateColumn: undefined }, { type: "stale", hours: 24 });
  const NOW = vn(2025, 11, 13, 12);

  it("dữ liệu cũ hơn X giờ → gửi; còn mới → không", async () => {
    const h = harness([stale()], [], NOW);
    h.changedAt = new Date(NOW.getTime() - 30 * 3_600_000).toISOString();
    const s = await evaluateStaleRules(h.deps);
    expect(s).toMatchObject({ evaluated: 1, notified: 1 });
    expect(h.mails[0].subject).toBe("[Cảnh báo · Alert] Dữ liệu ngừng cập nhật");
    expect(h.mails[0].html).toContain("Không có dữ liệu mới trong 24 giờ");
    expect(h.mails[0].html).toContain("30 giờ");
    expect(h.mails[0].images).toBeUndefined();

    const fresh = harness([stale()], [], NOW);
    fresh.changedAt = new Date(NOW.getTime() - 2 * 3_600_000).toISOString();
    expect((await evaluateStaleRules(fresh.deps)).notified).toBe(0);
    expect([...fresh.rules.values()][0].last_state).toBe("ok");
  });

  it("gọi lại ngay không gửi thêm; có dữ liệu mới thì trở lại ok", async () => {
    const h = harness([stale({ notify_recover: true })], [], NOW);
    h.changedAt = new Date(NOW.getTime() - 30 * 3_600_000).toISOString();
    await evaluateStaleRules(h.deps);
    h.now = new Date(NOW.getTime() + 600_000);
    await evaluateStaleRules(h.deps);
    expect(h.mails).toHaveLength(1);
    h.changedAt = new Date(NOW.getTime() + 300_000).toISOString();
    h.now = new Date(NOW.getTime() + 1_200_000);
    await evaluateStaleRules(h.deps);
    expect(h.mails).toHaveLength(2);
    expect(h.mails[1].subject).toBe("[Đã bình thường · Back to normal] Dữ liệu ngừng cập nhật");
  });

  it("chưa biết lúc dữ liệu đổi: chưa đủ dữ liệu, không gửi", async () => {
    const h = harness([stale()], [], NOW);
    h.changedAt = null;
    await evaluateStaleRules(h.deps);
    expect(h.mails).toEqual([]);
    expect([...h.rules.values()][0].last_state).toBe("insufficient");
  });

  it("luật stale không bị chạy khi đồng bộ, luật thường không bị chạy trong cron", async () => {
    const st = stale();
    const th = rule();
    const h = harness([st, th], LOW, NOW);
    h.changedAt = new Date(NOW.getTime() - 100 * 3_600_000).toISOString();
    await evaluateAlertsForSource("s", h.deps);
    expect(h.mails.map((m) => m.subject)).toEqual(["[Cảnh báo · Alert] Doanh thu thấp"]);
    h.now = new Date(NOW.getTime() + 60_000);
    await evaluateStaleRules(h.deps);
    expect(h.mails.map((m) => m.subject)).toEqual(["[Cảnh báo · Alert] Doanh thu thấp", "[Cảnh báo · Alert] Dữ liệu ngừng cập nhật"]);
  });

  it("nguồn của luật stale không thuộc dashboard → lỗi", async () => {
    const h = harness([stale()], [], NOW);
    h.ctx = ctxOf({ sources: [] });
    await evaluateStaleRules(h.deps);
    expect([...h.rules.values()][0].last_state).toBe("error");
  });
});

describe("processRule trực tiếp", () => {
  it("trả kết quả mô tả: trạng thái, loại thư, số thư gửi", async () => {
    const h = harness([rule()], LOW, vn(2025, 11, 13, 22));
    const r = [...h.rules.values()][0];
    expect(await processRule(r, h.deps)).toMatchObject({ ruleId: r.id, state: "firing", notify: "fire", sent: 1 });
  });
});
