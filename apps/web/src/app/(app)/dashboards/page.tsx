import { LangSwitch } from "@/components/i18n/LangSwitch";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Brand } from "@/components/Brand";
import { ConnectSheet } from "./ConnectSheet";
import { SignOutButton } from "./SignOutButton";
import { SourceItem, type SourceRow } from "./SourceItem";
import { DashboardList } from "./DashboardList";
import { SectionHead, sectionClass } from "./SectionHead";
import type { DashboardRow } from "@/lib/dashboards/api";
import styles from "./dashboards.module.css";

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
  const shared = (sharedRows ?? []) as Array<{ id: string; name: string; updated_at: string; role: "viewer" | "editor" }>;

  const name = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "";

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand}><Brand size={26} tone="strong" /></Link>
        <div className={styles.user}>
          <LangSwitch />
          <span>{name}</span>
          <Link href="/account" className={styles.accountLink}>Tài khoản</Link>
          <SignOutButton />
        </div>
      </header>

      <DashboardList dashboards={dashboards} />

      {shared.length > 0 && (
        <section className={sectionClass("shared")}>
          <SectionHead kind="shared" title="Được chia sẻ với bạn" count={shared.length}
            desc="Dashboard của người khác mời bạn xem hoặc chỉnh sửa." />
          <ul className={styles.list}>
            {shared.map((d) => (
              <li key={d.id} className={styles.item}>
                <div className={styles.itemTop}>
                  <div>
                    <Link href={d.role === "editor" ? `/editor/${d.id}` : `/d/${d.id}`} className={styles.dashName}>{d.name}</Link>
                    <div className={styles.muted}>
                      {d.role === "editor" ? "Bạn được sửa" : "Chỉ xem"} · sửa lần cuối: {new Date(d.updated_at).toLocaleString("vi-VN")}
                    </div>
                  </div>
                  <div className={styles.row}>
                    <Link href={d.role === "editor" ? `/editor/${d.id}` : `/d/${d.id}`} className={styles.ghost}>Mở</Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={sectionClass("source")}>
        <SectionHead
          kind="source"
          title="Nguồn dữ liệu"
          count={sources.length}
          desc="Nơi lấy số liệu cho biểu đồ: chọn file Google Sheets (dòng đầu của tab là tên cột). Dữ liệu được sao về hệ thống, biểu đồ không gọi Google mỗi lần xem."
          actions={
            <ConnectSheet
              apiKey={process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? ""}
              appId={process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? ""}
            />
          }
        />

        {sources.length === 0 ? (
          <p className={styles.empty}>Chưa có nguồn nào. Bấm "Chọn Google Sheet" để bắt đầu.</p>
        ) : (
          <ul className={styles.list}>
            {sources.map((s) => (
              <SourceItem key={s.id} source={s} />
            ))}
          </ul>
        )}
      </section>

      <footer className={styles.legalFoot}>
        <Link href="/privacy">Quyền riêng tư</Link> · <Link href="/terms">Điều khoản</Link>
      </footer>
    </main>
  );
}
