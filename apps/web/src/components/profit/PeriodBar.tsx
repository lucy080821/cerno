"use client";

import { useEffect, useState } from "react";
import {
  PRESETS, periodLabel, periodRange, presetPeriod, quarterPeriod, monthPeriod, yearPeriod, samePeriod, shiftPeriod, switchUnit, todayIso, dayPeriod, rangePeriod,
  isIsoDay, type Period, type PeriodUnit,
} from "@/lib/profit/period";
import { usePeriod } from "@/lib/profit/period-store";
import styles from "./profit.module.css";

// "Tất cả" đã có nút riêng ở hàng lối tắt nên không lặp lại trong ô chọn.
const UNITS: { value: Exclude<PeriodUnit, "all">; label: string }[] = [
  { value: "day", label: "Ngày" },
  { value: "month", label: "Tháng" },
  { value: "quarter", label: "Quý" },
  { value: "year", label: "Năm" },
  { value: "range", label: "Khoảng ngày" },
];

const vn = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");

/** Ô nhập năm: chỉ áp dụng khi đủ 4 chữ số hợp lệ, để gõ dở không làm nhảy kỳ. */
function YearInput({ value, onCommit, label }: { value: number; onCommit: (y: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      className={`${styles.input} ${styles.periodYear}`}
      inputMode="numeric"
      maxLength={4}
      aria-label={label}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/\D/g, "").slice(0, 4);
        setText(t);
        const y = Number(t);
        if (t.length === 4 && y >= 2000 && y <= 2100) onCommit(y);
      }}
    />
  );
}

/**
 * Thanh chọn khoảng thời gian cho các trang lãi: lối tắt (Hôm nay, 7 ngày, Tháng này, Quý này, Năm nay...) và chọn theo Ngày / Tháng / Quý /
 * Năm / Khoảng ngày, có nút lùi–tiến một kỳ. Lựa chọn dùng chung giữa các trang (lib/profit/period-store.ts). `dataMin`/`dataMax`: ngày đơn
 * đầu tiên và cuối cùng của dữ liệu, để người dùng biết nên chọn khoảng nào.
 */
export function PeriodBar({ dataMin, dataMax }: { dataMin?: string | null; dataMax?: string | null }) {
  const [period, setPeriod] = usePeriod();
  const today = todayIso();
  const range = periodRange(period);
  const set = (p: Period) => setPeriod(p);
  const unit = period.unit;
  const [yStr, rest = ""] = period.value.split(/-(.*)/);
  const y = Number(yStr) || Number(today.slice(0, 4));

  return (
    <div className={styles.periodBar}>
      <div className={styles.periodRow}>
        {PRESETS.map((pr) => (
          <button key={pr.key} className={`${styles.chip} ${samePeriod(period, presetPeriod(pr.key, today)) ? styles.chipOn : ""}`} onClick={() => set(presetPeriod(pr.key, today))}>
            {pr.label}
          </button>
        ))}
      </div>
      <div className={styles.periodRow}>
        {UNITS.map((u) => (
          <button key={u.value} className={`${styles.chip} ${unit === u.value ? styles.chipOn : ""}`} onClick={() => unit !== u.value && set(switchUnit(period, u.value, today))}>
            {u.label}
          </button>
        ))}

        {unit !== "all" && unit !== "range" && (
          <button className={styles.btn} aria-label="Kỳ trước" onClick={() => set(shiftPeriod(period, -1))}>‹</button>
        )}
        {unit === "day" && (
          <input className={styles.input} type="date" aria-label="Ngày" value={period.value} onChange={(e) => isIsoDay(e.target.value) && set(dayPeriod(e.target.value))} />
        )}
        {unit === "month" && (
          <>
            <select className={styles.input} aria-label="Tháng" value={Number(rest) || 1} onChange={(e) => set(monthPeriod(y, Number(e.target.value)))}>
              {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{`Tháng ${i + 1}`}</option>)}
            </select>
            <YearInput value={y} label="Năm" onCommit={(v) => set(monthPeriod(v, Number(rest) || 1))} />
          </>
        )}
        {unit === "quarter" && (
          <>
            <select className={styles.input} aria-label="Quý" value={Number(rest.replace("Q", "")) || 1} onChange={(e) => set(quarterPeriod(y, Number(e.target.value)))}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{`Quý ${q}`}</option>)}
            </select>
            <YearInput value={y} label="Năm" onCommit={(v) => set(quarterPeriod(v, Number(rest.replace("Q", "")) || 1))} />
          </>
        )}
        {unit === "year" && <YearInput value={y} label="Năm" onCommit={(v) => set(yearPeriod(v))} />}
        {unit === "range" && range && (
          <>
            <input className={styles.input} type="date" aria-label="Từ ngày" value={range.from} max={range.to} onChange={(e) => isIsoDay(e.target.value) && set(rangePeriod(e.target.value, range.to))} />
            <span className={styles.muted}>→</span>
            <input className={styles.input} type="date" aria-label="Đến ngày" value={range.to} min={range.from} onChange={(e) => isIsoDay(e.target.value) && set(rangePeriod(range.from, e.target.value))} />
          </>
        )}
        {unit !== "all" && unit !== "range" && (
          <button className={styles.btn} aria-label="Kỳ sau" onClick={() => set(shiftPeriod(period, 1))}>›</button>
        )}

        <span className={styles.periodNote}>
          {range ? <b>{periodLabel(period)}</b> : "Tất cả thời gian"}
          {dataMin && dataMax ? ` · dữ liệu từ ${vn(dataMin)} đến ${vn(dataMax)}` : ""}
        </span>
      </div>
    </div>
  );
}

/** Dòng báo khi khoảng đang chọn không có đơn nào (giữ thanh chọn ở trên để đổi kỳ). */
export function EmptyPeriod() {
  return (
    <div className={styles.empty}>
      <b style={{ color: "var(--text)" }}>Không có đơn nào trong khoảng thời gian này</b>
      <span>Chọn khoảng khác ở thanh phía trên, hoặc bấm Tất cả để xem toàn bộ dữ liệu.</span>
    </div>
  );
}
