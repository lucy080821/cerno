"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./fields";
import { useEditor } from "@/lib/editor/store";
import { site } from "@/lib/site";
import { resetCalcSync, syncCalc } from "@/lib/editor/calc";
import { useData } from "@/lib/editor/data-store";
import { Spinner } from "@/components/Spinner";
import type { Dashboard } from "@dashboard/schema";
import { SAMPLE_SOURCE } from "@/lib/editor/sample-data";
import { hydrateSources } from "@/lib/editor/remote-data";
import { saveNow, startAutosave } from "@/lib/editor/save-store";
import { SaveBanner } from "./SaveBanner";
import { RefreshData } from "./RefreshData";
import { startAutoRefresh } from "@/lib/editor/auto-refresh";
import { PageNav, PageStage, PageSwitcher, stepPage } from "./PageNav";
import { getPages, resolvePageId, widgetsOnPage } from "@dashboard/schema";
import { Canvas } from "./Canvas";
import { LeftPanel } from "./LeftPanel";
import { LeftShell } from "./PanelShells";
import { RightPanel } from "./RightPanel";
import { TopBar } from "./TopBar";
import { ViewFilters } from "./ViewFilters";
import { MobilePreview } from "./MobilePreview";
import s from "./editor.module.css";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function EditorApp({ dashboardId, initialDoc, initialRev, canShare = true }: {
  dashboardId: string;
  initialDoc: Dashboard;
  /** updated_at của server lúc mở, để phát hiện xung đột khi lưu. */
  initialRev: string;
  /** Chỉ chủ (owner/editor của workspace) mới bật chia sẻ, mời người, nhúng. */
  canShare?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef(false);
  const appRef = useRef<HTMLDivElement>(null);
  const mode = useEditor((st) => st.mode);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // Chỉ nạp một lần cho mỗi dashboard (trang dùng key=id): props đổi sau đó không được ghi đè thay đổi chưa lưu.
  const initial = useRef({ doc: initialDoc, rev: initialRev });

  // Nạp dashboard từ server vào store (sau khi mount, tránh lệch hydration) và bật tự lưu.
  useEffect(() => {
    // Nguồn dữ liệu mẫu do app định nghĩa: luôn dùng bản mới nhất (bản đã lưu có thể thiếu cột mới).
    const doc: Dashboard = {
      ...initial.current.doc,
      id: dashboardId,
      sources: initial.current.doc.sources.map((src) => (src.type === "sample" ? SAMPLE_SOURCE : src)),
    };
    const st = useEditor.getState();
    st.loadDoc(doc);
    // Trường tính toán phải sẵn sàng trước khi widget đầu tiên vẽ.
    resetCalcSync();
    useData.getState().setQueryBase("/api/query");
    syncCalc(doc);
    const stopCalc = useEditor.subscribe((cur, prev) => {
      if (cur.doc.calculatedFields !== prev.doc.calculatedFields || cur.doc.sources !== prev.doc.sources) syncCalc(cur.doc);
    });
    st.setMode("edit");
    setReady(true);
    const stop = startAutosave(dashboardId, initial.current.rev);
    // Nguồn Google Sheets trong dashboard: tải dữ liệu thật về (không chặn việc hiển thị editor).
    void hydrateSources(doc);
    // Giữ dữ liệu luôn mới khi đang mở: tự cập nhật nếu quá 2 giờ, hoặc tải về khi nơi khác đã cập nhật.
    const stopRefresh = startAutoRefresh();
    return () => {
      stopCalc();
      stop();
      stopRefresh();
    };
  }, [dashboardId]);

  // Tên tab trình duyệt = tên dashboard người dùng đặt (favicon vẫn là của Cerno, từ app/icon.svg).
  const dashName = useEditor((st) => st.doc.name);
  useEffect(() => {
    document.title = `${dashName.trim() || initial.current.doc.name.trim() || "Chưa đặt tên"} | ${site.name}`;
  }, [dashName]);

  // Ctrl/⌘+S: lưu ngay (kể cả khi đang gõ trong ô nhập).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Phím tắt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && k === "y") { e.preventDefault(); st.redo(); return; }
      if (mod && k === "0") { e.preventDefault(); st.fit(fullscreenRef.current ? 0 : 56); return; }
      if (st.mode === "preview") {
        if (k === "escape") st.setMode("edit");
        // Khi xem: ← → (hoặc PageUp/PageDown) chuyển trang.
        else if (k === "arrowright" || k === "pagedown") { e.preventDefault(); stepPage(1); }
        else if (k === "arrowleft" || k === "pageup") { e.preventDefault(); stepPage(-1); }
        return;
      }
      if (mod && k === "d") { e.preventDefault(); st.duplicateSelected(); return; }
      if (mod && k === "c") { st.copy(); return; }
      if (mod && k === "v") { e.preventDefault(); st.paste(); return; }
      if (mod && k === "a") { e.preventDefault(); st.select(widgetsOnPage(st.doc, st.pageId).filter((w) => !w.hidden).map((w) => w.id)); return; }
      if (mod && k === "]") { e.preventDefault(); st.reorder(e.shiftKey ? "front" : "forward"); return; }
      if (mod && k === "[") { e.preventDefault(); st.reorder(e.shiftKey ? "back" : "backward"); return; }
      if (k === "delete" || k === "backspace") { e.preventDefault(); st.removeSelected(); return; }
      if (k === "escape") { st.select([]); return; }
      const step = e.shiftKey ? 10 : 1;
      if (k === "arrowleft") { e.preventDefault(); st.nudge(-step, 0); }
      else if (k === "arrowright") { e.preventDefault(); st.nudge(step, 0); }
      else if (k === "arrowup") { e.preventDefault(); st.nudge(0, -step); }
      else if (k === "arrowdown") { e.preventDefault(); st.nudge(0, step); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Toàn màn hình: ẩn mọi thanh công cụ, dùng Fullscreen API của trình duyệt.
  const refit = () => requestAnimationFrame(() => requestAnimationFrame(() => useEditor.getState().fit(fullscreenRef.current ? 0 : 56)));

  const enterFullscreen = useCallback(() => {
    useEditor.getState().select([]);
    useEditor.getState().setMode("preview");
    setFullscreen(true);
    refit();
    appRef.current?.requestFullscreen?.().catch(() => {
      /* trình duyệt từ chối: vẫn giữ giao diện toàn khung */
    });
  }, []);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setFullscreen(false);
    useEditor.getState().setMode("edit");
    refit();
  }, []);

  // Người dùng thoát bằng Esc của trình duyệt.
  useEffect(() => {
    const onChange = () => {
      // Không đặt side effect trong hàm updater của setState (React chạy nó lúc render).
      if (!document.fullscreenElement && fullscreenRef.current) {
        setFullscreen(false);
        useEditor.getState().setMode("edit");
        refit();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Phím F: bật/tắt toàn màn hình.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      if (document.fullscreenElement || fullscreenRef.current) exitFullscreen();
      else enterFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enterFullscreen, exitFullscreen]);

  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);

  // Khung nhìn đổi kích thước (trình duyệt vào/ra fullscreen là bất đồng bộ): luôn lấp đầy, không lề.
  useEffect(() => {
    if (!fullscreen) return;
    const refill = () => useEditor.getState().fit(0);
    refill();
    return useEditor.subscribe((st, prev) => {
      if (st.viewport.w !== prev.viewport.w || st.viewport.h !== prev.viewport.h) refill();
    });
  }, [fullscreen]);

  // Ẩn/hiện panel làm khung nhìn đổi kích thước: vừa lại để trang luôn nằm giữa.
  useEffect(() => {
    if (!ready || fullscreenRef.current) return;
    refit();
  }, [mode, ready]);

  if (!ready) return <div className={s.loading}><Spinner size={36} label="Đang tải editor…" /></div>;

  return (
    <div ref={appRef} translate="no" className={`${s.app} ${mode === "preview" ? s.appPreview : ""} ${fullscreen ? s.appFullscreen : ""}`}>
      {!fullscreen && <SaveBanner />}
      {!fullscreen && <TopBar onMobile={() => setMobileOpen(true)} onFullscreen={enterFullscreen} notify={notify} canShare={canShare} />}
      <div className={s.body}>
        {mode === "edit" && <LeftShell><LeftPanel /></LeftShell>}
        <main className={s.center}>
          {mode === "preview" && <PageNav />}
          <div className={s.stage}>
            <PageStage>
              <Canvas />
            </PageStage>
            {mode === "preview" && !fullscreen && <div className={s.previewBadge}>Chế độ xem trước · nhấn Esc để thoát</div>}
            {mode === "preview" && <ViewFilters />}
            {mode === "preview" && <PageSwitcher />}
            {mode === "preview" && <RefreshData variant="float" />}
            {fullscreen && (
              <button className={s.fsExit} onClick={exitFullscreen} title="Thoát toàn màn hình (Esc hoặc F)">
                <Icon name="close" size={14} /> Thoát
              </button>
            )}
          </div>
        </main>
        {mode === "edit" && <RightPanel dashboardId={dashboardId} canModerate={canShare} />}
      </div>
      {mobileOpen && <MobilePreview onClose={() => setMobileOpen(false)} />}
      {toast && <div className={s.toast} role="status">{toast}</div>}
    </div>
  );
}
