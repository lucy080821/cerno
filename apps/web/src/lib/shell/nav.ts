import type { NavIconName } from "@/components/shell/NavIcon";

/** Mục điều hướng của thanh bên (dùng chung giữ chỗ khi đang tải và bản thật). */
export type BadgeKey = "todos" | "alertsFiring";
export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: NavIconName;
  badge?: BadgeKey;
}
export type NavEntry = { group: string } | NavItem;

export const NAV: NavEntry[] = [
  { key: "overview", href: "/overview", label: "Tổng quan", icon: "home" },
  { group: "Dữ liệu" },
  { key: "sources", href: "/sources", label: "Nguồn dữ liệu", icon: "database" },
  { key: "orders", href: "/orders", label: "Đơn hàng", icon: "list" },
  { key: "products", href: "/products", label: "Sản phẩm và giá vốn", icon: "box" },
  { key: "costs", href: "/costs", label: "Chi phí", icon: "wallet" },
  { group: "Phân tích" },
  { key: "dashboards", href: "/dashboards", label: "Dashboard", icon: "grid" },
  { key: "profit", href: "/profit", label: "Lãi lỗ", icon: "trend" },
  { key: "returns", href: "/returns", label: "Hoàn và hủy", icon: "return" },
  { key: "ai", href: "/ai", label: "Hỏi AI", icon: "sparkle" },
  { group: "Hành động" },
  { key: "todos", href: "/todos", label: "Việc cần làm", icon: "check", badge: "todos" },
  { key: "alerts", href: "/alerts", label: "Cảnh báo", icon: "bell", badge: "alertsFiring" },
  { key: "reports", href: "/reports", label: "Báo cáo định kỳ", icon: "mail" },
  { group: "Chia sẻ" },
  { key: "templates", href: "/templates", label: "Mẫu dashboard", icon: "templates" },
  { key: "sharing", href: "/sharing", label: "Chia sẻ và nhúng", icon: "share" },
];

/** Mục nào đang mở theo đường dẫn hiện tại (trang con cũng tính, vd /orders?filter=… cùng /orders). */
export function activeKey(pathname: string | null): string | null {
  if (!pathname) return null;
  const hit = NAV.find((n): n is NavItem => "href" in n && (pathname === n.href || pathname.startsWith(`${n.href}/`)));
  return hit?.key ?? null;
}
