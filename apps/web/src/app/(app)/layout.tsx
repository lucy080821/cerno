import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import styles from "./shell.module.css";

/**
 * Khung chung của các trang sau đăng nhập. Thanh bên ở đây nên giữ nguyên khi chuyển trang (chỉ phần nội dung bên phải đổi và
 * hiện màn hình chờ ngay ở loading.tsx). Việc kiểm tra đăng nhập nằm ở middleware và ở từng trang.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
