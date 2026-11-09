import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Giả lập DB cho quota: ghi lại các lần gọi RPC.
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { costMicro, mapAnthropicError, toAnthropicMessages, toAnthropicTools } from "./anthropic";
import { quotaLimits, QUOTA_MESSAGES, recordPaid, releasePaid, reservePaid } from "./quota";
import { estimateUsage, parseOrder, routeChat, type RouterDeps } from "./router";
import type { ChatMessage, ProviderOutcome, ProviderRequest } from "./types";

const req: ProviderRequest = { system: "sys", messages: [{ role: "user", content: "xin chào" }], tools: null };
const stream = () => new ReadableStream<Uint8Array>();
const ok = (provider: "groq" | "anthropic"): ProviderOutcome => ({ ok: true, provider, stream: stream() });
const bad = (provider: "groq" | "anthropic", status: number, body: Record<string, unknown>, fallbackable = true): ProviderOutcome => ({
  ok: false, provider, status, body, fallbackable,
});

describe("chi phí Anthropic", () => {
  it("Haiku 5.5: 1 triệu token vào + 1 triệu token ra = 0,60 USD", () => {
    expect(costMicro("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(600_000);
  });
  it("Sonnet 5.5 đắt gấp 20 lần ở phần vào", () => {
    expect(costMicro("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(2_000_000);
  });
  it("ghi cache đắt hơn 25%, đọc cache rẻ hơn 90%", () => {
    const u = { input_tokens: 0, output_tokens: 0 };
    expect(costMicro("claude-haiku-5-5", { ...u, cache_creation_input_tokens: 1_000_000 })).toBe(125_000);
    expect(costMicro("claude-haiku-5-5", { ...u, cache_read_input_tokens: 1_000_000 })).toBe(10_000);
  });
  it("model lạ tính theo giá cao nhất để không đánh giá thấp chi phí", () => {
    expect(costMicro("model-la", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(10_000_000);
  });
  it("lượt hỏi điển hình rất rẻ (< 0,003 USD)", () => {
    expect(costMicro("claude-haiku-5-5", { input_tokens: 16_000, output_tokens: 1_500 })).toBeLessThan(3000);
  });
});

describe("đổi hội thoại sang định dạng Anthropic", () => {
  const convo: ChatMessage[] = [
    { role: "user", content: "vẽ pie chart" },
    { role: "assistant", content: "Để mình vẽ.", tool_calls: [
      { id: "call_1", name: "show_chart", arguments: '{"chartType":"pie"}' },
      { id: "call_2", name: "add_filter", arguments: "không phải json" },
    ] },
    { role: "tool", tool_call_id: "call_1", content: "OK: đã vẽ" },
    { role: "tool", tool_call_id: "call_2", content: "LỖI: cột không tồn tại" },
  ];

  it("lệnh công cụ thành tool_use, các kết quả liên tiếp gộp vào MỘT tin user", () => {
    const m = toAnthropicMessages(convo);
    expect(m).toHaveLength(3);
    expect(m[1].role).toBe("assistant");
    const blocks = m[1].content as Anthropic.ContentBlockParam[];
    expect(blocks[0]).toMatchObject({ type: "text", text: "Để mình vẽ." });
    expect(blocks[1]).toMatchObject({ type: "tool_use", id: "call_1", name: "show_chart", input: { chartType: "pie" } });
    expect(blocks[2]).toMatchObject({ type: "tool_use", id: "call_2", input: {} }); // JSON hỏng thì input rỗng, không ném lỗi
    const results = m[2].content as Anthropic.ToolResultBlockParam[];
    expect(m[2].role).toBe("user");
    expect(results.map((r) => [r.tool_use_id, r.is_error])).toEqual([["call_1", false], ["call_2", true]]);
  });

  it("bỏ tin trợ lý rỗng, gộp các tin user liên tiếp", () => {
    const m = toAnthropicMessages([
      { role: "user", content: "a" }, { role: "assistant", content: "  " }, { role: "user", content: "b" },
    ]);
    expect(m).toHaveLength(1);
    expect((m[0].content as unknown[]).length).toBe(2);
  });

  it("input của tool_use luôn là object (mảng/số/chuỗi JSON đều thành {})", () => {
    for (const args of ["[1,2]", "5", '"x"', "null", ""]) {
      const m = toAnthropicMessages([{ role: "assistant", content: "", tool_calls: [{ id: "c", name: "t", arguments: args }] }]);
      expect((m[0].content as Array<{ input: unknown }>)[0].input).toEqual({});
    }
  });

  it("đổi định nghĩa công cụ OpenAI sang input_schema", () => {
    const t = toAnthropicTools([{ type: "function", function: { name: "x", description: "d", parameters: { type: "object", properties: {}, required: [] } } }]);
    expect(t).toEqual([{ name: "x", description: "d", input_schema: { type: "object", properties: {}, required: [] } }]);
  });
});

describe("mapAnthropicError", () => {
  const api = (status: number, message: string, headers: Record<string, string> = {}) =>
    Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message } }, message, new Headers(headers));

  it("429 → chờ rồi thử lại, kèm retry-after", () => {
    const r = mapAnthropicError(api(429, "rate", { "retry-after": "12" }));
    expect(r.status).toBe(429);
    expect(r.body.retryAfter).toBe(12);
    expect(r.fallbackable).toBe(true);
  });
  it("hết số dư (400 credit balance) → 503 thân thiện, cho phép thử nhà khác", () => {
    const r = mapAnthropicError(api(400, "Your credit balance is too low to access the API"));
    expect(r.status).toBe(503);
    expect(String(r.body.error)).toContain("hết số dư");
    expect(r.fallbackable).toBe(true);
  });
  it("khoá sai (401) → báo cấu hình; 400 khác là lỗi của yêu cầu, không thử nhà khác", () => {
    expect(mapAnthropicError(api(401, "invalid x-api-key")).status).toBe(503);
    expect(mapAnthropicError(api(400, "messages.0: bad")).fallbackable).toBe(false);
  });
  it("5xx / quá tải / lỗi mạng → thử nhà khác, không lộ chi tiết", () => {
    for (const e of [api(529, "overloaded"), api(500, "boom"), new Error("ECONNRESET")]) {
      const r = mapAnthropicError(e);
      expect(r.status).toBe(502);
      expect(r.fallbackable).toBe(true);
      expect(JSON.stringify(r.body)).not.toMatch(/boom|ECONNRESET|overloaded/);
    }
  });
});

describe("parseOrder", () => {
  it("mặc định groq rồi anthropic; bỏ giá trị lạ và trùng", () => {
    expect(parseOrder(undefined)).toEqual(["groq", "anthropic"]);
    expect(parseOrder("Anthropic, groq, anthropic, openai")).toEqual(["anthropic", "groq"]);
    expect(parseOrder("???")).toEqual(["groq", "anthropic"]);
    expect(parseOrder("groq")).toEqual(["groq"]);
  });
});

describe("routeChat: Groq miễn phí trước, Anthropic làm đường lui", () => {
  const reserve = vi.fn<RouterDeps["reserve"]>();
  const release = vi.fn<RouterDeps["release"]>();
  const record = vi.fn<RouterDeps["record"]>();
  const groq = vi.fn<NonNullable<RouterDeps["groq"]>>();
  const anthropic = vi.fn<NonNullable<RouterDeps["anthropic"]>>();
  const deps = (over: Partial<RouterDeps> = {}): RouterDeps => ({
    groq, anthropic, order: ["groq", "anthropic"], reserve, release, record, quotaMessages: QUOTA_MESSAGES, ...over,
  });

  beforeEach(() => {
    for (const f of [reserve, release, record, groq, anthropic]) f.mockReset();
    reserve.mockResolvedValue("ok");
    release.mockResolvedValue();
    record.mockResolvedValue();
  });

  it("Groq chạy được thì dùng Groq, không đụng tới quota hay Anthropic", async () => {
    groq.mockResolvedValue(ok("groq"));
    const r = await routeChat("u1", req, deps());
    expect(r.ok && r.provider).toBe("groq");
    expect(reserve).not.toHaveBeenCalled();
    expect(anthropic).not.toHaveBeenCalled();
  });

  it.each([
    ["hết hạn mức (429)", 429, { error: "x", retryAfter: 14 }],
    ["quá lớn (413)", 413, { error: "x", tooLarge: true }],
    ["lệnh sai định dạng", 502, { error: "x", retry: true }],
    ["lỗi chung", 502, { error: "x" }],
  ])("Groq %s → chuyển sang Anthropic và ghi chi phí", async (_n, status, body) => {
    groq.mockResolvedValue(bad("groq", status, body));
    anthropic.mockImplementation(async (_r, onUsage) => {
      onUsage({ input_tokens: 10_000, output_tokens: 1_000 }, "claude-haiku-5-5");
      return ok("anthropic");
    });
    const r = await routeChat("u1", req, deps());
    expect(r.ok && r.provider).toBe("anthropic");
    expect(reserve).toHaveBeenCalledWith("u1");
    expect(record).toHaveBeenCalledWith("u1", 10_000, 1_000, 1_000 + 500); // 10k*0,1 + 1k*0,5 micro-USD
  });

  it("hết lượt ngày thì không gọi Anthropic và báo lý do kèm lỗi của Groq (để client vẫn tự chờ Groq)", async () => {
    groq.mockResolvedValue(bad("groq", 429, { error: "Dịch vụ AI đang quá tải.", retryAfter: 10 }));
    reserve.mockResolvedValue("daily");
    const r = await routeChat("u1", req, deps());
    expect(anthropic).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(429);
    expect(r.body.retryAfter).toBe(10);
    expect(r.body.quota).toBe("daily");
    expect(String(r.body.error)).toContain("hết lượt AI nâng cao của hôm nay");
  });

  it("chỉ có Anthropic mà hết ngân sách → 429 với thông báo rõ", async () => {
    reserve.mockResolvedValue("budget");
    const r = await routeChat("u1", req, deps({ groq: undefined }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(429);
    expect(r.body.quota).toBe("budget");
  });

  it("Anthropic lỗi sau khi giữ chỗ thì trả lại lượt cho người dùng", async () => {
    groq.mockResolvedValue(bad("groq", 429, { error: "g" }));
    anthropic.mockResolvedValue(bad("anthropic", 503, { error: "hết số dư" }));
    const r = await routeChat("u1", req, deps());
    expect(release).toHaveBeenCalledWith("u1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.body.error).toBe("hết số dư");
  });

  it("lỗi của chính yêu cầu (không fallbackable) thì dừng, không thử nhà khác", async () => {
    anthropic.mockResolvedValue(bad("anthropic", 502, { error: "từ chối" }, false));
    const r = await routeChat("u1", req, deps({ order: ["anthropic", "groq"] }));
    expect(groq).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });

  it("thứ tự anthropic,groq: hết lượt thì rơi về Groq miễn phí", async () => {
    reserve.mockResolvedValue("monthly");
    groq.mockResolvedValue(ok("groq"));
    const r = await routeChat("u1", req, deps({ order: ["anthropic", "groq"] }));
    expect(r.ok && r.provider).toBe("groq");
    expect(anthropic).not.toHaveBeenCalled();
  });

  it("không cấu hình nhà cung cấp nào → 503", async () => {
    const r = await routeChat("u1", req, deps({ groq: undefined, anthropic: undefined }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it("cuộc gọi bị ngắt (không có số token thật) vẫn ghi chi phí ước lượng, không ghi 0", async () => {
    groq.mockResolvedValue(bad("groq", 429, { error: "g" }));
    anthropic.mockImplementation(async (_r, onUsage) => {
      onUsage(null, "claude-haiku-5-5");
      return ok("anthropic");
    });
    await routeChat("u1", { ...req, system: "x".repeat(12_000) }, deps());
    const [, input, output, cost] = record.mock.calls[0];
    expect(input).toBeGreaterThanOrEqual(5000);
    expect(output).toBeGreaterThan(0);
    expect(cost).toBeGreaterThan(0);
  });

  it("estimateUsage nghiêng về nhiều hơn khi có công cụ", () => {
    const a = estimateUsage(req).input_tokens;
    const b = estimateUsage({ ...req, tools: [] as never }).input_tokens;
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe("quota (gọi RPC của DB)", () => {
  beforeEach(() => {
    rpc.mockReset();
    delete process.env.AI_USER_DAILY_PAID;
    delete process.env.AI_USER_MONTHLY_PAID;
    delete process.env.AI_MONTHLY_BUDGET_USD;
  });

  it("giá trị mặc định: 5 lượt/ngày, 30 lượt/tháng, ngân sách 4 USD", () => {
    expect(quotaLimits()).toEqual({ daily: 5, monthly: 30, budgetMicro: 4_000_000 });
  });
  it("đổi bằng biến môi trường; giá trị sai thì dùng mặc định", () => {
    process.env.AI_USER_DAILY_PAID = "8";
    process.env.AI_MONTHLY_BUDGET_USD = "2.5";
    process.env.AI_USER_MONTHLY_PAID = "abc";
    expect(quotaLimits()).toEqual({ daily: 8, monthly: 30, budgetMicro: 2_500_000 });
  });
  it("reserve truyền đúng tham số và trả kết quả của DB", async () => {
    rpc.mockResolvedValue({ data: "ok", error: null });
    expect(await reservePaid("u1")).toBe("ok");
    expect(rpc).toHaveBeenCalledWith("ai_usage_reserve", { p_user: "u1", p_daily: 5, p_monthly: 30, p_budget_micro: 4_000_000 });
    for (const reason of ["daily", "monthly", "budget"] as const) {
      rpc.mockResolvedValue({ data: reason, error: null });
      expect(await reservePaid("u1")).toBe(reason);
    }
  });
  it("lỗi DB hoặc kết quả lạ thì TỪ CHỐI (đóng), không cho qua", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await reservePaid("u1")).toBe("error");
    rpc.mockResolvedValue({ data: "tuỳ ý", error: null });
    expect(await reservePaid("u1")).toBe("error");
  });
  it("record và release không ném lỗi dù DB lỗi", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(recordPaid("u1", 1, 2, 3)).resolves.toBeUndefined();
    await expect(releasePaid("u1")).resolves.toBeUndefined();
  });
});
