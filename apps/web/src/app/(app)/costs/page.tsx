import { CostsView } from "@/components/profit/CostsView";
import { AppShell } from "../AppShell";
import { requirePageUser } from "../page-user";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { name } = await requirePageUser();
  return (
    <AppShell userName={name} title="Chi phí" desc="Tiền đang đi vào đâu: giá vốn, phí sàn, quảng cáo, so với doanh thu thực.">
      <CostsView />
    </AppShell>
  );
}
