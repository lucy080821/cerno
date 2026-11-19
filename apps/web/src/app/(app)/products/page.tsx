import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductsView } from "@/components/profit/ProductsView";
import { AppShell } from "../AppShell";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { filter } = await searchParams;
  const initial = filter === "missing" || filter === "loss" ? filter : "all";
  return (
    <AppShell active="products" userName={(user.user_metadata?.full_name as string | undefined) ?? user.email ?? ""} title="Sản phẩm và giá vốn" desc="Giá vốn là chìa khóa để mỗi đơn biết lời hay lỗ. Nhập một lần, Cerno tính lại mọi đơn.">
      <ProductsView initialFilter={initial} />
    </AppShell>
  );
}
