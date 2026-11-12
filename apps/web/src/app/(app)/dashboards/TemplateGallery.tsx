"use client";

import { useState } from "react";
import { templateIndustries, type TemplateEntry } from "@/content/templates";
import dash from "./dashboards.module.css";
import styles from "./templates.module.css";

const ALL = "__all__";

/** Thư viện mẫu dashboard theo ngành: lọc theo ngành, bấm "Dùng mẫu này" để chọn. */
export function TemplateGallery({ entries, onPick }: { entries: TemplateEntry[]; onPick: (e: TemplateEntry) => void }) {
  const [industry, setIndustry] = useState(ALL);
  const industries = templateIndustries(entries);
  const shown = industry === ALL ? entries : entries.filter((e) => e.template.industry === industry);

  return (
    <div className={styles.gallery}>
      {industries.length > 1 && (
        <div className={styles.filters} role="group" aria-label="Lọc theo ngành">
          {[ALL, ...industries].map((i) => (
            <button
              key={i}
              className={`${styles.chip} ${industry === i ? styles.chipOn : ""}`}
              aria-pressed={industry === i}
              onClick={() => setIndustry(i)}
            >
              {i === ALL ? "Tất cả ngành" : i}
            </button>
          ))}
        </div>
      )}
      <div className={styles.grid}>
        {shown.map((e) => (
          <article key={e.template.id} className={styles.card}>
            <div className={styles.preview}>
              {e.previewImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.previewImage} alt={e.template.name} className={styles.previewImg} loading="lazy" />
              ) : (
                <span aria-hidden>{e.template.industry.slice(0, 1)}</span>
              )}
            </div>
            <div className={styles.cardBody}>
              <span className={styles.cardIndustry}>{e.template.industry}</span>
              <h3 className={styles.cardTitle}>{e.template.name}</h3>
              <p className={styles.cardDesc}>{e.template.description}</p>
            </div>
            <div className={styles.cardAction}>
              <button className={dash.primary} onClick={() => onPick(e)}>Dùng mẫu này</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
