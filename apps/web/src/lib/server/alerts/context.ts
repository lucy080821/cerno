import "server-only";
import { Dashboard, type CalculatedField } from "@dashboard/schema";
import { calcDefsFor, type CalcFieldDef } from "@dashboard/chart-engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadDashboard } from "@/lib/server/reports/live";
import type { CalcInfo, SourceInfo } from "./validate";

/** Cấu trúc thật của một dashboard cho việc tạo/kiểm luật cảnh báo: các nguồn Sheets (cột lấy từ DB, luôn mới nhất) và trường tính toán. */
export interface AlertContext {
  dashboardId: string;
  dashboardName: string;
  ownerId: string;
  doc: Dashboard;
  sources: (SourceInfo & { name: string })[];
  calc: CalcInfo[];
  calcFields: CalculatedField[];
  calcDefs(sourceId: string): CalcFieldDef[];
}

/**
 * Đọc dashboard bằng service role (CHỈ gọi sau khi đã kiểm người dùng có `dashboard_role` khác null). Ném lỗi nếu dashboard dùng
 * nguồn không thuộc workspace của nó. null nếu dashboard không tồn tại hoặc dữ liệu hỏng.
 */
export async function loadAlertContext(dashboardId: string): Promise<AlertContext | null> {
  const loaded = await loadDashboard(dashboardId);
  if (!loaded) return null;
  const parsed = Dashboard.safeParse(loaded.doc);
  if (!parsed.success) return null;
  const doc = parsed.data;

  const ids = doc.sources.filter((s) => s.type === "google_sheets").map((s) => s.id);
  const sources: AlertContext["sources"] = [];
  if (ids.length) {
    const { data } = await createAdminClient().from("data_sources").select("id, name, sheet_name, columns").in("id", ids);
    for (const r of data ?? []) {
      sources.push({
        id: r.id,
        name: (r.name as string | null) ?? (r.sheet_name as string),
        columns: ((r.columns ?? []) as { name: string; type: string }[]).map((c) => ({ name: c.name, type: c.type })),
      });
    }
  }
  return {
    dashboardId,
    dashboardName: loaded.name,
    ownerId: loaded.ownerId,
    doc,
    sources,
    calc: doc.calculatedFields.map((c) => ({ name: c.name, sourceId: c.sourceId })),
    calcFields: doc.calculatedFields,
    calcDefs: (sourceId) => calcDefsFor(doc.calculatedFields, sourceId),
  };
}
