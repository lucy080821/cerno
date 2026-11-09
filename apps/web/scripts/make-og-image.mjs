// Tạo ảnh chia sẻ (Open Graph) 1200x630 từ ảnh dashboard thật trong public/img/dashboard-demo.webp.
// Chạy lại khi đổi ảnh dashboard hoặc logo:  node apps/web/scripts/make-og-image.mjs
// Kết quả: apps/web/src/app/opengraph-image.png (Next.js tự dùng làm og:image).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "../public/img/dashboard-demo.webp");
const out = path.join(here, "../src/app/opengraph-image.png");

const W = 1200;
const H = 630;
const SHOT_W = 880;
const SHOT_H = Math.round((SHOT_W * 938) / 1667); // giữ đúng tỉ lệ ảnh gốc
const SHOT_X = W - SHOT_W - 48;
const SHOT_Y = Math.round((H - SHOT_H) / 2);

// Chỉ dùng chữ không dấu: font hệ thống khi dựng ảnh có thể thiếu ký tự tiếng Việt.
const background = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#060a14"/>
      <stop offset="0.55" stop-color="#0b1222"/>
      <stop offset="1" stop-color="#1b1740"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.75" cy="0.5" r="0.6">
      <stop offset="0" stop-color="#19c3b1" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#19c3b1" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="c" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d5efc"/>
      <stop offset="1" stop-color="#19c3b1"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <g transform="translate(48 56)">
    <svg width="72" height="72" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="15" fill="#14162b"/>
      <path d="M45.4 20A18 18 0 1 0 45.4 44" fill="none" stroke="url(#c)" stroke-width="7" stroke-linecap="round"/>
      <circle cx="35" cy="32" r="5" fill="#19c3b1"/>
    </svg>
    <text x="0" y="132" font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="800" fill="#e8edf7">Cerno</text>
  </g>
  <g font-family="Segoe UI, Arial, sans-serif" font-weight="700" fill="#e8edf7">
    <text x="48" y="330" font-size="30">Google Sheets</text>
    <text x="48" y="368" font-size="30" fill="#19c3b1">to dashboard</text>
  </g>
  <g font-family="Segoe UI, Arial, sans-serif" font-size="19" fill="#8b97b1">
    <text x="48" y="560">13 chart types</text>
    <text x="48" y="588">Free-form canvas</text>
  </g>
</svg>`);

const mask = Buffer.from(
  `<svg width="${SHOT_W}" height="${SHOT_H}"><rect width="${SHOT_W}" height="${SHOT_H}" rx="16" ry="16" fill="#fff"/></svg>`,
);
const frame = Buffer.from(
  `<svg width="${SHOT_W + 4}" height="${SHOT_H + 4}"><rect x="2" y="2" width="${SHOT_W}" height="${SHOT_H}" rx="16" ry="16" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/></svg>`,
);
const shadow = await sharp({
  create: { width: SHOT_W, height: SHOT_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.55 } },
})
  .composite([{ input: mask, blend: "dest-in" }])
  .blur(22)
  .png()
  .toBuffer();

const shot = await sharp(src)
  .resize(SHOT_W, SHOT_H)
  .composite([{ input: mask, blend: "dest-in" }])
  .png()
  .toBuffer();

await sharp(background)
  .composite([
    { input: shadow, left: SHOT_X, top: SHOT_Y + 14 },
    { input: shot, left: SHOT_X, top: SHOT_Y },
    { input: frame, left: SHOT_X - 2, top: SHOT_Y - 2 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log("Đã tạo", out);
