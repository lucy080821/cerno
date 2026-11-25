/** Nguồn dữ liệu người dùng đã chọn cho khung chat AI, nhớ ở trình duyệt (localStorage có thể bị chặn nên mọi thao tác đều có try/catch). */

const SAVED_KEY = "cerno.ai.sources";

export function readSavedSources(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeSavedSources(ids: string[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(ids));
  } catch {
    /* localStorage bị chặn */
  }
}
