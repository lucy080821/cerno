"use client";

import { useState } from "react";
import { TEMPLATES, type TemplateEntry } from "@/content/templates";
import type { TemplateSource } from "@/lib/templates/source";
import { TemplateGallery } from "../dashboards/TemplateGallery";
import { TemplateMapDialog } from "../dashboards/TemplateMapDialog";

/** Thư viện mẫu dashboard theo ngành: chọn mẫu → ghép cột với nguồn dữ liệu → tạo dashboard. */
export function TemplatesView({ sources, apiKey, appId }: { sources: TemplateSource[]; apiKey: string; appId: string }) {
  const [picked, setPicked] = useState<TemplateEntry | null>(null);
  return (
    <>
      <TemplateGallery entries={TEMPLATES} onPick={setPicked} />
      {picked && <TemplateMapDialog entry={picked} sources={sources} apiKey={apiKey} appId={appId} onClose={() => setPicked(null)} />}
    </>
  );
}
