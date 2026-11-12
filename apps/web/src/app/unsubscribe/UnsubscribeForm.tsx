"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import styles from "./unsubscribe.module.css";

type Action = "unsub" | "snooze" | "mute";

/**
 * Nút xác nhận cho các link trong email (huỷ nhận, tạm hoãn cảnh báo, tắt cảnh báo). Cố ý là một bước bấm riêng (POST) để bộ quét
 * link của hộp thư không làm thay người nhận.
 */
export function UnsubscribeForm({ token, action }: { token: string; action: Action }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit() {
    setState("busy");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Chưa huỷ được, vui lòng thử lại sau.");
      setState("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Chưa huỷ được, vui lòng thử lại sau.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className={styles.ok} role="status">
        {action === "snooze"
          ? "Đã tạm hoãn cảnh báo này trong 24 giờ."
          : action === "mute"
            ? "Đã tắt cảnh báo này."
            : "Đã huỷ. Bạn sẽ không nhận thêm email này nữa."}
      </p>
    );
  }
  return (
    <>
      <button className={styles.btn} onClick={submit} disabled={state === "busy"}>
        {state === "busy" ? <Spinner size={14} inline /> : null}{" "}
        {action === "snooze" ? "Tạm hoãn 24 giờ" : action === "mute" ? "Tắt cảnh báo này" : "Huỷ nhận email này"}
      </button>
      {state === "error" && <p className={styles.err} role="alert">{msg}</p>}
    </>
  );
}
