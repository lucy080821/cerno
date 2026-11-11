"use client";

import type { CSSProperties, ReactNode } from "react";
import { getPages, resolvePageId } from "@dashboard/schema";
import { useEditor } from "@/lib/editor/store";
import { getPageIcon } from "@/lib/editor/page-icons";
import s from "./editor.module.css";

/** Tên hiển thị của trang (tên trống thì dùng "Trang N"). */
export const pageLabel = (name: string, index: number) => name.trim() || `Trang ${index + 1}`;

/** Chuyển sang trang kế (1) hoặc trước (-1). Không vòng lại ở hai đầu. */
export function stepPage(dir: 1 | -1) {
  const st = useEditor.getState();
  const pages = getPages(st.doc);
  const i = pages.findIndex((p) => p.id === resolvePageId(st.doc, st.pageId));
  const next = pages[i + dir];
  if (next) st.setPage(next.id);
}

/**
 * Thanh danh sách trang bên trái, hiện khi xem trước / toàn màn hình (và trong khung xem thử ở bảng Thiết lập).
 * Toàn bộ giao diện (màu, cỡ chữ, bo góc, độ rộng) lấy từ `doc.nav`, người dùng chỉnh được.
 */
export function PageNav({ embedded = false, keyboardHint = true }: { embedded?: boolean; keyboardHint?: boolean }) {
  const doc = useEditor((st) => st.doc);
  const pageId = useEditor((st) => resolvePageId(st.doc, st.pageId));
  const setPage = useEditor((st) => st.setPage);
  const nav = doc.nav;
  const pages = getPages(doc);

  // Khi xem: chỉ hiện nếu có từ 2 trang trở lên và người dùng không tắt. Khung xem thử luôn hiện.
  if (!embedded && (!nav.show || pages.length < 2)) return null;

  const vars = {
    "--nav-bg": nav.background,
    "--nav-text": nav.textColor,
    "--nav-active": nav.activeColor,
    "--nav-active-bg": nav.activeBackground,
    "--nav-size": `${nav.fontSize}px`,
    "--nav-weight": nav.bold ? 700 : 500,
    "--nav-radius": `${nav.radius}px`,
    width: nav.width,
  } as CSSProperties;

  return (
    <nav className={`${s.pageNav} ${embedded ? s.pageNavEmbedded : ""}`} style={vars} aria-label="Danh sách trang">
      {nav.showTitle && (
        <div className={s.pageNavHead}>
          {nav.logo && /^https:\/\//.test(nav.logo) ? (
            <span className={`${s.pageNavLogo} ${s.pageNavLogoImg}`} aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={nav.logo} alt="" />
            </span>
          ) : (
            <span className={s.pageNavLogo} aria-hidden>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
                <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
              </svg>
            </span>
          )}
          <span className={s.pageNavName} title={doc.name}>{doc.name || "Dashboard"}</span>
        </div>
      )}
      <div className={s.pageNavSection}>Trang</div>
      <ul className={s.pageNavList}>
        {pages.map((p, i) => (
          <li key={p.id}>
            <button
              className={`${s.pageNavItem} ${p.id === pageId ? s.pageNavItemOn : ""}`}
              aria-current={p.id === pageId ? "page" : undefined}
              onClick={() => setPage(p.id)}
              title={pageLabel(p.name, i)}
            >
              <svg className={s.pageNavIcon} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {getPageIcon(p.icon).paths.map((d, k) => <path key={k} d={d} />)}
              </svg>
              <span className={s.pageNavLabel}>{pageLabel(p.name, i)}</span>
              <span className={s.pageNavNum}>{i + 1}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={s.pageNavFoot}>{pages.length} trang{keyboardHint ? " · ← → để chuyển" : ""}</div>
    </nav>
  );
}

/** Nút trang trước / trang sau nổi ở dưới khi xem. */
export function PageSwitcher() {
  const doc = useEditor((st) => st.doc);
  const pageId = useEditor((st) => resolvePageId(st.doc, st.pageId));
  const pages = getPages(doc);
  if (pages.length < 2) return null;
  const i = pages.findIndex((p) => p.id === pageId);

  return (
    <div className={s.pageSwitcher} role="group" aria-label="Chuyển trang">
      <button className={s.pageSwitchBtn} disabled={i <= 0} onClick={() => stepPage(-1)} title="Trang trước (←)" aria-label="Trang trước">‹</button>
      <span className={s.pageSwitchLabel}>{pageLabel(pages[i].name, i)} · {i + 1}/{pages.length}</span>
      <button className={s.pageSwitchBtn} disabled={i >= pages.length - 1} onClick={() => stepPage(1)} title="Trang sau (→)" aria-label="Trang sau">›</button>
    </div>
  );
}

/**
 * Bọc canvas để có hiệu ứng chuyển trang khi xem. Đổi `key` theo trang nên mỗi lần chuyển là một lần vào cảnh
 * mới (trượt hoặc mờ dần theo `nav.transition`, trượt theo hướng tới/lui). Khi sửa thì không có hiệu ứng.
 */
export function PageStage({ children }: { children: ReactNode }) {
  const preview = useEditor((st) => st.mode === "preview");
  const pageId = useEditor((st) => resolvePageId(st.doc, st.pageId));
  const dir = useEditor((st) => st.pageDir);
  const transition = useEditor((st) => st.doc.nav.transition);
  const anim = preview && transition !== "none" ? s[`pg_${transition}`] ?? "" : "";
  return (
    <div key={preview ? pageId : "edit"} className={`${s.pageAnim} ${anim}`} data-dir={dir}
      style={{ "--d": dir >= 0 ? 1 : -1 } as CSSProperties}>
      {children}
    </div>
  );
}
