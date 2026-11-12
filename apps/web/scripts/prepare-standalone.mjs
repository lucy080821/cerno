// Chạy sau `next build` (script "postbuild"). Monorepo làm bản standalone có dạng lồng nhau:
//   .next/standalone/node_modules          (có `next` và các gói phụ thuộc)
//   .next/standalone/apps/web/server.js    (+ .next/)
// Hostinger chạy server.js của apps/web nhưng chỉ thấy node_modules cạnh nó (thiếu `next`) nên báo
// "Cannot find module 'next'". Script này làm cho apps/web TỰ ĐỦ: gộp node_modules gốc vào, và chép thêm
// .next/static + public (standalone không tự mang theo).
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(web, ".next", "standalone");
const app = path.join(standalone, "apps", "web");

if (process.env.NEXT_OUTPUT === "export" || !existsSync(path.join(app, "server.js"))) {
  console.log("[prepare-standalone] không có bản standalone, bỏ qua.");
  process.exit(0);
}

const copy = (from, to, opts = {}) => {
  if (existsSync(from)) cpSync(from, to, { recursive: true, force: false, ...opts });
};

// Gộp node_modules gốc vào apps/web (không ghi đè file đã có; bỏ qua link workspace vì đã được biên dịch sẵn).
copy(path.join(standalone, "node_modules"), path.join(app, "node_modules"), {
  filter: (src) => !src.includes(`${path.sep}@dashboard${path.sep}`) && !src.endsWith(`${path.sep}@dashboard`),
});
copy(path.join(web, ".next", "static"), path.join(app, ".next", "static"));
copy(path.join(web, "public"), path.join(app, "public"));
// Font Noto Sans cho ảnh biểu đồ trong email báo cáo (render-chart.ts đọc assets/fonts theo thư mục chạy).
copy(path.join(web, "assets"), path.join(app, "assets"));

console.log("[prepare-standalone] đã gộp node_modules, static, public, assets vào", path.relative(web, app));
