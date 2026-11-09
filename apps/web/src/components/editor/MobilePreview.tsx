"use client";

import { useMemo, useState } from "react";
import { deriveMobileLayout, getPages, resolvePageId } from "@dashboard/schema";
import type { ChartTheme } from "@dashboard/chart-engine";
import { useEditor } from "@/lib/editor/store";
import { frameStyle, WidgetContent } from "./WidgetContent";
import { Icon } from "./fields";
import s from "./editor.module.css";

// Chiều rộng vùng hiển thị (đã trừ viền máy): dọc ~ iPhone 390pt, ngang ~ 844pt.
const PORTRAIT_W = 370;
const LANDSCAPE_W = 780;
const GUTTER = 12;

/** Xem trước layout mobile tự sinh, dùng chính hàm deriveMobileLayout mà app mobile sẽ gọi. */
export function MobilePreview({ onClose }: { onClose: () => void }) {
  const doc = useEditor((st) => st.doc);
  const [landscape, setLandscape] = useState(false);
  const SCREEN_W = landscape ? LANDSCAPE_W : PORTRAIT_W;
  const { palette, mode, fontFamily } = doc.theme;
  const theme = useMemo<ChartTheme>(() => ({ palette, mode, fontFamily }), [palette, mode, fontFamily]);
  const pages = getPages(doc);
  const [picked, setPicked] = useState(() => resolvePageId(doc, useEditor.getState().pageId));
  const pageId = resolvePageId(doc, picked);
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const items = useMemo(() => deriveMobileLayout(doc, SCREEN_W - GUTTER * 2, pageId), [doc, pageId, SCREEN_W]);
  const byId = useMemo(() => new Map(doc.widgets.map((w) => [w.id, w])), [doc.widgets]);

  return (
    <div className={s.modal} onClick={onClose} role="dialog" aria-label="Xem trước trên điện thoại">
      <div className={s.phoneWrap} onClick={(e) => e.stopPropagation()}>
        <button className={s.modalClose} onClick={onClose} title="Đóng"><Icon name="close" /></button>
        <button
          className={s.modalRotate}
          onClick={() => setLandscape((v) => !v)}
          title={landscape ? "Xoay dọc" : "Xoay ngang"}
          aria-label={landscape ? "Xoay dọc" : "Xoay ngang"}
          style={landscape ? { transform: "rotate(90deg)" } : undefined}
        >
          <Icon name="refresh" />
        </button>
        <div className={`${s.phone} ${landscape ? s.phoneLandscape : ""}`}>
          <div className={landscape ? s.phoneNotchSide : s.phoneNotch} />
          <div className={`${s.phoneScreen} ${landscape ? s.phoneScreenLandscape : ""}`} style={{ background: page.background ?? doc.canvas.background, padding: GUTTER }}>
            {pages.length > 1 && (
              <div className={s.phoneTabs} role="tablist">
                {pages.map((p, i) => (
                  <button key={p.id} role="tab" aria-selected={p.id === pageId}
                    className={`${s.phoneTab} ${p.id === pageId ? s.phoneTabOn : ""}`} onClick={() => setPicked(p.id)}>
                    {p.name.trim() || `Trang ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
            {items.map((it) => {
              const w = byId.get(it.widgetId);
              if (!w) return null;
              return (
                <div key={it.widgetId} className={s.phoneItem} style={{ height: it.height, ...frameStyle(w, theme) }}>
                  <WidgetContent
                    widget={{ ...w, w: SCREEN_W - GUTTER * 2, h: it.height }}
                    theme={theme}
                    mobile={{ screenWidth: SCREEN_W - GUTTER * 2, designWidth: w.w }}
                  />
                </div>
              );
            })}
            {items.length === 0 && <p className={s.hint}>Chưa có gì để hiển thị.</p>}
          </div>
        </div>
        <p className={s.phoneCaption}>
          Layout mobile tự sinh từ canvas · {items.length} đối tượng · {landscape ? "ngang" : "dọc"}
        </p>
      </div>
    </div>
  );
}
