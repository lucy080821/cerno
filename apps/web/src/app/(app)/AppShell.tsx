import type { ReactNode } from "react";
import styles from "./shell.module.css";

/**
 * Vùng nội dung của một trang sau đăng nhập. Không còn khối tiêu đề lớn: tên trang đã hiện ở mục đang chọn của thanh bên, nên nội
 * dung lên sát đầu trang; `title` chỉ còn là tiêu đề ẩn cho trình đọc màn hình. Thanh trên (nút 3 gạch, tìm kiếm, ngôn ngữ, tài khoản)
 * và thanh bên nằm ở layout (ShellFrame) nên không dựng lại mỗi lần chuyển trang; component này không truy vấn gì.
 * `userName` và `desc` chỉ còn để các trang cũ truyền vào, không dùng nữa.
 */
export function AppShell({ title, actions, bare = false, children }: { userName?: string; title: string; desc?: string; actions?: ReactNode; /** Nội dung chiếm trọn chiều cao, lề nhỏ (trang chat). */ bare?: boolean; children: ReactNode }) {
  if (bare) return <div className={styles.bodyBare}><h1 className={styles.srOnly}>{title}</h1>{children}</div>;
  return (
    <div className={styles.body}>
      <h1 className={styles.srOnly}>{title}</h1>
      {actions && <div className={styles.actions}>{actions}</div>}
      {children}
    </div>
  );
}
