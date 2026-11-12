import { Dashboard, type DataSource, type Widget } from "./dashboard";
import type { Template } from "./template";

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

// ---------------------------------------------------------------------------------------------
// Quét công thức. Không import được formula.ts của chart-engine (schema không phụ thuộc chart-engine), nên
// quét lại theo đúng quy tắc của bộ tách token ở đó: [Tên cột], chuỗi "..." / '...' (có \ thoát), số, định danh.
// ---------------------------------------------------------------------------------------------

export interface FormulaRef { name: string; start: number; end: number }

/** Từ không có ngoặc được phép trong công thức (hằng và toán tử chữ). */
const BARE_OK = new Set(["TRUE", "FALSE", "NULL", "AND", "OR", "NOT"]);
const isIdStart = (c: string) => /[\p{L}_]/u.test(c);
const isIdPart = (c: string) => /[\p{L}\p{N}_]/u.test(c);

/**
 * Trả các tham chiếu cột `[...]` và các tên cột viết trần (không ngoặc, không phải hàm/hằng) trong công thức.
 * Tên trần là lỗi với công thức mẫu, vì không đổi tên được một cách an toàn.
 */
export function scanFormula(src: string): { refs: FormulaRef[]; bare: string[] } {
  const refs: FormulaRef[] = [];
  const bare: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "[") {
      const j = src.indexOf("]", i + 1);
      if (j < 0) throw new TemplateError("Công thức thiếu dấu ] đóng.");
      refs.push({ name: src.slice(i + 1, j).trim(), start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      if (src[j] === ".") { j++; while (j < src.length && /[0-9]/.test(src[j])) j++; }
      if (/[eE]/.test(src[j] ?? "") && /[0-9+-]/.test(src[j + 1] ?? "")) {
        j++;
        if (/[+-]/.test(src[j])) j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdPart(src[j])) j++;
      const word = src.slice(i, j);
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] !== "(" && !BARE_OK.has(word.toUpperCase())) bare.push(word);
      i = j;
      continue;
    }
    i++;
  }
  return { refs, bare };
}

/** Thay từng `[tên]` bằng `[fn(tên)]`, giữ nguyên mọi chỗ khác. */
export function rewriteFormula(src: string, fn: (name: string) => string): string {
  const { refs } = scanFormula(src);
  let out = "";
  let last = 0;
  for (const r of refs) {
    const to = fn(r.name);
    if (to.includes("]")) throw new TemplateError(`Cột "${to}" chứa ký tự ] nên không dùng được trong công thức.`);
    out += src.slice(last, r.start) + `[${to}]`;
    last = r.end;
  }
  return out + src.slice(last);
}

// ---------------------------------------------------------------------------------------------
// Duyệt các chỗ widget tham chiếu cột
// ---------------------------------------------------------------------------------------------

/** Mọi tên cột mà widget tham chiếu (chuỗi rỗng, vd số đo count không cột, được bỏ qua). */
export function widgetColumnRefs(w: Widget): string[] {
  const c = w.config;
  let cols: string[] = [];
  if (c.kind === "chart") cols = [...c.dimensions, ...c.metrics].map((b) => b.column);
  else if (c.kind === "kpi") cols = [c.metric.column, ...(c.compare ? [c.compare.dateColumn] : [])];
  return cols.filter((x) => x !== "");
}

function mapWidgetColumns(w: Widget, f: (c: string) => string): Widget {
  const m = (c: string) => (c === "" ? c : f(c));
  const c = w.config;
  if (c.kind === "chart") {
    return {
      ...w,
      config: {
        ...c,
        dimensions: c.dimensions.map((b) => ({ ...b, column: m(b.column) })),
        metrics: c.metrics.map((b) => ({ ...b, column: m(b.column) })),
      },
    };
  }
  if (c.kind === "kpi") {
    return {
      ...w,
      config: {
        ...c,
        metric: { ...c.metric, column: m(c.metric.column) },
        compare: c.compare ? { ...c.compare, dateColumn: m(c.compare.dateColumn) } : undefined,
      },
    };
  }
  return w;
}

// ---------------------------------------------------------------------------------------------
// Kiểm tra mẫu
// ---------------------------------------------------------------------------------------------

/**
 * Kiểm tra doc mẫu theo quy ước: đúng một nguồn; mọi tham chiếu cột là khoá vai hoặc tên trường tính toán;
 * công thức chỉ dùng `[khoá_vai]`, không viết tên trần; không dùng `echartsOverride`.
 * Trả danh sách lỗi (rỗng = hợp lệ).
 */
export function validateTemplate(t: Template): string[] {
  const errors: string[] = [];
  const slotKeys = new Set<string>();
  for (const s of t.slots) {
    if (slotKeys.has(s.key)) errors.push(`Khoá vai trùng: ${s.key}`);
    slotKeys.add(s.key);
  }
  if (t.doc.sources.length !== 1) errors.push("Doc mẫu phải có đúng 1 nguồn dữ liệu.");
  const calcNames = new Set<string>();
  for (const f of t.doc.calculatedFields) {
    if (calcNames.has(f.name)) errors.push(`Tên trường tính toán trùng: ${f.name}`);
    if (slotKeys.has(f.name)) errors.push(`Trường tính toán trùng khoá vai: ${f.name}`);
    calcNames.add(f.name);
  }
  const known = (n: string) => slotKeys.has(n) || calcNames.has(n);
  for (const f of t.doc.calculatedFields) {
    try {
      const { refs, bare } = scanFormula(f.expression);
      for (const b of bare) errors.push(`Công thức "${f.name}" dùng tên trần "${b}", phải viết [${b}].`);
      for (const r of refs) if (!known(r.name)) errors.push(`Công thức "${f.name}" tham chiếu cột lạ [${r.name}].`);
    } catch (e) {
      errors.push(`Công thức "${f.name}": ${(e as Error).message}`);
    }
  }
  for (const w of t.doc.widgets) {
    for (const c of widgetColumnRefs(w)) if (!known(c)) errors.push(`Widget ${w.id} tham chiếu cột lạ "${c}".`);
    if (w.config.kind === "chart" && w.config.echartsOverride) errors.push(`Widget ${w.id} dùng echartsOverride (không được trong mẫu).`);
  }
  for (const f of t.doc.filters) if (!known(f.column)) errors.push(`Bộ lọc ${f.id} tham chiếu cột lạ "${f.column}".`);
  for (const [i, r] of t.sampleRows.entries()) {
    for (const k of Object.keys(r)) if (!slotKeys.has(k)) errors.push(`Dòng mẫu ${i + 1} có khoá lạ "${k}".`);
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// applyTemplate
// ---------------------------------------------------------------------------------------------

export interface ApplyTemplateOptions {
  /** Sinh id mới (mặc định UUID ngẫu nhiên). Cho phép test dùng id tất định. */
  newId?: () => string;
}

export interface ApplyTemplateResult {
  doc: Dashboard;
  /** Phần tử của mẫu đã bị bỏ vì dùng vai tuỳ chọn còn trống (id/tên theo mẫu). */
  dropped: { widgets: string[]; filters: string[]; calculatedFields: string[] };
}

function defaultNewId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Biến mẫu thành dashboard thật.
 * @param mapping khoá vai → tên cột thật của `source` (vai bỏ trống/null = không có)
 * @param source nguồn dữ liệu thật; trở thành nguồn duy nhất của dashboard
 * Ném `TemplateError` nếu mẫu sai quy ước, thiếu vai bắt buộc, hoặc cột được chọn không có trong nguồn.
 */
export function applyTemplate(
  template: Template,
  mapping: Record<string, string | null | undefined>,
  source: DataSource,
  options: ApplyTemplateOptions = {},
): ApplyTemplateResult {
  const newId = options.newId ?? defaultNewId;
  const errs = validateTemplate(template);
  if (errs.length) throw new TemplateError(`Mẫu "${template.id}" không hợp lệ: ${errs.join("; ")}`);

  const realCols = new Set(source.columns.map((c) => c.name));
  const slotMap = new Map<string, string>();
  for (const s of template.slots) {
    const col = mapping[s.key];
    if (col == null || col === "") {
      if (s.required) throw new TemplateError(`Thiếu cột cho vai bắt buộc "${s.label}".`);
      continue;
    }
    if (!realCols.has(col)) throw new TemplateError(`Cột "${col}" (vai "${s.label}") không có trong nguồn dữ liệu.`);
    slotMap.set(s.key, col);
  }

  const doc = template.doc;
  const calcByName = new Map(doc.calculatedFields.map((f) => [f.name, f]));

  // Trường tính toán nào phải bỏ: dùng vai trống, hoặc dùng trường khác đã bị bỏ (lặp đến khi ổn định).
  const droppedCalc = new Set<string>();
  const isMissing = (name: string) => (calcByName.has(name) ? droppedCalc.has(name) : !slotMap.has(name));
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of doc.calculatedFields) {
      if (droppedCalc.has(f.name)) continue;
      if (scanFormula(f.expression).refs.some((r) => isMissing(r.name))) {
        droppedCalc.add(f.name);
        changed = true;
      }
    }
  }

  // Tên mới cho trường tính toán còn giữ, tránh trùng cột thật.
  const used = new Set([...realCols].map((n) => n.toLowerCase()));
  const calcNewName = new Map<string, string>();
  for (const f of doc.calculatedFields) {
    if (droppedCalc.has(f.name)) continue;
    let name = f.name;
    let n = 1;
    while (used.has(name.toLowerCase())) {
      n++;
      name = n === 2 ? `${f.name} (tính toán)` : `${f.name} (tính toán ${n - 1})`;
    }
    used.add(name.toLowerCase());
    calcNewName.set(f.name, name);
  }

  /** Đổi một tham chiếu cột (khoá vai hoặc tên trường tính toán); chỉ gọi khi đã chắc không thiếu. */
  const resolve = (name: string): string => calcNewName.get(name) ?? slotMap.get(name) ?? name;

  const calculatedFields = doc.calculatedFields
    .filter((f) => !droppedCalc.has(f.name))
    .map((f) => ({
      id: newId(),
      sourceId: source.id,
      name: calcNewName.get(f.name)!,
      expression: rewriteFormula(f.expression, resolve),
    }));

  const widgetIds = new Map<string, string>();
  const droppedWidgets: string[] = [];
  const widgets: Widget[] = [];
  const groupIds = new Map<string, string>();
  const pageIds = new Map(doc.pages.map((p) => [p.id, newId()]));
  for (const w of doc.widgets) {
    if (widgetColumnRefs(w).some(isMissing)) {
      droppedWidgets.push(w.id);
      continue;
    }
    const id = newId();
    widgetIds.set(w.id, id);
    const mapped = mapWidgetColumns(w, resolve);
    let config = mapped.config;
    if (config.kind === "chart" || config.kind === "kpi") config = { ...config, sourceId: source.id };
    let groupId = mapped.groupId;
    if (groupId) {
      if (!groupIds.has(groupId)) groupIds.set(groupId, newId());
      groupId = groupIds.get(groupId);
    }
    widgets.push({
      ...mapped,
      id,
      config,
      groupId,
      pageId: mapped.pageId ? pageIds.get(mapped.pageId) : undefined,
    });
  }

  const droppedFilters: string[] = [];
  const filters = [];
  for (const f of doc.filters) {
    const targets = f.targets?.filter((t) => widgetIds.has(t)).map((t) => widgetIds.get(t)!);
    // Bộ lọc nhắm tới widget cụ thể mà mọi widget đó đã bị bỏ thì không còn ý nghĩa.
    if (isMissing(f.column) || (f.targets?.length && !targets?.length)) {
      droppedFilters.push(f.id);
      continue;
    }
    filters.push({ ...f, id: newId(), sourceId: source.id, column: resolve(f.column), targets: f.targets ? targets : undefined });
  }

  const result = Dashboard.parse({
    ...doc,
    id: newId(),
    sources: [source],
    calculatedFields,
    pages: doc.pages.map((p) => ({ ...p, id: pageIds.get(p.id)! })),
    filters,
    widgets,
    meta: { templateId: template.id, templateVersion: template.version },
  });

  return {
    doc: result,
    dropped: { widgets: droppedWidgets, filters: droppedFilters, calculatedFields: [...droppedCalc] },
  };
}
