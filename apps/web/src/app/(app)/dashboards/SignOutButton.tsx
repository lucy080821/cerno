"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./dashboards.module.css";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className={styles.ghost}
      onClick={async () => {
        await createClient().auth.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      Đăng xuất
    </button>
  );
}
