"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useEditor } from "@/lib/editor/store";
import {
  clampRightWidth, loadLayoutPrefs, RIGHT_DEFAULT, RIGHT_MAX, RIGHT_MIN, saveLayoutPrefs,
} from "@/lib/editor/layout-prefs";
import { ChatPanel } from "./ChatPanel";
import { CommentsPanel } from "./CommentsPanel";
import { FiltersPanel } from "./FiltersPanel";
import { PropertyPanel } from "./PropertyPanel";
import s from "./editor.module.css";

type Tab = "setup" | "filters" | "ai" | "comments";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "setup", label: "Thiết lập" },
  { id: "filters", label: "Bộ lọc" },
  { id: "ai", label: "AI" },
  { id: "comments", label: "Bình luận" },
];

/** Bảng bên phải: 4 tab lớn. Thiết lập (Dữ liệu / Kiểu dáng của widget), Bộ lọc dashboard, Chat với AI, Bình luận. */
export function RightPanel({ dashboardId, canModerate = false }: { dashboardId: string; canModerate?: boolean }) {
  const [tab, setTab] = useState<Tab>("setup");
  const filterCount = useEditor((st) => st.doc.filters.length);

  // Độ rộng kéo được (hữu ích nhất cho khung chat). Nhớ theo trình duyệt.
  const [width, setWidth] = useState(RIGHT_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const last = useRef(RIGHT_DEFAULT);

  useEffect(() => {
    const w = clampRightWidth(loadLayoutPrefs().rightWidth, window.innerWidth);
    last.current = w;
    setWidth(w);
  }, []);

  // Cửa sổ thu nhỏ lại thì bảng không được chiếm quá 60% bề ngang.
  useEffect(() => {
    const onResize = () => setWidth((w) => clampRightWidth(w, window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [dragging]);

  const apply = (w: number, persist: boolean) => {
    const v = clampRightWidth(w, window.innerWidth);
    last.current = v;
    setWidth(v);
    if (persist) saveLayoutPrefs({ rightWidth: v });
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    apply(drag.current.w + (drag.current.x - e.clientX), false); // kéo sang trái = rộng ra
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    saveLayoutPrefs({ rightWidth: last.current });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") apply(width + step, true);
    else if (e.key === "ArrowRight") apply(width - step, true);
    else if (e.key === "Home") apply(RIGHT_DEFAULT, true);
    else return;
    e.preventDefault();
  };

  return (
    <aside className={s.rightShell} style={{ width }}>
      <div
        className={`${s.rightResizer} ${dragging ? s.rightResizerOn : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Kéo để đổi độ rộng bảng bên phải"
        aria-valuenow={width}
        aria-valuemin={RIGHT_MIN}
        aria-valuemax={RIGHT_MAX}
        tabIndex={0}
        title="Kéo để đổi độ rộng (bấm đúp để đặt lại)"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => apply(RIGHT_DEFAULT, true)}
        onKeyDown={onKey}
      />
      <div className={s.mainTabs} role="tablist" aria-label="Bảng thuộc tính">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`${s.mainTab} ${tab === t.id ? s.mainTabOn : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "filters" && filterCount > 0 && <span className={s.badge}>{filterCount}</span>}
          </button>
        ))}
      </div>
      <div className={`${s.rightBody} ${tab === "ai" ? s.rightBodyChat : ""}`}>
        {tab === "setup" && <PropertyPanel />}
        {tab === "filters" && <FiltersPanel />}
        {tab === "ai" && <ChatPanel />}
        {tab === "comments" && <CommentsPanel dashboardId={dashboardId} canModerate={canModerate} />}
      </div>
    </aside>
  );
}
