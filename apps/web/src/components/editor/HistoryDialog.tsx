"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { useDialog } from "@/components/ui/DialogProvider";
import { useEditor } from "@/lib/editor/store";
import {
  createNamedRevision, deleteRevision, formatRevisionTime, listRevisions, loadRevisionDoc, type RevisionRow,
} from "@/lib/revisions/revisions";
import { Icon } from "./fields";
import s from "./editor.module.css";

/**
 * Lịch sử phiên bản của dashboard: các bản tự lưu theo từng buổi chỉnh sửa và các mốc đặt tên. Khôi phục = nạp bản cũ vào editor
 * (tự lưu như mọi lần sửa khác). Trước khi khôi phục luôn lưu bản hiện tại thành mốc "Trước khi khôi phục" để quay lại được.
 */
export function HistoryDialog({ dashboardId, onClose, notify }: { dashboardId: string; onClose: () => void; notify: (m: string) => void }) {
  const dialog = useDialog();
  const [rows, setRows] = useState<RevisionRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listRevisions(dashboardId);
    if ("error" in r) setError(r.error);
    else {
      setError("");
      setRows(r.rows);
    }
  }, [dashboardId]);

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, onClose]);

  const saveMark = async () => {
    const label = await dialog.prompt({ title: "Lưu mốc", message: "Đặt tên cho bản hiện tại để quay lại sau này, ví dụ \"Trước khi đổi bố cục\".", label: "Tên mốc", maxLength: 80, validate: (v) => (v.trim() ? null : "Hãy nhập tên") });
    if (!label?.trim()) return;
    setBusy("save");
    const err = await createNamedRevision(dashboardId, label.trim());
    setBusy(null);
    if (err) return void dialog.alert({ title: "Chưa lưu được mốc", message: err, tone: "danger" });
    notify("Đã lưu mốc");
    void load();
  };

  const restore = async (r: RevisionRow) => {
    const when = formatRevisionTime(r.savedAt);
    const ok = await dialog.confirm({
      title: "Khôi phục phiên bản này?",
      message: `Dashboard sẽ trở về bản ${r.label ? `"${r.label}" ` : ""}lưu lúc ${when}. Bản hiện tại được giữ lại thành mốc "Trước khi khôi phục" nên bạn quay lại được.`,
      confirmText: "Khôi phục",
    });
    if (!ok) return;
    setBusy(r.id);
    const keep = await createNamedRevision(dashboardId, "Trước khi khôi phục");
    if (keep) {
      setBusy(null);
      return void dialog.alert({ title: "Chưa khôi phục được", message: keep, tone: "danger" });
    }
    const res = await loadRevisionDoc(r.id);
    setBusy(null);
    if ("error" in res) return void dialog.alert({ title: "Chưa khôi phục được", message: res.error, tone: "danger" });
    const st = useEditor.getState();
    st.loadDoc({ ...res.doc, id: st.doc.id });
    notify("Đã khôi phục");
    onClose();
  };

  const remove = async (r: RevisionRow) => {
    const ok = await dialog.confirm({ title: "Xoá mốc này?", message: `Mốc "${r.label ?? formatRevisionTime(r.savedAt)}" sẽ bị xoá, không khôi phục được.`, confirmText: "Xoá", tone: "danger" });
    if (!ok) return;
    setBusy(r.id);
    const err = await deleteRevision(r.id);
    setBusy(null);
    if (err) return void dialog.alert({ title: "Chưa xoá được", message: err, tone: "danger" });
    void load();
  };

  return (
    <div className={s.modalBack} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${s.dialog} ${s.dialogShare}`} role="dialog" aria-modal="true" aria-label="Lịch sử phiên bản">
        <div className={s.shareHead}>
          <div className={s.shareHeadRow}>
            <strong>Lịch sử phiên bản</strong>
            <button className={s.iconBtn} title="Đóng (Esc)" onClick={onClose}><Icon name="close" size={14} /></button>
          </div>
          <span className={s.shareSub}>Cerno tự lưu một mốc mỗi buổi chỉnh sửa (giữ 20 mốc gần nhất). Bạn cũng có thể tự lưu mốc có tên.</span>
        </div>
        <div className={s.shareBody}>
          <div className={s.histBar}>
            <button className={s.btn} onClick={() => void saveMark()} disabled={busy !== null}><Icon name="plus" size={14} /> Lưu mốc hiện tại</button>
          </div>
          {error ? (
            <p className={s.hint}>{error}</p>
          ) : rows === null ? (
            <div className={s.shareLoading}><Spinner size={26} label="Đang tải…" /></div>
          ) : rows.length === 0 ? (
            <p className={s.hint}>Chưa có phiên bản nào. Sau lần chỉnh sửa tiếp theo, bản trước đó sẽ xuất hiện ở đây.</p>
          ) : (
            <ul className={s.histList}>
              {rows.map((r) => (
                <li key={r.id} className={s.histRow}>
                  <div className={s.histInfo}>
                    <b data-i18n-skip={r.label ? true : undefined}>{r.label ?? "Tự động lưu"}</b>
                    <span>{formatRevisionTime(r.savedAt)}</span>
                  </div>
                  <button className={s.btn} onClick={() => void restore(r)} disabled={busy !== null}>{busy === r.id ? "Đang xử lý…" : "Khôi phục"}</button>
                  {r.label && <button className={s.iconBtn} title="Xoá mốc" aria-label="Xoá mốc" onClick={() => void remove(r)} disabled={busy !== null}><Icon name="trash" size={14} /></button>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={s.shareFoot}>
          <button className={s.btn} onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
