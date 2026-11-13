import { Dashboard, type ReportFrequency, type ReportType } from "@dashboard/schema";
import { buildReportEmail } from "@/lib/server/mail/report-email";
import type { BuiltEmail } from "@/lib/server/mail/invite-email";
import type { InlineImage } from "@/lib/server/mail";
import { buildReportFacts, type Executor, type ReportFacts } from "./facts";
import { reportPeriods, type ReportPeriods } from "./period";
import { renderReportImages, type RenderedImage } from "./render-chart";
import { createReportCache, writeReport, type ChatFn, type WriteResult } from "./write-report";

/**
 * Ráp một báo cáo hoàn chỉnh cho MỘT người nhận: số liệu (facts) → bài AI (đã kiểm số) → ảnh → email.
 * Dùng chung cho cron (gửi thật), "Xem trước" và "Gửi thử". Mọi phụ thuộc (DB, AI, truy vấn) được truyền vào nên kiểm thử được.
 * Việc tốn kém (số liệu, bài AI, ảnh) được nhớ trong `ComposeCaches` nên nhiều người nhận cùng yêu cầu chỉ tính một lần.
 */

export interface LoadedDashboard {
  id: string;
  name: string;
  doc: unknown;
  /** Chủ workspace: AI viết báo cáo tính vào hạn mức của người này. */
  ownerId: string;
  /** Lần đồng bộ dữ liệu gần nhất của các nguồn dashboard dùng (ISO), null nếu chưa biết. */
  updatedAt: string | null;
}

export interface ComposeDeps {
  loadDashboard(id: string): Promise<LoadedDashboard | null>;
  exec: Executor;
  chat(ownerId: string): ChatFn;
  /** Mã link xem công khai đang bật của dashboard, hoặc null. */
  viewToken(dashboardId: string): Promise<string | null>;
  /** https://cerno.cloud (không có dấu / cuối). */
  origin: string;
  /** Có cho AI viết báo cáo không (hạn mức gói). Mặc định có. */
  aiAllowed?(ownerId: string, dashboardId: string): Promise<boolean>;
}

/** Cấu hình của MỘT người nhận (một dòng report_subscriptions, hoặc bản nháp khi xem trước). */
export interface ReportConfig {
  frequency: ReportFrequency;
  recipient_name: string;
  prompt: string;
  widget_ids: string[];
  include_images: boolean;
  link_mode: "view_link" | "login";
  /** compare (mặc định) hoặc overview. Thiếu = compare (đăng ký tạo trước migration 0016). */
  report_type?: ReportType;
}

export interface ComposeCaches {
  facts: Map<string, Promise<{ facts: ReportFacts; periods: ReportPeriods }>>;
  images: Map<string, Promise<{ images: RenderedImage[]; notes: string[] }>>;
  ai: ReturnType<typeof createReportCache>;
  docs: Map<string, Promise<LoadedDashboard | null>>;
}

export const createComposeCaches = (): ComposeCaches => ({ facts: new Map(), images: new Map(), ai: createReportCache(), docs: new Map() });

export interface ComposeMeta {
  ai: { used: boolean; reason?: string; detail?: string; attempts?: number; provider?: string; unverified?: string[] };
  images: number;
  imageNotes: string[];
  linkMode: "view_link" | "login";
  linkFallback: boolean;
}

export type ComposeResult =
  | { ok: true; email: BuiltEmail; images: InlineImage[]; dashboardName: string; ownerId: string; meta: ComposeMeta }
  | { ok: false; error: string };

const memo = <T>(m: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> => {
  let p = m.get(key);
  if (!p) {
    p = make();
    m.set(key, p);
    // Lỗi thì không nhớ, để lượt sau thử lại.
    p.catch(() => m.delete(key));
  }
  return p;
};

export async function composeReport(
  deps: ComposeDeps,
  dashboardId: string,
  cfg: ReportConfig,
  opts: { now: Date; caches: ComposeCaches; unsubscribeUrl: string; appName?: string },
): Promise<ComposeResult> {
  const { now, caches } = opts;
  const loaded = await memo(caches.docs, dashboardId, () => deps.loadDashboard(dashboardId));
  if (!loaded) return { ok: false, error: "Dashboard không còn tồn tại." };
  const parsed = Dashboard.safeParse(loaded.doc);
  if (!parsed.success) return { ok: false, error: "Dữ liệu dashboard không hợp lệ." };
  const doc = parsed.data;

  const periods = reportPeriods(cfg.frequency, now);
  const mode: ReportType = cfg.report_type === "overview" ? "overview" : "compare";
  const factsKey = `${dashboardId}|${cfg.frequency}|${mode}|${periods.cur.from}`;
  const f = await memo(caches.facts, factsKey, async () => ({
    periods,
    facts: await buildReportFacts({ doc, periods, exec: deps.exec, updatedAt: loaded.updatedAt, mode }),
  }));

  // Phần AI: lỗi không làm hỏng báo cáo, chỉ thiếu phần AI.
  const notes: string[] = [];
  let write: WriteResult | null = null;
  const allowed = deps.aiAllowed ? await deps.aiAllowed(loaded.ownerId, dashboardId) : true;
  if (allowed) {
    const key = caches.ai.key(dashboardId, f.facts, cfg.frequency, cfg.prompt);
    write = await caches.ai.run(key, () => writeReport(f.facts, cfg.prompt, deps.chat(loaded.ownerId)));
  }
  const body = write?.ok ? write.body : null;
  if (!body) notes.push("Phần phân tích bằng AI không có trong báo cáo này.");

  // Ảnh.
  let imgs: RenderedImage[] = [];
  let imageNotes: string[] = [];
  if (cfg.include_images) {
    const key = `${factsKey}|${[...cfg.widget_ids].join(",")}`;
    const r = await memo(caches.images, key, () =>
      renderReportImages({ doc, facts: f.facts, periods: f.periods, exec: deps.exec, widgetIds: cfg.widget_ids }),
    );
    imgs = r.images;
    imageNotes = r.notes;
  }

  // Link mở dashboard.
  let linkFallback = false;
  let url = `${deps.origin}/d/${dashboardId}`;
  if (cfg.link_mode === "view_link") {
    const token = await deps.viewToken(dashboardId);
    if (token) url = `${deps.origin}/view/${token}`;
    else {
      linkFallback = true;
      notes.push("Dashboard chưa bật link xem, nên bạn cần được mời và đăng nhập để mở dashboard.");
    }
  }

  const email = buildReportEmail({
    appName: opts.appName ?? "Cerno",
    dashboardName: loaded.name || doc.name,
    recipientName: cfg.recipient_name,
    facts: f.facts,
    body,
    images: imgs.map((i) => ({ cid: i.cid, title: i.title })),
    dashboardUrl: url,
    unsubscribeUrl: opts.unsubscribeUrl,
    notes: [...notes, ...imageNotes],
  });

  const meta: ComposeMeta = {
    ai: write
      ? write.ok
        ? { used: true, attempts: write.attempts, provider: write.provider }
        : { used: false, reason: write.reason, detail: write.detail, attempts: write.attempts, ...(write.unverified ? { unverified: write.unverified } : {}) }
      : { used: false, reason: "not_allowed" },
    images: imgs.length,
    imageNotes,
    linkMode: cfg.link_mode,
    linkFallback,
  };
  return {
    ok: true,
    email,
    images: imgs.map((i, n) => ({ filename: `bieu-do-${n + 1}.png`, content: i.png, cid: i.cid, contentType: "image/png" })),
    dashboardName: loaded.name || doc.name,
    ownerId: loaded.ownerId,
    meta,
  };
}
