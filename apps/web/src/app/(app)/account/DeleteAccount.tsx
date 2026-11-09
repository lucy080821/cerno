"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { confirmMatches } from "@/lib/account-utils";
import styles from "./account.module.css";
import { Spinner } from "@/components/Spinner";

/** Xóa tài khoản: phải gõ lại đúng email của mình mới bấm được nút. */
export function DeleteAccount({ email }: { email: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = confirmMatches(email, typed);

  async function remove() {
    if (!ok || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: typed }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Không xóa được tài khoản.");
      // Xóa phiên còn sót ở trình duyệt rồi về trang đăng nhập kèm thông báo.
      await createClient().auth.signOut().catch(() => {});
      window.location.assign("/login?deleted=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xóa được tài khoản.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.confirmBox}>
      <label className={styles.label}>
        Gõ lại email <strong>{email}</strong> để xác nhận
        <input
          className={styles.input}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={email}
          disabled={busy}
        />
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className={styles.deleteBtn} disabled={!ok || busy} onClick={remove}>
        {busy ? <><Spinner size={12} inline />Đang xóa…</> : "Xóa vĩnh viễn tài khoản và toàn bộ dữ liệu"}
      </button>
    </div>
  );
}
