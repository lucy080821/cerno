"use client";

import { useCallback, useEffect, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { LOCAL_ROW_LIMIT, useData } from "@/lib/editor/data-store";
import { fetchSources, loadRows, syncNow, toDocSource, type RemoteSource } from "@/lib/editor/remote-data";
import { timeAgo } from "@/lib/editor/time";
import s from "./editor.module.css";
import { Spinner } from "@/components/Spinner";

/**
 * Chọn nguồn dữ liệu cho dashboard: dữ liệu mẫu hoặc các Google Sheets đã kết nối ở /dashboards.
 * Nguồn đầu danh sách là "nguồn chính": widget, bộ lọc và AI tạo mới sẽ dùng nguồn này.
 */
export function SourcesPanel() {
  const doc = useEditor((st) => st.doc);
  const meta = useData((st) => st.meta);
  const mutate = useEditor((st) => st.mutate);
  const status = useData((st) => st.status);
  const syncedAt = useData((st) => st.syncedAt);
  const [note, setNote] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteSource[] | null | undefined>(undefined); // undefined = đang tải
  const [pick, setPick] = useState("");

  const refresh = useCallback(async () => setRemote(await fetchSources()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inDoc = new Set(doc.sources.map((x) => x.id));
  const available = (remote ?? []).filter((r) => !inDoc.has(r.id));

  const usedBy = (id: string) =>
    doc.widgets.some((w) => (w.config.kind === "chart" || w.config.kind === "kpi") && w.config.sourceId === id) ||
    doc.filters.some((f) => f.sourceId === id);

  const add = async () => {
    const r = remote?.find((x) => x.id === pick);
    if (!r) return;
    mutate((d) => ({ ...d, sources: [toDocSource(r), ...d.sources] }), "source-add"); // thêm vào đầu = nguồn chính
    setPick("");
    await loadRows(r.id);
  };

  const makePrimary = (id: string) =>
    mutate((d) => ({ ...d, sources: [...d.sources].sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0)) }), "source-primary");

  // Lấy dữ liệu mới nhất từ Google Sheets (không chỉ tải lại bản sao đã có).
  const update = async (id: string) => {
    setSyncing(id);
    setNote("");
    const out = await syncNow(id);
    setSyncing(null);
    setNote(!out.ok ? out.error ?? "Không cập nhật được." : out.changed ? "Đã cập nhật dữ liệu mới." : "Dữ liệu đã là mới nhất.");
  };

  const remove = (id: string) => mutate((d) => ({ ...d, sources: d.sources.filter((x) => x.id !== id) }), "source-remove");

  return (
    <>
      {doc.sources.map((src, i) => {
        const sheet = src.type === "google_sheets";
        const st = status[src.id];
        // Danh sách đã tải xong mà không còn nguồn này: nó đã bị xóa khỏi tài khoản (ở trang quản lý).
        const deleted = sheet && Array.isArray(remote) && !remote.some((r) => r.id === src.id);
        return (
          <div key={src.id} className={s.sourceCard}>
            <strong>{src.type === "sample" ? src.name : src.sheetName}</strong>
            <span>
              {sheet ? "Google Sheets" : "Dữ liệu mẫu"} · {src.columns.length} cột
              {sheet && meta[src.id] ? ` · ${meta[src.id].rowCount.toLocaleString("vi-VN")} dòng` : ""}
              {sheet && (meta[src.id]?.rowCount ?? 0) > LOCAL_ROW_LIMIT ? " (nguồn lớn: máy chủ tính số liệu)" : ""}
              {i === 0 ? " · nguồn chính" : ""}
              {sheet && syncedAt[src.id] ? ` · cập nhật ${timeAgo(syncedAt[src.id])}` : ""}
              {deleted ? " · nguồn đã bị xóa khỏi tài khoản" : ""}
              {st === "loading" ? <> · <Spinner size={11} inline />đang tải…</> : ""}
              {st === "error" ? " · không tải được dữ liệu" : ""}
            </span>
            <div className={s.btnRow}>
              {i > 0 && (
                <button className={s.smallBtn} onClick={() => makePrimary(src.id)}>Đặt làm nguồn chính</button>
              )}
              {sheet && (
                <button className={s.smallBtn} onClick={() => update(src.id)} disabled={deleted || st === "loading" || syncing === src.id}>
                  {syncing === src.id ? <><Spinner size={12} inline />Đang cập nhật…</> : "Cập nhật từ Google Sheets"}
                </button>
              )}
              {sheet && (
                <button
                  className={`${s.smallBtn} ${s.danger}`}
                  disabled={usedBy(src.id)}
                  title={usedBy(src.id) ? "Đang có biểu đồ hoặc bộ lọc dùng nguồn này: xóa hoặc đổi chúng trước" : "Gỡ khỏi dashboard"}
                  onClick={() => remove(src.id)}
                >
                  Gỡ
                </button>
              )}
            </div>
          </div>
        );
      })}

      {note && <p className={s.hint} role="status">{note}</p>}
      <p className={s.hint}>Dữ liệu Google Sheets tự cập nhật mỗi 2 giờ.</p>
      {remote === undefined && <p className={s.hint}><Spinner size={12} inline />Đang tải danh sách Google Sheets…</p>}
      {remote === null && <p className={s.hint}>Không lấy được danh sách Google Sheets (chưa đăng nhập hoặc lỗi mạng).</p>}
      {remote && available.length > 0 && (
        <div className={`${s.btnRow} ${s.sourceAdd}`}>
          <select className={`${s.input} ${s.sourceSelect}`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Chọn Google Sheets">
            <option value="">Thêm Google Sheets…</option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>{r.name ?? r.sheet_name} ({r.row_count} dòng)</option>
            ))}
          </select>
          <button className={s.smallBtn} onClick={add} disabled={!pick}>Thêm</button>
        </div>
      )}
      {remote && available.length === 0 && (
        <p className={s.hint}>
          {remote.length === 0 ? "Chưa có Google Sheets nào." : "Đã thêm hết các Google Sheets của bạn."}{" "}
          <a href="/dashboards" target="_blank" rel="noreferrer">Kết nối thêm</a>
        </p>
      )}
    </>
  );
}
