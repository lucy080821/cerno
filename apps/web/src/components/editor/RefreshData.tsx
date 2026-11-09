"use client";

import { useEffect, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { useData } from "@/lib/editor/data-store";
import { syncNow } from "@/lib/editor/remote-data";
import { timeAgo } from "@/lib/editor/time";
import { Icon } from "./fields";
import s from "./editor.module.css";

/**
 * Nút "Cập nhật dữ liệu": lấy dữ liệu mới nhất từ Google Sheets cho mọi nguồn đang dùng trong dashboard,
 * kèm "cập nhật X phút trước". Chỉ hiện khi dashboard có nguồn Google Sheets.
 * `bar`: trên thanh công cụ. `float`: nổi ở góc dưới phải khi xem trước / toàn màn hình.
 */
export function RefreshData({ variant }: { variant: "bar" | "float" }) {
  const sources = useEditor((st) => st.doc.sources);
  const syncedAt = useData((st) => st.syncedAt);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [, tick] = useState(0);

  // Làm tươi chữ "x phút trước" mỗi 30 giây.
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(""), 5000);
    return () => window.clearTimeout(t);
  }, [msg]);

  const ids = sources.filter((x) => x.type === "google_sheets").map((x) => x.id);
  if (ids.length === 0) return null;

  // Thời điểm cũ nhất trong các nguồn đang dùng: đó mới là độ "mới" thật của cả dashboard.
  const stamps = ids.map((id) => syncedAt[id]).filter((x): x is string => !!x);
  const oldest = stamps.length === ids.length ? stamps.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    const results = await Promise.all(ids.map((id) => syncNow(id)));
    setBusy(false);
    const failed = results.find((r) => !r.ok);
    if (failed) setMsg(failed.error ?? "Không cập nhật được.");
    else setMsg(results.some((r) => r.changed) ? "Đã cập nhật dữ liệu mới" : "Dữ liệu đã là mới nhất");
  };

  const label = busy ? "Đang cập nhật…" : "Cập nhật dữ liệu";
  const sub = oldest ? `cập nhật ${timeAgo(oldest)}` : "";

  return (
    <div className={variant === "float" ? s.refreshFloat : s.refreshBar}>
      {msg && <span className={s.refreshMsg} role="status">{msg}</span>}
      <button
        className={variant === "float" ? s.refreshFloatBtn : s.btn}
        onClick={run}
        disabled={busy}
        title={`Lấy dữ liệu mới nhất từ Google Sheets${sub ? ` (${sub})` : ""}. Hệ thống cũng tự cập nhật mỗi 2 giờ.`}
      >
        <span className={busy ? s.spin : undefined}><Icon name="refresh" size={14} /></span>
        {/* Trên thanh công cụ: chỉ hiện icon khi màn hình hẹp (xem .lblWide / .lblXWide). */}
        <span className={variant === "bar" ? s.lblWide : undefined}>{label}</span>
        {sub && <span className={variant === "bar" ? `${s.refreshSub} ${s.lblXWide}` : s.refreshSub}>· {sub}</span>}
      </button>
    </div>
  );
}
