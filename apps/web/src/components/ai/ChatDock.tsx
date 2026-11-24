"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { periodRange } from "@/lib/profit/period";
import { usePeriod } from "@/lib/profit/period-store";
import { pageContext } from "@/lib/shell/page-context";
import { useShell } from "@/lib/shell/store";
import { AiChat } from "./AiChat";

/**
 * Khung chat AI cố định bên phải mọi trang. Chỉ dựng (và tải lịch sử, nguồn dữ liệu) lần đầu khi người dùng mở, rồi giữ nguyên
 * khi chuyển trang nên cuộc trò chuyện đang viết không bị mất. Gửi kèm mô tả trang đang xem để AI hiểu ngữ cảnh.
 */
export function ChatDock() {
  const open = useShell((s) => s.chat);
  const ask = useShell((s) => s.ask);
  const setChat = useShell((s) => s.setChat);
  const pathname = usePathname();
  const [period] = usePeriod();
  const [mounted, setMounted] = useState(false);
  const fullChat = pathname === "/ai";

  useEffect(() => {
    if ((open || ask) && !mounted) setMounted(true);
  }, [open, ask, mounted]);

  const context = useMemo(() => pageContext(pathname, periodRange(period)), [pathname, period]);

  if (!mounted) return null;
  return <AiChat variant="dock" context={context} listenAsk={!fullChat} onClose={() => setChat(false)} />;
}
