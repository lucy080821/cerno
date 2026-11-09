import type { Metadata } from "next";
import { ReadOnlyViewer } from "@/components/editor/ReadOnlyViewer";
import { loadSharedDashboard, sanitizeDocForEmbed, sourceRowCounts } from "@/lib/server/embed";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

// Link riêng tư theo mã: không cho công cụ tìm kiếm lập chỉ mục.
export const metadata: Metadata = {
  title: `Dashboard | ${site.name}`,
  robots: { index: false, follow: false },
};

function Unavailable({ message }: { message: string }) {
  return (
    <main style={{ maxWidth: 420, margin: "20vh auto", padding: 24, textAlign: "center" }}>
      <h1 style={{ fontSize: 20 }}>Không xem được dashboard</h1>
      <p style={{ color: "var(--muted)", marginTop: 8 }}>{message}</p>
    </main>
  );
}

/**
 * Trang xem công khai theo mã chia sẻ, dùng làm link và làm nguồn cho iframe.
 * Header CSP `frame-ancestors` (tên miền được phép nhúng) do middleware đặt theo từng mã.
 */
export default async function EmbedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let shared;
  try {
    shared = await loadSharedDashboard(token, ["embed"]);
  } catch {
    return <Unavailable message="Hệ thống đang bận, vui lòng thử lại sau." />;
  }
  if (!shared) return <Unavailable message="Link này không còn hiệu lực. Hãy liên hệ người chia sẻ để lấy link mới." />;
  if (!shared.doc) return <Unavailable message="Dữ liệu dashboard này đang lỗi định dạng." />;
  return (
    <ReadOnlyViewer
      doc={sanitizeDocForEmbed(shared.doc)}
      access={{ kind: "token", token }}
      sourceRows={await sourceRowCounts(shared.doc, shared.workspaceId)}
    />
  );
}
