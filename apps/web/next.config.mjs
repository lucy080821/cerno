import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

// File .env nằm ở thư mục gốc repo (không phải apps/web). Nạp vào process.env phía server;
// biến không có tiền tố NEXT_PUBLIC_ thì không bao giờ lọt xuống trình duyệt.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== "production", console, true);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Package nội bộ trong monorepo được viết bằng TypeScript thô.
  transpilePackages: ["@dashboard/schema", "@dashboard/chart-engine"],
  // Đặt NEXT_OUTPUT=export để build tĩnh (gói hosting không có Node.js).
  // Bản tĩnh không có API route / SSR, chỉ dùng cho trang giới thiệu (không chạy được chat AI).
  output: process.env.NEXT_OUTPUT === "export" ? "export" : undefined,
  // Chống clickjacking: không trang nào của app được nhúng vào website khác, TRỪ /embed/<mã> (middleware.ts đặt
  // CSP frame-ancestors riêng theo tên miền khách khai báo). Bản build tĩnh không hỗ trợ headers().
  ...(process.env.NEXT_OUTPUT === "export"
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/((?!embed/).*)",
              headers: [
                { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
                { key: "X-Frame-Options", value: "DENY" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
