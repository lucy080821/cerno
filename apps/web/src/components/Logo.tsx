import { useId } from "react";
import { BRAND } from "@dashboard/schema";

/** Logo Cerno: chữ C như con mắt, đồng tử là một điểm dữ liệu. Màu lấy từ BRAND; giữ khớp với app/icon.svg. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND.violet} />
          <stop offset="1" stopColor={BRAND.teal} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={BRAND.ink} />
      <path d="M45.4 20A18 18 0 1 0 45.4 44" fill="none" stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="round" />
      <circle cx="35" cy="32" r="5" fill={BRAND.teal} />
    </svg>
  );
}
