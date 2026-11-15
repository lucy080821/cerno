import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplateViewerLazy } from "@/components/templates/TemplateViewerLazy";
import { getTemplateEntry } from "@/content/templates";

export const metadata: Metadata = { title: "Xem trước mẫu", robots: { index: false, follow: false } };

/**
 * Dashboard của một mẫu chạy thật trên dữ liệu mẫu, chiếm cả màn hình. Dùng để chụp ảnh minh họa cho thư viện mẫu
 * (`npm run shoot:templates`) và để xem nhanh một mẫu; không cần đăng nhập, không có dữ liệu người dùng.
 */
export default async function TemplatePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = getTemplateEntry(id);
  if (!entry) notFound();
  return (
    <div style={{ position: "fixed", inset: 0, background: "#f1f4f9" }}>
      <TemplateViewerLazy template={entry.template} />
    </div>
  );
}
