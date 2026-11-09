import { Dashboard } from "@dashboard/schema";

const STORAGE_KEY = "dashboard-studio:draft:v1";

export function loadDraft(): Dashboard | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = Dashboard.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveDraft(doc: Dashboard): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    /* hết dung lượng hoặc bị chặn: bỏ qua, người dùng vẫn có thể xuất JSON */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* bỏ qua */
  }
}

export function parseDashboard(text: string): { ok: true; doc: Dashboard } | { ok: false; error: string } {
  try {
    const result = Dashboard.safeParse(JSON.parse(text));
    if (!result.success) {
      const first = result.error.issues[0];
      return { ok: false, error: `${first.path.join(".") || "file"}: ${first.message}` };
    }
    return { ok: true, doc: result.data };
  } catch {
    return { ok: false, error: "File không phải JSON hợp lệ" };
  }
}

export function downloadJson(doc: Dashboard): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.name.replace(/[^\w\-]+/g, "_") || "dashboard"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
