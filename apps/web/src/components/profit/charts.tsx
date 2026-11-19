import { compact } from "./format";

/** Biểu đồ SVG nhẹ cho các trang lãi từng đơn (không tải ECharts). Màu lấy theo biến CSS của giao diện. */
const POS = "var(--green)";
const NEG = "#f87171";
const BASE = "var(--brand-a)";

export interface WaterfallItem {
  label: string;
  value: number;
  kind: "total" | "neg" | "pos" | "result";
}

export function Waterfall({ items, height = 260, fmt = compact }: { items: WaterfallItem[]; height?: number; fmt?: (n: number) => string }) {
  const w = 640, pt = 28, pb = 40, ih = height - pt - pb;
  let level = 0;
  const bars = items.map((it) => {
    if (it.kind === "total") { level = it.value; return { ...it, from: 0, to: it.value }; }
    if (it.kind === "neg") { const b = { ...it, from: level, to: level - it.value }; level -= it.value; return b; }
    if (it.kind === "pos") { const b = { ...it, from: level, to: level + it.value }; level += it.value; return b; }
    return { ...it, from: 0, to: level, value: level };
  });
  const hi = Math.max(0, ...bars.flatMap((b) => [b.from, b.to]));
  const lo = Math.min(0, ...bars.flatMap((b) => [b.from, b.to]));
  const span = hi - lo || 1;
  const Y = (v: number) => pt + ((hi - v) / span) * ih;
  const slot = w / bars.length, bw = Math.min(64, slot * 0.6);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" role="img" style={{ display: "block" }}>
      <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke="var(--line)" />
      {bars.map((b, i) => {
        const cx = slot * (i + 0.5), y1 = Y(Math.max(b.from, b.to)), y2 = Y(Math.min(b.from, b.to));
        const color = b.kind === "total" ? BASE : b.kind === "neg" ? "#fb923c" : b.kind === "pos" ? "var(--brand-b)" : b.to >= 0 ? POS : NEG;
        const txt = b.kind === "neg" ? `-${fmt(b.value)}` : b.kind === "pos" ? `+${fmt(b.value)}` : fmt(b.value);
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={y1} width={bw} height={Math.max(2, y2 - y1)} rx={5} fill={color} />
            {i < bars.length - 1 && <line x1={cx + bw / 2} x2={cx + slot - bw / 2} y1={Y(b.to)} y2={Y(b.to)} stroke="var(--muted)" strokeDasharray="3 3" opacity={0.6} />}
            <text x={cx} y={y1 - 7} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="var(--text)">{txt}</text>
            <text x={cx} y={height - 14} textAnchor="middle" fontSize={12} fill="var(--muted)">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Histogram({ bins, height = 220 }: { bins: { label: string; count: number; negative: boolean }[]; height?: number }) {
  const w = 640, pt = 22, pb = 30, ih = height - pt - pb;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const slot = w / bins.length, bw = slot * 0.74;
  const zero = bins.findIndex((b) => !b.negative);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" role="img" style={{ display: "block" }}>
      {bins.map((b, i) => {
        const h = (b.count / max) * ih, cx = slot * (i + 0.5);
        return (
          <g key={b.label}>
            <rect x={cx - bw / 2} y={pt + ih - h} width={bw} height={Math.max(1, h)} rx={4} fill={b.negative ? NEG : POS} opacity={0.9} />
            <text x={cx} y={pt + ih - h - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--text)">{b.count}</text>
            <text x={cx} y={height - 10} textAnchor="middle" fontSize={11} fill="var(--muted)">{b.label}</text>
          </g>
        );
      })}
      {zero > 0 && <line x1={slot * zero} x2={slot * zero} y1={pt - 10} y2={pt + ih} stroke="var(--text)" strokeDasharray="4 3" opacity={0.6} />}
    </svg>
  );
}

/** Cột theo ngày, cột âm màu đỏ. */
export function DayBars({ data, height = 200 }: { data: { date: string; profit: number }[]; height?: number }) {
  const w = 640, pt = 14, pb = 26, ih = height - pt - pb;
  const hi = Math.max(0, ...data.map((d) => d.profit)), lo = Math.min(0, ...data.map((d) => d.profit));
  const span = hi - lo || 1;
  const Y = (v: number) => pt + ((hi - v) / span) * ih;
  const slot = w / Math.max(1, data.length), bw = Math.max(2, Math.min(26, slot * 0.7));
  const every = Math.max(1, Math.ceil(data.length / 10));
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" role="img" style={{ display: "block" }}>
      <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke="var(--line)" />
      {data.map((d, i) => {
        const cx = slot * (i + 0.5), y1 = Y(Math.max(0, d.profit)), y2 = Y(Math.min(0, d.profit));
        return (
          <g key={d.date}>
            <rect x={cx - bw / 2} y={y1} width={bw} height={Math.max(1, y2 - y1)} rx={3} fill={d.profit >= 0 ? POS : NEG}>
              <title>{`${d.date}: ${compact(d.profit)}`}</title>
            </rect>
            {i % every === 0 && <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{d.date.slice(8, 10)}/{d.date.slice(5, 7)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** Thanh ngang có nhãn, giá trị âm màu đỏ. */
export function HBars({ rows, userLabels = true }: { rows: { label: string; value: number; text: string; tone?: "pos" | "neg" | "base" }[]; userLabels?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 34%) 1fr auto", gap: 12, alignItems: "center", fontSize: "0.88rem" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-i18n-skip={userLabels ? "" : undefined}>{r.label}</span>
          <span style={{ height: 10, borderRadius: 5, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(Math.abs(r.value) / max) * 100}%`, borderRadius: 5, background: r.tone === "base" ? BASE : (r.tone ?? (r.value < 0 ? "neg" : "pos")) === "neg" ? NEG : POS }} />
          </span>
          <b style={{ fontVariantNumeric: "tabular-nums", minWidth: 90, textAlign: "right" }}>{r.text}</b>
        </div>
      ))}
    </div>
  );
}
