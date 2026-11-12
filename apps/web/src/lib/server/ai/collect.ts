/** Gom luồng NDJSON của một nhà cung cấp AI (`{"t":"text","v"}` / `{"t":"tool","id","name","args"}`) thành kết quả hoàn chỉnh. */
export interface CollectedChat {
  text: string;
  tools: { id: string; name: string; args: string }[];
}

export async function collectChat(stream: ReadableStream<Uint8Array>): Promise<CollectedChat> {
  const out: CollectedChat = { text: "", tools: [] };
  const handle = (line: string) => {
    if (!line.trim()) return;
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (!ev || typeof ev !== "object") return;
    const e = ev as Record<string, unknown>;
    if (e.t === "text" && typeof e.v === "string") out.text += e.v;
    else if (e.t === "tool" && typeof e.name === "string") {
      out.tools.push({ id: String(e.id ?? ""), name: e.name, args: typeof e.args === "string" ? e.args : "{}" });
    }
  };
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  handle(buf + dec.decode());
  return out;
}
