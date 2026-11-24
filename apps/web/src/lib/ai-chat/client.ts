import { parseVisual, type Visual } from "./visual";

/** Phần thuần của trang Hỏi AI phía trình duyệt: đọc luồng NDJSON, chia báo cáo chữ thuần thành khối để vẽ, nhãn nguồn. */

export interface ChatSummary {
  id: string;
  title: string;
  sourceIds: string[];
  updatedAt: string;
}

export interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export type StreamEvent =
  | { t: "chat"; id: string; title: string }
  | { t: "status"; v: string }
  | { t: "text"; v: string }
  | { t: "reset" }
  | { t: "visual"; visual: Visual }
  | { t: "done"; message: Msg }
  | { t: "error"; message: string; status?: number; retryAfter?: number };

/** Gộp phần dư của lần đọc trước với đoạn mới, trả các dòng đã đủ và phần chưa hết dòng. */
export function splitLines(rest: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (rest + chunk).split("\n");
  return { rest: parts.pop() ?? "", lines: parts.filter((l) => l.trim()) };
}

export function parseEvent(line: string): StreamEvent | null {
  try {
    const e = JSON.parse(line) as Record<string, unknown>;
    switch (e.t) {
      case "chat":
        return typeof e.id === "string" ? { t: "chat", id: e.id, title: String(e.title ?? "") } : null;
      case "status":
      case "text":
        return typeof e.v === "string" ? { t: e.t, v: e.v } : null;
      case "reset":
        return { t: "reset" };
      case "visual": {
        const v = parseVisual(e.visual);
        return v ? { t: "visual", visual: v } : null;
      }
      case "done": {
        const m = e.message as Msg | undefined;
        return m && typeof m.content === "string" ? { t: "done", message: m } : null;
      }
      case "error":
        return { t: "error", message: String(e.message ?? "AI gặp lỗi, hãy thử lại."), status: typeof e.status === "number" ? e.status : undefined, retryAfter: typeof e.retryAfter === "number" ? e.retryAfter : undefined };
    }
  } catch {
    /* dòng hỏng */
  }
  return null;
}

export type Block = { kind: "title" | "scope" | "heading" | "item" | "para" | "gap"; text: string };

const isHeading = (l: string) => /^\d+\.\s+\S/.test(l) && l === l.toUpperCase() && /\p{L}{2,}/u.test(l);

/** Chia báo cáo chữ thuần thành các khối: tiêu đề, phạm vi, tiêu đề mục (1. TÓM TẮT), gạch đầu dòng, đoạn văn. */
export function reportBlocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const l = raw.trimEnd();
    if (!l.trim()) {
      if (out.length && out[out.length - 1].kind !== "gap") out.push({ kind: "gap", text: "" });
    } else if (/^(BÁO CÁO|REPORT)\s*:/i.test(l.trim())) out.push({ kind: "title", text: l.trim() });
    else if (/^(Phạm vi|Scope)\s*:/i.test(l.trim())) out.push({ kind: "scope", text: l.trim() });
    else if (isHeading(l.trim())) out.push({ kind: "heading", text: l.trim() });
    else if (/^\s*[-•]\s+/.test(l)) out.push({ kind: "item", text: l.replace(/^\s*[-•]\s+/, "") });
    else out.push({ kind: "para", text: l.trim() });
  }
  while (out.length && out[out.length - 1].kind === "gap") out.pop();
  return out;
}

export interface SourceOption {
  id: string;
  name: string;
  sheet_name: string;
  spreadsheet_id: string;
  row_count: number | null;
  last_synced_at: string | null;
}

export const isOrdersSource = (s: Pick<SourceOption, "spreadsheet_id">) => s.spreadsheet_id.startsWith("upload:");
export const sourceLabel = (s: SourceOption) => (s.name || s.sheet_name || "Nguồn dữ liệu").trim();

export const MAX_SOURCES = 5;

/** Chọn nguồn khi mở trang: nguồn đã lưu còn tồn tại, nếu không có thì nguồn đơn hàng (nếu có), nếu không thì nguồn đầu tiên. */
export function defaultSelection(saved: string[], sources: SourceOption[]): string[] {
  const exist = new Set(sources.map((s) => s.id));
  const keep = saved.filter((id) => exist.has(id)).slice(0, MAX_SOURCES);
  if (keep.length) return keep;
  const orders = sources.find(isOrdersSource);
  return orders ? [orders.id] : sources[0] ? [sources[0].id] : [];
}

export function toggleSource(selected: string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  return selected.length >= MAX_SOURCES ? selected : [...selected, id];
}
