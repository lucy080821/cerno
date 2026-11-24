"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ChatDock } from "@/components/ai/ChatDock";
import { GlobalBar } from "@/components/shell/GlobalBar";
import { useShell } from "@/lib/shell/store";
import { Sidebar } from "./Sidebar";
import styles from "./shell.module.css";

/**
 * Khung của mọi trang sau đăng nhập: thanh trên cố định, thanh bên (nút 3 gạch ẩn/hiện), vùng nội dung và khung chat AI bên phải.
 * Trạng thái ẩn/hiện nằm ở `useShell` và được gắn thành thuộc tính `data-*` để CSS quyết định; nhờ vậy trang không bị dựng lại.
 * Ở trang Hỏi AI (đã là chat toàn màn hình) khung bên phải được ẩn nhưng vẫn giữ nguyên, nên cuộc trò chuyện đang viết không bị mất.
 */
export function ShellFrame({ children }: { children: ReactNode }) {
  const side = useShell((s) => s.side);
  const chat = useShell((s) => s.chat);
  const pathname = usePathname();
  const fullChat = pathname === "/ai";
  return (
    <div className={styles.frame} data-side={side} data-chat={chat && !fullChat ? "1" : "0"}>
      <GlobalBar hideChat={fullChat} />
      <div className={styles.row}>
        <Sidebar />
        <div className={styles.backdrop} onClick={() => useShell.getState().closeSide()} aria-hidden />
        <div className={styles.main}>{children}</div>
        <aside className={styles.dock} aria-label="Hỏi AI"><ChatDock /></aside>
      </div>
    </div>
  );
}
