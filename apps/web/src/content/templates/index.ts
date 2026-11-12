import { Template, z } from "@dashboard/schema";
import { BAN_HANG } from "./ban-hang";
import { GENERATED_TEMPLATES } from "./generated";

/** Một mẫu trong thư viện kèm thông tin chỉ dùng cho giao diện (không thuộc schema của mẫu). */
export interface TemplateEntry {
  template: Template;
  /** Đường dẫn ảnh xem trước (vd `/img/templates/ban-hang.webp`). Bỏ trống = khối màu theo ngành. */
  previewImage?: string;
  /** ID Google Sheet mẫu công khai; có thì hiện nút "Sao chép Sheet mẫu" (link `/copy`). */
  sampleSheetId?: string;
}

/** Dạng một file mẫu do scripts/export-template.mjs xuất ra. */
export const TemplateFile = z.object({
  template: Template,
  previewImage: z.string().optional(),
  sampleSheetId: z.string().optional(),
});

/** Mẫu viết tay, chỉ dùng khi chưa có bản xuất từ editor cùng id. */
const HANDWRITTEN: TemplateEntry[] = [{ template: BAN_HANG }];

const exported: TemplateEntry[] = GENERATED_TEMPLATES.map((raw) => TemplateFile.parse(raw));
const exportedIds = new Set(exported.map((e) => e.template.id));

export const TEMPLATES: TemplateEntry[] = [...exported, ...HANDWRITTEN.filter((e) => !exportedIds.has(e.template.id))];

export const getTemplateEntry = (id: string): TemplateEntry | undefined =>
  TEMPLATES.find((t) => t.template.id === id);

export const templateIndustries = (list: TemplateEntry[] = TEMPLATES): string[] => [
  ...new Set(list.map((t) => t.template.industry)),
];

/** Link của Google để người dùng tạo bản sao Sheet mẫu vào Drive của họ. */
export const sampleSheetCopyUrl = (sheetId: string) =>
  `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/copy`;
