import { describe, expect, it } from "vitest";
import { Dashboard } from "@dashboard/schema";
import { runQuery, type Row } from "@dashboard/chart-engine";
import type { MailMessage, SendResult } from "@/lib/server/mail";
import type { ProviderOutcome } from "@/lib/server/ai/types";
import type { ComposeDeps } from "./compose";
import { RETRY_MARKER, runDueReports, type DueSub, type FinishPatch, type LogEntry, type RunDeps } from "./run-due";

const NOW = new Date("2025-11-03T02:00:00Z");
const rows: Row[] = [
  { Ngày: "2025-09-05", Tỉnh: "Hà Nội", "Doanh thu": 100 },
  { Ngày: "2025-10-02", Tỉnh: "Hà Nội", "Doanh thu": 400 },
];
const sum = { column: "Doanh thu", aggregation: "sum" as const };
const doc = Dashboard.parse({
  schemaVersion: 1, id: "d", name: "D", canvas: { width: 1000, height: 600, background: "#fff" },
  sources: [{ id: "s", type: "google_sheets", spreadsheetId: "x", sheetName: "T", columns: [{ name: "Ngày", type: "date" }, { name: "Tỉnh", type: "string" }, { name: "Doanh thu", type: "number" }] }],
  widgets: [{ id: "k1", x: 0, y: 0, w: 300, h: 100, config: { kind: "kpi", sourceId: "s", metric: sum, title: "Doanh thu" } }],
});
// Kỳ này 400, kỳ trước 100 → +300%.
const GOOD = { executiveSummary: "Doanh thu đạt 400, tăng 300% so với kỳ trước.", highlights: [], concerns: [], analysis: "", actions: [] };

const sub = (id: string, over: Partial<DueSub> = {}): DueSub => ({
  id, dashboard_id: "dash", recipient_email: `${id}@example.com`, recipient_name: id.toUpperCase(), prompt: "",
  frequency: "monthly", weekday: null, month_day: 3, hour_vn: 9, widget_ids: [], include_images: false, link_mode: "login", last_error: null, ...over,
});

interface H { deps: RunDeps; sent: MailMessage[]; logs: LogEntry[]; finished: [string, FinishPatch][]; chatCalls: number; order: string[] }

function harness(subs: DueSub[], over: Partial<RunDeps> = {}, sendResult: (m: MailMessage) => SendResult | Promise<SendResult> = () => ({ ok: true })): H {
  const h: H = { sent: [], logs: [], finished: [], chatCalls: 0, order: [], deps: undefined as unknown as RunDeps };
  const compose: ComposeDeps = {
    loadDashboard: async () => ({ id: "dash", name: "Doanh số", doc, ownerId: "owner", updatedAt: null }),
    exec: async (_i, spec) => runQuery(rows, spec),
    chat: () => async (): Promise<ProviderOutcome> => {
      h.chatCalls++;
      const line = JSON.stringify({ t: "tool", id: "c", name: "write_report", args: JSON.stringify(GOOD) }) + "\n";
      return { ok: true, provider: "groq", stream: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(line)); c.close(); } }) };
    },
    viewToken: async () => "TOK",
    origin: "https://cerno.cloud",
  };
  h.deps = {
    compose,
    claim: async () => subs,
    isOptedOut: async () => false,
    send: async (m) => { h.order.push(m.to); h.sent.push(m); return sendResult(m); },
    log: async (e) => { h.logs.push(e); },
    finish: async (id, p) => { h.finished.push([id, p]); },
    unsubscribeLinks: (s) => ({ pageUrl: `https://cerno.cloud/unsubscribe?t=${s.id}`, apiUrl: `https://cerno.cloud/api/unsubscribe?t=${s.id}` }),
    now: () => NOW,
    ...over,
  };
  return h;
}

describe("runDueReports", () => {
  it("gửi cho từng người nhận, tuần tự, đúng thư và tiêu đề List-Unsubscribe một chạm", async () => {
    const h = harness([sub("an"), sub("binh")]);
    const r = await runDueReports(h.deps);
    expect(r).toEqual({ claimed: 2, sent: 2, failed: 0, skipped: 0 });
    expect(h.order).toEqual(["an@example.com", "binh@example.com"]);
    const m = h.sent[0];
    expect(m.subject).toBe("[Cerno] Doanh số · Tháng 10/2025");
    expect(m.html).toContain("Kính gửi anh/chị AN,");
    expect(m.html).toContain("https://cerno.cloud/unsubscribe?t=an");
    expect(m.text).toContain("Huỷ nhận email này: https://cerno.cloud/unsubscribe?t=an");
    expect(m.headers).toEqual({
      "List-Unsubscribe": "<https://cerno.cloud/api/unsubscribe?t=an>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("ghi nhật ký 'sent' có meta AI/ảnh, và đặt lịch kỳ sau (nextRunAt) + last_sent_at", async () => {
    const h = harness([sub("an")]);
    await runDueReports(h.deps);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({ kind: "report", ref_id: "an", dashboard_id: "dash", recipient: "an@example.com", status: "sent" });
    expect(h.logs[0].meta).toMatchObject({ ai: { used: true }, images: 0, linkFallback: false });
    expect(JSON.stringify(h.logs[0])).not.toContain("Doanh thu đạt"); // không ghi nội dung báo cáo vào nhật ký
    const [id, patch] = h.finished[0];
    expect(id).toBe("an");
    expect(patch).toMatchObject({ last_sent_at: NOW.toISOString(), last_error: null });
    // 02:00Z 3/11/2025 = 09:00 VN đúng giờ gửi, ngày 3 → kỳ sau là 3/12/2025 09:00 VN = 02:00Z
    expect(patch.next_run_at).toBe("2025-12-03T02:00:00.000Z");
  });

  it("người nhận cùng yêu cầu dùng chung một bài AI trong cùng lượt chạy", async () => {
    const h = harness([sub("an"), sub("binh"), sub("chi", { prompt: "Khác" })]);
    await runDueReports(h.deps);
    expect(h.chatCalls).toBe(2); // an+binh chung, chi riêng
  });

  it("người đã huỷ nhận: bỏ qua, ghi 'skipped', tắt đăng ký, không gửi", async () => {
    const h = harness([sub("an"), sub("binh")], { isOptedOut: async (e) => e.startsWith("an") });
    const r = await runDueReports(h.deps);
    expect(r).toMatchObject({ sent: 1, skipped: 1 });
    expect(h.sent.map((m) => m.to)).toEqual(["binh@example.com"]);
    expect(h.logs.find((l) => l.recipient === "an@example.com")).toMatchObject({ status: "skipped", meta: { reason: "optout" } });
    expect(h.finished.find(([id]) => id === "an")?.[1]).toEqual({ enabled: false, next_run_at: null });
  });

  it("chưa cấu hình link huỷ nhận thì KHÔNG gửi", async () => {
    const h = harness([sub("an")], { unsubscribeLinks: () => null });
    const r = await runDueReports(h.deps);
    expect(r.failed).toBe(1);
    expect(h.sent).toEqual([]);
    expect(h.logs[0]).toMatchObject({ status: "failed", error: "Chưa cấu hình UNSUBSCRIBE_SECRET" });
  });

  it("dashboard không còn tồn tại: tắt đăng ký, không thử lại", async () => {
    const h = harness([sub("an")]);
    h.deps.compose.loadDashboard = async () => null;
    await runDueReports(h.deps);
    expect(h.finished[0][1]).toMatchObject({ enabled: false, next_run_at: null, last_error: "Dashboard không còn tồn tại." });
    expect(h.sent).toEqual([]);
  });

  it("gửi mail lỗi tạm thời: thử lại sau 1 giờ; lỗi lần hai: đợi kỳ sau", async () => {
    const fail = () => ({ ok: false as const, code: "send_failed" as const });
    const h1 = harness([sub("an")], {}, fail);
    await runDueReports(h1.deps);
    expect(h1.finished[0][1]).toMatchObject({ last_error: RETRY_MARKER, next_run_at: "2025-11-03T03:00:00.000Z" });
    expect(h1.logs[0]).toMatchObject({ status: "failed", error: "Không gửi được email." });

    const h2 = harness([sub("an", { last_error: RETRY_MARKER })], {}, fail);
    await runDueReports(h2.deps);
    expect(h2.finished[0][1]).toMatchObject({ last_error: "Không gửi được email.", next_run_at: "2025-12-03T02:00:00.000Z" });
  });

  it("chưa cấu hình SMTP: không thử lại ngay, đợi kỳ sau", async () => {
    const h = harness([sub("an")], {}, () => ({ ok: false, code: "not_configured" }));
    await runDueReports(h.deps);
    expect(h.finished[0][1]).toMatchObject({ last_error: "Máy chủ chưa cấu hình gửi email.", next_run_at: "2025-12-03T02:00:00.000Z" });
  });

  it("một người lỗi bất ngờ (ném lỗi) không làm hỏng người sau", async () => {
    let n = 0;
    const h = harness([sub("an"), sub("binh")], {}, () => {
      if (n++ === 0) throw new Error("SMTP sập");
      return { ok: true };
    });
    const r = await runDueReports(h.deps);
    expect(r).toMatchObject({ sent: 1, failed: 1 });
    expect(h.logs.map((l) => l.status)).toEqual(["failed", "sent"]);
    expect(h.finished[0][1].last_error).toBe("SMTP sập");
  });

  it("không ghi được trạng thái cũng không ném ra ngoài", async () => {
    const h = harness([sub("an")], { finish: async () => { throw new Error("DB chết"); } });
    await expect(runDueReports(h.deps)).resolves.toMatchObject({ sent: 0 });
  });

  it("chỉ nhận tối đa 20 đăng ký mỗi lượt", async () => {
    let asked = 0;
    const h = harness([], { claim: async (n) => { asked = n; return []; } });
    await runDueReports(h.deps, 500);
    expect(asked).toBe(20);
    await runDueReports(h.deps, 0);
    expect(asked).toBe(1);
  });

  it("không có đăng ký nào đến hạn", async () => {
    const h = harness([]);
    expect(await runDueReports(h.deps)).toEqual({ claimed: 0, sent: 0, failed: 0, skipped: 0 });
  });
});
