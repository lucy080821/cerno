import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Dashboard } from "@dashboard/schema";
import { EditorApp } from "@/components/editor/EditorApp";
import { createClient } from "@/lib/supabase/server";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  // Tạm thời; EditorApp đổi thành tên dashboard của người dùng khi nạp xong.
  title: `Editor | ${site.name}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/editor/${id}`)}`);

  // Vai trò trên dashboard này: owner / editor (được mời sửa) vào editor; người chỉ có quyền xem chuyển sang trang xem.
  const { data: role } = await supabase.rpc("dashboard_role", { d: id });
  if (!role) notFound();
  if (role === "viewer" || role === "member") redirect(`/d/${id}`);

  // RLS: chỉ đọc được dashboard thuộc workspace của mình. Không thấy thì coi như không tồn tại.
  const { data } = await supabase.from("dashboards").select("id, doc, updated_at").eq("id", id).maybeSingle();
  if (!data) notFound();

  const parsed = Dashboard.safeParse(data.doc);
  if (!parsed.success) {
    return (
      <main style={{ maxWidth: 480, margin: "20vh auto", padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>Không mở được dashboard</h1>
        <p style={{ color: "var(--muted)", margin: "8px 0 16px" }}>
          Dữ liệu dashboard này không đúng định dạng ({parsed.error.issues[0]?.path.join(".") || "doc"}). Dữ liệu trên server chưa bị thay đổi.
        </p>
        <Link href="/dashboards" style={{ color: "var(--cyan)" }}>← Về danh sách dashboard</Link>
      </main>
    );
  }

  return (
    <EditorApp
      key={data.id}
      dashboardId={data.id}
      initialDoc={{ ...parsed.data, id: data.id }}
      initialRev={data.updated_at}
      /* Người được mời quyền Sửa không quản lý được chia sẻ/mời người khác. */
      canShare={role === "owner"}
    />
  );
}
