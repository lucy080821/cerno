import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Dashboard } from "@dashboard/schema";
import { ReadOnlyViewer } from "@/components/editor/ReadOnlyViewer";
import { ViewerBar } from "@/components/ViewerBar";
import { createClient } from "@/lib/supabase/server";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Dashboard | ${site.name}`, robots: { index: false } };

/**
 * Xem dashboard (chỉ đọc) bằng tài khoản đã đăng nhập: dành cho người được mời quyền Xem và thành viên workspace chỉ có quyền xem.
 * Người có quyền Sửa được chuyển thẳng sang editor. Quyền do RLS quyết định, không tin dữ liệu từ trình duyệt.
 */
export default async function SharedViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/d/${id}`)}`);

  const { data: role } = await supabase.rpc("dashboard_role", { d: id });
  if (!role) notFound();
  if (role === "owner" || role === "editor") redirect(`/editor/${id}`);

  const { data } = await supabase.from("dashboards").select("doc").eq("id", id).maybeSingle();
  const parsed = data ? Dashboard.safeParse(data.doc) : null;
  if (!parsed?.success) notFound();

  const doc = parsed.data;
  // Số dòng từng nguồn (RLS: chỉ thấy nguồn mà dashboard được mời đang dùng).
  const srcIds = doc.sources.filter((s) => s.type === "google_sheets").map((s) => s.id);
  const { data: counts } = srcIds.length
    ? await supabase.from("data_sources").select("id, row_count").in("id", srcIds)
    : { data: [] };
  const sourceRows = Object.fromEntries((counts ?? []).map((r) => [r.id as string, (r.row_count as number) ?? 0]));
  return (
    <ReadOnlyViewer
      doc={{ ...doc, id, sources: doc.sources.map((s) => (s.type === "google_sheets" ? { ...s, spreadsheetId: "" } : s)) }}
      access={{ kind: "session" }}
      sourceRows={sourceRows}
      brand={false}
      commentsFor={id}
      bar={<ViewerBar name={doc.name} backHref="/dashboards" />}
    />
  );
}
