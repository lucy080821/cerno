import { AiChat } from "@/components/ai/AiChat";
import { AppShell } from "../AppShell";
import { requirePageUser } from "../page-user";

export const dynamic = "force-dynamic";

/** Hỏi AI: trò chuyện với AI về số liệu, chọn nguồn dữ liệu ngay ở khung nhập, có lịch sử các cuộc trò chuyện. */
export default async function AiPage() {
  const { name } = await requirePageUser();
  return (
    <AppShell userName={name} title="Hỏi AI" bare>
      <AiChat />
    </AppShell>
  );
}
