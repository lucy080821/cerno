"use client";

import { createClient } from "@/lib/supabase/client";
import styles from "./dashboards.module.css";

export function SignOutButton() {
  return (
    <button
      className={styles.ghost}
      onClick={async () => {
        await createClient().auth.signOut();
        // Tải lại cả trang (không chuyển trang trong app) để xoá sạch số liệu đã nhớ trong trình duyệt của người dùng cũ.
        window.location.assign("/");
      }}
    >
      Đăng xuất
    </button>
  );
}
