"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/Spinner";
import styles from "./login.module.css";

/** Đăng nhập bằng mã một lần gửi qua email, cho người được mời không dùng Google. */
export function EmailLogin({ next }: { next?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setErr(json.error ?? "Không gửi được mã. Thử lại nhé.");
      else {
        setStep("code");
        setCode("");
      }
    } catch {
      setErr("Không gửi được mã. Thử lại nhé.");
    }
    setBusy(false);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const { error } = await createClient().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    if (error) {
      setErr("Mã không đúng hoặc đã hết hạn.");
      setBusy(false);
      return;
    }
    window.location.assign(next ?? "/dashboards");
  }

  return step === "email" ? (
    <form className={styles.otpForm} onSubmit={sendCode}>
      <label className={styles.otpLabel} htmlFor="otp-email">Hoặc nhập email đã được mời</label>
      <input
        id="otp-email"
        className={styles.otpInput}
        type="email"
        autoComplete="email"
        required
        placeholder="ten@congty.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className={styles.otpBtn} type="submit" disabled={busy || !email.trim()}>
        {busy ? <><Spinner size={14} inline />Đang gửi mã…</> : "Gửi mã đăng nhập"}
      </button>
      {err && <p className={styles.error} role="alert">{err}</p>}
    </form>
  ) : (
    <form className={styles.otpForm} onSubmit={verify}>
      <p className={styles.notice} role="status">
        Nếu email này đã được mời, mã đăng nhập đã được gửi tới đó. Mã có hiệu lực trong ít phút.
      </p>
      <label className={styles.otpLabel} htmlFor="otp-code">Nhập mã trong email</label>
      <input
        id="otp-code"
        className={`${styles.otpInput} ${styles.otpCode}`}
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={8}
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      />
      <button className={styles.otpBtn} type="submit" disabled={busy || code.length < 6}>
        {busy ? <><Spinner size={14} inline />Đang kiểm tra…</> : "Đăng nhập"}
      </button>
      <button type="button" className={styles.alt} onClick={() => { setStep("email"); setErr(""); }}>
        Dùng email khác
      </button>
      {err && <p className={styles.error} role="alert">{err}</p>}
    </form>
  );
}
