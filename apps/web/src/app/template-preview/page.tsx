import type { Metadata } from "next";
import Link from "next/link";
import { TEMPLATES } from "@/content/templates";

export const metadata: Metadata = { title: "Xem trước mẫu", robots: { index: false, follow: false } };

/** Danh sách mẫu để script chụp ảnh duyệt qua (mỗi mẫu một liên kết). */
export default function TemplatePreviewIndex() {
  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <ul>
        {TEMPLATES.map((e) => (
          <li key={e.template.id}><Link href={`/template-preview/${e.template.id}`}>{e.template.name}</Link></li>
        ))}
      </ul>
    </main>
  );
}
