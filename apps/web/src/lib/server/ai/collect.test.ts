import { describe, expect, it } from "vitest";
import { collectChat } from "./collect";

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe("collectChat", () => {
  it("gom chữ và lệnh công cụ, kể cả khi một dòng bị cắt giữa hai đoạn", async () => {
    const lines = [
      JSON.stringify({ t: "text", v: "Xin " }),
      JSON.stringify({ t: "text", v: "chào" }),
      JSON.stringify({ t: "tool", id: "c1", name: "map_columns", args: '{"a":1}' }),
    ].join("\n");
    const cut = Math.floor(lines.length / 2);
    const r = await collectChat(streamOf([lines.slice(0, cut), lines.slice(cut) + "\n"]));
    expect(r.text).toBe("Xin chào");
    expect(r.tools).toEqual([{ id: "c1", name: "map_columns", args: '{"a":1}' }]);
  });

  it("bỏ qua dòng hỏng, dòng trống và sự kiện lạ; dòng cuối không có xuống dòng vẫn đọc", async () => {
    const r = await collectChat(streamOf(["không phải json\n\n", '{"t":"x"}\n', '{"t":"text","v":"ok"}']));
    expect(r).toEqual({ text: "ok", tools: [] });
  });

  it("luồng rỗng", async () => {
    expect(await collectChat(streamOf([]))).toEqual({ text: "", tools: [] });
  });
});
