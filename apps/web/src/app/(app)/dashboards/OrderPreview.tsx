"use client";

import type { ReactNode } from "react";
import { CHANNELS, INPUT_FIELDS, INPUT_LABELS, type ColumnMapping, type InputField } from "@/lib/orders/canonical";
import tpl from "./templates.module.css";
import styles from "./import-orders.module.css";

export interface PreviewInfo {
  headers: string[];
  channel: string | null;
  mapping: ColumnMapping;
  problems: string[];
  summary: {
    lines: number;
    orders: number;
    dateMin: string | null;
    dateMax: string | null;
    byStatus: Record<string, number>;
    keyed: boolean;
    netRevenue: number;
  } | null;
  warnings: string[];
  preview: Record<string, string | number | null>[];
}

const nf = new Intl.NumberFormat("vi-VN");
/** "2025-09-05 14:30" → "05/09/2025". */
const day = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
const PREVIEW_COLUMNS = ["Kênh", "Mã đơn", "Ngày đặt", "Trạng thái", "Sản phẩm", "Số lượng", "Doanh thu thực"];
const NUMERIC = new Set(["Số lượng", "Doanh thu thực"]);

/**
 * Phần xem trước dùng chung cho tải file và nối Google Sheet: chọn kênh, tóm tắt, vấn đề/cảnh báo, chỉnh cột và vài dòng sẽ được lưu.
 * `children` là các dòng chọn riêng của từng cách nhập (vd chọn sheet trong file). `mode`: file có Mã đơn thì gộp theo đơn, Sheet luôn
 * thay toàn bộ dòng của kênh nên không cần ghi chú về mã đơn.
 */
export function OrderPreview({ info, busy, mode, onChange, children }: {
  info: PreviewInfo;
  busy: boolean;
  mode: "file" | "sheet";
  onChange: (patch: { channel?: string | null; mapping?: ColumnMapping }) => void;
  children?: ReactNode;
}) {
  const mapped = info.mapping;
  const feeCols = mapped.platformFee ?? [];
  const optionList = info.headers.map((h, i) => ({ h: h || `Cột ${i + 1}`, i }));

  const setField = (field: InputField, idx: number | null) => {
    const next: ColumnMapping = { ...info.mapping };
    if (idx === null) delete next[field];
    else next[field] = [idx];
    onChange({ mapping: next });
  };
  const removeFee = (idx: number) => {
    const rest = (info.mapping.platformFee ?? []).filter((i) => i !== idx);
    const next: ColumnMapping = { ...info.mapping };
    if (rest.length) next.platformFee = rest;
    else delete next.platformFee;
    onChange({ mapping: next });
  };

  return (
    <>
      <div className={tpl.slots}>
        <div className={tpl.slotRow}>
          <div className={tpl.slotLabel}>Kênh bán<span className={tpl.star} title="Bắt buộc">*</span></div>
          <select className={tpl.select} value={info.channel ?? ""} disabled={busy} aria-label="Kênh bán" onChange={(e) => onChange({ channel: e.target.value || null })}>
            <option value="">— Chọn kênh —</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {children}
      </div>

      {info.summary && (
        <div className={styles.summary}>
          <div className={styles.stat}><b>{nf.format(info.summary.orders)}</b>đơn hàng</div>
          <div className={styles.stat}><b>{nf.format(info.summary.lines)}</b>dòng sản phẩm</div>
          <div className={styles.stat}><b>{`${day(info.summary.dateMin)} – ${day(info.summary.dateMax)}`}</b>khoảng thời gian</div>
          <div className={styles.stat}><b>{nf.format(Math.round(info.summary.netRevenue))}</b>doanh thu thực (đồng)</div>
        </div>
      )}

      {info.problems.length > 0 && <ul className={`${styles.list} ${styles.problem}`} role="alert">{info.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {info.warnings.length > 0 && <ul className={`${styles.list} ${styles.warn}`}>{info.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {mode === "file" && info.summary && !info.summary.keyed && (
        <p className={tpl.note}>File không có mã đơn hàng: khi tải file mới của cùng kênh, dữ liệu cũ của kênh đó sẽ được thay bằng file mới.</p>
      )}

      <div className={styles.mapTitle}>{mode === "file" ? "Cột trong file của bạn" : "Cột trong Sheet của bạn"}</div>
      <div className={tpl.slots}>
        {INPUT_FIELDS.filter((f) => f !== "platformFee").map((f) => {
          const cur = mapped[f]?.[0];
          return (
            <div key={f} className={tpl.slotRow}>
              <div className={tpl.slotLabel}>{INPUT_LABELS[f]}</div>
              <select className={tpl.select} value={cur ?? ""} disabled={busy} aria-label={INPUT_LABELS[f]} onChange={(e) => setField(f, e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">— Không dùng —</option>
                {optionList.map((o) => <option key={o.i} value={o.i}>{o.h}</option>)}
              </select>
            </div>
          );
        })}
        {feeCols.length > 0 && (
          <div className={tpl.slotRow}>
            <div className={tpl.slotLabel}>{INPUT_LABELS.platformFee}</div>
            <div className={styles.fee}>
              {feeCols.map((i) => (
                <span key={i} className={styles.chip}>
                  {info.headers[i] || `Cột ${i + 1}`}
                  <button className={styles.chipX} onClick={() => removeFee(i)} aria-label="Bỏ cột này">×</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {info.preview.length > 0 && (
        <>
          <div className={styles.mapTitle}>Dữ liệu sẽ được lưu (vài dòng đầu)</div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>{PREVIEW_COLUMNS.map((c) => <th key={c} className={NUMERIC.has(c) ? styles.num : undefined}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {info.preview.map((r, i) => (
                  <tr key={i}>
                    {PREVIEW_COLUMNS.map((c) => (
                      <td key={c} className={NUMERIC.has(c) ? styles.num : undefined}>
                        {typeof r[c] === "number" ? nf.format(r[c] as number) : r[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
