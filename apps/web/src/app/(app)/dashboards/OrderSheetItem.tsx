"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { useDialog } from "@/components/ui/DialogProvider";
import { AUTO_SYNC_MINUTES } from "@/lib/google/constants";
import styles from "./dashboards.module.css";

export interface OrderSheetRow {
  id: string;
  name: string;
  channel: string;
  sheet_name: string;
  last_synced_at: string | null;
  last_error: string | null;
  line_count: number;
  order_count: number;
  warnings: string[] | null;
}

/** Một Google Sheet đơn hàng đã nối: trạng thái đồng bộ, cập nhật ngay, ngắt kết nối. */
export function OrderSheetItem({ sheet }: { sheet: OrderSheetRow }) {
  const dialog = useDialog();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function sync() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/orders/sheets/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: sheet.id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(json.error ?? "Đồng bộ lỗi.");
      else setMsg(json.changed === false ? "Dữ liệu trong Sheet không thay đổi." : `Đã cập nhật ${Number(json.lines).toLocaleString("vi-VN")} dòng (${Number(json.orders).toLocaleString("vi-VN")} đơn).`);
    } catch {
      setMsg("Lỗi mạng, thử lại sau.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function disconnect() {
    const ok = await dialog.confirm({
      title: "Ngắt kết nối Sheet?",
      message: `Ngắt kết nối "${sheet.name}"?\nDữ liệu kênh ${sheet.channel} đã nhập vẫn giữ nguyên nhưng không còn tự cập nhật. Sau đó bạn có thể tải file đơn hàng cho kênh này. Google Sheet gốc không bị ảnh hưởng.`,
      confirmText: "Ngắt kết nối",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/orders/sheets?id=${encodeURIComponent(sheet.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(json.error ?? "Không ngắt kết nối được.");
    } catch {
      setMsg("Lỗi mạng, thử lại sau.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const when = sheet.last_synced_at ? new Date(sheet.last_synced_at).toLocaleString("vi-VN") : "chưa đồng bộ";
  const hours = AUTO_SYNC_MINUTES / 60;
  return (
    <li className={styles.item}>
      <div className={styles.itemTop}>
        <div>
          <strong>{sheet.name}</strong>
          <div className={styles.muted}>
            {`Kênh ${sheet.channel} · ${sheet.line_count.toLocaleString("vi-VN")} dòng · ${sheet.order_count.toLocaleString("vi-VN")} đơn · cập nhật: ${when} · tự động mỗi ${hours} giờ`}
          </div>
        </div>
        <div className={styles.row}>
          <button className={styles.ghost} onClick={sync} disabled={busy}>
            {busy ? <><Spinner size={12} inline />Đang xử lý…</> : "Cập nhật ngay"}
          </button>
          <button className={styles.ghost} onClick={disconnect} disabled={busy}>Ngắt kết nối</button>
        </div>
      </div>
      {(msg || sheet.last_error) && <p className={styles.msg}>{msg || sheet.last_error}</p>}
      {!msg && !sheet.last_error && (sheet.warnings ?? []).length > 0 && <p className={styles.muted}>{(sheet.warnings ?? []).slice(0, 3).join(" · ")}</p>}
    </li>
  );
}
