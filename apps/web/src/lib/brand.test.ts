import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND } from "@dashboard/schema";

/**
 * Giữ màu logo và màu nhấn của giao diện cùng một bảng màu (BRAND). Các file không import được hằng số
 * (CSS, SVG) phải khớp giá trị, và không được còn sót màu cũ của bảng màu trước.
 */
const src = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(src, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx?|svg)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

describe("thương hiệu Cerno", () => {
  it("globals.css khai báo đúng màu thương hiệu", () => {
    const css = read("app/globals.css");
    expect(css).toContain(`--brand-ink: ${BRAND.ink};`);
    expect(css).toContain(`--brand-a: ${BRAND.violet};`);
    expect(css).toContain(`--brand-b: ${BRAND.teal};`);
  });

  it("favicon (icon.svg) dùng đúng màu thương hiệu", () => {
    const svg = read("app/icon.svg");
    for (const c of [BRAND.ink, BRAND.violet, BRAND.teal]) expect(svg.toLowerCase()).toContain(c.toLowerCase());
  });

  it("không còn màu của bảng màu cũ (cyan/tím nhạt/xanh dương) trong giao diện", () => {
    const stale = ["#22d3ee", "#a78bfa", "#6366f1", "#4f7cff", "#38bdf8", "#67e8f9", "#c4b5fd"];
    const hits: string[] = [];
    for (const file of walk(src)) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const c of stale) if (text.includes(c)) hits.push(`${file.slice(src.length + 1)}: ${c}`);
    }
    expect(hits).toEqual([]);
  });

  it("mọi nơi hiện logo dùng chung component Logo/Brand, không tự vẽ lại logo", () => {
    // Logo vẽ lại bằng tay luôn chứa đúng đường cung này; chỉ được có ở Logo.tsx và icon.svg.
    // (Ảnh chia sẻ OG là PNG sinh bởi scripts/make-og-image.mjs, nằm ngoài src nên không tính.)
    const arc = "M45.4 20A18 18 0 1 0 45.4 44";
    const owners = walk(src).filter((f) => readFileSync(f, "utf8").includes(arc)).map((f) => f.slice(src.length + 1).replace(/\\/g, "/"));
    expect(owners.sort()).toEqual(["app/icon.svg", "components/Logo.tsx"]);
  });
});
