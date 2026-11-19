import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/Brand";
import { LangSwitch } from "@/components/i18n/LangSwitch";
import { SignOutButton } from "./dashboards/SignOutButton";
import styles from "./shell.module.css";

export type ShellKey = "dashboards" | "orders" | "products" | "profit" | "returns" | "todos" | "account";

const NAV: ({ group: string } | { key: ShellKey; href: string; label: string; icon: string })[] = [
  { key: "dashboards", href: "/dashboards", label: "Dashboard", icon: "▦" },
  { group: "Lãi từng đơn" },
  { key: "orders", href: "/orders", label: "Đơn hàng", icon: "≣" },
  { key: "products", href: "/products", label: "Sản phẩm và giá vốn", icon: "◫" },
  { key: "profit", href: "/profit", label: "Lãi lỗ", icon: "↗" },
  { key: "returns", href: "/returns", label: "Hoàn và hủy", icon: "↺" },
  { key: "todos", href: "/todos", label: "Việc cần làm", icon: "✓" },
  { group: "Cá nhân" },
  { key: "account", href: "/account", label: "Tài khoản", icon: "◎" },
];

/** Khung chung của các trang sau đăng nhập: thanh điều hướng bên trái, thanh trên có tên người dùng, ngôn ngữ, đăng xuất. */
export function AppShell({ active, userName, title, desc, actions, children }: { active: ShellKey; userName: string; title: string; desc?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <Link href="/dashboards" className={styles.brand}><Brand size={26} tone="strong" /></Link>
        <nav className={styles.nav} aria-label="Điều hướng">
          {NAV.map((n, i) =>
            "group" in n ? (
              <div key={i} className={styles.group}>{n.group}</div>
            ) : (
              <Link key={n.key} href={n.href} className={`${styles.item} ${n.key === active ? styles.on : ""}`} aria-current={n.key === active ? "page" : undefined}>
                <span className={styles.icon} aria-hidden>{n.icon}</span>
                <span>{n.label}</span>
              </Link>
            ),
          )}
        </nav>
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
            <span className={styles.user} data-i18n-skip>{userName}</span>
            <SignOutButton />
          </div>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
