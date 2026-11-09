"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useEditor } from "@/lib/editor/store";
import { loadLayoutPrefs, saveLayoutPrefs } from "@/lib/editor/layout-prefs";
import { Icon } from "./fields";
import s from "./editor.module.css";

/**
 * Vỏ của bảng bên trái: có nút ở mép để thu gọn / mở ra, dành thêm chỗ cho canvas.
 * Trạng thái nhớ theo trình duyệt. Sau khi trượt xong, canvas tự căn lại vừa khung mới.
 */
export function LeftShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);

  // Đọc tuỳ chọn đã lưu sau khi mount (tránh lệch giữa HTML dựng ở server và trình duyệt).
  useEffect(() => {
    setOpen(loadLayoutPrefs().leftOpen);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    saveLayoutPrefs({ leftOpen: next });
    window.setTimeout(() => useEditor.getState().fit(), 240);
  };

  return (
    <div className={`${s.leftShell} ${open ? "" : s.leftShellClosed}`}>
      <div className={s.leftInner} inert={!open}>
        {children}
      </div>
      <button
        type="button"
        className={s.panelToggle}
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Thu gọn bảng bên trái" : "Mở bảng bên trái"}
        title={open ? "Thu gọn bảng bên trái" : "Mở bảng bên trái"}
      >
        <Icon name="chevron" size={14} />
      </button>
    </div>
  );
}
