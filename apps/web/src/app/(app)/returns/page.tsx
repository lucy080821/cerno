import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReturnsView } from "@/components/profit/ReturnsView";
import { AppShell } from "../AppShell";

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <AppShell userName={(user.user_metadata?.full_name as string | undefined) ?? user.email ?? ""} title="Hoàn và hủy" desc="Đơn hoàn và đơn hủy làm shop mất bao nhiêu.">
      <ReturnsView />
    </AppShell>
  );
}
