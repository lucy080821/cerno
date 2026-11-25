"use client";

import { useEffect } from "react";
import styles from "./app-error.module.css";

/** Trang con gặp lỗi: giữ nguyên khung (thanh bên, thanh trên) và cho tải lại thay vì màn hình trắng. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);
  return (
    <div className={styles.box} role="alert">
      <h2>Trang này gặp lỗi</h2>
      <p>Có thể do hệ thống vừa được cập nhật phiên bản mới. Hãy tải lại trang; nếu vẫn lỗi, bạn thử lại sau ít phút.</p>
      <div className={styles.row}>
        <button type="button" className={styles.primary} onClick={() => window.location.reload()}>Tải lại trang</button>
        <button type="button" className={styles.ghost} onClick={reset}>Thử lại</button>
      </div>
    </div>
  );
}
