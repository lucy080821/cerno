import { describe, expect, it } from "vitest";
import { Dashboard } from "@dashboard/schema";
import { runQuery, type Row } from "@dashboard/chart-engine";
import type { ProviderOutcome } from "@/lib/server/ai/types";
import { composeReport, createComposeCaches, type ComposeDeps, type LoadedDashboard, type ReportConfig } from "./compose";
import type { Executor } from "./facts";

const NOW = new Date("2025-11-03T01:00:00Z"); // báo cáo tháng 10/2025
const rows: Row[] = [
  { Ngày: "2025-09-05", Tỉnh: "Hà Nội", "Doanh thu": 100 },
  { Ngày: "2025-09-20", Tỉnh: "Đà Nẵng", "Doanh thu": 350 },
  { Ngày: "2025-10-02", Tỉnh: "Hà Nội", "Doanh thu": 400 },
  { Ngày: "2025-10-15", Tỉnh: "Đà Nẵng", "Doanh thu": 300 },
];
const sum = { column: "Doanh thu", aggregation: "sum" as const };
const box = { x: 0, y: 0, w: 400, h: 200 };
const doc = Dashboard.parse({
  schemaVersion: 1, id: "d", name: "Doanh số", canvas: { width: 1000, height: 600, background: "#fff" },
  sources: [{ id: "s", type: "google_sheets", spreadsheetId: "x", sheetName: "T", columns: [{ name: "Ngày", type: "date" }, { name: "Tỉnh", type: "string" }, { name: "Doanh thu", type: "number" }] }],
  widgets: [
    { id: "k1", ...box, config: { kind: "kpi", sourceId: "s", metric: sum, title: "Doanh thu" } },
    { id: "c1", ...box, y: 100, config: { kind: "chart", chartType: "bar", sourceId: "s", dimensions: [{ column: "Tỉnh" }], metrics: [sum], title: "Theo tỉnh" } },
  ],
});
// Kỳ này 700, kỳ trước 450 → +55,6%.
const GOOD = {
  executiveSummary: "Doanh thu đạt 700, tăng 55,6% so với kỳ trước.",
  highlights: ["Hà Nội dẫn đầu."], concerns: [], analysis: "", actions: ["Duy trì đà tăng."],
};

function streamOutcome(body: unknown): ProviderOutcome {
  const line = JSON.stringify({ t: "tool", id: "c", name: "write_report", args: JSON.stringify(body) }) + "\n";
  return { ok: true, provider: "groq", stream: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(line)); c.close(); } }) };
}

interface Harness { deps: ComposeDeps; chatCalls: number; execCalls: number; loads: number }
function harness(over: Partial<ComposeDeps> = {}, chatBody: unknown = GOOD, loaded: LoadedDashboard | null = {
  id: "dash", name: "Doanh số tháng", doc, ownerId: "owner-1", updatedAt: "2025-11-03T00:00:00Z",
}): Harness {
  const h: Harness = { chatCalls: 0, execCalls: 0, loads: 0, deps: undefined as unknown as ComposeDeps };
  const exec: Executor = async (_i, spec) => { h.execCalls++; return runQuery(rows, spec); };
  h.deps = {
    async loadDashboard() { h.loads++; return loaded; },
    exec,
    chat: () => async () => { h.chatCalls++; return streamOutcome(chatBody); },
    viewToken: async () => "TOKEN123",
    origin: "https://cerno.cloud",
    ...over,
  };
  return h;
}

const cfg: ReportConfig = { frequency: "monthly", recipient_name: "An", prompt: "", widget_ids: [], include_images: true, link_mode: "view_link" };
const opts = () => ({ now: NOW, caches: createComposeCaches(), unsubscribeUrl: "https://cerno.cloud/unsubscribe?t=abc" });

describe("composeReport", () => {
  it("ráp báo cáo đầy đủ: số liệu, bài AI đã qua kiểm số, ảnh, link xem, link huỷ nhận", async () => {
    const h = harness();
    const r = await composeReport(h.deps, "dash", cfg, opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.email.subject).toBe("[Cerno] Doanh số tháng · Tháng 10/2025");
    expect(r.email.html).toContain("Kính gửi anh/chị An,");
    expect(r.email.html).toContain("Doanh thu đạt 700, tăng 55,6%");
    expect(r.email.html).toContain("▲ +55,6%");
    expect(r.email.html).toContain('href="https://cerno.cloud/view/TOKEN123"');
    expect(r.email.html).toContain('href="https://cerno.cloud/unsubscribe?t=abc"');
    expect(r.images).toHaveLength(1); // chỉ biểu đồ tự chọn; KPI không tự thành ảnh
    expect(r.images[0]).toMatchObject({ contentType: "image/png", cid: "chart-1@cerno.report" });
    expect(r.email.html).toContain("cid:chart-1@cerno.report");
    expect(r.ownerId).toBe("owner-1");
    expect(r.meta).toMatchObject({ ai: { used: true, attempts: 1, provider: "groq" }, images: 1, linkFallback: false });
  });

  it("chọn widget và tắt ảnh", async () => {
    const h = harness();
    const withKpi = await composeReport(h.deps, "dash", { ...cfg, widget_ids: ["k1", "c1"] }, opts());
    expect(withKpi.ok && withKpi.images.map((i) => i.cid)).toEqual(["chart-1@cerno.report", "chart-2@cerno.report"]);
    const none = await composeReport(h.deps, "dash", { ...cfg, include_images: false }, opts());
    expect(none.ok && none.images).toEqual([]);
    expect(none.ok && none.email.html).not.toContain("cid:");
  });

  it("số trong bài AI lệch → bỏ phần AI, vẫn gửi bảng số + ghi chú + meta nêu số lệch", async () => {
    const h = harness({}, { ...GOOD, executiveSummary: "Doanh thu đạt 999." });
    const r = await composeReport(h.deps, "dash", cfg, opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.email.html).not.toContain("Tóm tắt điều hành");
    expect(r.email.html).toContain("Chỉ số chính");
    expect(r.email.html).toContain("Phần phân tích bằng AI không có trong báo cáo này.");
    expect(r.meta.ai).toMatchObject({ used: false, reason: "numbers_mismatch", unverified: ["999"] });
    expect(h.chatCalls).toBe(2); // lần đầu + viết lại một lần
  });

  it("AI lỗi → vẫn có báo cáo không có phần AI", async () => {
    const h = harness({ chat: () => async () => ({ ok: false, provider: "groq", status: 429, body: { error: "Hết hạn mức" }, fallbackable: false }) });
    const r = await composeReport(h.deps, "dash", cfg, opts());
    expect(r.ok && r.meta.ai).toMatchObject({ used: false, reason: "ai_error", detail: "Hết hạn mức" });
    expect(r.ok && r.email.html).toContain("Chỉ số chính");
  });

  it("gói không cho dùng AI → không gọi AI", async () => {
    const h = harness({ aiAllowed: async () => false });
    const r = await composeReport(h.deps, "dash", cfg, opts());
    expect(h.chatCalls).toBe(0);
    expect(r.ok && r.meta.ai).toEqual({ used: false, reason: "not_allowed" });
  });

  it("chưa bật link xem → dùng link đăng nhập và ghi chú; link_mode=login luôn dùng /d/<id>", async () => {
    const h = harness({ viewToken: async () => null });
    const a = await composeReport(h.deps, "dash", cfg, opts());
    expect(a.ok && a.email.html).toContain('href="https://cerno.cloud/d/dash"');
    expect(a.ok && a.email.html).toContain("chưa bật link xem");
    expect(a.ok && a.meta.linkFallback).toBe(true);
    const b = await composeReport(harness().deps, "dash", { ...cfg, link_mode: "login" }, opts());
    expect(b.ok && b.email.html).toContain('href="https://cerno.cloud/d/dash"');
    expect(b.ok && b.meta.linkFallback).toBe(false);
  });

  it("dashboard không còn tồn tại / dữ liệu hỏng → lỗi rõ ràng, không ném", async () => {
    const gone = await composeReport(harness({}, GOOD, null).deps, "dash", cfg, opts());
    expect(gone).toEqual({ ok: false, error: "Dashboard không còn tồn tại." });
    const bad = await composeReport(harness({}, GOOD, { id: "d", name: "x", doc: { sai: true }, ownerId: "o", updatedAt: null }).deps, "dash", cfg, opts());
    expect(bad).toEqual({ ok: false, error: "Dữ liệu dashboard không hợp lệ." });
  });

  it("người nhận cùng yêu cầu dùng chung bài AI, số liệu và ảnh (chỉ tính một lần)", async () => {
    const h = harness();
    const o = opts();
    const a = await composeReport(h.deps, "dash", { ...cfg, recipient_name: "An" }, o);
    const execAfterFirst = h.execCalls;
    const b = await composeReport(h.deps, "dash", { ...cfg, recipient_name: "Bình" }, o);
    expect(h.chatCalls).toBe(1);
    expect(h.loads).toBe(1);
    expect(h.execCalls).toBe(execAfterFirst); // không truy vấn lại
    expect(a.ok && a.email.html).toContain("Kính gửi anh/chị An,");
    expect(b.ok && b.email.html).toContain("Kính gửi anh/chị Bình,"); // lời chào riêng dù dùng chung bài
    expect(b.ok && b.images[0].content).toBe(a.ok ? a.images[0].content : null); // cùng ảnh
  });

  it("yêu cầu khác nhau thì viết bài riêng", async () => {
    const h = harness();
    const o = opts();
    await composeReport(h.deps, "dash", { ...cfg, prompt: "Tập trung Hà Nội" }, o);
    await composeReport(h.deps, "dash", { ...cfg, prompt: "Ngắn gọn" }, o);
    expect(h.chatCalls).toBe(2);
  });

  it("tần suất khác nhau cho kỳ khác nhau (tuần ≠ tháng)", async () => {
    const h = harness();
    const r = await composeReport(h.deps, "dash", { ...cfg, frequency: "weekly" }, opts());
    expect(r.ok && r.email.subject).toContain("Tuần 27/10 – 02/11/2025");
  });
});
