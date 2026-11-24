import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../AppShell";
import type { SourceRow } from "../sources/types";
import { DashboardList, type SharedDashboard } from "./DashboardList";
import type { DashboardRow } from "@/lib/dashboards/api";

export const dynamic = "force-dynamic";

export default async function DashboardsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Chỉ liệt kê thứ thuộc workspace của mình: RLS còn cho đọc cả nguồn/dashboard được người khác mời, những thứ đó
  // không được lẫn vào danh sách "của bạn" (hiện ở mục "Được chia sẻ với bạn").
  const { data: mem } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", user.id);
  const wsIds = (mem ?? []).map((m) => m.workspace_id as string);

  const { data } = wsIds.length
    ? await supabase
        .from("data_sources")
        .select("id, name, sheet_name, spreadsheet_id, columns, row_count, last_synced_at, last_error")
        .in("workspace_id", wsIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  const sources = (data ?? []) as SourceRow[];

  const { data: dash } = wsIds.length
    ? await supabase.from("dashboards").select("id, name, updated_at").in("workspace_id", wsIds).order("updated_at", { ascending: false })
    : { data: [] };
  const dashboards = (dash ?? []) as DashboardRow[];

  const { data: sharedRows } = await supabase.rpc("shared_dashboards");
  const shared = (sharedRows ?? []) as SharedDashboard[];

  const name = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "";

  return (
    <AppShell userName={name} title="Dashboard">
      <DashboardList
        dashboards={dashboards}
        shared={shared}
        sources={sources}
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? ""}
        appId={process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? ""}
      />
    </AppShell>
  );
}
