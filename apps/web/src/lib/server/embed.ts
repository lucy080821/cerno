import "server-only";
import { Dashboard } from "@dashboard/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { TOKEN_RE } from "@/lib/embed/token";

/** embed = mã nhúng iframe (dashboard_shares), link = link xem công khai trên Cerno (dashboard_links). */
export type ShareKind = "embed" | "link";

export interface SharedDashboard {
  id: string;
  workspaceId: string;
  kind: ShareKind;
  doc: Dashboard | null;
}

/**
 * Tìm dashboard theo mã chia sẻ công khai, chỉ trong các loại `kinds` cho phép. Dùng service role (bỏ qua RLS)
 * nên CHỈ trả đúng dashboard khớp mã, và mọi nơi gọi hàm này phải coi mã là bí mật duy nhất bảo vệ dữ liệu.
 */
export async function loadSharedDashboard(token: string, kinds: ShareKind[] = ["embed", "link"]): Promise<SharedDashboard | null> {
  if (!TOKEN_RE.test(token)) return null;
  const admin = createAdminClient();

  let dashboardId: string | null = null;
  let kind: ShareKind = "embed";
  if (kinds.includes("embed")) {
    const { data } = await admin.from("dashboard_shares").select("dashboard_id").eq("token", token).maybeSingle();
    if (data) dashboardId = data.dashboard_id;
  }
  if (!dashboardId && kinds.includes("link")) {
    const { data } = await admin.from("dashboard_links").select("dashboard_id").eq("token", token).maybeSingle();
    if (data) {
      dashboardId = data.dashboard_id;
      kind = "link";
    }
  }
  if (!dashboardId) return null;

  const { data: dash } = await admin.from("dashboards").select("id, workspace_id, doc").eq("id", dashboardId).maybeSingle();
  if (!dash) return null;
  const parsed = Dashboard.safeParse(dash.doc);
  return { id: dash.id, workspaceId: dash.workspace_id, kind, doc: parsed.success ? parsed.data : null };
}

/** Bỏ thông tin không cần cho người xem (id file Google Sheets gốc). */
export function sanitizeDocForEmbed(doc: Dashboard): Dashboard {
  return {
    ...doc,
    sources: doc.sources.map((s) => (s.type === "google_sheets" ? { ...s, spreadsheetId: "" } : s)),
  };
}

/**
 * Dashboard được chia sẻ công khai có thật sự dùng nguồn `sourceId` không? (Mã chia sẻ chỉ cho đọc những nguồn mà
 * dashboard đó dùng, không phải mọi nguồn trong workspace.) Trả về dashboard nếu hợp lệ, ngược lại null.
 */
export async function authorizeSharedSource(token: string, sourceId: string): Promise<SharedDashboard | null> {
  const shared = await loadSharedDashboard(token);
  if (!shared?.doc) return null;
  if (!shared.doc.sources.some((s) => s.id === sourceId && s.type === "google_sheets")) return null;
  return shared;
}

/**
 * Số dòng của từng nguồn Google Sheets mà dashboard dùng (chỉ nguồn thuộc đúng workspace của dashboard).
 * Trình xem dựa vào đây để biết nguồn nào lớn (không tải về, hỏi server gộp số liệu) và nguồn nào nhỏ (tải về).
 */
export async function sourceRowCounts(doc: Dashboard, workspaceId: string): Promise<Record<string, number>> {
  const ids = doc.sources.filter((s) => s.type === "google_sheets").map((s) => s.id);
  if (ids.length === 0) return {};
  const { data } = await createAdminClient().from("data_sources").select("id, row_count").eq("workspace_id", workspaceId).in("id", ids);
  return Object.fromEntries((data ?? []).map((r) => [r.id as string, (r.row_count as number) ?? 0]));
}
