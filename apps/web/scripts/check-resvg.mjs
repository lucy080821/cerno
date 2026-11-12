// Kiểm tra máy chủ có vẽ được ảnh PNG biểu đồ cho email báo cáo hay không (resvg + font tiếng Việt + ECharts SSR).
//
//   node apps/web/scripts/check-resvg.mjs        (chạy từ thư mục gốc repo, SAU `npm install`)
//
// In ra thông tin máy (Node, hệ điều hành, glibc/musl), thời gian và dung lượng ảnh, rồi "KẾT QUẢ: OK" hoặc lỗi.
// Ghi 2 ảnh ra thư mục tạm để bạn mở xem bằng mắt (chữ tiếng Việt có dấu phải hiện đúng, không bị ô vuông).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const fontDir = path.resolve(here, "../assets/fonts");
const fontFiles = ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"].map((f) => path.join(fontDir, f));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cerno-resvg-"));
const require = createRequire(import.meta.url);

const lines = [];
const say = (k, v = "") => { lines.push(`${k}${v === "" ? "" : ": " + v}`); console.log(`${k}${v === "" ? "" : ": " + v}`); };
let failed = false;
const fail = (msg) => { failed = true; say("LỖI", msg); };

// 1) Thông tin máy
const rep = process.report?.getReport?.();
const glibc = rep?.header?.glibcVersionRuntime;
say("Node", process.version);
say("Nền tảng", `${process.platform} ${process.arch} ${glibc ? `(glibc ${glibc})` : process.platform === "linux" ? "(không có glibc: có thể musl/Alpine)" : ""}`);
say("RAM trống", `${Math.round(os.freemem() / 1048576)} MB / ${Math.round(os.totalmem() / 1048576)} MB`);
say("CPU", `${os.cpus().length} nhân`);

// 2) Font có mặt không
for (const f of fontFiles) {
  if (!fs.existsSync(f)) fail(`Thiếu file font ${path.relative(process.cwd(), f)}`);
}

// 3) Nạp resvg (gói nhị phân theo nền tảng)
let Resvg;
try {
  ({ Resvg } = require("@resvg/resvg-js"));
  say("resvg-js", `đã nạp (v${require("@resvg/resvg-js/package.json").version})`);
} catch (e) {
  fail(`Không nạp được @resvg/resvg-js: ${e.message}. Thử: npm install --include=optional (cần gói nhị phân cho ${process.platform}-${process.arch}).`);
}

const OPTS = { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Noto Sans" }, fitTo: { mode: "width", value: 600 } };

function toPng(svg, name) {
  const t0 = performance.now();
  const r = new Resvg(svg, OPTS);
  const rendered = r.render();
  const png = rendered.asPng();
  const ms = performance.now() - t0;
  const sig = png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const px = rendered.pixels;
  let ink = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0 && (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235)) ink++;
  const file = path.join(outDir, name);
  fs.writeFileSync(file, png);
  return { ms, bytes: png.length, sig, w: rendered.width, h: rendered.height, ink, file };
}

if (Resvg && !failed) {
  try {
    // 4) Chữ tiếng Việt có dấu
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120" viewBox="0 0 600 120">
      <rect width="600" height="120" fill="#ffffff"/>
      <text x="20" y="45" font-family="Noto Sans" font-size="22" font-weight="700" fill="#14162b">Doanh thu tháng 10: 125,4 triệu +25,4%</text>
      <polygon points="560,28 572,28 566,16" fill="#19c3b1"/>
      <text x="20" y="85" font-family="Noto Sans" font-size="18" fill="#444">Đà Nẵng, Hà Nội, Cần Thơ, Huế — ƯỚC ƠI, ĐƯỜNG, NGHỈ</text></svg>`;
    const a = toPng(svg, "chu-tieng-viet.png");
    say("Ảnh chữ tiếng Việt", `${a.w}x${a.h}, ${a.bytes} B, ${a.ms.toFixed(0)} ms, ${a.ink} điểm ảnh có mực, PNG hợp lệ: ${a.sig}`);
    say("  mở xem", a.file);
    if (!a.sig) fail("Kết quả không phải PNG.");
    if (a.ink < 800) fail("Gần như không có chữ nào được vẽ: font không nạp được.");

    // 5) ECharts SSR → SVG → PNG
    const echarts = require("echarts");
    const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 600, height: 300 });
    chart.setOption({
      animation: false,
      textStyle: { fontFamily: "Noto Sans" },
      title: { text: "Doanh thu theo tỉnh", textStyle: { fontFamily: "Noto Sans" } },
      xAxis: { type: "category", data: ["Hà Nội", "Đà Nẵng", "Cần Thơ", "Huế"] },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: [400, 120, 80, 200], itemStyle: { color: "#6d5efc" } }],
    });
    const chartSvg = chart.renderToSVGString();
    chart.dispose();
    const b = toPng(chartSvg, "bieu-do.png");
    say("Ảnh biểu đồ ECharts", `${b.w}x${b.h}, ${b.bytes} B, ${b.ms.toFixed(0)} ms, ${b.ink} điểm ảnh có mực`);
    say("  mở xem", b.file);
    if (!b.sig || b.ink < 800) fail("Ảnh biểu đồ không hợp lệ.");

    // 6) Sáu ảnh liên tiếp: thời gian và bộ nhớ
    const rss0 = process.memoryUsage().rss;
    const t0 = performance.now();
    let total = 0;
    for (let i = 0; i < 6; i++) total += toPng(chartSvg, `lap-${i}.png`).bytes;
    say("6 ảnh liên tiếp", `${(performance.now() - t0).toFixed(0)} ms, tổng ${(total / 1024).toFixed(0)} KB, RAM tăng ${Math.round((process.memoryUsage().rss - rss0) / 1048576)} MB`);
    if (total > 1.5 * 1048576) fail("Tổng dung lượng 6 ảnh vượt 1,5 MB.");
  } catch (e) {
    fail(e instanceof Error ? e.stack ?? e.message : String(e));
  }
}

console.log("");
say(failed ? "KẾT QUẢ: LỖI" : "KẾT QUẢ: OK");
if (!failed) console.log(`Hãy mở 2 ảnh trong ${outDir} và kiểm tra chữ có dấu hiện đúng (không bị ô vuông).`);
process.exit(failed ? 1 : 0);
