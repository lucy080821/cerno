"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/Spinner";
import type { ChartVisual, KpiVisual, Visual } from "@/lib/ai-chat/visual";
import styles from "./ai.module.css";

// ECharts nặng: chỉ tải khi trong cuộc trò chuyện có biểu đồ.
const ChartCanvas = dynamic(() => import("./ChartCanvas"), {
  ssr: false,
  loading: () => (
    <div className={styles.vLoading}>
      <Spinner size={20} label="" />
    </div>
  ),
});

/** "39.457.000 đồng" → số lớn + đơn vị nhỏ bên cạnh (không tách được thì giữ nguyên chữ). */
function splitUnit(text: string): { num: string; unit: string | null } {
  const m = text.match(/^([-+−]?[\d.,]+)\s+(\S.*)$/);
  return m ? { num: m[1], unit: m[2] } : { num: text, unit: null };
}

function Kpi({ v }: { v: KpiVisual }) {
  return (
    <div className={styles.kpiBlock} data-i18n-skip>
      {v.title && <div className={styles.vTitle}>{v.title}</div>}
      <div className={styles.kpiGrid}>
        {v.cards.map((c, i) => {
          const { num, unit } = splitUnit(c.text);
          return (
            <div key={i} className={styles.kpiCard}>
              <div className={styles.kpiLabel}>{c.label}</div>
              <div className={styles.kpiValue}>
                {num}
                {unit && <span className={styles.kpiUnit}>{unit}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chart({ v }: { v: ChartVisual }) {
  return (
    <figure className={styles.vCard}>
      <figcaption className={styles.vTitle} data-i18n-skip>{v.title}</figcaption>
      <div data-i18n-skip>
        <ChartCanvas visual={v} />
      </div>
      {v.groups > v.rows.length && <p className={styles.vNote}>{`Chỉ hiện ${v.rows.length}/${v.groups} nhóm.`}</p>}
    </figure>
  );
}

/** Biểu đồ và thẻ KPI do AI vẽ ngay trong tin trả lời (chỉ có khi người dùng yêu cầu). */
export function Visuals({ items }: { items: Visual[] }) {
  if (!items.length) return null;
  return (
    <div className={styles.visuals}>
      {items.map((v, i) => (v.kind === "kpi" ? <Kpi key={i} v={v} /> : <Chart key={i} v={v} />))}
    </div>
  );
}
