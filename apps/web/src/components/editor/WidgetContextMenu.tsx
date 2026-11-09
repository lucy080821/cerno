"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "@/lib/editor/store";
import { type FormatPart } from "@/lib/editor/widget-format";
import m from "./contextMenu.module.css";

/** Menu chuột phải của widget (chỉ ở chế độ sửa): sao chép/dán widget và sao chép/dán thông số sang widget khác. */
export function WidgetContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const st = useEditor();
  const sel = st.doc.widgets.filter((w) => st.selection.includes(w.id));
  const anyEditable = sel.some((w) => !w.locked);
  const clipName = (part: FormatPart) => {
    const w = st.formatClips[part];
    return w ? ((w.config as { title?: string }).title?.trim() || "widget đã chép") : "";
  };

  // Giữ menu trong màn hình.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const Item = ({ children, onClick, disabled, hint }: { children: ReactNode; onClick: () => void; disabled?: boolean; hint?: string }) => (
    <button role="menuitem" className={m.item} disabled={disabled} onClick={onClick}>
      <span>{children}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );

  return createPortal(
    <div ref={ref} className={m.menu} style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      <Item onClick={run(st.copy)} hint="Ctrl+C">Sao chép widget</Item>
      <Item onClick={run(st.paste)} disabled={st.clipboard.length === 0} hint="Ctrl+V">Dán widget</Item>
      <Item onClick={run(st.duplicateSelected)} hint="Ctrl+D">Nhân đôi</Item>
      <div className={m.sep} role="separator" />
      <div className={m.label}>Kích thước</div>
      <Item onClick={run(() => st.copyFormat("size"))} disabled={sel.length === 0}>Sao chép kích thước</Item>
      <Item
        onClick={run(() => st.pasteFormat("size"))}
        disabled={!st.formatClips.size || !anyEditable || sel.every((w) => w.id === st.formatClips.size?.id)}
      >
        Dán kích thước{st.formatClips.size ? ` (từ: ${clipName("size")})` : ""}
      </Item>
      <div className={m.label}>Vị trí</div>
      <Item onClick={run(() => st.copyFormat("position"))} disabled={sel.length === 0}>Sao chép vị trí</Item>
      <Item
        onClick={run(() => st.pasteFormat("position"))}
        disabled={!st.formatClips.position || !anyEditable || sel.every((w) => w.id === st.formatClips.position?.id)}
      >
        Dán vị trí{st.formatClips.position ? ` (từ: ${clipName("position")})` : ""}
      </Item>
      <div className={m.label}>Kiểu dáng</div>
      <Item onClick={run(() => st.copyFormat("style"))} disabled={sel.length === 0}>Sao chép kiểu dáng</Item>
      <Item
        onClick={run(() => st.pasteFormat("style"))}
        disabled={!st.formatClips.style || !anyEditable || sel.every((w) => w.id === st.formatClips.style?.id)}
      >
        Dán kiểu dáng{st.formatClips.style ? ` (từ: ${clipName("style")})` : ""}
      </Item>
      <div className={m.sep} role="separator" />
      <Item onClick={run(st.removeSelected)} hint="Del">Xoá</Item>
    </div>,
    document.body,
  );
}
