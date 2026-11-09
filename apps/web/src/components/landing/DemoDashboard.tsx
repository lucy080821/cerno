"use client";

import { Dashboard } from "@dashboard/schema";
import demo from "@/content/demo-dashboard.json";
import { ReadOnlyViewer, type RowsAccess } from "@/components/editor/ReadOnlyViewer";

/**
 * Dashboard dùng thử trên trang giới thiệu. Toàn bộ nằm trong mã nguồn (doc + dữ liệu ở `content/demo-dashboard.json`,
 * ảnh ở `public/img/demo`), nên chạy y hệt ở máy bạn và trên hosting thật, không cần Supabase, link chia sẻ hay tên
 * miền nhúng. Cập nhật bằng `npm run export:demo -w @dashboard/web -- <id dashboard>`.
 */
const parsed = Dashboard.parse(demo.doc);
// Thanh trang hẹp lại một chút để dành chỗ cho biểu đồ trong khung nhỏ của trang giới thiệu.
const doc: Dashboard = { ...parsed, nav: { ...parsed.nav, width: 150, fontSize: 12 } };
const access: RowsAccess = { kind: "static", rows: demo.rows as Extract<RowsAccess, { kind: "static" }>["rows"] };
const sourceRows = Object.fromEntries(Object.entries(demo.rows).map(([id, rows]) => [id, rows.length]));

export default function DemoDashboard() {
  return <ReadOnlyViewer doc={doc} access={access} sourceRows={sourceRows} brand={false} showLang={false} manageTitle={false} pageScroll contained />;
}
