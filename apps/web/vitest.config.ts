import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Giống tsconfig của web: alias "@/..." trỏ vào src, và JSX dùng runtime tự động (không cần import React).
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
