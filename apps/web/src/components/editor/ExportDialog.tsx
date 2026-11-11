"use client";

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { toCanvas, toSvg } from "html-to-image";
import type { Dashboard } from "@dashboard/schema";
import type { ChartTheme } from "@dashboard/chart-engine";
import { getPages, resolvePageId, widgetsOnPage } from "@dashboard/schema";
import { useEditor } from "@/lib/editor/store";
import {
  clampScale, exportFileName, FORMATS, orientationOf, planSheet,
  type ImageFormat, type Orientation,
} from "@/lib/editor/export-image";
import { Spinner } from "@/components/Spinner";
import { frameStyle, WidgetContent } from "./WidgetContent";
import { pageLabel } from "./PageNav";
import { Icon } from "./fields";
import s from "./editor.module.css";

/** Một trang vẽ đúng kích thước thật (1:1), không có khung chọn/lưới, để chụp thành ảnh. */
function ExportPage({ doc, pageId }: { doc: Dashboard; pageId: string }) {
  const { palette, mode, fontFamily } = doc.theme;
  const theme = useMemo<ChartTheme>(() => ({ palette, mode, fontFamily }), [palette, mode, fontFamily]);
  const widgets = useMemo(
    () => widgetsOnPage(doc, pageId).filter((w) => !w.hidden).sort((a, b) => a.z - b.z),
    [doc, pageId],
  );
  return (
    <div style={{ position: "relative", width: doc.canvas.width, height: doc.canvas.height, overflow: "hidden", background: pageBackground(doc, pageId) }}>
      {widgets.map((w, i) => (
        <div key={w.id} className={s.widget}
          style={{ left: w.x, top: w.y, width: w.w, height: w.h, zIndex: i + 1, transform: w.rotation ? `rotate(${w.rotation}deg)` : undefined }}>
          <div className={s.widgetInner} style={frameStyle(w, theme)}>
            <WidgetContent widget={w} theme={theme} />
          </div>
        </div>
      ))}
    </div>
  );
}

const pageBackground = (doc: Dashboard, pageId: string) =>
  getPages(doc).find((p) => p.id === pageId)?.background ?? doc.canvas.background;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Chờ chart vẽ xong: font tải xong, hết vòng quay "đang tính", rồi thêm chút để hiệu ứng vẽ của ECharts kết thúc. */
async function waitUntilReady(host: HTMLElement) {
  await nextFrame();
  await nextFrame();
  try { await document.fonts?.ready; } catch { /* bỏ qua */ }
  const deadline = Date.now() + 20_000;
  while (host.querySelector('[role="status"]') && Date.now() < deadline) await sleep(150);
  await sleep(1300);
}

const dataUrlToText = (url: string) => decodeURIComponent(url.slice(url.indexOf(",") + 1));

/** Vẽ một trang thành file ảnh theo định dạng/hướng đã chọn. */
async function renderPage(
  doc: Dashboard, pageId: string, format: ImageFormat, orientation: Orientation, scale: number,
): Promise<Blob> {
  const W = doc.canvas.width;
  const H = doc.canvas.height;
  const bg = pageBackground(doc, pageId);
  const plan = planSheet(W, H, orientation);

  // Đặt ngoài màn hình nhưng vẫn có kích thước thật để ECharts đo được.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<ExportPage doc={doc} pageId={pageId} />);
    await waitUntilReady(host);
    const node = host.firstElementChild as HTMLElement | null;
    if (!node) throw new Error("Không dựng được trang để xuất.");
    const opts = { width: W, height: H, backgroundColor: bg };

    if (format === "svg") {
      const inner = await toSvg(node, opts);
      const text = plan.exact
        ? dataUrlToText(inner)
        : `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.width}" height="${plan.height}" viewBox="0 0 ${plan.width} ${plan.height}">` +
          `<rect width="100%" height="100%" fill="${bg.replace(/[^#\w(),.% -]/g, "")}"/>` +
          `<image href="${inner}" x="${plan.x}" y="${plan.y}" width="${plan.pageW}" height="${plan.pageH}"/></svg>`;
      return new Blob([text], { type: "image/svg+xml" });
    }

    const k = clampScale(scale, plan.width, plan.height);
    const page = await toCanvas(node, { ...opts, pixelRatio: k });
    const out = document.createElement("canvas");
    out.width = Math.round(plan.width * k);
    out.height = Math.round(plan.height * k);
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không tạo được ảnh.");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(page, plan.x * k, plan.y * k, plan.pageW * k, plan.pageH * k);

    const mime = FORMATS.find((f) => f.value === format)!.mime;
    return await new Promise<Blob>((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("Không tạo được file ảnh."))), mime, 0.92));
  } finally {
    root.unmount();
    host.remove();
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Hộp thoại "Xuất ảnh": chọn hướng ảnh, định dạng, độ nét và những trang cần xuất (mỗi trang một ảnh). */
export function ExportDialog({ onClose, notify }: { onClose: () => void; notify: (msg: string) => void }) {
  const doc = useEditor((st) => st.doc);
  const currentId = useEditor((st) => resolvePageId(st.doc, st.pageId));
  const pages = getPages(doc);

  const [orientation, setOrientation] = useState<Orientation>(orientationOf(doc.canvas.width, doc.canvas.height));
  const [format, setFormat] = useState<ImageFormat>("png");
  const [scale, setScale] = useState(2);
  const [picked, setPicked] = useState<Set<string>>(() => new Set([currentId]));
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const natural = orientationOf(doc.canvas.width, doc.canvas.height);
  const plan = planSheet(doc.canvas.width, doc.canvas.height, orientation);
  const k = format === "svg" ? 1 : clampScale(scale, plan.width, plan.height);
  const px = `${Math.round(plan.width * k)} × ${Math.round(plan.height * k)} px`;
  const allOn = picked.size === pages.length;

  const toggle = (id: string) => setPicked((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const run = async () => {
    const ids = pages.filter((p) => picked.has(p.id)).map((p) => p.id);
    if (!ids.length || busy) return;
    setError("");
    setBusy({ done: 0, total: ids.length });
    const ext = FORMATS.find((f) => f.value === format)!.ext;
    const snapshot = useEditor.getState().doc;
    try {
      for (let i = 0; i < ids.length; i++) {
        const blob = await renderPage(snapshot, ids[i], format, orientation, scale);
        const idx = pages.findIndex((p) => p.id === ids[i]);
        download(blob, exportFileName(snapshot.name, pageLabel(pages[idx].name, idx), i, ids.length, ext));
        setBusy({ done: i + 1, total: ids.length });
        if (i < ids.length - 1) await sleep(400); // giãn nhịp để trình duyệt không chặn nhiều lượt tải liền nhau
      }
      notify(ids.length === 1 ? "Đã xuất 1 ảnh" : `Đã xuất ${ids.length} ảnh`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xuất được ảnh.");
      setBusy(null);
    }
  };

  return (
    <div className={s.modalBack} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`${s.dialog} ${s.dialogShare} ${s.expDialog}`} role="dialog" aria-modal="true" aria-label="Xuất ảnh">
        <div className={s.shareHead}>
          <div className={s.shareHeadRow}>
            <strong>Xuất ảnh</strong>
            <button className={s.iconBtn} title="Đóng (Esc)" disabled={!!busy} onClick={onClose}><Icon name="close" size={14} /></button>
          </div>
          <span className={s.shareSub}>
            Mỗi trang là một ảnh, cùng kích thước {doc.canvas.width} × {doc.canvas.height} px bạn đã đặt. Bộ lọc đang chọn được giữ nguyên.
          </span>
        </div>

        <div className={s.shareBody}>
          <div className={s.expGroup}>
            <span className={s.label}>Hướng ảnh</span>
            <div className={s.expChoices} role="radiogroup" aria-label="Hướng ảnh">
              {(["landscape", "portrait"] as const).map((o) => (
                <label key={o} className={`${s.expChoice} ${orientation === o ? s.expChoiceOn : ""}`}>
                  <input type="radio" name="orientation" checked={orientation === o} disabled={!!busy} onChange={() => setOrientation(o)} />
                  <span className={`${s.expShape} ${o === "portrait" ? s.expShapeP : ""}`} aria-hidden />
                  <span>{o === "landscape" ? "Ngang (landscape)" : "Dọc (portrait)"}</span>
                </label>
              ))}
            </div>
            {orientation !== natural && (
              <p className={s.hint}>
                Trang của bạn đang {natural === "landscape" ? "nằm ngang" : "nằm dọc"}. Chọn hướng khác thì ảnh đổi chiều và trang được thu vừa khung, đặt giữa, phần thừa lấy màu nền của trang.
              </p>
            )}
          </div>

          <div className={s.expGroup}>
            <span className={s.label}>Trang cần xuất ({picked.size}/{pages.length})</span>
            {pages.length > 1 && (
              <div className={s.expQuick}>
                <button className={s.btn} disabled={!!busy} onClick={() => setPicked(new Set([currentId]))}>Chỉ trang đang xem</button>
                <button className={s.btn} disabled={!!busy} onClick={() => setPicked(allOn ? new Set() : new Set(pages.map((p) => p.id)))}>
                  {allOn ? "Bỏ chọn hết" : "Chọn toàn bộ"}
                </button>
              </div>
            )}
            <div className={s.expPages}>
              {pages.map((p, i) => (
                <label key={p.id} className={s.expPage}>
                  <input type="checkbox" checked={picked.has(p.id)} disabled={!!busy} onChange={() => toggle(p.id)} />
                  <span className={s.expPageNum}>{i + 1}</span>
                  <span className={s.expPageName}>{pageLabel(p.name, i)}</span>
                  {p.id === currentId && <span className={s.expPageTag}>đang xem</span>}
                </label>
              ))}
            </div>
          </div>

          <div className={s.two}>
            <div className={s.expGroup}>
              <span className={s.label}>Định dạng</span>
              <select className={s.input} value={format} disabled={!!busy} onChange={(e) => setFormat(e.target.value as ImageFormat)}>
                {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className={s.expGroup}>
              <span className={s.label}>Độ nét</span>
              <select className={s.input} value={scale} disabled={!!busy || format === "svg"} onChange={(e) => setScale(Number(e.target.value))}>
                <option value={1}>Chuẩn (1×)</option>
                <option value={2}>Cao (2×)</option>
                <option value={3}>Rất cao (3×)</option>
              </select>
            </div>
          </div>
          <p className={s.hint}>Kích thước mỗi ảnh: {px}{format === "svg" ? " (SVG co giãn theo khung)" : ""}.</p>
          {error && <div className={s.imgError} role="alert">{error}</div>}
        </div>

        <div className={s.shareFoot} style={{ gap: 8, alignItems: "center" }}>
          {busy && (
            <span className={s.hint} style={{ marginRight: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
              <Spinner size={12} inline />Đang xuất {Math.min(busy.done + 1, busy.total)}/{busy.total}…
            </span>
          )}
          <button className={s.btn} disabled={!!busy} onClick={onClose}>Hủy</button>
          <button className={`${s.btn} ${s.btnActive}`} disabled={!!busy || picked.size === 0} onClick={() => void run()}>
            <Icon name="download" size={14} /> {picked.size > 1 ? `Xuất ${picked.size} ảnh` : "Xuất ảnh"}
          </button>
        </div>
      </div>
    </div>
  );
}
