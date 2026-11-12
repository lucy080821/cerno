// Xuất MỘT dashboard bạn dựng trong editor thành MẪU theo ngành nằm trong repo.
//
//   npm run export:template -w @dashboard/web -- <id mẫu> <id dashboard> [--rows 40]
//
//   <id mẫu>      trùng tên file khai báo vai ở apps/web/scripts/templates/<id mẫu>.json
//   --rows N      số dòng dữ liệu mẫu lấy từ Sheet (mặc định 40, 0 = không lấy dòng nào)
//
// Cần SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL trong .env ở thư mục gốc. Ghi ra:
//   apps/web/src/content/templates/<id mẫu>.json     (mẫu: doc với tên cột = khoá vai + dòng mẫu)
//   apps/web/src/content/templates/generated.ts      (danh sách các file mẫu, sinh lại mỗi lần chạy)
//   apps/web/public/img/templates/<id mẫu>/*         (ảnh trong dashboard, tải về từ kho ảnh công khai)
// Ảnh xem trước (tuỳ chọn): đặt tay apps/web/public/img/templates/<id mẫu>.webp, script tự gắn khi thấy file.
//
// LƯU Ý: dòng dữ liệu mẫu lấy từ Sheet THẬT của bạn và sẽ nằm trong repo. Xem lại file JSON trước khi commit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTemplate, pickSource } from "./template-export-core.mjs";

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

const args = process.argv.slice(2);
const rowsIdx = args.indexOf("--rows");
let maxRows = 40;
if (rowsIdx >= 0) {
  maxRows = Number(args[rowsIdx + 1]);
  args.splice(rowsIdx, 2);
  if (!Number.isInteger(maxRows) || maxRows < 0 || maxRows > 200) throw new Error("--rows phải là số nguyên từ 0 đến 200.");
}
const [templateId, dashboardId] = args;
if (!templateId || !/^[a-z0-9][a-z0-9-]*$/.test(templateId) || !dashboardId || !/^[0-9a-f-]{36}$/i.test(dashboardId)) {
  throw new Error("Cách dùng: export-template.mjs <id mẫu> <id dashboard (uuid)> [--rows 40]");
}

const metaFile = path.join(here, "templates", `${templateId}.json`);
if (!fs.existsSync(metaFile)) throw new Error(`Không có file khai báo vai: ${path.relative(root, metaFile)}`);
const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
if (meta.id !== templateId) throw new Error(`"id" trong ${path.basename(metaFile)} phải là "${templateId}".`);

const env = { ...loadEnv(path.join(root, ".env")), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env");

const headers = { apikey: key, Authorization: `Bearer ${key}` };
async function get(p) {
  const res = await fetch(`${url}/rest/v1/${p}`, { headers });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json();
}

const [dash] = await get(`dashboards?id=eq.${dashboardId}&select=name,doc`);
if (!dash) throw new Error("Không tìm thấy dashboard");
const doc = dash.doc;

// Dòng dữ liệu của nguồn mà dashboard dùng (chỉ khi cần dòng mẫu).
const src = pickSource(doc);
const rows = [];
if (maxRows > 0) {
  if (src.type !== "google_sheets") throw new Error("Nguồn của dashboard không phải Google Sheets: dùng --rows 0.");
  for (let from = 0; ; from += 1000) {
    const page = await get(`source_rows?source_id=eq.${src.id}&select=data&order=row_index&limit=1000&offset=${from}`);
    rows.push(...page.map((r) => r.data));
    if (page.length < 1000) break;
  }
}

let built;
try {
  built = buildTemplate({ meta, doc, rows, maxRows });
} catch (e) {
  console.error(`\nKhông xuất được mẫu "${templateId}":\n${e.message}\n`);
  console.error(`Cột của nguồn "${src.type === "google_sheets" ? src.sheetName : src.name}": ${src.columns.map((c) => `${c.name} (${c.type})`).join(", ")}`);
  process.exit(1);
}
const { template, warnings } = built;

// Ảnh: tải về /public để không phụ thuộc kho ảnh Supabase.
const imgDir = path.join(webDir, "public/img/templates", templateId);
fs.rmSync(imgDir, { recursive: true, force: true });
let n = 0;
for (const w of template.doc.widgets) {
  if (w.config?.kind !== "image" || !/^https?:\/\//.test(w.config.url)) continue;
  const res = await fetch(w.config.url);
  if (!res.ok) throw new Error(`Không tải được ảnh ${w.config.url}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const ext = type.includes("png") ? "png" : type.includes("jpeg") ? "jpg" : type.includes("gif") ? "gif" : "webp";
  fs.mkdirSync(imgDir, { recursive: true });
  const name = `img-${++n}.${ext}`;
  fs.writeFileSync(path.join(imgDir, name), Buffer.from(await res.arrayBuffer()));
  w.config.url = `/img/templates/${templateId}/${name}`;
}

const entry = { template };
const preview = path.join(webDir, "public/img/templates", `${templateId}.webp`);
if (fs.existsSync(preview)) entry.previewImage = `/img/templates/${templateId}.webp`;
if (meta.sampleSheetId) entry.sampleSheetId = meta.sampleSheetId;

const outDir = path.join(webDir, "src/content/templates");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${templateId}.json`), JSON.stringify(entry, null, 1) + "\n");

// Sinh lại danh sách mẫu (generated.ts) từ mọi file *.json trong thư mục.
const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".json")).sort();
const imports = files.map((f, i) => `import t${i} from "./${f}";`).join("\n");
fs.writeFileSync(
  path.join(outDir, "generated.ts"),
  `// Tệp này do scripts/export-template.mjs sinh ra, KHÔNG sửa tay.\n${imports}${imports ? "\n" : ""}\n` +
    `/** Mọi mẫu đã xuất (dạng thô, index.ts kiểm bằng zod). */\nexport const GENERATED_TEMPLATES: unknown[] = [${files.map((_, i) => `t${i}`).join(", ")}];\n`,
);

console.log(
  `Đã xuất mẫu "${template.name}" từ dashboard "${dash.name}": ${template.doc.widgets.length} widget, ` +
    `${template.slots.length} vai, ${template.sampleRows.length} dòng mẫu, ${n} ảnh.`,
);
for (const w of warnings) console.warn(`  ! ${w}`);
if (template.sampleRows.length) {
  console.warn(`\nDòng mẫu lấy từ dữ liệu THẬT: mở src/content/templates/${templateId}.json và xoá thông tin nhạy cảm trước khi commit.`);
}
console.log("Nhớ: thêm bản dịch tiếng Anh cho tên, mô tả, nhãn vai của mẫu vào src/lib/i18n/en/templates.ts (test sẽ báo nếu thiếu).");
