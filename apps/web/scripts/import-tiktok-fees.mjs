#!/usr/bin/env node
// Nhập biểu Phí Hoa Hồng Nền Tảng của TikTok Shop (file PDF do TikTok công bố) vào src/content/tiktok-fees.json.
// Dùng: node scripts/import-tiktok-fees.mjs <file.pdf | file.txt> [--from 2026-10-20] [--standard-from 2026-07-03]
// File .pdf được đọc bằng `pdftotext -layout` (cần poppler-utils). File .txt là kết quả của lệnh đó.
// Mỗi dòng dữ liệu: Nhóm ngành | cấp 1 | cấp 2 | cấp 3 | phí Mall | phí tiêu chuẩn (các ô cách nhau từ 2 dấu cách).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
if (!input) {
  console.error("Thiếu file đầu vào.");
  process.exit(1);
}
const text = input.toLowerCase().endsWith(".pdf") ? execFileSync("pdftotext", ["-layout", input, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) : readFileSync(input, "utf8");

const PCT = /\s(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/;
const bps = (s) => Math.round(parseFloat(s) * 100);
const strings = [];
const idx = new Map();
const sid = (s) => {
  if (!idx.has(s)) {
    idx.set(s, strings.length);
    strings.push(s);
  }
  return idx.get(s);
};
const rows = [];
const seen = new Map();
let def = null;
for (const line of text.split("\n")) {
  const m = PCT.exec(line);
  if (!m) continue;
  const cells = line.slice(0, m.index).trim().split(/\s{2,}/);
  if (cells.length === 1 && /mặc định/i.test(cells[0])) {
    def = { mall: bps(m[1]), standard: bps(m[2]) };
    continue;
  }
  if (cells.length !== 4) throw new Error(`Dòng không đọc được: ${line.trim()}`);
  const [, a, b, c] = cells;
  const key = `${a}|${b}|${c}`;
  const row = [sid(a), sid(b), sid(c), bps(m[1]), bps(m[2])];
  if (seen.has(key)) {
    const prev = seen.get(key);
    if (prev[3] !== row[3] || prev[4] !== row[4]) throw new Error(`Ngành trùng nhưng khác mức phí: ${key}`);
    continue; // dòng lặp giống hệt
  }
  seen.set(key, row);
  rows.push(row);
}
if (!def) throw new Error("Không thấy dòng 'Phí suất mặc định'.");
if (rows.length < 1000) throw new Error(`Chỉ đọc được ${rows.length} ngành, có thể file đã đổi định dạng.`);

const out = {
  _doc: "Biểu Phí Hoa Hồng Nền Tảng theo ngành hàng của TikTok Shop, đã gồm thuế. Nguồn: file PDF do TikTok Shop công bố (seller-vn.tiktok.com/university). Mỗi dòng: [chỉ số tên cấp 1, cấp 2, cấp 3, phí Mall, phí tiêu chuẩn], phí tính bằng phần vạn (1250 = 12,5%). Ngành không có trong bảng dùng phí mặc định. Tạo bằng scripts/import-tiktok-fees.mjs.",
  effectiveFrom: { mall: opt("from", "2026-10-20"), non_mall: opt("standard-from", "2026-07-03") },
  source: "TikTok Shop - Phí suất hoa hồng nền tảng theo nhóm ngành hàng",
  defaults: def,
  strings,
  rows,
};
const dest = join(dirname(fileURLToPath(import.meta.url)), "../src/content/tiktok-fees.json");
writeFileSync(dest, JSON.stringify(out));
console.log(`Đã ghi ${rows.length} ngành, mặc định Mall ${def.mall / 100}% / tiêu chuẩn ${def.standard / 100}% → ${dest}`);
