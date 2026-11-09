import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { site } from "@/lib/site";
import { siteUrl } from "@/lib/seo";
import { I18nRoot } from "@/components/i18n/I18nRoot";
import { DialogProvider } from "@/components/ui/DialogProvider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: `${site.name} | Tạo dashboard từ Google Sheets, đặt chart tự do`,
  description: site.description,
  applicationName: site.name,
  alternates: { canonical: "/" },
  keywords: ["tạo dashboard", "dashboard Google Sheets", "phần mềm làm dashboard", "báo cáo trực quan", "biểu đồ từ Google Sheets", "nhúng dashboard vào website", "công cụ BI"],
  openGraph: {
    type: "website",
    locale: "vi_VN",
    siteName: site.name,
    title: `${site.name} | Tạo dashboard từ Google Sheets`,
    description: site.description,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: `${site.name} | Tạo dashboard từ Google Sheets`, description: site.description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#060a14", colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      {/* Extension trình duyệt (ColorZilla, Grammarly...) hay chèn attribute vào <body> trước khi React chạy. */}
      <body suppressHydrationWarning>
        <I18nRoot />
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  );
}
