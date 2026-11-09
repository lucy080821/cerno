"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDialog } from "@/components/ui/DialogProvider";

import { SourcePreview } from "./SourcePreview";
import styles from "./dashboards.module.css";
import { Spinner } from "@/components/Spinner";

export interface SourceRow {
  id: string;
  name: string | null;
  sheet_name: string;
  spreadsheet_id: string;
  columns: { name: string; type: string; unit?: string }[];
  row_count: number;
  last_synced_at: string | null;
  last_error: string | null;
}

export function SourceItem({ source }: { source: SourceRow }) {
  const dialog = useDialog();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);

  async function sync() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/sources/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: source.id }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(json.error ?? "Đồng bộ lỗi.");
    setMsg(json.changed === false ? "Dữ liệu trên Google Sheets không thay đổi." : `Đã cập nhật ${json.rowCount} dòng mới nhất.`);
    router.refresh();
  }

  // Xóa nguồn: bản sao dòng dữ liệu xóa theo (cascade ở DB). File Google Sheets gốc của bạn không bị đụng tới.
  async function remove() {
    const supabase = createClient();
    // Đếm dashboard đang dùng nguồn này để cảnh báo đúng mức (jsonb: doc.sources có phần tử mang id này).
    const { count } = await supabase
      .from("dashboards")
      .select("id", { count: "exact", head: true })
      .contains("doc", { sources: [{ id: source.id }] });
    const used = count ?? 0;
    const warn = used > 0
      ? `Nguồn này đang được ${used} dashboard sử dụng; các biểu đồ dùng nó sẽ không còn dữ liệu.\n\n`
      : "";
    const ok = await dialog.confirm({
      title: "Xóa nguồn dữ liệu?",
      message: `${warn}Xóa nguồn "${source.name ?? source.sheet_name}" và bản sao dữ liệu đã lưu?\nFile Google Sheets gốc của bạn không bị ảnh hưởng.`,
      confirmText: "Xóa nguồn",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    const { error } = await supabase.from("data_sources").delete().eq("id", source.id);
    setBusy(false);
    if (error) return setMsg(`Không xóa được: ${error.message}`);
    router.refresh();
  }

  const when = source.last_synced_at ? new Date(source.last_synced_at).toLocaleString("vi-VN") : "chưa đồng bộ";

  return (
    <li className={styles.item}>
      <div className={styles.itemTop}>
        <div>
          <strong>{source.name ?? source.sheet_name}</strong>
          <div className={styles.muted}>
            {source.row_count.toLocaleString("vi-VN")} dòng · {source.columns.length} cột · cập nhật: {when} · tự động mỗi 2 giờ
          </div>
        </div>
        <div className={styles.row}>
          <button className={styles.ghost} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Ẩn dữ liệu" : "Xem dữ liệu"}
          </button>
          <button className={styles.ghost} onClick={sync} disabled={busy}>
            {busy ? <><Spinner size={12} inline />Đang xử lý…</> : "Cập nhật ngay"}
          </button>
          <button className={styles.ghost} onClick={remove} disabled={busy}>Xóa nguồn</button>
        </div>
      </div>
      {(msg || source.last_error) && <p className={styles.msg}>{msg || source.last_error}</p>}
      {open && <SourcePreview sourceId={source.id} columns={source.columns} total={source.row_count} version={source.last_synced_at} />}
    </li>
  );
}
