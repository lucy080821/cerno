"use client";

import { LangSwitch } from "@/components/i18n/LangSwitch";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useDialog } from "@/components/ui/DialogProvider";
import { LogoMark } from "@/components/Logo";
import { ExportDialog } from "./ExportDialog";
import { ShareDialog } from "./ShareDialog";
import { NotifyDialog } from "./NotifyDialog";
import { reportableWidgets } from "@/lib/notify/format";
import { useEditor } from "@/lib/editor/store";
import { createBlankDashboard, createDemoDashboard } from "@/lib/editor/defaults";
import { downloadJson, parseDashboard } from "@/lib/editor/io";
import { saveNow, useSave } from "@/lib/editor/save-store";
import { Icon } from "./fields";
import { RefreshData } from "./RefreshData";
import s from "./editor.module.css";

const SAVE_LABEL = {
  saved: "Đã lưu",
  dirty: "Chưa lưu…",
  saving: "Đang lưu…",
  error: "Lưu lỗi, đang thử lại",
  conflict: "Xung đột phiên bản",
} as const;
const SAVE_CLASS = {
  saved: s.savedOk,
  dirty: s.savedWarn,
  saving: s.savedBusy,
  error: s.savedErr,
  conflict: s.savedErr,
} as const;

/** Menu "⋯": gom các thao tác ít dùng (mẫu, trống, xuất/nhập JSON) để thanh công cụ không bị chật. */
function MoreMenu({ items }: { items: Array<{ icon: Parameters<typeof Icon>[0]["name"]; label: string; run: () => void }> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={s.menuWrap} ref={ref}>
      <button className={s.iconBtn} title="Thêm" aria-label="Thêm" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}><Icon name="more" /></button>
      {open && (
        <div className={s.menu} role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" className={s.menuItem}
              onClick={() => { setOpen(false); it.run(); }}>
              <Icon name={it.icon} size={14} /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar({ onMobile, onFullscreen, notify, canShare = true }: {
  onMobile: () => void;
  onFullscreen: () => void;
  notify: (msg: string) => void;
  canShare?: boolean;
}) {
  const dialog = useDialog();
  const name = useEditor((st) => st.doc.name);
  const doc = useEditor((st) => st.doc);
  const zoom = useEditor((st) => st.view.zoom);
  const mode = useEditor((st) => st.mode);
  const canUndo = useEditor((st) => st.past.length > 0);
  const canRedo = useEditor((st) => st.future.length > 0);
  const { mutate, undo, redo, zoomAt, fit, setMode, loadDoc } = useEditor.getState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const dashboardId = useEditor((st) => st.doc.id);

  const zoomBy = (f: number) => {
    const { viewport } = useEditor.getState();
    zoomAt(viewport.w / 2, viewport.h / 2, f);
  };

  const save = useSave((st) => st.status);

  // Thay nội dung nhưng giữ id: dashboard vẫn là cùng một bản ghi trên server (loadDoc đổi doc nên tự lưu lại).
  const replaceDoc = (next: ReturnType<typeof createDemoDashboard>) => {
    loadDoc({ ...next, id: useEditor.getState().doc.id });
    requestAnimationFrame(() => useEditor.getState().fit());
  };

  return (
    <header className={s.top}>
      <div className={s.topLeft}>
        <Link href="/dashboards" className={s.logoLink} title="Về danh sách dashboard">
          <LogoMark size={30} />
        </Link>
        <input
          className={s.nameInput}
          value={name}
          aria-label="Tên dashboard"
          onChange={(e) => mutate((d) => ({ ...d, name: e.target.value }), "name")}
        />
        <button
          className={`${s.saved} ${SAVE_CLASS[save]}`}
          style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }}
          title="Lưu ngay (Ctrl+S)"
          onClick={() => void saveNow()}
        >
          {SAVE_LABEL[save]}
        </button>
      </div>

      <div className={s.topCenter}>
        <button className={s.iconBtn} title="Hoàn tác (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Icon name="undo" /></button>
        <button className={s.iconBtn} title="Làm lại (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}><Icon name="redo" /></button>
        <span className={s.sep} />
        <button className={s.iconBtn} title="Thu nhỏ" onClick={() => zoomBy(1 / 1.2)}><Icon name="minus" /></button>
        <button className={s.zoomLabel} title="Về 100%" onClick={() => zoomBy(1 / zoom)}>{Math.round(zoom * 100)}%</button>
        <button className={s.iconBtn} title="Phóng to" onClick={() => zoomBy(1.2)}><Icon name="plus" /></button>
        <button className={s.iconBtn} title="Vừa màn hình (Ctrl+0)" onClick={() => fit()}><Icon name="fit" /></button>
      </div>

      <div className={s.topRight}>
        <LangSwitch compact />
        <RefreshData variant="bar" />
        <button className={s.btn} title="Toàn màn hình (F)" aria-label="Toàn màn hình" onClick={onFullscreen}>
          <Icon name="expand" size={14} /><span className={s.lblWide}>Toàn màn hình</span>
        </button>
        <button className={s.btn} title="Xem trên điện thoại" aria-label="Mobile" onClick={onMobile}>
          <Icon name="phone" size={14} /><span className={s.lblWide}>Mobile</span>
        </button>
        <button className={s.btn} title="Xuất ảnh (PNG, JPEG, WebP, SVG)" aria-label="Xuất ảnh" onClick={() => setExportOpen(true)}>
          <Icon name="image" size={14} /><span className={s.lblWide}>Xuất ảnh</span>
        </button>
        <MoreMenu items={[
          { icon: "reset", label: "Thay bằng dashboard mẫu", run: async () => {
            const ok = await dialog.confirm({
              title: "Thay bằng dashboard mẫu?",
              message: "Nội dung hiện tại của dashboard này sẽ bị thay bằng dashboard mẫu. Bạn có thể hoàn tác ngay bằng Ctrl+Z.",
              confirmText: "Thay bằng mẫu",
              tone: "danger",
            });
            if (ok) replaceDoc(createDemoDashboard());
          } },
          { icon: "file", label: "Tạo dashboard trống", run: async () => {
            const ok = await dialog.confirm({
              title: "Tạo dashboard trống?",
              message: "Nội dung hiện tại của dashboard này sẽ bị thay bằng một trang trống. Bạn có thể hoàn tác ngay bằng Ctrl+Z.",
              confirmText: "Tạo trống",
              tone: "danger",
            });
            if (ok) replaceDoc(createBlankDashboard());
          } },
          { icon: "download", label: "Xuất JSON", run: () => downloadJson(doc) },
          { icon: "upload", label: "Nhập JSON", run: () => fileRef.current?.click() },
        ]} />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const r = parseDashboard(await f.text());
            if (r.ok) { replaceDoc(r.doc); notify("Đã nhập dashboard"); }
            else notify(`Không nhập được: ${r.error}`);
          }}
        />
        <span className={s.sep} />
        <button className={s.btn} title="Báo cáo định kỳ qua email" aria-label="Thông báo" onClick={() => setNotifyOpen(true)}>
          <Icon name="bell" size={14} /><span className={s.lblWide}>Thông báo</span>
        </button>
        {canShare && <button className={s.btn} title="Chia sẻ và nhúng vào website" aria-label="Chia sẻ" onClick={() => setShareOpen(true)}>
          <Icon name="share" size={14} /><span className={s.lblWide}>Chia sẻ</span>
        </button>}
        <button className={`${s.btn} ${mode === "preview" ? s.btnActive : ""}`}
          onClick={() => setMode(mode === "edit" ? "preview" : "edit")}>
          <Icon name={mode === "edit" ? "play" : "pencil"} size={14} /> {mode === "edit" ? "Xem trước" : "Quay lại sửa"}
        </button>
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} notify={notify} />}
      {shareOpen && <ShareDialog dashboardId={dashboardId} onClose={() => setShareOpen(false)} />}
      {notifyOpen && <NotifyDialog dashboardId={dashboardId} widgets={reportableWidgets(doc)} onClose={() => setNotifyOpen(false)} />}
    </header>
  );
}
