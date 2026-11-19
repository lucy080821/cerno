import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TodosView } from "@/components/profit/TodosView";
import { AppShell } from "../AppShell";

export const dynamic = "force-dynamic";

export default async function TodosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <AppShell active="todos" userName={(user.user_metadata?.full_name as string | undefined) ?? user.email ?? ""} title="Việc cần làm" desc="Gợi ý việc nên làm để lãi mỗi đơn cao hơn, sắp xếp theo mức ảnh hưởng.">
      <TodosView />
    </AppShell>
  );
}
