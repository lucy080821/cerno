"use client";

import { useMemo } from "react";
import { BRAND } from "@dashboard/schema";
import type { AggregatedTable } from "@dashboard/chart-engine";
import { StaticChart } from "@/components/editor/WidgetContent";
import type { ChartVisual } from "@/lib/ai-chat/visual";

const PALETTE = [BRAND.violet, BRAND.teal, "#f5a524", "#f0568a", "#34b6e6", "#a06cf5"];

/** Vẽ một biểu đồ của tin trả lời bằng đúng bộ vẽ của dashboard (ECharts). Tách file riêng để chỉ tải khi có biểu đồ. */
export default function ChartCanvas({ visual }: { visual: ChartVisual }) {
  const config = useMemo(
    () => ({
      kind: "chart" as const,
      chartType: visual.chartType,
      sourceId: "ai",
      dimensions: visual.dimLabels.map((column) => ({ column })),
      metrics: visual.metricLabels.map((column) => ({ column, label: column })),
    }),
    [visual],
  );
  const table = useMemo<AggregatedTable>(
    () => ({ dimLabels: visual.dimLabels, metricLabels: visual.metricLabels, rows: visual.rows, ...(visual.metricKinds ? { metricKinds: visual.metricKinds } : {}) }),
    [visual],
  );
  return <StaticChart config={config} table={table} palette={PALETTE} />;
}
