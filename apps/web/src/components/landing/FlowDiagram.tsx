import s from "../../app/landing.module.css";

/**
 * Minh họa dòng dữ liệu: Google Sheets → Cerno → Dashboard. Thuần SVG + CSS, không JS, chỉ để trang trí
 * (aria-hidden). Các chấm chạy dùng SMIL; tắt bằng CSS khi người dùng chọn giảm chuyển động.
 */
export function FlowDiagram() {
  const dot = (path: string, begin: string) => (
    <circle r="5" className={s.flowDot}>
      <animateMotion dur="2.6s" begin={begin} repeatCount="indefinite" path={path} />
    </circle>
  );
  const L1 = "M262 120 L388 120";
  const L2 = "M572 120 L698 120";

  return (
    <svg className={s.flow} viewBox="0 0 960 250" role="img" aria-hidden focusable="false">
      <defs>
        <linearGradient id="fl-c" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d5efc" />
          <stop offset="1" stopColor="#19c3b1" />
        </linearGradient>
        <linearGradient id="fl-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#19c3b1" />
          <stop offset="1" stopColor="#6d5efc" />
        </linearGradient>
      </defs>

      {/* đường nối */}
      <path d={L1} className={s.flowLine} />
      <path d={L2} className={s.flowLine} />
      {dot(L1, "0s")}
      {dot(L1, "0.87s")}
      {dot(L1, "1.73s")}
      {dot(L2, "0.4s")}
      {dot(L2, "1.27s")}
      {dot(L2, "2.13s")}

      {/* 1. Google Sheets */}
      <g>
        <rect x="40" y="40" width="222" height="160" rx="16" className={s.flowCard} />
        {[0, 1, 2, 3].map((r) =>
          [0, 1, 2].map((c) => (
            <rect
              key={`${r}-${c}`}
              x={62 + c * 66}
              y={62 + r * 34}
              width="58"
              height="26"
              rx="5"
              className={r === 0 ? s.cellHead : s.cell}
              style={{ animationDelay: `${(r * 3 + c) * 0.18}s` }}
            />
          )),
        )}
        <text x="151" y="232" textAnchor="middle" className={s.flowLabel}>Google Sheets</text>
      </g>

      {/* 2. Cerno xử lý */}
      <g>
        <circle cx="480" cy="120" r="64" className={s.flowRing} />
        <circle cx="480" cy="120" r="64" className={`${s.flowRing} ${s.flowRing2}`} />
        <rect x="428" y="68" width="104" height="104" rx="24" fill="#14162b" stroke="rgba(255,255,255,0.14)" />
        <path d="M502 100A26 26 0 1 0 502 140" fill="none" stroke="url(#fl-c)" strokeWidth="10" strokeLinecap="round" />
        <circle cx="490" cy="120" r="7" fill="#19c3b1" />
        <text x="480" y="232" textAnchor="middle" className={s.flowLabel}>Cerno tự đọc và tính</text>
      </g>

      {/* 3. Dashboard */}
      <g>
        <rect x="698" y="40" width="222" height="160" rx="16" className={s.flowCard} />
        <rect x="716" y="56" width="90" height="10" rx="5" className={s.flowTitle} />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={718 + i * 38}
            y="82"
            width="26"
            height="100"
            rx="5"
            fill="url(#fl-bar)"
            className={s.bar}
            style={{ animationDelay: `${i * 0.25}s` }}
          />
        ))}
        <text x="809" y="232" textAnchor="middle" className={s.flowLabel}>Dashboard của bạn</text>
      </g>
    </svg>
  );
}
