import s from "../../app/landing.module.css";

type Pt = [number, number];

/** Đường mạch kiểu bảng mạch: các đoạn thẳng nối nhau, góc được bo tròn. */
function route(pts: Pt[], r = 18): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0);
    const l2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = x1 - ((x1 - x0) / l1) * rr;
    const ay = y1 - ((y1 - y0) / l1) * rr;
    const bx = x1 + ((x2 - x1) / l2) * rr;
    const by = y1 + ((y2 - y1) / l2) * rr;
    d += ` L${ax.toFixed(1)} ${ay.toFixed(1)} Q${x1} ${y1} ${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L${lx} ${ly}`;
}

interface Trace {
  pts: Pt[];
  /** Màu nhấn của đường (a = tím, b = ngọc), bỏ trống = đường xám mờ. */
  tone?: "a" | "b";
  /** Có chấm sáng chạy dọc đường này không: [thời gian một vòng (giây), trễ bắt đầu (giây)]. */
  pulse?: [number, number];
}

// Vùng vẽ 1600x1000, cắt theo khung nhìn. Đường dồn về hai mép để chữ ở giữa trang vẫn dễ đọc.
const TRACES: Trace[] = [
  { pts: [[0, 140], [220, 140], [280, 200], [280, 420], [340, 480], [520, 480]], tone: "b", pulse: [9, 0] },
  { pts: [[0, 330], [120, 330], [180, 390], [180, 640], [240, 700], [460, 700]], pulse: [11, 3] },
  { pts: [[0, 860], [200, 860], [260, 800], [260, 740], [420, 740]], tone: "a", pulse: [8, 5] },
  { pts: [[1600, 200], [1380, 200], [1320, 260], [1320, 520], [1260, 580], [1100, 580]], tone: "a", pulse: [10, 1.5] },
  { pts: [[1600, 420], [1480, 420], [1420, 480], [1420, 760], [1360, 820], [1180, 820]], pulse: [12, 6] },
  { pts: [[1600, 920], [1400, 920], [1340, 860], [1340, 820]], tone: "b", pulse: [8, 7] },
  { pts: [[520, 480], [600, 480], [660, 420], [660, 300], [720, 240], [900, 240]] },
  { pts: [[1100, 580], [1020, 580], [960, 640], [960, 760], [900, 820], [760, 820]] },
  { pts: [[400, 0], [400, 60], [460, 120], [700, 120], [760, 60], [760, 0]], tone: "b", pulse: [10, 2.5] },
  { pts: [[1160, 0], [1160, 90], [1220, 150], [1400, 150]] },
];

const ring = (p: Pt, key: string, filled = false) => (
  <circle key={key} cx={p[0]} cy={p[1]} r={filled ? 4 : 5} className={filled ? s.nodeFill : s.node} />
);

/**
 * Nền trang landing: mạng đường mạch nhỏ với vài chấm sáng chạy dọc, gợi ý "kết nối dữ liệu".
 * Cố định theo khung nhìn, nằm sau nội dung, không bắt chuột. Thuần SVG + CSS, không JS.
 * Chấm chạy ẩn khi người dùng chọn giảm chuyển động.
 */
export function CircuitBackground() {
  return (
    <div className={s.circuit} aria-hidden>
      <svg className={s.circuitSvg} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
        {TRACES.map((t, i) => (
          <path
            key={`p${i}`}
            d={route(t.pts)}
            className={`${s.trace} ${t.tone === "a" ? s.traceA : t.tone === "b" ? s.traceB : ""}`}
          />
        ))}
        {TRACES.map((t, i) => [
          ring(t.pts[0], `s${i}`, true),
          ring(t.pts[t.pts.length - 1], `e${i}`),
        ])}
        {TRACES.map((t, i) =>
          t.pulse ? (
            <circle key={`d${i}`} r="3.2" className={`${s.pulse} ${t.tone === "a" ? s.pulseA : ""}`}>
              <animateMotion dur={`${t.pulse[0]}s`} begin={`${t.pulse[1]}s`} repeatCount="indefinite" path={route(t.pts)} />
            </circle>
          ) : null,
        )}
      </svg>
    </div>
  );
}
