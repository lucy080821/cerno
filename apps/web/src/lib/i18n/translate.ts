/**
 * Bộ dịch thuần (không phụ thuộc trình duyệt): tra từ điển Việt → Anh.
 * Khoá = câu tiếng Việt đã chuẩn hoá (gộp khoảng trắng, bỏ khoảng trắng hai đầu). Khoá có `{0}`, `{1}`... là mẫu:
 * `Xoá "{0}"?` khớp mọi tên, và `{0}` trong bản dịch được thay bằng phần đã khớp (đổi thứ tự được: `{1} of {0}`).
 * Không tìm thấy thì trả `null` để nơi gọi giữ nguyên chữ gốc.
 */
export type Dict = Record<string, string>;
export type Translate = (text: string) => string | null;

export const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function makeTranslator(dict: Dict): Translate {
  const exact = new Map<string, string>();
  const patterns: Array<{ re: RegExp; out: string; weight: number }> = [];
  for (const [k, v] of Object.entries(dict)) {
    const key = normalize(k);
    if (/\{\d+\}/.test(key)) {
      const parts = key.split(/(\{\d+\})/);
      const re = parts.map((p) => (/^\{\d+\}$/.test(p) ? "(.+?)" : escapeRe(p))).join("");
      // Mẫu nhiều chữ cố định hơn thì thử trước (cụ thể hơn).
      patterns.push({ re: new RegExp(`^${re}$`), out: v, weight: key.replace(/\{\d+\}/g, "").length });
      // Thứ tự nhóm bắt = thứ tự `{n}` trong khoá; ghi lại để thay đúng chỗ.
      (patterns[patterns.length - 1] as { idx?: number[] }).idx = [...key.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
    } else exact.set(key, v);
  }
  patterns.sort((a, b) => b.weight - a.weight);

  return (text) => {
    const lead = /^\s*/.exec(text)?.[0] ?? "";
    const trail = /\s*$/.exec(text)?.[0] ?? "";
    const core = normalize(text);
    if (!core) return null;
    const hit = exact.get(core);
    if (hit !== undefined) return lead + hit + trail;
    for (const p of patterns) {
      const m = p.re.exec(core);
      if (!m) continue;
      const idx = (p as { idx?: number[] }).idx ?? [];
      const args: string[] = [];
      idx.forEach((n, i) => (args[n] = m[i + 1]));
      return lead + p.out.replace(/\{(\d+)\}/g, (_, n: string) => args[Number(n)] ?? "") + trail;
    }
    return null;
  };
}
