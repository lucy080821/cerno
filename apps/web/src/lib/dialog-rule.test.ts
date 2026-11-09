import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * QUY ĐỊNH: không bao giờ dùng alert / confirm / prompt của trình duyệt. Mọi chỗ cần hỏi hay báo người dùng
 * phải dùng useDialog() (components/ui/DialogProvider.tsx) để hộp thoại đúng giao diện của ứng dụng.
 */
const src = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

// Gọi trần (confirm(...)) hoặc qua window.; không bắt dialog.confirm(...) vì có dấu chấm đứng trước.
const BANNED = /(?<![\w.$])(?:confirm|alert|prompt)\s*\(|window\.(?:confirm|alert|prompt)\s*\(/;

describe("không dùng hộp thoại của trình duyệt", () => {
  it("không có alert/confirm/prompt trong mã nguồn", () => {
    const hits: string[] = [];
    for (const file of walk(src)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (BANNED.test(line)) hits.push(`${file.slice(src.length + 1)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
