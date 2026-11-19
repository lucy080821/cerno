import "server-only";

/**
 * Hai lần ghi nguồn "Đơn hàng đa kênh" cùng lúc (tải file, lưu bảng giá vốn) vào một workspace sẽ cùng đọc-rồi-ghi toàn bộ nguồn và ghi đè lẫn nhau, nên xếp hàng theo workspace.
 * (Khoá nằm trong bộ nhớ của tiến trình Node: đủ cho một tiến trình duy nhất như Hostinger; nhiều tiến trình cần khoá ở DB.)
 */
const queues = new Map<string, Promise<unknown>>();
export async function inWorkspaceQueue<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(workspaceId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(task);
  queues.set(workspaceId, run);
  try {
    return await run;
  } finally {
    if (queues.get(workspaceId) === run) queues.delete(workspaceId);
  }
}

