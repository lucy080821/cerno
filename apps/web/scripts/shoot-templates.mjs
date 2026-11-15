// Chụp ảnh minh họa cho thư viện mẫu: mở /template-preview/<id> (dashboard thật chạy trên dữ liệu mẫu) bằng Chromium,
// chụp rồi nén thành public/img/templates/<id>.webp. Chạy sau khi đổi mẫu hoặc giao diện dashboard:
//   npm run build:web && (cd apps/web && npm run start) &   rồi   npm run shoot:templates -w @dashboard/web
// Biến: BASE_URL (mặc định http://127.0.0.1:3000), IDS (danh sách id cách nhau bằng dấu phẩy, mặc định mọi mẫu).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sharp = require("sharp");

const base = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/img/templates");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "vi-VN" });

let ids = process.env.IDS ? process.env.IDS.split(",").map((s) => s.trim()).filter(Boolean) : [];
if (ids.length === 0) {
  await page.goto(`${base}/template-preview`, { waitUntil: "networkidle" });
  ids = await page.$$eval("a[href^='/template-preview/']", (as) => as.map((a) => a.getAttribute("href").split("/").pop()));
}
console.log(`Chụp ${ids.length} mẫu từ ${base}`);

for (const id of ids) {
  await page.goto(`${base}/template-preview/${id}`, { waitUntil: "networkidle" });
  await page.waitForSelector("svg", { timeout: 30_000 });
  // Thanh bộ lọc nổi che tiêu đề ở góc trên trái: ẩn riêng khi chụp ảnh (bản xem trước tương tác vẫn có để người dùng thử).
  await page.addStyleTag({ content: '[role="group"][aria-label="Bộ lọc"] { display: none !important; }' });
  await page.waitForTimeout(2500); // đợi biểu đồ chạy xong hiệu ứng vào
  const png = await page.screenshot({ type: "png" });
  const file = path.join(out, `${id}.webp`);
  await sharp(png).resize({ width: 800 }).webp({ quality: 82 }).toFile(file);
  console.log(`  ${id}.webp  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
await browser.close();
