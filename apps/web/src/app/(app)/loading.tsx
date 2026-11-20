import { Spinner } from "@/components/Spinner";
import styles from "./shell.module.css";

/** Màn hình chờ hiện NGAY khi bấm chuyển trang (thanh bên vẫn giữ nguyên), trong lúc máy chủ dựng trang mới. */
export default function Loading() {
  return (
    <>
      <header className={styles.top}><div className={`${styles.skelLine} ${styles.skel}`} style={{ width: 180, height: 26 }} /></header>
      <div className={styles.body} style={{ display: "grid", placeItems: "center", minHeight: 320 }}>
        <Spinner size={32} label="Đang tải…" />
      </div>
    </>
  );
}
