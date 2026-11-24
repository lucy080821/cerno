import type { ReactNode } from "react";
import { ShellFrame } from "./ShellFrame";

/**
 * Khung chung của các trang sau đăng nhập (thanh trên, thanh bên, khung chat AI). Nó giữ nguyên khi chuyển trang: chỉ phần nội dung
 * ở giữa đổi và hiện màn hình chờ ngay ở loading.tsx. Việc kiểm tra đăng nhập nằm ở middleware và ở từng trang.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <ShellFrame>{children}</ShellFrame>;
}
