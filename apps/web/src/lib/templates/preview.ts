import { applyTemplate, type Dashboard, type Template } from "@dashboard/schema";
import type { Row } from "@dashboard/chart-engine";

export interface TemplatePreviewData {
  doc: Dashboard;
  /** id nguồn → dòng dữ liệu mẫu, đúng dạng `RowsAccess` kiểu "static" của trình xem. */
  rows: Record<string, Row[]>;
  sourceRows: Record<string, number>;
}

/**
 * Dựng dashboard xem trước của một mẫu bằng chính dữ liệu mẫu của nó: cột của nguồn đặt tên theo NHÃN của từng vai (giống
 * một Sheet thật sẽ có), nên tên cột, tiêu đề trục và bảng trong bản xem trước đọc được như khi người dùng tạo từ mẫu.
 * Hàm thuần, không gọi mạng; chạy ở trình duyệt và ở script chụp ảnh.
 */
export function buildTemplatePreview(t: Template): TemplatePreviewData {
  const sourceId = `preview-${t.id}`;
  const mapping = Object.fromEntries(t.slots.map((s) => [s.key, s.label]));
  const source = { id: sourceId, type: "upload" as const, name: t.name, columns: t.slots.map((s) => ({ name: s.label, type: s.type })) };
  let n = 0; // id tất định: dựng lại cùng một mẫu luôn ra cùng một dashboard
  const { doc } = applyTemplate(t, mapping, source, { newId: () => `pv-${t.id}-${n++}` });
  const rows: Row[] = t.sampleRows.map((r) => Object.fromEntries(t.slots.map((s) => [s.label, r[s.key] ?? null])));
  return { doc, rows: { [sourceId]: rows }, sourceRows: { [sourceId]: rows.length } };
}
