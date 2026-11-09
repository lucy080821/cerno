import { create } from "zustand";
import type { Dashboard } from "@dashboard/schema";
import { applyAiActions, MAX_TOOL_CALLS_PER_TURN } from "./ai-actions";
import { runShowChart, type ChartPreview } from "./ai-chart";
import { wantsTools } from "./ai-intent";
import { MAX_CONTEXT_LEVEL } from "./ai-context";
import { useEditor, type FilterValue } from "./store";

export interface ChatAction {
  label: string;
  ok: boolean;
}

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  /** Các thay đổi AI đã áp lên dashboard trong lượt trả lời này. */
  actions?: ChatAction[];
  /** Biểu đồ AI vẽ trong khung chat (công cụ show_chart), có nút "Thêm vào dashboard". */
  charts?: ChartPreview[];
  /** Nhà cung cấp đã trả lời: "anthropic" là AI nâng cao trả phí (có hạn mức), "groq" là miễn phí. */
  provider?: "groq" | "anthropic";
  /** Để hoàn tác cả lượt: số bước lịch sử đã tạo, bản dashboard cuối cùng và giá trị bộ lọc trước khi sửa. */
  undo?: { steps: number; finalDoc: Dashboard; prevFilters: Record<string, FilterValue>; done?: boolean };
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
type ApiMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatState {
  messages: ChatMsg[];
  busy: boolean;
  /** Thông báo tạm (ví dụ đang chờ hạn mức của dịch vụ AI). */
  notice: string | null;
  /** Cho phép AI sửa dashboard (gửi công cụ cho model). Tắt thì AI chỉ phân tích. */
  canEdit: boolean;
  setCanEdit: (v: boolean) => void;
  /**
   * `getContext(level)` được gọi mỗi vòng để AI luôn thấy dashboard/bộ lọc mới nhất (kể cả sau khi nó vừa sửa).
   * `level` càng cao thì ngữ cảnh càng gọn (xem CONTEXT_LEVELS): tăng lên khi dịch vụ AI báo yêu cầu quá lớn.
   */
  send: (text: string, getContext: (level: number) => string | Promise<string>) => Promise<void>;
  stop: () => void;
  clear: () => void;
  undoTurn: (id: string) => string | null;
  /** Đánh dấu một biểu đồ trong chat đã được thêm vào dashboard. */
  markChartAdded: (messageId: string, chartId: string) => void;
}

const MAX_ROUNDS = 4;
let controller: AbortController | null = null;
let seq = 0;
const nid = () => `m${Date.now().toString(36)}${seq++}`;

/** Đọc luồng NDJSON từ /api/chat. */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onText: (chunk: string) => void,
): Promise<ToolCall[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls: ToolCall[] = [];
  let buf = "";
  const handle = (line: string) => {
    if (!line.trim()) return;
    try {
      const ev = JSON.parse(line);
      if (ev.t === "text" && typeof ev.v === "string") onText(ev.v);
      else if (ev.t === "tool") calls.push({ id: String(ev.id), name: String(ev.name), arguments: String(ev.args ?? "") });
    } catch {
      /* dòng hỏng thì bỏ qua */
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buf);
  return calls;
}

const parseArgs = (s: string): unknown => {
  if (!s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  busy: false,
  notice: null,
  canEdit: true,
  setCanEdit: (canEdit) => set({ canEdit }),

  stop: () => controller?.abort(),
  clear: () => {
    controller?.abort();
    set({ messages: [], busy: false });
  },

  markChartAdded: (messageId, chartId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, charts: m.charts?.map((c) => (c.id === chartId ? { ...c, added: true } : c)) } : m,
      ),
    })),

  undoTurn: (id) => {
    const m = get().messages.find((x) => x.id === id);
    if (!m?.undo || m.undo.done) return null;
    const ed = useEditor.getState();
    if (ed.doc !== m.undo.finalDoc) return "Dashboard đã có thay đổi khác sau lượt này, hãy dùng Ctrl+Z để hoàn tác từng bước.";
    for (let i = 0; i < m.undo.steps; i++) useEditor.getState().undo();
    // Khôi phục giá trị bộ lọc trước khi AI sửa.
    const { filterValues, setFilterValue } = useEditor.getState();
    for (const k of Object.keys(filterValues)) if (!(k in m.undo.prevFilters)) setFilterValue(k, null);
    for (const [k, v] of Object.entries(m.undo.prevFilters)) setFilterValue(k, v);
    set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, undo: { ...x.undo!, done: true } } : x)) }));
    return null;
  },

  send: async (text, getContext) => {
    const q = text.trim();
    if (!q || get().busy) return;

    // Lịch sử gửi lên: chỉ chữ (lượt gọi công cụ cũ được tóm tắt thành một dòng để model biết mình đã làm gì).
    const api: ApiMsg[] = get()
      .messages.filter((m) => !m.error)
      .map((m): ApiMsg => {
        if (m.role === "user") return { role: "user", content: m.content };
        const did = m.actions?.filter((a) => a.ok).map((a) => a.label).join("; ");
        const text = m.content.length > 700 ? `${m.content.slice(0, 700)}…` : m.content;
        const drew = m.charts?.map((c) => c.config.title).filter(Boolean).join("; ");
        return {
          role: "assistant",
          content: [text, did ? `[Đã sửa dashboard: ${did}]` : "", drew ? `[Đã vẽ biểu đồ trong chat: ${drew}]` : ""].filter(Boolean).join("\n"),
        };
      })
      .filter((m) => m.content)
      .slice(-6);
    api.push({ role: "user", content: q });

    const reply: ChatMsg = { id: nid(), role: "assistant", content: "" };
    set((s) => ({ messages: [...s.messages, { id: nid(), role: "user", content: q }, reply], busy: true }));
    const patchReply = (p: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) =>
      set((s) => ({ messages: s.messages.map((m) => (m.id === reply.id ? { ...m, ...(typeof p === "function" ? p(m) : p) } : m)) }));

    // Công cụ (vẽ chart, sửa dashboard) tốn ~1.800 token mỗi yêu cầu: chỉ gửi khi câu hỏi có ý định vẽ/sửa.
    const userTexts = get().messages.filter((m) => m.role === "user" && !m.error).map((m) => m.content);
    const intent = wantsTools([...userTexts, q]);
    // Bị báo "quá lớn" thì lần lượt: rút gọn dữ liệu gửi kèm, bỏ công cụ sửa, bỏ hết công cụ.
    let shrink = 0;

    const prevFilters = { ...useEditor.getState().filterValues };
    const actions: ChatAction[] = [];
    const charts: ChartPreview[] = [];
    let steps = 0;
    let shown = ""; // văn bản đã hoàn tất của các vòng trước
    controller = new AbortController();

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let res: Response;
        let err: { error?: string; retryAfter?: number; retry?: boolean; tooLarge?: boolean } | null = null;
        let rateWaits = 0;
        let toolRetried = false;
        // Vòng gửi yêu cầu: tự xử lý hạn mức token/phút (chờ ít giây), lệnh sai định dạng (thử lại 1 lần) và yêu cầu quá lớn.
        for (;;) {
          // Có công cụ đi kèm thì ngữ cảnh phải gọn hơn ngay từ đầu (công cụ + lời nhắc ~3.000 token): nếu không sẽ vượt hạn mức.
          const baseLevel = !intent ? 0 : get().canEdit ? 2 : 1;
          const payload = JSON.stringify({
            messages: api,
            context: await getContext(Math.min(MAX_CONTEXT_LEVEL, baseLevel + shrink)),
            tools: intent && get().canEdit && shrink < 2,
            charts: intent && shrink < 3,
          });
          res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            signal: controller.signal,
          });
          if (res.ok && res.body) break;
          err = await res.json().catch(() => null);
          if (res.status === 413 && err?.tooLarge && shrink < 3) {
            shrink += 1;
            set({ notice: "Dashboard khá lớn so với hạn mức của dịch vụ AI, đang rút gọn dữ liệu gửi đi…" });
            continue;
          }
          // Model tạo lệnh sai định dạng: thường hỏi lại là được, tự thử lại một lần.
          if (err?.retry && !toolRetried) {
            toolRetried = true;
            continue;
          }
          const wait = err?.retryAfter;
          if (res.status === 429 && wait !== undefined && wait <= 30 && rateWaits < 2) {
            rateWaits += 1;
            for (let s = Math.ceil(wait) + 1; s > 0; s--) {
              set({ notice: `Đang chờ hạn mức của dịch vụ AI… ${s}s` });
              await new Promise((r) => setTimeout(r, 1000));
              if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
            }
            set({ notice: null });
        const provider = res.headers.get("x-ai-provider");
        if (provider === "anthropic" || provider === "groq") patchReply({ provider });
            continue;
          }
          break;
        }
        set({ notice: null });
        if (!res.ok || !res.body) {
          const msg = err?.error ?? "Không gọi được AI, thử lại sau.";
          patchReply((m) => ({ content: m.content ? `${m.content}\n\n${msg}` : msg, error: true }));
          return;
        }

        let roundText = "";
        const calls = (
          await readStream(res.body, (chunk) => {
            roundText += chunk;
            patchReply({ content: shown + roundText });
          })
        ).filter((c) => c.name); // lệnh không tên không gửi lại được cho model
        if (calls.length === 0) {
          if (!(shown + roundText).trim() && actions.length === 0 && charts.length === 0) patchReply({ content: "AI không trả lời, hãy thử hỏi lại.", error: true });
          return;
        }

        // Có lệnh sửa: kiểm tra + áp lên dashboard (cả vòng = 1 bước hoàn tác), rồi báo kết quả cho model.
        const ed = useEditor.getState();
        const parsed = calls.map((c) => ({ call: c, args: parseArgs(c.arguments) }));
        // show_chart chỉ ĐỌC dữ liệu (vẽ trong chat), chạy riêng và bất đồng bộ (nguồn lớn phải hỏi server).
        // Các lệnh còn lại sửa dashboard: chỉ chạy khi người dùng cho phép.
        type Res = { ok: boolean; label: string; message: string };
        const results: Res[] = new Array(parsed.length);
        const shows = await Promise.all(
          parsed.map((p) => (p.call.name === "show_chart" ? runShowChart(ed.doc, p.args, ed.filterValues) : null)),
        );
        const editIdx = parsed.map((_, i) => i).filter((i) => !shows[i]);
        let doc = ed.doc;
        let filterOps: Array<{ id: string; value: FilterValue | null }> = [];
        if (editIdx.length) {
          if (!get().canEdit) {
            editIdx.forEach((i) => {
              results[i] = { ok: false, label: parsed[i].call.name, message: 'Người dùng chưa bật "Cho phép AI sửa dashboard".' };
            });
          } else {
            const applied = applyAiActions(ed.doc, editIdx.map((i) => ({ name: parsed[i].call.name, args: parsed[i].args })), ed.pageId);
            doc = applied.doc;
            filterOps = applied.filterOps;
            applied.results.forEach((r, k) => { results[editIdx[k]] = r; });
          }
        }
        shows.forEach((r, i) => {
          if (!r) return;
          results[i] = r;
          if (r.ok && r.chart) charts.push(r.chart);
        });
        if (doc !== ed.doc) {
          ed.mutate(() => doc);
          steps += 1;
        }
        filterOps.forEach((op) => useEditor.getState().setFilterValue(op.id, op.value));

        parsed.forEach((p, i) => {
          if (p.args === undefined) results[i] = { ...results[i], ok: false, message: "Tham số không phải JSON hợp lệ." };
        });
        // Biểu đồ vẽ trong chat hiện thành biểu đồ, không phải "thay đổi đã thực hiện".
        results.forEach((r, i) => { if (!shows[i]) actions.push({ label: r.label, ok: r.ok }); });
        shown += (roundText.trim() ? roundText.trim() + "\n\n" : "");
        patchReply({
          content: shown.trim(),
          actions: [...actions],
          ...(charts.length ? { charts: [...charts] } : {}),
          ...(steps > 0 || filterOps.length ? { undo: { steps, finalDoc: useEditor.getState().doc, prevFilters } } : {}),
        });

        api.push({ role: "assistant", content: roundText, tool_calls: calls.slice(0, MAX_TOOL_CALLS_PER_TURN + 5) });
        calls.slice(0, MAX_TOOL_CALLS_PER_TURN + 5).forEach((c, i) => {
          api.push({ role: "tool", tool_call_id: c.id, content: `${results[i]?.ok ? "OK" : "LỖI"}: ${results[i]?.message ?? "không rõ"}`.slice(0, 1800) });
        });
      }
      patchReply((m) => ({ content: (m.content + "\n\n(Dừng vì đã gọi công cụ quá nhiều vòng.)").trim() }));
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        patchReply((m) => (m.content || m.actions?.length || m.charts?.length ? {} : { content: "(đã dừng)", error: true }));
      } else {
        patchReply((m) => ({ content: m.content ? `${m.content}\n\nMất kết nối tới server.` : "Mất kết nối tới server.", error: true }));
      }
    } finally {
      controller = null;
      set({ busy: false, notice: null });
    }
  },
}));
