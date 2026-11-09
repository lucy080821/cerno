"use client";

import { aabb, cursorFor, HANDLES, union } from "@/lib/editor/geometry";
import { useEditor } from "@/lib/editor/store";
import s from "./editor.module.css";

/**
 * Khung chọn + các handle. Vẽ trong toạ độ artboard và đặt trên mọi widget,
 * kích thước handle chia cho zoom để luôn to bằng nhau trên màn hình.
 */
export function SelectionOverlay() {
  const widgets = useEditor((st) => st.doc.widgets);
  const selection = useEditor((st) => st.selection);
  const zoom = useEditor((st) => st.view.zoom);

  const sel = widgets.filter((w) => selection.includes(w.id) && !w.hidden);
  if (sel.length === 0) return null;

  const px = 1 / zoom;
  const hs = 10 * px;

  if (sel.length > 1) {
    const box = union(sel.map(aabb));
    return (
      <>
        {sel.map((w) => (
          <div
            key={w.id}
            className={s.selBox}
            style={{
              left: w.x, top: w.y, width: w.w, height: w.h,
              transform: w.rotation ? `rotate(${w.rotation}deg)` : undefined,
              borderWidth: px,
              opacity: 0.7,
            }}
          />
        ))}
        <div
          className={s.selBox}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderWidth: 1.5 * px, borderStyle: "dashed" }}
        >
          <span className={s.sizeTag} style={{ fontSize: 11 * px, top: `calc(100% + ${8 * px}px)` }}>
            {sel.length} đối tượng
          </span>
        </div>
      </>
    );
  }

  const w = sel[0];
  return (
    <div
      className={s.selBox}
      style={{
        left: w.x, top: w.y, width: w.w, height: w.h,
        transform: w.rotation ? `rotate(${w.rotation}deg)` : undefined,
        borderWidth: 1.5 * px,
      }}
    >
      {!w.locked &&
        Object.entries(HANDLES).map(([name, dir]) => (
          <i
            key={name}
            data-handle={name}
            data-owner={w.id}
            className={s.handle}
            style={{
              left: `${(dir.hx + 1) * 50}%`,
              top: `${(dir.hy + 1) * 50}%`,
              width: hs, height: hs,
              marginLeft: -hs / 2, marginTop: -hs / 2,
              borderWidth: 1.5 * px,
              cursor: cursorFor(dir, w.rotation),
            }}
          />
        ))}
      {!w.locked && (
        <>
          <i className={s.stem} style={{ height: 22 * px, top: -22 * px, width: 1.5 * px, marginLeft: -0.75 * px }} />
          <i
            data-handle="rotate"
            data-owner={w.id}
            className={s.rotateHandle}
            style={{
              width: hs * 1.3, height: hs * 1.3,
              marginLeft: -hs * 0.65,
              top: -22 * px - hs * 0.65,
              borderWidth: 1.5 * px,
            }}
          />
        </>
      )}
      <span className={s.sizeTag} style={{ fontSize: 11 * px, top: `calc(100% + ${8 * px}px)` }}>
        {Math.round(w.w)} × {Math.round(w.h)}
        {w.rotation ? ` · ${Math.round(w.rotation)}°` : ""}
      </span>
    </div>
  );
}
