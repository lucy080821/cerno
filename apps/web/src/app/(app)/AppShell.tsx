import type { ReactNode } from "react";
import { LangSwitch } from "@/components/i18n/LangSwitch";
import Link from "next/link";
import { SignOutButton } from "./dashboards/SignOutButton";
import styles from "./shell.module.css";

/**
 * Thanh trên + vùng nội dung của một trang sau đăng nhập. Thanh bên nằm ở layout (app/(app)/layout.tsx) nên không dựng lại
 * mỗi lần chuyển trang; component này không truy vấn gì, nhận sẵn tên người dùng từ trang.
 */
export function AppShell({ userName, title, desc, actions, children }: { userName: string; title: string; desc?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className={styles.top}>
        <div className={styles.titleBox}>
          <h1 className={styles.title}>{title}</h1>
          {desc && <p className={styles.desc}>{desc}</p>}
        </div>
        <div className={styles.topRight}>
          {actions}
          <LangSwitch />
          <Link href="/account" className={styles.user} title="Tài khoản" data-i18n-skip>{userName}</Link>
          <SignOutButton />
        </div>
      </header>
      <div className={styles.body}>{children}</div>
    </>
  );
}
