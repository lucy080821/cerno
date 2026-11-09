import { site } from "@/lib/site";
import { LogoMark } from "./Logo";

/**
 * Logo + tên ứng dụng, luôn đi liền nhau. Mọi chỗ hiện tên thương hiệu (tiêu đề trang, liên kết "Tạo bằng ...")
 * dùng component này để logo không bao giờ bị thiếu.
 *
 * `strong`: chữ trắng, đậm, to hơn một chút và giãn chữ, để tách bạch với logo màu bên cạnh.
 * `inherit` (mặc định): chữ thừa hưởng màu và cỡ của phần tử bao ngoài (dùng cho dòng nhỏ kiểu "Tạo bằng ...").
 */
export function Brand({
  size = 24, gap, tone = "inherit",
}: { size?: number; gap?: number; tone?: "strong" | "inherit" }) {
  const strong = tone === "strong";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: gap ?? 8, verticalAlign: "middle" }}>
      <LogoMark size={size} />
      <span
        style={
          strong
            ? { color: "var(--text, #e6eaf4)", fontWeight: 800, fontSize: `${Math.round(size * 0.78)}px`, letterSpacing: "0.02em", lineHeight: 1 }
            : undefined
        }
      >
        {site.name}
      </span>
    </span>
  );
}
