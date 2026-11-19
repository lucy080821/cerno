import { OverviewView } from "@/components/profit/OverviewView";
import { AppShell } from "../AppShell";
import { requirePageUser } from "../page-user";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { name } = await requirePageUser();
  return (
    <AppShell active="overview" userName={name} title="Tổng quan" desc="Lãi thật, đơn lỗ và việc nên làm trước, tính từ dữ liệu đơn hàng của bạn.">
      <OverviewView />
    </AppShell>
  );
}
