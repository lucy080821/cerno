import type { Widget } from "@dashboard/schema";

/** Phần thông số có thể sao chép từ widget này sang widget khác (không bao giờ đụng tới dữ liệu: nguồn, cột, số đo, nội dung). */
export type FormatPart = "size" | "position" | "style";
export const ALL_PARTS: FormatPart[] = ["size", "position", "style"];

/** Trường kiểu dáng trong `config` của từng loại widget. Dữ liệu (cột, số đo, văn bản, url) cố ý KHÔNG nằm ở đây. */
const CONFIG_STYLE_KEYS = {
  chart: ["format"],
  kpi: ["titleStyle", "valueStyle", "align"],
  text: ["fontSize", "color", "bold", "align", "fontFamily", "italic", "underline"],
  image: ["fit"],
} as const;

const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * Áp các phần `parts` của `src` lên `target`, trả widget mới (hoặc chính `target` nếu không có gì đổi).
 * - size: w, h. position: x, y, rotation.
 * - style: khung (nền, bo góc, viền) và kiểu dáng riêng của loại widget. Kiểu riêng chỉ áp khi cùng loại
 *   (chart→chart, kpi→kpi...); khác loại thì chỉ áp khung. Widget bị khoá thì giữ nguyên.
 */
export function applyFormat(target: Widget, src: Widget, parts: readonly FormatPart[]): Widget {
  if (target.locked || target.id === src.id) return target;
  let next: Widget = target;
  if (parts.includes("size")) next = { ...next, w: src.w, h: src.h };
  if (parts.includes("position")) next = { ...next, x: src.x, y: src.y, rotation: src.rotation };
  if (parts.includes("style")) {
    next = { ...next, style: clone(src.style) };
    if (src.config.kind === next.config.kind) {
      const keys: readonly string[] = CONFIG_STYLE_KEYS[src.config.kind];
      const cfg = { ...next.config } as Record<string, unknown>;
      const from = src.config as unknown as Record<string, unknown>;
      for (const k of keys) {
        if (from[k] === undefined) delete cfg[k];
        else cfg[k] = clone(from[k]);
      }
      next = { ...next, config: cfg as unknown as Widget["config"] };
    }
  }
  return next;
}
