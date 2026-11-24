"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NavIcon } from "@/components/shell/NavIcon";
import { activeKey, NAV } from "@/lib/shell/nav";
import { badgeText, initialsOf, usageRatio } from "@/lib/shell/sidebar";
import { pendingCount, useDoneTodos } from "@/lib/profit/todos-done";
import { useShell } from "@/lib/shell/store";
import { useSidebarData } from "@/lib/shell/use-sidebar";
import styles from "./shell.module.css";

/**
 * Thanh bên của mọi trang sau đăng nhập. Nằm ở layout nên KHÔNG bị dựng lại khi chuyển trang; số liệu (tên cửa hàng, kênh, số việc,
 * số cảnh báo, gói) tải nền từ /api/shell/sidebar, không chặn việc mở trang. Bản đã tải được nhớ ở module để hiện ngay lần sau.
 */
/** Ảnh đại diện Google; chưa có hoặc tải lỗi (bị chặn, hết hạn) thì hiện chữ viết tắt như trước. */
function ShopAvatar({ url, initials }: { url: string | null; initials: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <span className={styles.shopAvatar} aria-hidden data-i18n-skip>
      {url && !failed ? (
        // Ảnh Google đôi khi từ chối khi có Referer: gửi không kèm.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </span>
  );
}
const TREE_KEY = "cerno.shell.tree";

/** Mục có cây con: Dashboard (các dashboard mới sửa) và Nguồn dữ liệu. */
const TREE_PARENTS = new Set(["dashboards", "sources"]);

export function Sidebar() {
  const pathname = usePathname();
  const active = activeKey(pathname);
  const sb = useSidebarData(pathname);
  const closeSide = useShell((s) => s.closeSide);
  const doneTodos = useDoneTodos();
  const [open, setOpen] = useState<Record<string, boolean>>({ dashboards: true, sources: false });

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(TREE_KEY) ?? "null");
      if (v && typeof v === "object") setOpen((o) => ({ ...o, ...v }));
    } catch {
      /* localStorage bị chặn */
    }
  }, []);
  const toggle = (k: string) =>
    setOpen((o) => {
      const next = { ...o, [k]: !o[k] };
      try {
        localStorage.setItem(TREE_KEY, JSON.stringify(next));
      } catch {
        /* localStorage bị chặn */
      }
      return next;
    });

  const children = (key: string): { id: string; name: string; href: string }[] =>
    !sb ? [] : key === "dashboards" ? sb.dashboards.map((d) => ({ id: d.id, name: d.name, href: `/editor/${d.id}` })) : key === "sources" ? sb.sourceList.map((d) => ({ id: d.id, name: d.name, href: "/sources" })) : [];

  return (
    <aside className={styles.side} onClick={(e) => (e.target as HTMLElement).closest("a") && closeSide()}>
      <Link href="/account" className={styles.shop}>
        {sb ? (
          <>
            <ShopAvatar url={sb.avatar} initials={initialsOf(sb.shop)} />
            <span className={styles.shopText}>
              <b data-i18n-skip>{sb.shop}</b>
              {sb.channels ? <span data-i18n-skip>{sb.channels}</span> : <span>Chưa có dữ liệu đơn hàng</span>}
            </span>
          </>
        ) : (
          <>
            <span className={`${styles.shopAvatar} ${styles.skel}`} aria-hidden />
            <span className={styles.shopText}>
              <span className={`${styles.skelLine} ${styles.skel}`} />
              <span className={`${styles.skelLine} ${styles.skel}`} style={{ width: "60%" }} />
            </span>
          </>
        )}
      </Link>
      <nav className={styles.nav} aria-label="Điều hướng">
        {NAV.map((n, i) => {
          if ("group" in n) return <div key={i} className={styles.group}>{n.group}</div>;
          const badge = n.badge && sb ? badgeText(n.badge === "todos" && sb.todoIds ? pendingCount(sb.todoIds, doneTodos) : sb[n.badge]) : null;
          const on = n.key === active;
          const kids = TREE_PARENTS.has(n.key) ? children(n.key) : [];
          const expanded = kids.length > 0 && !!open[n.key];
          return (
            <div key={n.key}>
              <div className={styles.itemRow}>
                <Link href={n.href} className={`${styles.item} ${on ? styles.on : ""}`} aria-current={on ? "page" : undefined}>
                  <span className={styles.icon}><NavIcon name={n.icon} /></span>
                  <span className={styles.label}>{n.label}</span>
                  {badge && <span className={styles.badge} data-i18n-skip>{badge}</span>}
                </Link>
                {kids.length > 0 && (
                  <button type="button" className={`${styles.chev} ${expanded ? styles.chevOpen : ""}`} onClick={() => toggle(n.key)} aria-expanded={expanded} aria-label={expanded ? "Thu gọn" : "Mở rộng"}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
                  </button>
                )}
              </div>
              {expanded && (
                <div className={styles.tree}>
                  {kids.map((k) => (
                    <Link key={k.id} href={k.href} className={styles.leaf} title={k.name}>
                      <span data-i18n-skip>{k.name}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      {sb && (
        <Link href="/upgrade" className={styles.plan}>
          <b>{sb.plan === "free" ? "Gói miễn phí" : "Gói trả phí"}</b>
          <span>{`${sb.sources} trên ${sb.maxSources} nguồn dữ liệu`}</span>
          <span className={styles.meter} aria-hidden><i style={{ width: `${Math.round(usageRatio(sb.sources, sb.maxSources) * 100)}%` }} /></span>
          {sb.plan === "free" && <span className={styles.planCta}>Nâng cấp để có báo cáo hằng ngày</span>}
        </Link>
      )}
    </aside>
  );
}
