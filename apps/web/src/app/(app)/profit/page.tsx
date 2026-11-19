import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfitView } from "@/components/profit/ProfitView";
import { AppShell } from "../AppShell";

export const dynamic = "force-dynamic";

export default async function ProfitPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <AppShell active="profit" userName={(user.user_metadata?.full_name as string | undefined) ?? user.email ?? ""} title="Lãi lỗ" desc="Tiền đi đâu, đơn nào lãi, đơn nào lỗ và vì sao.">
      <ProfitView />
    </AppShell>
  );
}
