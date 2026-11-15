"use client";

import { useMemo } from "react";
import type { Template } from "@dashboard/schema";
import { ReadOnlyViewer } from "@/components/editor/ReadOnlyViewer";
import { buildTemplatePreview } from "@/lib/templates/preview";

/** Dashboard của một mẫu chạy thật (lọc, bấm biểu đồ để lọc chéo) trên dữ liệu mẫu. Không gọi máy chủ nào. */
export default function TemplateViewer({ template }: { template: Template }) {
  const p = useMemo(() => buildTemplatePreview(template), [template]);
  return (
    <ReadOnlyViewer
      key={template.id}
      doc={p.doc}
      access={{ kind: "static", rows: p.rows }}
      sourceRows={p.sourceRows}
      brand={false}
      showLang={false}
      manageTitle={false}
      pageScroll
      contained
    />
  );
}
