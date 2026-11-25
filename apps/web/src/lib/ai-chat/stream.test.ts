import { afterEach, describe, expect, it, vi } from "vitest";
import { streamAnswer, type StreamHandlers } from "./stream";

const body = (events: object[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      const all = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
      const mid = Math.floor(all.length / 2); // cắt đôi giữa một dòng
      c.enqueue(enc.encode(all.slice(0, mid)));
      c.enqueue(enc.encode(all.slice(mid)));
      c.close();
    },
  });

function recorder() {
  const log: string[] = [];
  const on: StreamHandlers = {
    onChat: (id, title) => log.push(`chat:${id}:${title}`),
    onStatus: (t) => log.push(`status:${t}`),
    onText: (c) => log.push(`text:${c}`),
    onReset: () => log.push("reset"),
    onVisual: (v) => log.push(`visual:${v.kind}`),
    onDone: (m) => log.push(`done:${m.content}`),
    onError: (m) => log.push(`error:${m}`),
  };
  return { log, on };
}
const req = { chatId: null, question: "hi", sourceIds: ["a"], lang: "vi" as const };
const msg = { id: "m", role: "assistant", content: "xong", meta: {}, createdAt: "" };

afterEach(() => vi.unstubAllGlobals());

describe("streamAnswer", () => {
  it("chuyển từng sự kiện theo thứ tự, kể cả dòng bị cắt đôi, và kết thúc bằng done", async () => {
    const chart = { kind: "kpi", cards: [{ label: "Lãi", value: 1, text: "1 đồng" }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body([{ t: "chat", id: "c1", title: "T" }, { t: "status", v: "Đang tính…" }, { t: "text", v: "Xin" }, { t: "reset" }, { t: "visual", visual: chart }, { t: "done", message: msg }]))));
    const { log, on } = recorder();
    await streamAnswer(req, on, new AbortController().signal);
    expect(log).toEqual(["chat:c1:T", "status:Đang tính…", "text:Xin", "reset", "visual:kpi", "done:xong"]);
  });

  it("AI báo lỗi: đúng một lần onError, bỏ qua sự kiện sau đó", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body([{ t: "error", message: "hết lượt" }, { t: "text", v: "thừa" }]))));
    const { log, on } = recorder();
    await streamAnswer(req, on, new AbortController().signal);
    expect(log).toEqual(["error:hết lượt"]);
  });

  it("HTTP lỗi lấy thông báo của máy chủ", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Bạn hỏi quá nhanh" }), { status: 429 })));
    const { log, on } = recorder();
    await streamAnswer(req, on, new AbortController().signal);
    expect(log).toEqual(["error:Bạn hỏi quá nhanh"]);
  });

  it("luồng hết mà chưa có done thì báo gián đoạn", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body([{ t: "text", v: "dở" }]))));
    const { log, on } = recorder();
    await streamAnswer(req, on, new AbortController().signal);
    expect(log.at(-1)).toMatch(/^error:Kết nối bị gián đoạn/);
  });

  it("bấm dừng hoặc mất mạng: một thông báo lỗi tương ứng", async () => {
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw abort; }));
    const a = recorder();
    await streamAnswer(req, a.on, new AbortController().signal);
    expect(a.log).toEqual(["error:Đã dừng."]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const b = recorder();
    await streamAnswer(req, b.on, new AbortController().signal);
    expect(b.log).toEqual(["error:Mất kết nối tới máy chủ, hãy thử lại."]);
  });

  it("gửi kèm ngữ cảnh trang khi có", async () => {
    const f = vi.fn(async () => new Response(body([{ t: "done", message: msg }])));
    vi.stubGlobal("fetch", f);
    await streamAnswer({ ...req, context: "Trang Lãi lỗ" }, recorder().on, new AbortController().signal);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ context: "Trang Lãi lỗ", question: "hi", sourceIds: ["a"] });
  });
});
