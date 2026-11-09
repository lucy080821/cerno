import type { Metadata } from "next";
import { ReadOnlyViewer } from "@/components/editor/ReadOnlyViewer";
import { ViewerBar } from "@/components/ViewerBar";
import { loadSharedDashboard, sanitizeDocForEmbed, sourceRowCounts } from "@/lib/server/embed";
import { createClient } from "@/lib/supabase/server";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

// Link riêng tư theo mã: không cho công cụ tìm kiếm lập chỉ mục, và không gửi mã đi qua header Referer.
export const metadata: Metadata = {
  title: `Dashboard | ${site.name}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Unavailable({ message }: { message: string }) {
  return (
    <main style={{ maxWidth: 420, margin: "20vh auto", padding: 24, textAlign: "center" }}>
      <h1 style={{ fontSize: 20 }}>Không xem được dashboard</h1>
      <p style={{ color: "var(--muted)", marginTop: 8 }}>{message}</p>
    </main>
  );
}

/** Người đang đăng nhập có quyền sửa dashboard này không (để hiện nút "Chỉnh sửa"). Lỗi thì coi là không. */
async function canEdit(dashboardId: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: role } = await supabase.rpc("dashboard_role", { d: dashboardId });
    return role === "owner" || role === "editor";
  } catch {
    return false;
  }
}

/**
 * Link xem công khai trên Cerno: ai có link cũng xem, đổi bộ lọc, lọc chéo được; KHÔNG sửa được.
 * Chỉ người đã được chủ cấp quyền Sửa (và đang đăng nhập) mới thấy nút "Chỉnh sửa".
 */
export default async function ViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let shared;
  try {
    shared = await loadSharedDashboard(token, ["link"]);
  } catch {
    return <Unavailable message="Hệ thống đang bận, vui lòng thử lại sau." />;
  }
  if (!shared) return <Unavailable message="Link này không còn hiệu lực. Hãy liên hệ người chia sẻ để lấy link mới." />;
  if (!shared.doc) return <Unavailable message="Dữ liệu dashboard này đang lỗi định dạng." />;
  const edit = await canEdit(shared.id);
  return (
    <ReadOnlyViewer
      doc={sanitizeDocForEmbed(shared.doc)}
      access={{ kind: "token", token }}
      sourceRows={await sourceRowCounts(shared.doc, shared.workspaceId)}
      brand={false}
      bar={<ViewerBar name={shared.doc.name} editHref={edit ? `/editor/${shared.id}` : undefined} />}
    />
  );
}
