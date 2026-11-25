/** Gọi API của trang Hỏi AI từ trình duyệt: có hạn chờ để máy chủ treo thì báo lỗi cho người dùng thử lại thay vì quay mãi. */

const TIMEOUT_MS = 20_000;

/** GET JSON; lỗi mạng, quá hạn hoặc HTTP không ổn đều trả null. */
export async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** PATCH/DELETE; true khi máy chủ báo thành công. */
export async function sendJson(method: "PATCH" | "DELETE", url: string, body?: unknown): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return r.ok;
  } catch {
    return false;
  }
}
