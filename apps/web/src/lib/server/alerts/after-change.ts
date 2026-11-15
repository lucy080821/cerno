import "server-only";

/**
 * Chạy các luật cảnh báo của một nguồn sau khi dữ liệu của nó vừa đổi (đồng bộ Google Sheets hoặc tải file lên).
 * Lỗi cảnh báo KHÔNG được làm hỏng việc cập nhật dữ liệu nên bắt hết ở đây.
 */
export async function evaluateAlertsAfterChange(sourceId: string): Promise<void> {
  try {
    const [{ evaluateAlertsForSource }, { liveAlertDeps }] = await Promise.all([import("./evaluate"), import("./live")]);
    await evaluateAlertsForSource(sourceId, liveAlertDeps());
  } catch (e) {
    console.error("[sync] alert evaluation failed:", e instanceof Error ? e.message : e);
  }
}
