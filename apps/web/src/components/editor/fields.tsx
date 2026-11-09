"use client";

import type { ReactNode } from "react";
import s from "./editor.module.css";

const ICONS: Record<string, string> = {
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  eyeOff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  copy: "M9 9h11v11H9zM5 15V4h11",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  expand: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  phone: "M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2",
  play: "M7 4l13 8-13 8z",
  pencil: "M4 20l4-1 11-11-3-3L5 16l-1 4z",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  upload: "M12 16V5M7 9l5-5 5 5M5 20h14",
  reset: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
  refresh: "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  close: "M6 6l12 12M18 6L6 18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  // Biểu tượng của các mục trong bảng thuộc tính
  grid: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  canvas: "M3 5h18v14H3zM8 9h5v6H8z",
  database: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  chart: "M5 20V10M12 20V4M19 20v-7",
  move: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
  palette: "M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.5-1-1.7-1-3 0-1 .8-2 2-2h2a4 4 0 0 0 4-4c0-4-4-7-9-7zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
  type: "M5 6h14M12 6v13M9 19h6",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4",
  box: "M4 4h16v16H4z",
  align: "M4 6h16M4 12h10M4 18h14",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M13 4v4M7 10v4M15 16v4",
  info: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  chevron: "M6 9l6 6 6-6",
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Biểu tượng mặc định theo tên mục, để các nơi gọi <Section title="..."> không phải khai báo thêm. */
function iconFor(title: string): keyof typeof ICONS {
  const k = title.trim().toLowerCase();
  if (k === "dashboard") return "grid";
  if (k === "canvas") return "canvas";
  if (k === "nguồn dữ liệu" || k === "trường dữ liệu") return "database";
  if (k.startsWith("trang")) return "file";
  if (k.startsWith("lớp") || k === "thứ tự lớp") return "layers";
  if (k === "biểu đồ" || k === "kpi") return "chart";
  if (k === "vị trí và kích thước") return "move";
  if (k === "định dạng") return "palette";
  if (k === "định dạng chữ" || k === "nội dung") return "type";
  if (k === "ảnh" || k === "hiển thị ảnh") return "image";
  if (k === "khung") return "box";
  if (k.startsWith("căn")) return "align";
  if (k === "trên điện thoại") return "phone";
  if (k === "bộ lọc dashboard") return "sliders";
  if (k === "thêm vào canvas") return "plus";
  return "sliders";
}

/**
 * Một mục trong bảng bên (trái/phải): tiêu đề có biểu tượng, bấm để thu gọn / mở ra. Mặc định mở.
 * Dùng <details> nên thu gọn được bằng bàn phím và không cần thêm trạng thái.
 */
export function Section({ title, icon, defaultOpen = true, children }: {
  title: string; icon?: keyof typeof ICONS; defaultOpen?: boolean; children: ReactNode;
}) {
  return (
    <details className={s.section} open={defaultOpen}>
      <summary className={s.sectionTitle}>
        <span className={s.sectionIcon} aria-hidden><Icon name={icon ?? iconFor(title)} size={14} /></span>
        <span className={s.sectionText}>{title}</span>
        <span className={s.sectionChevron} aria-hidden><Icon name="chevron" size={14} /></span>
      </summary>
      <div className={s.sectionBody}>{children}</div>
    </details>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function NumField({
  label, value, onChange, min, max, step = 1, suffix,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <Field label={label}>
      <span className={s.numWrap}>
        <input
          type="number"
          className={s.input}
          value={Math.round(value * 10) / 10}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v)) onChange(v);
          }}
        />
        {suffix && <em>{suffix}</em>}
      </span>
    </Field>
  );
}

export function TextField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <Field label={label}>
      <input className={s.input} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <select className={s.input} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function ColorField({ label, value, onChange, clearable, emptyLabel = "Trong suốt" }: {
  label: string; value: string | undefined; onChange: (v: string | undefined) => void; clearable?: boolean;
  /** Chữ hiện khi chưa chọn màu (nền: "Trong suốt", chữ: "Mặc định"). */
  emptyLabel?: string;
}) {
  return (
    <Field label={label}>
      <span className={s.colorWrap}>
        <input type="color" className={s.color} value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)} />
        <span className={s.colorText}>{value ?? emptyLabel}</span>
        {clearable && value && (
          <button type="button" className={s.iconBtn} title="Xoá màu" onClick={() => onChange(undefined)}>
            <Icon name="close" size={12} />
          </button>
        )}
      </span>
    </Field>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={s.toggle}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
