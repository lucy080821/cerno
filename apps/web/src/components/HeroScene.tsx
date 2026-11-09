import type { ReactNode } from "react";
import { BRAND } from "@dashboard/schema";
import s from "./HeroScene.module.css";

type Pt = [number, number];

/** Đường cong mượt đi qua các điểm (Catmull-Rom → Bézier). */
function smooth(pts: Pt[]): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

const COLORS = {
  cyan: BRAND.teal,
  violet: BRAND.violet,
  green: "#34d399",
  amber: "#fbbf24",
  muted: "#8b97b1",
  text: "#e8edf7",
};

// Dây điện: từ cổng của database (x=270) tới mép trái card dashboard (x=480).
const WIRES = [
  { id: "w0", d: "M270 227 C 380 227, 380 115, 480 115", color: COLORS.cyan },
  { id: "w1", d: "M270 297 C 380 297, 380 265, 480 265", color: COLORS.violet },
  { id: "w2", d: "M270 367 C 380 367, 380 455, 480 455", color: COLORS.green },
];

function Card({ x, y, w, h, title, children }: {
  x: number; y: number; w: number; h: number; title: string; children: ReactNode;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} fill="url(#card)" stroke="rgba(255,255,255,0.14)" />
      <text x={x + 18} y={y + 26} className={s.text} fontSize={12.5} fontWeight={600} fill={COLORS.text}>
        {title}
      </text>
      {children}
    </g>
  );
}

export function HeroScene() {
  const barHeights = [50, 72, 58, 96, 80, 110, 90, 125];
  const line1: Pt[] = [[500, 490], [537, 478], [574, 485], [611, 455], [648, 462], [685, 435], [722, 440], [760, 415]];
  const line2: Pt[] = [[500, 505], [537, 500], [574, 492], [611, 495], [648, 480], [685, 478], [722, 470], [760, 466]];
  const area: Pt[] = [[820, 205], [868, 196], [916, 200], [964, 176], [1012, 160], [1060, 136], [1110, 118]];
  const heat = [
    [0.2, 0.4, 0.7, 0.9, 0.6, 0.35, 0.2],
    [0.35, 0.6, 0.95, 0.75, 0.5, 0.3, 0.45],
    [0.15, 0.3, 0.5, 0.65, 0.85, 0.7, 0.4],
  ];

  return (
    <svg
      className={s.svg}
      viewBox="0 0 1200 600"
      role="img"
      aria-label="Cơ sở dữ liệu nối bằng dây điện tới một dashboard gồm nhiều biểu đồ"
    >
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.03)" />
        </linearGradient>
        <linearGradient id="dbBody" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0e2a3d" />
          <stop offset="0.5" stopColor="#14425e" />
          <stop offset="1" stopColor="#0b2233" />
        </linearGradient>
        <linearGradient id="dbTop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND.teal} />
          <stop offset="1" stopColor="#0d7a70" />
        </linearGradient>
        <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={COLORS.cyan} />
          <stop offset="1" stopColor={BRAND.violet} />
        </linearGradient>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={COLORS.violet} stopOpacity="0.55" />
          <stop offset="1" stopColor={COLORS.violet} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={COLORS.cyan} stopOpacity="0.3" />
          <stop offset="1" stopColor={COLORS.cyan} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* ---------- Dây điện ---------- */}
      {WIRES.map((w) => (
        <g key={w.id}>
          <path id={w.id} d={w.d} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={3} />
          <path d={w.d} fill="none" stroke={w.color} strokeOpacity={0.35} strokeWidth={1.5} />
          <path d={w.d} pathLength={100} fill="none" stroke={w.color} strokeWidth={3.5}
            strokeLinecap="round" filter="url(#glow)" className={s.pulse} />
          <path d={w.d} pathLength={100} fill="none" stroke="#fff" strokeWidth={1.6}
            strokeLinecap="round" className={s.pulseShort} style={{ animationDelay: "0.8s" }} />
          {[0, 1].map((k) => (
            <circle key={k} r={3.2} fill="#fff" filter="url(#glow)" className={s.packet}>
              <animateMotion dur="3.2s" begin={`${-k * 1.6}s`} repeatCount="indefinite">
                <mpath href={`#${w.id}`} />
              </animateMotion>
            </circle>
          ))}
        </g>
      ))}

      {/* Liên kết ngắn giữa các card */}
      {[115, 300, 470].map((y, i) => (
        <g key={y}>
          <path d={`M780 ${y} L800 ${y}`} stroke="rgba(255,255,255,0.18)" strokeWidth={2} />
          <path d={`M780 ${y} L800 ${y}`} pathLength={100} stroke={COLORS.cyan} strokeWidth={2.5}
            strokeLinecap="round" className={s.pulseShort} style={{ animationDelay: `${i * 0.5}s` }} />
        </g>
      ))}

      {/* ---------- Database ---------- */}
      <g className={s.float}>
        <g transform="translate(70 190)">
          {[2, 1, 0].map((i) => (
            <g key={i} transform={`translate(0 ${i * 70})`}>
              <path d="M0 20 V54 A100 20 0 0 0 200 54 V20" fill="url(#dbBody)" stroke="rgba(56,189,248,0.55)" />
              <ellipse cx={100} cy={20} rx={100} ry={20} fill="url(#dbTop)" stroke="rgba(186,230,253,0.6)" />
              <ellipse cx={100} cy={20} rx={70} ry={11} fill="none" stroke="rgba(255,255,255,0.25)" />
              <circle cx={34} cy={46} r={3.4} fill={COLORS.green} filter="url(#glow)" className={s.led}
                style={{ animationDelay: `${i * 0.5}s` }} />
              <circle cx={48} cy={46} r={3.4} fill={COLORS.amber} className={s.led}
                style={{ animationDelay: `${i * 0.5 + 0.9}s` }} />
              <rect x={120} y={42} width={56} height={6} rx={3} fill="rgba(255,255,255,0.18)" />
            </g>
          ))}
        </g>
        <text x={170} y={440} textAnchor="middle" className={s.text} fontSize={13} fontWeight={600} fill={COLORS.muted}>
          Google Sheets · Database
        </text>
      </g>

      {/* Cổng kết nối trên database và trên card */}
      {[227, 297, 367].map((y, i) => (
        <circle key={y} cx={270} cy={y} r={5} fill={WIRES[i].color} filter="url(#glow)" />
      ))}
      {[115, 265, 455].map((y, i) => (
        <g key={y}>
          <circle cx={480} cy={y} r={5} fill={WIRES[i].color} filter="url(#glow)" />
          <circle cx={480} cy={y} r={5} fill="none" stroke={WIRES[i].color} strokeWidth={2}
            className={s.ring} style={{ animationDelay: `${i * 0.7}s` }} />
        </g>
      ))}

      {/* ---------- Dashboard ---------- */}
      {/* KPI */}
      <Card x={480} y={70} w={300} h={90} title="Tổng quan">
        <text x={498} y={126} className={s.text} fontSize={24} fontWeight={800} fill={COLORS.text}>$128.4K</text>
        <text x={498} y={144} className={s.text} fontSize={11} fill={COLORS.green}>▲ 12.5% doanh thu</text>
        <text x={640} y={126} className={s.text} fontSize={24} fontWeight={800} fill={COLORS.text}>3,482</text>
        <text x={640} y={144} className={s.text} fontSize={11} fill={COLORS.green}>▲ 4.1% đơn hàng</text>
      </Card>

      {/* Cột */}
      <Card x={480} y={180} w={300} h={170} title="Doanh thu theo tháng">
        <line x1={498} y1={330} x2={762} y2={330} stroke="rgba(255,255,255,0.12)" />
        {barHeights.map((h, i) => (
          <rect key={i} className={s.bar} x={500 + i * 32.5} y={330 - h} width={22} height={h} rx={4}
            fill="url(#barFill)" style={{ animationDelay: `${0.3 + i * 0.09}s` }} />
        ))}
      </Card>

      {/* Đường */}
      <Card x={480} y={370} w={300} h={170} title="Lượt truy cập">
        <path d={`${smooth(line1)} L760 525 L500 525 Z`} fill="url(#lineFill)" className={s.fade} />
        <path d={smooth(line2)} pathLength={1} fill="none" stroke={COLORS.violet} strokeWidth={2.2}
          strokeLinecap="round" className={s.draw} style={{ animationDelay: "0.7s" }} />
        <path d={smooth(line1)} pathLength={1} fill="none" stroke={COLORS.cyan} strokeWidth={2.6}
          strokeLinecap="round" className={s.draw} />
        <circle cx={760} cy={415} r={4.5} fill={COLORS.cyan} filter="url(#glow)" className={s.fade} />
      </Card>

      {/* Vùng */}
      <Card x={800} y={70} w={330} h={170} title="Tăng trưởng người dùng">
        <path d={`${smooth(area)} L1110 225 L820 225 Z`} fill="url(#areaFill)" className={s.fade} />
        <path d={smooth(area)} pathLength={1} fill="none" stroke={COLORS.violet} strokeWidth={2.6}
          strokeLinecap="round" className={s.draw} style={{ animationDelay: "0.6s" }} />
        <circle cx={1110} cy={118} r={4.5} fill={COLORS.violet} filter="url(#glow)" className={s.fade} />
      </Card>

      {/* Donut */}
      <Card x={800} y={260} w={330} h={130} title="Nguồn truy cập">
        <g transform="rotate(-90 870 335)" fill="none" strokeWidth={14}>
          <circle cx={870} cy={335} r={34} stroke="rgba(255,255,255,0.08)" />
          <circle cx={870} cy={335} r={34} pathLength={100} stroke={COLORS.cyan}
            strokeDasharray="43 57" className={s.fade} />
          <circle cx={870} cy={335} r={34} pathLength={100} stroke={COLORS.violet}
            strokeDasharray="28 72" strokeDashoffset={-45} className={s.fade} />
          <circle cx={870} cy={335} r={34} pathLength={100} stroke={COLORS.amber}
            strokeDasharray="22 78" strokeDashoffset={-75} className={s.fade} />
        </g>
        {[
          ["Organic", "45%", COLORS.cyan],
          ["Quảng cáo", "30%", COLORS.violet],
          ["Giới thiệu", "25%", COLORS.amber],
        ].map(([label, pct, color], i) => (
          <g key={label}>
            <circle cx={950} cy={312 + i * 22} r={4.5} fill={color} />
            <text x={964} y={316 + i * 22} className={s.text} fontSize={12} fill={COLORS.muted}>{label}</text>
            <text x={1100} y={316 + i * 22} textAnchor="end" className={s.text} fontSize={12} fontWeight={700}
              fill={COLORS.text}>{pct}</text>
          </g>
        ))}
      </Card>

      {/* Heatmap */}
      <Card x={800} y={410} w={330} h={130} title="Hiệu suất theo khu vực">
        {heat.map((row, r) =>
          row.map((v, c) => (
            <rect key={`${r}-${c}`} x={820 + c * 41} y={438 + r * 31} width={36} height={25} rx={5}
              fill={COLORS.cyan} fillOpacity={0.12 + v * 0.75} className={s.fade}
              style={{ animationDelay: `${0.8 + (r + c) * 0.07}s` }} />
          )),
        )}
      </Card>
    </svg>
  );
}
