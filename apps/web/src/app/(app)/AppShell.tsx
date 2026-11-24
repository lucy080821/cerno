import type { ReactNode } from "react";
import styles from "./shell.module.css";

/**
 * Tiêu đề trang + vùng nội dung của một trang sau đăng nhập. Thanh trên (nút 3 gạch, tìm kiếm, ngôn ngữ, tài khoản) và thanh bên
 * nằm ở layout (ShellFrame) nên không dựng lại mỗi lần chuyển trang; component này không truy vấn gì.
 * `userName` chỉ còn để các trang cũ truyền vào, không dùng nữa.
 */
export function AppShell({ title, desc, actions, children }: { userName?: string; title: string; desc?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className={styles.top}>
        <div className={styles.titleBox}>
          <h1 className={styles.title}>{title}</h1>
          {desc && <p className={styles.desc}>{desc}</p>}
        </div>
        {actions && <div className={styles.topRight}>{actions}</div>}
      </header>
      <div className={styles.body}>{children}</div>
    </>
  );
}
