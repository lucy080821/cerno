"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getJson } from "@/lib/ai-chat/api";
import { defaultSelection, toggleSource, type ChatSummary, type SourceOption } from "@/lib/ai-chat/client";
import { readSavedSources, writeSavedSources } from "@/lib/ai-chat/selection";

/**
 * Dữ liệu nền của khung chat: lịch sử các cuộc trò chuyện, danh sách nguồn và nguồn đang chọn (nhớ ở trình duyệt).
 * Tải lỗi/quá hạn thì `loadFailed` bật để giao diện báo và cho thử lại (`loadAll`), không để vòng quay chạy mãi.
 */
export function useChatLists() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [sources, setSources] = useState<SourceOption[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  /** Tải lại lịch sử; lỗi thì giữ danh sách cũ. Trả true khi tải được. */
  const refreshChats = useCallback(async (): Promise<boolean> => {
    const r = await getJson<{ chats: ChatSummary[] }>("/api/ai/chats");
    if (r) setChats(r.chats);
    else setChats((cur) => cur ?? []);
    return r !== null;
  }, []);

  const loadAll = useCallback(async () => {
    setLoadFailed(false);
    const [chatsOk, src] = await Promise.all([refreshChats(), getJson<{ sources: SourceOption[] }>("/api/sources")]);
    if (src) {
      setSources(src.sources);
      setSelected(defaultSelection(readSavedSources(), src.sources));
    }
    if (!chatsOk || !src) setLoadFailed(true);
  }, [refreshChats]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const pick = useCallback((id: string) => {
    setSelected((cur) => {
      const next = toggleSource(cur, id);
      writeSavedSources(next);
      return next;
    });
  }, []);

  /** Về nguồn mặc định (đã lưu hoặc nguồn đơn hàng) khi bắt đầu cuộc trò chuyện mới. */
  const resetSelection = useCallback(() => setSelected(defaultSelection(readSavedSources(), sources ?? [])), [sources]);

  const byId = useMemo(() => new Map((sources ?? []).map((s) => [s.id, s])), [sources]);

  return { chats, setChats, sources, selected, setSelected, loadFailed, loadAll, refreshChats, pick, resetSelection, byId };
}
