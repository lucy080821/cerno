"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/Spinner";
import dash from "@/app/(app)/dashboards/dashboards.module.css";
import tpl from "@/app/(app)/dashboards/templates.module.css";
import styles from "@/app/(app)/dashboards/import-orders.module.css";
import { CHANNELS, MAX_UPLOAD_BYTES } from "@/lib/orders/canonical";
import { AD_LABELS, type AdMapping } from "@/lib/orders/ad-fields";
import { ALL_CHANNELS } from "@/lib/profit/ad-spend";
import { dayText, nf } from "./format";
import profit from "./profit.module.css";

interface Inspect {
  filename: string;
  sheetNames: string[];
  sheet: string;
  headers: string[];
  mapping: AdMapping;
  channel: string | null;
  problems: string[];
  warnings: string[];
  summary: { days: number; total: number; dateMin: string | null; dateMax: string | null; rows: number; byChannel: { channel: string; days: number; total: number }[] } | null;
  preview: { channel: string; day: string; amount: number }[];
}

interface Saved {
  saved: number;
  orders: number;
  days: number;
  total: number;
  dateMin: string | null;
  dateMax: string | null;
  warnings: string[];
  unallocated: { days: number; total: number; from: string | null; to: string | null };
}

type Opts = { sheet?: string; channel?: string | null; mapping?: AdMapping };

/**
 * Tải file chi phí quảng cáo THEO NGÀY (Shopee Ads, Facebook Ads, TikTok Ads hoặc bảng tự ghi). Cerno cộng theo ngày rồi chia
 * cho các đơn hàng của ngày và kênh đó theo doanh thu để tính lãi thật từng đơn. Luồng: chọn file → xem trước (chưa lưu) → Nhập.
 */
export function ImportAdSpend({ label = "+ Tải file chi phí quảng cáo", onDone }: { label?: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<Inspect | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Saved | null>(null);
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
    if (done) onDone?.();
    setDone(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const form = (f: File, o: Opts) => {
    const fd = new FormData();
    fd.set("file", f);
    if (o.sheet) fd.set("sheet", o.sheet);
    if (o.channel) fd.set("channel", o.channel);
    if (o.mapping) fd.set("mapping", JSON.stringify(o.mapping));
    return fd;
  };

  const inspect = useCallback(async (f: File, o: Opts = {}) => {
    const mine = ++seq.current;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ads/inspect", { method: "POST", body: form(f, o) });
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

  const change = (patch: Opts) => {
    if (!file || !info) return;
    void inspect(file, { sheet: patch.sheet ?? info.sheet, channel: patch.channel === undefined ? info.channel : patch.channel, mapping: patch.sheet ? undefined : patch.mapping ?? info.mapping });
  };

  const setField = (f: keyof AdMapping, idx: number | null) => {
    if (!info) return;
    const next: AdMapping = { ...info.mapping };
    if (idx === null) delete next[f];
    else next[f] = idx;
    change({ mapping: next });
  };

  const save = async () => {
    if (!file || !info || info.problems.length) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/ads/import", { method: "POST", body: form(file, { sheet: info.sheet, channel: info.channel, mapping: info.mapping }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Không nhập được file.");
      else setDone(json as Saved);
    } catch {
      setError("Lỗi mạng, thử lại sau.");
    } finally {
      setSaving(false);
    }
  };

  const options = info?.headers.map((h, i) => ({ h: h || `Cột ${i + 1}`, i })) ?? [];
  const channelName = (c: string) => (c === ALL_CHANNELS ? "Mọi kênh" : c);

  return (
    <>
      <button className={`${profit.btn} ${profit.primary}`} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className={tpl.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className={tpl.dialog} role="dialog" aria-modal="true" aria-labelledby="ads-title">
            {saving && (
              <div className={tpl.busy}>
                <Spinner size={32} label="Đang chia chi phí cho các đơn hàng…" />
              </div>
            )}
            <h2 id="ads-title" className={tpl.dialogTitle}>Tải file chi phí quảng cáo</h2>

            {done ? (
              <>
                <p className={styles.done}>
                  {`Đã nhập chi phí quảng cáo của ${nf.format(done.days)} ngày (${dayText(done.dateMin)} – ${dayText(done.dateMax)}), tổng ${nf.format(Math.round(done.total))}đ. Đã chia cho ${nf.format(done.orders)} đơn hàng.`}
                </p>
                {done.unallocated.days > 0 && (
                  <ul className={`${styles.list} ${styles.warn}`}>
                    <li>
                      {`${nf.format(done.unallocated.days)} ngày (${nf.format(Math.round(done.unallocated.total))}đ, từ ${dayText(done.unallocated.from)} đến ${dayText(done.unallocated.to)}) chưa chia được vì chưa có đơn hàng của kênh đó trong những ngày này. Chi phí vẫn được lưu: khi bạn tải file đơn hàng của những ngày đó, Cerno sẽ tự chia.`}
                    </li>
                  </ul>
                )}
                {done.warnings.length > 0 && <ul className={`${styles.list} ${styles.warn}`}>{done.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                <div className={tpl.actions}>
                  <button className={dash.primary} onClick={close}>Xong</button>
                </div>
              </>
            ) : (
              <>
                {!file && (
                  <>
                    <p className={tpl.sub}>
                      Chọn file báo cáo quảng cáo THEO NGÀY (Shopee Ads, Facebook Ads, TikTok Ads hoặc bảng tự ghi) có cột ngày và cột chi phí. Cerno cộng chi phí theo ngày rồi chia cho các đơn hàng của ngày đó theo doanh thu, nên đây là số ước tính từng đơn, không phải số thật.
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

                {file && <p className={styles.file}><b>{file.name}</b></p>}
                {busy && <p className={styles.working}><Spinner size={14} inline />Đang đọc file…</p>}

                {info && (
                  <>
                    <div className={tpl.slots}>
                      {info.mapping.channel === undefined && (
                        <div className={tpl.slotRow}>
                          <div className={tpl.slotLabel}>Kênh nhận chi phí này<span className={tpl.star} title="Bắt buộc">*</span></div>
                          <select className={tpl.select} value={info.channel ?? ""} disabled={busy} aria-label="Kênh nhận chi phí này" onChange={(e) => change({ channel: e.target.value || null })}>
                            <option value="">— Chọn kênh —</option>
                            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                            <option value={ALL_CHANNELS}>Chia cho đơn của mọi kênh</option>
                          </select>
                        </div>
                      )}
                      {info.sheetNames.length > 1 && (
                        <div className={tpl.slotRow}>
                          <div className={tpl.slotLabel}>Sheet trong file</div>
                          <select className={tpl.select} value={info.sheet} disabled={busy} aria-label="Sheet trong file" onChange={(e) => change({ sheet: e.target.value })}>
                            {info.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                      )}
                    </div>

                    {info.summary && (
                      <div className={styles.summary}>
                        <div className={styles.stat}><b>{nf.format(info.summary.days)}</b>ngày có chi phí</div>
                        <div className={styles.stat}><b>{`${dayText(info.summary.dateMin)} – ${dayText(info.summary.dateMax)}`}</b>khoảng thời gian</div>
                        <div className={styles.stat}><b>{nf.format(Math.round(info.summary.total))}</b>tổng chi phí (đồng)</div>
                      </div>
                    )}

                    {info.problems.length > 0 && <ul className={`${styles.list} ${styles.problem}`} role="alert">{info.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
                    {info.warnings.length > 0 && <ul className={`${styles.list} ${styles.warn}`}>{info.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                    {info.summary && <p className={tpl.note}>Tải lại cho cùng kênh và cùng ngày thì chi phí của ngày đó được thay bằng số mới. Chi phí quảng cáo ghi trong file đơn hàng (nếu có) sẽ được thay bằng số đã chia ở những đơn được phủ tới.</p>}

                    <div className={styles.mapTitle}>Cột trong file của bạn</div>
                    <div className={tpl.slots}>
                      {(["date", "spend", "channel"] as const).map((f) => (
                        <div key={f} className={tpl.slotRow}>
                          <div className={tpl.slotLabel}>{AD_LABELS[f]}</div>
                          <select className={tpl.select} value={info.mapping[f] ?? ""} disabled={busy} aria-label={AD_LABELS[f]} onChange={(e) => setField(f, e.target.value === "" ? null : Number(e.target.value))}>
                            <option value="">— Không dùng —</option>
                            {options.map((o) => <option key={o.i} value={o.i}>{o.h}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>

                    {info.preview.length > 0 && (
                      <>
                        <div className={styles.mapTitle}>Dữ liệu sẽ được lưu (vài ngày đầu)</div>
                        <div className={styles.tableWrap}>
                          <table className={styles.table}>
                            <thead><tr><th>Ngày</th><th>Kênh</th><th className={styles.num}>Chi phí (đồng)</th></tr></thead>
                            <tbody>
                              {info.preview.map((r) => (
                                <tr key={`${r.channel}${r.day}`}>
                                  <td>{dayText(r.day)}</td>
                                  <td>{channelName(r.channel)}</td>
                                  <td className={styles.num}>{nf.format(r.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </>
                )}

                {error && <p className={tpl.error} role="alert">{error}</p>}

                <div className={tpl.actions}>
                  {file && <button className={dash.ghost} onClick={() => { setFile(null); setInfo(null); setError(""); seq.current++; setBusy(false); }} disabled={saving}>Chọn file khác</button>}
                  <button className={dash.ghost} onClick={close} disabled={saving}>Hủy</button>
                  <button className={dash.primary} onClick={save} disabled={!info || busy || saving || info.problems.length > 0}>Nhập dữ liệu</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
