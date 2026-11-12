import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

/**
 * Cho bot lập chỉ mục các trang công khai; chặn khu vực cần đăng nhập, API và các trang xem/nhúng dashboard
 * (link xem và mã nhúng mang tính riêng tư, không nên xuất hiện trên công cụ tìm kiếm).
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/auth/", "/editor/", "/dashboards", "/account", "/d/", "/view/", "/embed/", "/login", "/unsubscribe"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
