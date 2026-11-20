import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrdersView } from "@/components/profit/OrdersView";
import type { OrderFilter } from "@/lib/profit/order-profit";
import { AppShell } from "../AppShell";

export const dynamic = "force-dynamic";
const FILTERS: OrderFilter[] = ["all", "loss", "thin", "missing", "return"];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { filter } = await searchParams;
  const initial = (FILTERS as string[]).includes(filter ?? "") ? (filter as OrderFilter) : "all";
  return (
    <AppShell userName={(user.user_metadata?.full_name as string | undefined) ?? user.email ?? ""} title="Đơn hàng" desc="Lãi của từng đơn sau phí sàn, giá vốn và quảng cáo. Mọi kênh gộp một bảng, đơn lỗ hiện màu đỏ.">
      <OrdersView initialFilter={initial} />
    </AppShell>
  );
}
