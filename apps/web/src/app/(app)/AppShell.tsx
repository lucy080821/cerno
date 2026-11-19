import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/Brand";
import { LangSwitch } from "@/components/i18n/LangSwitch";
import { NavIcon, type NavIconName } from "@/components/shell/NavIcon";
import { createClient } from "@/lib/supabase/server";
import { loadSidebar, type SidebarData } from "@/lib/server/sidebar";
import { badgeText, initialsOf, usageRatio } from "@/lib/shell/sidebar";
import { SignOutButton } from "./dashboards/SignOutButton";
import styles from "./shell.module.css";

export type ShellKey =
  | "overview" | "sources" | "orders" | "products" | "costs"
  | "dashboards" | "profit" | "returns" | "ai"
  | "todos" | "alerts" | "reports"
  | "templates" | "sharing" | "account";

type BadgeKey = "todos" | "alertsFiring";
interface NavItem { key: ShellKey; href: string; label: string; icon: NavIconName; badge?: BadgeKey }

const NAV: ({ group: string } | NavItem)[] = [
  { key: "overview", href: "/overview", label: "Tổng quan", icon: "home" },
  { group: "Dữ liệu" },
  { key: "sources", href: "/sources", label: "Nguồn dữ liệu", icon: "database" },
  { key: "orders", href: "/orders", label: "Đơn hàng", icon: "list" },
  { key: "products", href: "/products", label: "Sản phẩm và giá vốn", icon: "box" },
  { key: "costs", href: "/costs", label: "Chi phí", icon: "wallet" },
  { group: "Phân tích" },
  { key: "dashboards", href: "/dashboards", label: "Dashboard", icon: "grid" },
  { key: "profit", href: "/profit", label: "Lãi lỗ", icon: "trend" },
  { key: "returns", href: "/returns", label: "Hoàn và hủy", icon: "return" },
  { key: "ai", href: "/ai", label: "Hỏi AI", icon: "sparkle" },
  { group: "Hành động" },
  { key: "todos", href: "/todos", label: "Việc cần làm", icon: "check", badge: "todos" },
  { key: "alerts", href: "/alerts", label: "Cảnh báo", icon: "bell", badge: "alertsFiring" },
  { key: "reports", href: "/reports", label: "Báo cáo định kỳ", icon: "mail" },
  { group: "Chia sẻ" },
  { key: "templates", href: "/templates", label: "Mẫu dashboard", icon: "templates" },
  { key: "sharing", href: "/sharing", label: "Chia sẻ và nhúng", icon: "share" },
];

async function sidebarFor(userName: string): Promise<SidebarData | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    return await loadSidebar(supabase, user.id, userName || user.email || "");
  } catch (e) {
    console.error("[shell/sidebar]", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Khung chung của các trang sau đăng nhập: thanh bên (cửa hàng, điều hướng theo nhóm, gói), thanh trên có ngôn ngữ, tài khoản, đăng xuất. */
export async function AppShell({ active, userName, title, desc, actions, children, sidebar }: {
  active: ShellKey; userName: string; title: string; desc?: string; actions?: ReactNode; children: ReactNode;
  /** Số liệu thanh bên dựng sẵn (trang thử giao diện); bỏ trống thì tự đọc theo phiên đăng nhập. */
  sidebar?: SidebarData;
}) {
  const sb = sidebar ?? (await sidebarFor(userName));
  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <Link href="/overview" className={styles.brand}><Brand size={26} tone="strong" /></Link>
        {sb && (
          <Link href="/account" className={styles.shop}>
            <span className={styles.shopAvatar} aria-hidden data-i18n-skip>{initialsOf(sb.shop)}</span>
            <span className={styles.shopText}>
              <b data-i18n-skip>{sb.shop}</b>
              {sb.channels ? <span data-i18n-skip>{sb.channels}</span> : <span>Chưa có dữ liệu đơn hàng</span>}
            </span>
          </Link>
        )}
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
      <div className={styles.main}>
        <header className={styles.top}>
          <div className={styles.titleBox}>
            <h1 className={styles.title}>{title}</h1>
            {desc && <p className={styles.desc}>{desc}</p>}
          </div>
          <div className={styles.topRight}>
            {actions}
            <LangSwitch />
            <Link href="/account" className={`${styles.user} ${active === "account" ? styles.userOn : ""}`} title="Tài khoản" data-i18n-skip>{userName}</Link>
            <SignOutButton />
          </div>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
