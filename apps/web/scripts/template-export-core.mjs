// Phần thuần (không I/O) của script xuất mẫu: biến một dashboard thật (tên cột thật) thành file mẫu (khoá vai).
// Là CHIỀU NGƯỢC của applyTemplate (packages/schema/src/apply-template.ts) nên có test vòng tròn
// (src/content/templates/export-template.test.ts). Viết bằng JS thuần vì script .mjs không import được TypeScript.

/** Bỏ dấu tiếng Việt, đ→d, chữ thường, ký tự lạ thành dấu cách (cùng quy tắc với match-columns.ts). */
export function normalizeText(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const BARE_OK = new Set(["TRUE", "FALSE", "NULL", "AND", "OR", "NOT"]);
const isIdStart = (c) => /[\p{L}_]/u.test(c);
const isIdPart = (c) => /[\p{L}\p{N}_]/u.test(c);

/** Quét công thức theo quy tắc của formula.ts: tham chiếu `[...]` và tên trần (không ngoặc, không phải hàm/hằng). */
export function scanFormula(src) {
  const refs = [];
  const bare = [];
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
      if (j < 0) throw new Error("Công thức thiếu dấu ] đóng.");
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

function rewriteFormula(src, fn) {
  const { refs } = scanFormula(src);
  let out = "";
  let last = 0;
  for (const r of refs) {
    out += src.slice(last, r.start) + `[${fn(r.name)}]`;
    last = r.end;
  }
  return out + src.slice(last);
}

/** Nguồn mà dashboard dùng (đúng một). Ném lỗi nếu dùng nhiều nguồn. */
export function pickSource(doc) {
  const used = new Set();
  for (const w of doc.widgets ?? []) if (w.config?.sourceId) used.add(w.config.sourceId);
  for (const f of doc.filters ?? []) used.add(f.sourceId);
  if (used.size === 0 && doc.sources?.length === 1) used.add(doc.sources[0].id);
  if (used.size !== 1) {
    throw new Error(`Mẫu chỉ được dùng đúng 1 nguồn dữ liệu, dashboard đang dùng ${used.size} nguồn.`);
  }
  const src = doc.sources.find((s) => s.id === [...used][0]);
  if (!src) throw new Error("Dashboard tham chiếu một nguồn không có trong doc.sources.");
  return src;
}

/** Chọn tối đa `max` dòng cách đều (giữ thứ tự), chỉ giữ các cột thuộc vai, ghi theo khoá vai. */
export function sampleRowsFor(rows, colToSlot, max) {
  if (max <= 0 || !rows.length) return [];
  const n = rows.length;
  const picked = n <= max ? rows : Array.from({ length: max }, (_, i) => rows[Math.floor((i * n) / max)]);
  return picked.map((r) => {
    const out = {};
    for (const [col, key] of colToSlot) {
      const v = r?.[col];
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
      else if (v === null || v === undefined || v === "") out[key] = null;
      else out[key] = String(v).slice(0, 200);
    }
    return out;
  });
}

/**
 * @param {{ meta: object, doc: object, rows: object[], maxRows?: number }} p
 *   meta: khai báo mẫu (id, industry, name, description, slots[], columns?: {khoá vai: tên cột thật})
 * @returns {{ template: object, warnings: string[] }}  ném Error (một thông báo tổng hợp) nếu dashboard không đổi được thành mẫu
 */
export function buildTemplate({ meta, doc, rows, maxRows = 40 }) {
  const errors = [];
  const warnings = [];
  const slots = meta.slots ?? [];
  const slotByKey = new Map(slots.map((s) => [s.key, s]));
  const src = pickSource(doc);

  // 1) Cột thật → khoá vai: ưu tiên `columns` khai báo tay, còn lại tự khớp CHÍNH XÁC theo nhãn/khoá/từ đồng nghĩa.
  const realCols = new Map(src.columns.map((c) => [c.name, c]));
  const colToSlot = new Map();
  const slotToCol = new Map();
  for (const [key, col] of Object.entries(meta.columns ?? {})) {
    if (!col) continue;
    if (!slotByKey.has(key)) errors.push(`"columns" có khoá vai lạ: ${key}`);
    else if (!realCols.has(col)) errors.push(`Cột "${col}" (vai ${key}) không có trong nguồn của dashboard.`);
    else {
      colToSlot.set(col, key);
      slotToCol.set(key, col);
    }
  }
  for (const s of slots) {
    if (slotToCol.has(s.key)) continue;
    const names = new Set([s.key.replace(/_/g, " "), s.label, ...(s.synonyms ?? [])].map(normalizeText));
    const hit = src.columns.find((c) => !colToSlot.has(c.name) && names.has(normalizeText(c.name)));
    if (hit) {
      colToSlot.set(hit.name, s.key);
      slotToCol.set(s.key, hit.name);
    }
  }

  const calcFields = (doc.calculatedFields ?? []).filter((f) => f.sourceId === src.id);
  const calcNames = new Set(calcFields.map((f) => f.name));
  const unmapped = new Set();
  const refName = (name) => {
    if (name === "") return name;
    if (calcNames.has(name)) return name;
    const key = colToSlot.get(name);
    if (key) return key;
    unmapped.add(name);
    return name;
  };

  // 2) Đổi tham chiếu trong widget, filter, trường tính toán.
  const out = structuredClone(doc);
  delete out.meta;
  out.id = `tpl-${meta.id}`;
  out.name = meta.name;
  for (const w of out.widgets ?? []) {
    const c = w.config;
    if (c.kind === "chart") {
      if (c.echartsOverride) errors.push(`Widget ${w.id} dùng echartsOverride (mẫu không được dùng).`);
      for (const b of [...c.dimensions, ...c.metrics]) b.column = refName(b.column);
      c.sourceId = "src";
    } else if (c.kind === "kpi") {
      c.metric.column = refName(c.metric.column);
      if (c.compare) c.compare.dateColumn = refName(c.compare.dateColumn);
      c.sourceId = "src";
    }
  }
  out.filters = (out.filters ?? []).map((f) => ({ ...f, sourceId: "src", column: refName(f.column) }));
  out.calculatedFields = calcFields.map((f) => {
    let expression = f.expression;
    try {
      const { bare } = scanFormula(expression);
      if (bare.length) errors.push(`Trường "${f.name}" dùng tên cột trần (${bare.join(", ")}): hãy viết trong [ ].`);
      expression = rewriteFormula(expression, refName);
    } catch (e) {
      errors.push(`Trường "${f.name}": ${e.message}`);
    }
    return { ...f, sourceId: "src", expression };
  });
  if (unmapped.size) {
    errors.push(
      `Các cột sau được dashboard dùng nhưng chưa có vai trong mẫu: ${[...unmapped].map((n) => `"${n}"`).join(", ")}. ` +
        `Thêm vào "columns" của file khai báo (vd "ten_vai": "${[...unmapped][0]}") hoặc thêm vai mới vào "slots".`,
    );
  }
  if (errors.length) throw new Error(errors.join("\n"));

  // 3) Cảnh báo (không chặn).
  for (const [key, col] of slotToCol) {
    const s = slotByKey.get(key);
    const real = realCols.get(col);
    if (real && real.type !== s.type) warnings.push(`Vai "${key}" kiểu ${s.type} nhưng cột "${col}" kiểu ${real.type}.`);
  }
  const usedKeys = new Set();
  const collect = (n) => { if (slotByKey.has(n)) usedKeys.add(n); };
  for (const w of out.widgets) {
    const c = w.config;
    if (c.kind === "chart") [...c.dimensions, ...c.metrics].forEach((b) => collect(b.column));
    if (c.kind === "kpi") { collect(c.metric.column); if (c.compare) collect(c.compare.dateColumn); }
  }
  out.filters.forEach((f) => collect(f.column));
  out.calculatedFields.forEach((f) => scanFormula(f.expression).refs.forEach((r) => collect(r.name)));
  for (const s of slots) if (!usedKeys.has(s.key)) warnings.push(`Vai "${s.key}" không được widget/bộ lọc/công thức nào dùng.`);
  for (const s of slots) if (s.required && !slotToCol.has(s.key)) warnings.push(`Vai bắt buộc "${s.key}" chưa nối với cột nào (không có dòng mẫu cho vai này).`);

  // 4) Nguồn mẫu + dòng mẫu.
  out.sources = [{ id: "src", type: "sample", name: `Dữ liệu ${meta.name}`, columns: slots.map((s) => ({ name: s.key, type: s.type })) }];
  const sampleRows = sampleRowsFor(rows, colToSlot, maxRows);

  return {
    template: {
      id: meta.id,
      version: meta.version ?? 1,
      industry: meta.industry,
      name: meta.name,
      description: meta.description,
      slots: slots.map((s) => ({ key: s.key, label: s.label, type: s.type, required: s.required !== false, synonyms: s.synonyms ?? [] })),
      doc: out,
      sampleRows,
    },
    warnings,
  };
}
