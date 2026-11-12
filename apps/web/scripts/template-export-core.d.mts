export function normalizeText(s: string): string;
export function scanFormula(src: string): { refs: { name: string; start: number; end: number }[]; bare: string[] };
export function pickSource(doc: any): any;
export function sampleRowsFor(rows: any[], colToSlot: Map<string, string>, max: number): Record<string, string | number | null>[];
export function buildTemplate(p: { meta: any; doc: any; rows: any[]; maxRows?: number }): { template: any; warnings: string[] };
