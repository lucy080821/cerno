import { describe, expect, it } from "vitest";
import { runQuery, type Row } from "@dashboard/chart-engine";
import type { RouterDeps } from "../ai/router";
import type { ProviderOutcome, ProviderRequest } from "../ai/types";
import { ChatCaller } from "./caller";
import { MAX_ROUNDS, runChat, type RunEvent } from "./run";
import type { SourceInfo } from "./sources";
import type { ToolDeps } from "./tools";

const rows: Row[] = [
  { Kênh: "Shopee", "Doanh thu": 100_000 },
  { Kênh: "Shopee", "Doanh thu": 300_000 },
  { Kênh: "TikTok Shop", "Doanh thu": 200_000 },
];
const sheet: SourceInfo = {
  alias: "s1", id: "11111111-1111-1111-1111-111111111111", name: "Sổ bán hàng", kind: "sheet",
  columns: [{ name: "Kênh", type: "string" }, { name: "Doanh thu", type: "number", unit: "đồng" }], rowCount: 3, syncedAt: null, workspaceId: "w",
};
const tools: ToolDeps = { query: async (_id, spec) => runQuery(rows, spec) };

type Step = { text?: string; calls?: { name: string; args: unknown }[] } | { fail: number; fallbackable?: boolean };
const stream = (events: object[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      // Cắt đôi một dòng để kiểm tra việc ghép dòng bị chia giữa hai đoạn.
      const all = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
      const mid = Math.floor(all.length / 2);
      c.enqueue(enc.encode(all.slice(0, mid)));
      c.enqueue(enc.encode(all.slice(mid)));
      c.close();
    },
  });

/** Nhà cung cấp giả chạy theo kịch bản; ghi lại các yêu cầu nhận được. */
function fakeProvider(name: "groq" | "anthropic", script: Step[], seen: ProviderRequest[]) {
  let i = 0;
  return async (req: ProviderRequest): Promise<ProviderOutcome> => {
    seen.push({ ...req, messages: [...req.messages] });
    const step = script[Math.min(i++, script.length - 1)];
    if ("fail" in step) return { ok: false, provider: name, status: step.fail, body: { error: `lỗi ${step.fail}` }, fallbackable: !!step.fallbackable };
    const ev: object[] = [];
    if (step.text) ev.push({ t: "text", v: step.text });
    (step.calls ?? []).forEach((c, k) => ev.push({ t: "tool", id: `c${i}_${k}`, name: c.name, args: JSON.stringify(c.args) }));
    return { ok: true, provider: name, stream: stream(ev) };
  };
}

function setup(script: Step[], opts: { reserve?: "ok" | "daily"; provider?: "groq" | "anthropic" } = {}) {
  const seen: ProviderRequest[] = [];
  const reserved: string[] = [];
  const provider = opts.provider ?? "anthropic";
  const fn = fakeProvider(provider, script, seen);
  const deps: RouterDeps = {
    ...(provider === "groq" ? { groq: fn } : { anthropic: (r) => fn(r) }),
    order: [provider],
    reserve: async (u) => { reserved.push(u); return opts.reserve ?? "ok"; },
    release: async () => {},
    record: async () => {},
    quotaMessages: { daily: "hết lượt ngày", monthly: "hết lượt tháng", budget: "hết ngân sách", error: "lỗi hạn mức" },
  };
  return { caller: new ChatCaller("u1", deps), seen, reserved };
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
const input = { history: [], question: "Doanh thu theo kênh?", sources: [sheet], lang: "vi" as const, now: new Date("2026-11-24T05:00:00Z") };

describe("runChat", () => {
  it("tra số liệu bằng công cụ rồi viết báo cáo, đã bỏ markdown", async () => {
    const { caller, seen, reserved } = setup([
      { text: "Để tôi tra cứu.", calls: [{ name: "query_data", args: { source: "s1", group_by: [{ column: "Kênh" }], metrics: [{ column: "Doanh thu", agg: "sum" }] } }] },
      { text: "**BÁO CÁO**: Doanh thu\n- Shopee: 400.000 đồng" },
    ]);
    const ev = await collect(runChat(input, { caller, tools }));
    expect(ev.map((e) => e.t)).toEqual(["text", "reset", "status", "text", "final"]);
    const final = ev.at(-1) as Extract<RunEvent, { t: "final" }>;
    expect(final.text).toBe("BÁO CÁO: Doanh thu\n- Shopee: 400.000 đồng");
    expect(final.meta).toMatchObject({ provider: "anthropic", tools: ["query_data"], rounds: 2 });
    // Vòng 2 phải nhận được kết quả công cụ có số liệu thật (400000 = Shopee).
    const second = seen[1].messages;
    expect(second.at(-1)).toMatchObject({ role: "tool" });
    expect((second.at(-1) as { content: string }).content).toContain("400000");
    // Prompt có ngày hôm nay (giờ VN) và mô tả nguồn.
    expect(seen[0].system).toContain("24/11/2026");
    expect(seen[0].system).toContain("Sổ bán hàng");
    // Chỉ giữ chỗ hạn mức một lần cho cả câu hỏi dù gọi AI hai vòng.
    expect(reserved).toHaveLength(1);
    expect(seen[0].maxTokens).toBeGreaterThan(2000);
  });

  it("vòng cuối không gửi công cụ để buộc AI kết luận", async () => {
    // AI cứ gọi công cụ mãi: tới vòng cuối phải bị buộc kết luận (không còn công cụ) rồi báo lỗi nếu vẫn không viết gì.
    const loop = Array.from({ length: MAX_ROUNDS + 2 }, () => ({ calls: [{ name: "sample_rows", args: { source: "s1" } }] }));
    const s2 = setup(loop);
    const ev = await collect(runChat(input, { caller: s2.caller, tools }));
    expect(ev.at(-1)).toMatchObject({ t: "error" });
    expect(s2.seen).toHaveLength(MAX_ROUNDS);
    expect(s2.seen.at(-1)!.tools).toBeNull();
    expect(s2.seen[0].tools).not.toBeNull();
  });

  it("công cụ báo lỗi thì AI nhận lại lý do để sửa tham số", async () => {
    const { caller, seen } = setup([
      { calls: [{ name: "query_data", args: { source: "s1", metrics: [{ column: "Không có", agg: "sum" }] } }] },
      { text: "Đã sửa" },
    ]);
    const ev = await collect(runChat(input, { caller, tools }));
    expect(ev.at(-1)).toMatchObject({ t: "final" });
    expect((seen[1].messages.at(-1) as { content: string }).content).toMatch(/^LỖI/);
  });

  it("hết hạn mức AI trả phí thì báo lỗi rõ ràng, không gọi nhà cung cấp", async () => {
    const { caller, seen } = setup([{ text: "x" }], { reserve: "daily" });
    const ev = await collect(runChat(input, { caller, tools }));
    expect(ev).toEqual([{ t: "error", message: "hết lượt ngày", status: 429 }]);
    expect(seen).toHaveLength(0);
  });

  it("lỗi nhà cung cấp được chuyển thành sự kiện lỗi", async () => {
    const { caller } = setup([{ fail: 502 }], { provider: "groq" });
    const ev = await collect(runChat(input, { caller, tools }));
    expect(ev[0]).toMatchObject({ t: "error", status: 502 });
  });

  it("trả lời rỗng thì báo lỗi thay vì lưu câu trả lời trống", async () => {
    const { caller } = setup([{ text: "   " }]);
    const ev = await collect(runChat(input, { caller, tools }));
    expect(ev.at(-1)).toMatchObject({ t: "error" });
  });

  it("giao diện tiếng Anh: lời nhắc bắt trả lời bằng tiếng Anh", async () => {
    const { caller, seen } = setup([{ text: "REPORT: ok" }]);
    await collect(runChat({ ...input, lang: "en" }, { caller, tools }));
    expect(seen[0].system).toContain("write the whole answer in English");
  });
});
