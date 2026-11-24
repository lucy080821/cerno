"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_UPLOAD_BYTES, type ColumnMapping } from "@/lib/orders/canonical";
import { OrderPreview, type PreviewInfo } from "./OrderPreview";
import { Spinner } from "@/components/Spinner";
import dash from "./dashboards.module.css";
import tpl from "./templates.module.css";
import styles from "./import-orders.module.css";

interface Inspect extends PreviewInfo {
  filename: string;
  sheetNames: string[];
  sheet: string;
  profileLabel: string;
  profile: "shopee" | "tiktok" | "generic";
  /** Tên Google Sheet đang nối cho kênh này: kênh đó không nhận file tải lên. */
  blockedBy?: string | null;
}

interface Imported {
  channel: string;
  lines: number;
  orders: number;
  totalRows: number;
  warnings: string[];
}

const nf = new Intl.NumberFormat("vi-VN");

/**
 * Tải file đơn hàng (Excel/CSV từ Shopee, TikTok Shop hoặc tự ghi) vào nguồn "Đơn hàng đa kênh".
 * Luồng: chọn file → máy chủ nhận diện + xem trước (chưa lưu gì) → người dùng kiểm tra/sửa → Nhập dữ liệu.
 */
export function ImportOrders({ label = "+ Tải file đơn hàng", onDone }: { label?: string; onDone?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<Inspect | null>(null);
  const [busy, setBusy] = useState(false); // đang đọc/xem trước
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Imported | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const close = () => {
    if (saving) return;
    setOpen(false);
    setFile(null);
    setInfo(null);
    setError("");
    setBusy(false);
    seq.current++;
    if (done) {
      router.refresh();
      onDone?.();
    }
    setDone(null);
  };

  useEffect(() => {
    if (!open) return;
    // Pha bắt (capture) + stopPropagation: khi hộp thoại này nằm trong hộp thoại chọn mẫu thì Esc chỉ đóng lớp trên cùng.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const form = (f: File, opts: { sheet?: string; channel?: string | null; mapping?: ColumnMapping }) => {
    const fd = new FormData();
    fd.set("file", f);
    if (opts.sheet) fd.set("sheet", opts.sheet);
    if (opts.channel) fd.set("channel", opts.channel);
    if (opts.mapping) fd.set("mapping", JSON.stringify(opts.mapping));
    return fd;
  };

  const inspect = useCallback(async (f: File, opts: { sheet?: string; channel?: string | null; mapping?: ColumnMapping } = {}) => {
    const mine = ++seq.current;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/orders/inspect", { method: "POST", body: form(f, opts) });
      const json = await res.json().catch(() => ({}));
      if (mine !== seq.current) return;
      if (!res.ok) {
        setInfo(null);
        setError(json.error ?? "Không đọc được file.");
      } else setInfo(json as Inspect);
    } catch {
      if (mine === seq.current) setError("Lỗi mạng, thử lại sau.");
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, []);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) return setError(`File lớn hơn ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Hãy chia nhỏ theo thời gian rồi tải từng phần.`);
    setFile(f);
    setInfo(null);
    void inspect(f);
  };

  /** Đổi sheet/kênh/ánh xạ: xem trước lại với lựa chọn mới (giữ phần người dùng đã chỉnh). */
  const change = (patch: { sheet?: string; channel?: string | null; mapping?: ColumnMapping }) => {
    if (!file || !info) return;
    void inspect(file, {
      // Đổi sheet thì nhận diện lại từ đầu; còn lại giữ nguyên lựa chọn hiện có.
      sheet: patch.sheet ?? info.sheet,
      channel: patch.channel === undefined ? info.channel : patch.channel,
      mapping: patch.sheet ? undefined : patch.mapping ?? info.mapping,
    });
  };

  const save = async () => {
    if (!file || !info || info.problems.length || info.blockedBy) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/orders/import", { method: "POST", body: form(file, { sheet: info.sheet, channel: info.channel, mapping: info.mapping }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Không nhập được file.");
      else setDone(json as Imported);
    } catch {
      setError("Lỗi mạng, thử lại sau.");
    } finally {
      setSaving(false);
    }
  };

  // Kênh đang nối Google Sheet thì không nhận file: coi như một vấn đề chặn nhập.
  const shown: PreviewInfo | null = info
    ? { ...info, problems: info.blockedBy ? [...info.problems, `Kênh ${info.channel} đang lấy dữ liệu từ Google Sheet "${info.blockedBy}". Hãy thêm dữ liệu vào Sheet đó, hoặc ngắt kết nối Sheet ở trang Nguồn dữ liệu trước khi tải file lên.`] : info.problems }
    : null;

  return (
    <>
      <button className={dash.ghost} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className={tpl.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className={tpl.dialog} role="dialog" aria-modal="true" aria-labelledby="imp-title">
            {saving && (
              <div className={tpl.busy}>
                <Spinner size={32} label="Đang nhập dữ liệu…" />
              </div>
            )}
            <h2 id="imp-title" className={tpl.dialogTitle}>Tải file đơn hàng</h2>

            {done ? (
              <>
                <p className={styles.done}>
                  {`Đã nhập ${nf.format(done.lines)} dòng (${nf.format(done.orders)} đơn) của kênh ${done.channel}. Nguồn "Đơn hàng đa kênh" hiện có ${nf.format(done.totalRows)} dòng.`}
                </p>
                {done.warnings.length > 0 && (
                  <ul className={`${styles.list} ${styles.warn}`}>{done.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                )}
                <div className={tpl.actions}>
                  <button className={dash.primary} onClick={close}>Xong</button>
                </div>
              </>
            ) : (
              <>
                {!file && (
                  <>
                    <p className={tpl.sub}>
                      Chọn file xuất từ Shopee hoặc TikTok Shop, hoặc file tự ghi của bạn. Cerno nhận diện cột, bỏ thông tin người mua và gộp các kênh vào một dashboard.
                    </p>
                    <button
                      type="button"
                      className={`${styles.drop} ${over ? styles.dropOver : ""}`}
                      onClick={() => input.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                      onDragLeave={() => setOver(false)}
                      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
                    >
                      <span className={styles.dropTitle}>Bấm để chọn file hoặc kéo thả vào đây</span>
                      <span className={styles.dropHint}>Excel (.xlsx) hoặc CSV, tối đa 10 MB</span>
                    </button>
                    <input ref={input} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
                  </>
                )}

                {file && (
                  <p className={styles.file}>
                    <b>{file.name}</b>
                    {info && <span className={styles.badge}>{info.profile === "generic" ? info.profileLabel : `Nhận diện: ${info.profileLabel}`}</span>}
                  </p>
                )}

                {busy && <p className={styles.working}><Spinner size={14} inline />Đang đọc file…</p>}

                {info && shown && (
                  <OrderPreview info={shown} busy={busy} mode="file" onChange={change}>
                    {info.sheetNames.length > 1 && (
                      <div className={tpl.slotRow}>
                        <div className={tpl.slotLabel}>Sheet trong file</div>
                        <select className={tpl.select} value={info.sheet} disabled={busy} aria-label="Sheet trong file" onChange={(e) => change({ sheet: e.target.value })}>
                          {info.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    )}
                  </OrderPreview>
                )}

                {error && <p className={tpl.error} role="alert">{error}</p>}

                <div className={tpl.actions}>
                  {file && <button className={dash.ghost} onClick={() => { setFile(null); setInfo(null); setError(""); seq.current++; setBusy(false); }} disabled={saving}>Chọn file khác</button>}
                  <button className={dash.ghost} onClick={close} disabled={saving}>Hủy</button>
                  <button className={dash.primary} onClick={save} disabled={!info || busy || saving || info.problems.length > 0 || !!info.blockedBy}>Nhập dữ liệu</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
