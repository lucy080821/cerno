import { z } from "zod";
import { Dashboard } from "./dashboard";

/**
 * Mẫu dashboard theo ngành. Trong `doc`, tên cột là KHOÁ VAI (vd `ngay`, `doanh_thu`) chứ không phải tên cột thật;
 * `applyTemplate` đổi sang cột thật của nguồn người dùng (xem apply-template.ts).
 */
export const SlotType = z.enum(["date", "number", "string"]);

export const Slot = z.object({
  /** Khoá vai, dùng trong doc mẫu: chữ thường không dấu, số, gạch dưới. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "Khoá vai chỉ gồm chữ thường không dấu, số và _"),
  label: z.string().min(1).max(80),
  type: SlotType,
  required: z.boolean().default(true),
  /** Tên cột thường gặp (có dấu hay không đều được), dùng để tự khớp cột. */
  synonyms: z.array(z.string().max(80)).default([]),
});

/** Một dòng dữ liệu mẫu, khoá theo khoá vai. */
export const SampleRow = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

export const Template = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(80),
  version: z.number().int().min(1),
  industry: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  slots: z.array(Slot).min(1).max(60),
  doc: Dashboard,
  sampleRows: z.array(SampleRow).max(200).default([]),
});

export type SlotType = z.infer<typeof SlotType>;
export type Slot = z.infer<typeof Slot>;
export type SampleRow = z.infer<typeof SampleRow>;
export type Template = z.infer<typeof Template>;
