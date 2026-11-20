"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavIcon } from "@/components/shell/NavIcon";
import { activeKey, NAV } from "@/lib/shell/nav";
import { badgeText, initialsOf, usageRatio } from "@/lib/shell/sidebar";
import type { SidebarData } from "@/lib/server/sidebar";
import styles from "./shell.module.css";

/**
 * Thanh bên của mọi trang sau đăng nhập. Nằm ở layout nên KHÔNG bị dựng lại khi chuyển trang; số liệu (tên cửa hàng, kênh, số việc,
 * số cảnh báo, gói) tải nền từ /api/shell/sidebar, không chặn việc mở trang. Bản đã tải được nhớ ở module để hiện ngay lần sau.
 */
let cache: { at: number; data: SidebarData } | null = null;
const FRESH_MS = 30_000;

export function Sidebar() {
  const pathname = usePathname();
  const active = activeKey(pathname);
  const [sb, setSb] = useState<SidebarData | null>(cache?.data ?? null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (cache && Date.now() - cache.at < FRESH_MS) return;
      fetch("/api/shell/sidebar", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: SidebarData | null) => {
          if (!d || !alive) return;
          cache = { at: Date.now(), data: d };
          setSb(d);
        })
        .catch(() => {});
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

  return (
    <aside className={styles.side}>
      <Link href="/overview" className={styles.brand}><Brand size={26} tone="strong" /></Link>
      <Link href="/account" className={styles.shop}>
        {sb ? (
          <>
            <span className={styles.shopAvatar} aria-hidden data-i18n-skip>{initialsOf(sb.shop)}</span>
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
          const badge = n.badge && sb ? badgeText(sb[n.badge]) : null;
          const on = n.key === active;
          return (
            <Link key={n.key} href={n.href} className={`${styles.item} ${on ? styles.on : ""}`} aria-current={on ? "page" : undefined}>
              <span className={styles.icon}><NavIcon name={n.icon} /></span>
              <span className={styles.label}>{n.label}</span>
              {badge && <span className={styles.badge} data-i18n-skip>{badge}</span>}
            </Link>
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
