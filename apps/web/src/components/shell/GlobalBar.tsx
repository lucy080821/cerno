"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { LangSwitch } from "@/components/i18n/LangSwitch";
import { NavIcon } from "@/components/shell/NavIcon";
import { createClient } from "@/lib/supabase/client";
import { useShell } from "@/lib/shell/store";
import { useSidebarData } from "@/lib/shell/use-sidebar";
import { initialsOf } from "@/lib/shell/sidebar";
import { SearchBox } from "./SearchBox";
import styles from "./shellbar.module.css";

/**
 * Thanh trên cùng của mọi trang sau đăng nhập (nằm ở layout nên không bị dựng lại khi chuyển trang): nút 3 gạch ẩn/hiện thanh bên,
 * logo, ô tìm kiếm, nút mở khung chat AI, đổi ngôn ngữ và menu tài khoản.
 */
export function GlobalBar({ hideChat = false }: { hideChat?: boolean }) {
  const sb = useSidebarData();
  const toggleSide = useShell((s) => s.toggleSide);
  const side = useShell((s) => s.side);
  const chat = useShell((s) => s.chat);
  const setChat = useShell((s) => s.setChat);
  const init = useShell((s) => s.init);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => init(), [init]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const name = sb?.userName ?? "";
  return (
    <header className={styles.bar}>
      <button type="button" className={styles.burger} onClick={toggleSide} aria-label="Ẩn hoặc hiện thanh bên" aria-expanded={side !== "closed"} title="Ẩn / hiện thanh bên">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <Link href="/overview" className={styles.logo}><Brand size={24} tone="strong" /></Link>
      <SearchBox />
      <div className={styles.right}>
        {!hideChat && (
          <button type="button" className={`${styles.chatBtn} ${chat ? styles.chatOn : ""}`} onClick={() => setChat(!chat)} aria-pressed={chat} title="Mở / đóng khung chat AI">
            <NavIcon name="sparkle" size={16} />
            <span>Hỏi AI</span>
          </button>
        )}
        <LangSwitch compact />
        <div className={styles.account} ref={menuRef}>
          <button type="button" className={styles.avatarBtn} onClick={() => setMenu((o) => !o)} aria-haspopup="menu" aria-expanded={menu} aria-label="Tài khoản">
            {sb?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sb.avatar} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span data-i18n-skip>{name ? initialsOf(name) : "·"}</span>
            )}
          </button>
          {menu && (
            <div className={styles.menu} role="menu">
              {name && <div className={styles.menuName} data-i18n-skip>{name}</div>}
              <Link href="/account" role="menuitem" onClick={() => setMenu(false)}>Tài khoản</Link>
              <Link href="/upgrade" role="menuitem" onClick={() => setMenu(false)}>Gói và nâng cấp</Link>
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  await createClient().auth.signOut();
                  // Tải lại cả trang để xoá sạch số liệu đã nhớ trong trình duyệt của người dùng cũ.
                  window.location.assign("/");
                }}
              >
                Đăng xuất
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
