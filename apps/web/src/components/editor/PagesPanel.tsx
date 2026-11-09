"use client";

import { useState } from "react";
import { MAX_PAGES, getPages, pageIdOf, resolvePageId } from "@dashboard/schema";
import { useEditor } from "@/lib/editor/store";
import { Icon, Section } from "./fields";
import { pageLabel } from "./PageNav";
import s from "./editor.module.css";
import { useDialog } from "@/components/ui/DialogProvider";

/** Danh sách trang ở thanh trái của editor: chọn, đổi tên (nhấp đúp), đổi chỗ, nhân đôi, xoá, thêm trang. */
export function PagesPanel() {
  const dialog = useDialog();
  const doc = useEditor((st) => st.doc);
  const pageId = useEditor((st) => resolvePageId(st.doc, st.pageId));
  const { setPage, addPage, renamePage, deletePage, duplicatePage, movePage } = useEditor.getState();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const pages = getPages(doc);
  const count = (id: string) => doc.widgets.filter((w) => pageIdOf(doc, w) === id).length;

  const startEdit = (id: string, name: string) => {
    setEditing(id);
    setDraft(name);
  };
  const commit = () => {
    if (editing) renamePage(editing, draft);
    setEditing(null);
  };

  const remove = async (id: string, label: string) => {
    const n = count(id);
    if (n > 0) {
      const ok = await dialog.confirm({
        title: "Xóa trang?",
        message: `Xóa "${label}" và ${n} đối tượng trên trang này? Bạn có thể hoàn tác bằng Ctrl+Z.`,
        confirmText: "Xóa trang",
        tone: "danger",
      });
      if (!ok) return;
    }
    deletePage(id);
  };

  return (
    <Section title={`Trang (${pages.length})`}>
      <ul className={s.pageList}>
        {pages.map((p, i) => {
          const on = p.id === pageId;
          const label = pageLabel(p.name, i);
          return (
            <li key={p.id} className={`${s.pageRow} ${on ? s.pageRowOn : ""}`}>
              {editing === p.id ? (
                <input
                  className={`${s.input} ${s.pageEdit}`}
                  value={draft}
                  autoFocus
                  maxLength={80}
                  aria-label="Tên trang"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <button
                  className={s.pageBtn}
                  onClick={() => setPage(p.id)}
                  onDoubleClick={() => startEdit(p.id, p.name)}
                  title="Nhấp đúp để đổi tên"
                >
                  <span className={s.pageName}>{label}</span>
                  <span className={s.pageCount}>{count(p.id)}</span>
                </button>
              )}
              {on && editing !== p.id && (
                <span className={s.pageActions}>
                  <button className={s.iconBtn} title="Đổi tên" onClick={() => startEdit(p.id, p.name)}><Icon name="pencil" size={13} /></button>
                  <button className={s.iconBtn} title="Đưa lên" disabled={i === 0} onClick={() => movePage(p.id, -1)}>↑</button>
                  <button className={s.iconBtn} title="Đưa xuống" disabled={i === pages.length - 1} onClick={() => movePage(p.id, 1)}>↓</button>
                  <button className={s.iconBtn} title="Nhân đôi trang" disabled={pages.length >= MAX_PAGES} onClick={() => duplicatePage(p.id)}><Icon name="copy" size={13} /></button>
                  <button className={s.iconBtn} title={pages.length <= 1 ? "Phải còn ít nhất một trang" : "Xoá trang"}
                    disabled={pages.length <= 1} onClick={() => remove(p.id, label)}><Icon name="trash" size={13} /></button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <button className={s.smallBtn} disabled={pages.length >= MAX_PAGES} onClick={() => addPage()}>
        <Icon name="plus" size={13} /> Thêm trang
      </button>
      {pages.length >= MAX_PAGES && <p className={s.hint}>Tối đa {MAX_PAGES} trang.</p>}
    </Section>
  );
}
