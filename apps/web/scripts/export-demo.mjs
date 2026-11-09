// Xuất MỘT dashboard thật thành bản chụp nằm trong repo, để trang giới thiệu cho người dùng thử tương tác mà
// KHÔNG phụ thuộc Supabase, link chia sẻ hay tên miền nhúng (nên không thể "mất" khi lên hosting).
//
//   npm run export:demo -w @dashboard/web -- <id dashboard>
//
// Cần SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL trong .env ở thư mục gốc. Ghi ra:
//   apps/web/src/content/demo-dashboard.json   (doc + toàn bộ dòng dữ liệu của các nguồn Google Sheets)
//   apps/web/public/img/demo/*                  (ảnh trong dashboard, tải về từ kho ảnh công khai)
// Chạy lại script này mỗi khi sửa dashboard mẫu rồi commit các file trên.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const root = path.resolve(webDir, "../..");

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

const env = { ...loadEnv(path.join(root, ".env")), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const id = process.argv[2];
if (!url || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env");
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Cách dùng: export-demo.mjs <id dashboard (uuid)>");

const headers = { apikey: key, Authorization: `Bearer ${key}` };
async function get(p) {
  const res = await fetch(`${url}/rest/v1/${p}`, { headers });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json();
}

const [dash] = await get(`dashboards?id=eq.${id}&select=name,doc`);
if (!dash) throw new Error("Không tìm thấy dashboard");
const doc = structuredClone(dash.doc);
doc.id = "demo";

// Dòng dữ liệu của các nguồn Google Sheets mà dashboard dùng.
const rows = {};
for (const s of doc.sources) {
  if (s.type !== "google_sheets") continue;
  const all = [];
  for (let from = 0; ; from += 1000) {
    const page = await get(`source_rows?source_id=eq.${s.id}&select=data&order=row_index&limit=1000&offset=${from}`);
    all.push(...page.map((r) => r.data));
    if (page.length < 1000) break;
  }
  rows[s.id] = all;
  s.spreadsheetId = ""; // không công bố id file Google Sheets gốc
}

// Ảnh: tải về /public để không phụ thuộc kho ảnh Supabase.
const imgDir = path.join(webDir, "public/img/demo");
fs.mkdirSync(imgDir, { recursive: true });
for (const f of fs.readdirSync(imgDir)) fs.rmSync(path.join(imgDir, f));
let n = 0;
for (const w of doc.widgets) {
  if (w.config?.kind !== "image" || !/^https?:\/\//.test(w.config.url)) continue;
  const res = await fetch(w.config.url);
  if (!res.ok) throw new Error(`Không tải được ảnh ${w.config.url}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const ext = type.includes("png") ? "png" : type.includes("jpeg") ? "jpg" : type.includes("gif") ? "gif" : "webp";
  const name = `img-${++n}.${ext}`;
  fs.writeFileSync(path.join(imgDir, name), Buffer.from(await res.arrayBuffer()));
  w.config.url = `/img/demo/${name}`;
}

const outFile = path.join(webDir, "src/content/demo-dashboard.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ name: dash.name, exportedAt: new Date().toISOString(), doc, rows }, null, 1));
const counts = Object.entries(rows).map(([k, v]) => `${v.length} dòng`).join(", ");
console.log(`Đã xuất "${dash.name}": ${doc.widgets.length} widget, ${doc.pages?.length ?? 1} trang, ${counts}, ${n} ảnh.`);
