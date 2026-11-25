import type { ReportType } from "@dashboard/schema";
import type { ProfitSummary } from "@/lib/profit/order-profit";
import { buildReportEmail } from "@/lib/server/mail/report-email";
import { storeWording } from "@/lib/server/mail/store-wording";
import type { InlineImage } from "@/lib/server/mail";
import { reportPeriods, type ReportPeriods } from "@/lib/server/reports/period";
import type { ReportFacts } from "@/lib/server/reports/facts";
import type { ChatFn, WriteResult } from "@/lib/server/reports/write-report";
import { writeReport } from "@/lib/server/reports/write-report";
import type { RenderedImage } from "@/lib/server/reports/render-chart";
import type { ComposeCaches, ComposeMeta, ComposeResult, ReportConfig } from "@/lib/server/reports/compose";
import { buildStoreReportFacts } from "./report-facts";
import { dailyWindow, renderStoreImages } from "./report-images";

/**
 * Ráp báo cáo cho MỘT người nhận từ dữ liệu bán hàng của cả cửa hàng (không gắn dashboard): số liệu từ các trang lãi → bài AI (đã kiểm số,
 * chỉ gói trả phí) → 3 biểu đồ cố định → email. Cùng khung `ComposeResult` với báo cáo dashboard nên cron, xem trước và gửi thử dùng chung.
 * Mọi phụ thuộc (DB, AI, tính lãi) truyền vào để kiểm thử được.
 */

export interface StoreInfo {
  id: string;
  name: string;
  ownerId: string;
  /** Lần cập nhật dữ liệu đơn hàng gần nhất (ISO), null nếu chưa biết. */
  updatedAt: string | null;
  /** false = cửa hàng chưa có dữ liệu đơn hàng. */
  hasOrders: boolean;
}

export interface StoreComposeDeps {
  loadStore(workspaceId: string): Promise<StoreInfo | null>;
  /** Tổng hợp lãi của các đơn có ngày đặt trong khoảng (gồm hai đầu). */
  summarize(workspaceId: string, range: { from: string; to: string }): Promise<ProfitSummary>;
  chat(ownerId: string): ChatFn;
  /** https://cerno.cloud (không có dấu / cuối). */
  origin: string;
  /** Có cho AI viết báo cáo không (gói trả phí). Mặc định có. */
  aiAllowed?(ownerId: string, workspaceId: string): Promise<boolean>;
}

/** Dữ liệu tính một lần cho mỗi (cửa hàng, tần suất, kỳ): nhiều người nhận cùng báo cáo dùng chung. Gắn theo `ComposeCaches` của lượt chạy. */
interface StoreData {
  facts: ReportFacts;
  periods: ReportPeriods;
  cur: ProfitSummary;
}
const storeCaches = new WeakMap<ComposeCaches, Map<string, Promise<StoreData>>>();

const memo = <T>(m: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> => {
  let p = m.get(key);
  if (!p) {
    p = make();
    m.set(key, p);
    p.catch(() => m.delete(key));
  }
  return p;
};

export async function composeStoreReport(
  deps: StoreComposeDeps,
  workspaceId: string,
  cfg: ReportConfig,
  opts: { now: Date; caches: ComposeCaches; unsubscribeUrl: string; appName?: string },
): Promise<ComposeResult> {
  const { now, caches } = opts;
  const store = await deps.loadStore(workspaceId);
  if (!store) return { ok: false, error: "Cửa hàng không còn tồn tại." };
  if (!store.hasOrders) return { ok: false, error: "Cửa hàng chưa có dữ liệu đơn hàng để làm báo cáo." };

  const periods: ReportPeriods = reportPeriods(cfg.frequency, now);
  const mode: ReportType = cfg.report_type === "overview" ? "overview" : "compare";
  const key = `ws:${workspaceId}|${cfg.frequency}|${mode}|${periods.cur.from}`;

  let mine = storeCaches.get(caches);
  if (!mine) storeCaches.set(caches, (mine = new Map()));
  const data = await memo(mine, key, async () => {
    const [cur, prev] = await Promise.all([deps.summarize(workspaceId, periods.cur), deps.summarize(workspaceId, periods.prev)]);
    const facts: ReportFacts = buildStoreReportFacts({ cur, prev, periods, updatedAt: store.updatedAt, mode });
    return { facts, periods, cur };
  });

  const notes: string[] = [];
  let write: WriteResult | null = null;
  const allowed = deps.aiAllowed ? await deps.aiAllowed(store.ownerId, workspaceId) : true;
  if (allowed) {
    const aiKey = caches.ai.key(`ws:${workspaceId}`, data.facts, cfg.frequency, cfg.prompt);
    write = await caches.ai.run(aiKey, () => writeReport(data.facts, cfg.prompt, deps.chat(store.ownerId)));
  }
  const body = write?.ok ? write.body : null;
  if (!body) notes.push("Phần phân tích bằng AI không có trong báo cáo này.");

  let imgs: RenderedImage[] = [];
  let imageNotes: string[] = [];
  if (cfg.include_images && data.cur.orders > 0) {
    const r = await memo(caches.images, `${key}|img`, async () => {
      const win = dailyWindow(periods);
      const daily = win.from === periods.cur.from && win.to === periods.cur.to ? data.cur : await deps.summarize(workspaceId, win);
      return renderStoreImages({ cur: data.cur, daily, periods });
    });
    imgs = r.images;
    imageNotes = r.notes;
  }

  const built = storeWording(
    buildReportEmail({
      appName: opts.appName ?? "Cerno",
      dashboardName: store.name,
      recipientName: cfg.recipient_name,
      facts: data.facts,
      body,
      images: imgs.map((i) => ({ cid: i.cid, title: i.title })),
      dashboardUrl: `${deps.origin}/overview`,
      unsubscribeUrl: opts.unsubscribeUrl,
      notes: [...notes, ...imageNotes],
    }),
  );

  const meta: ComposeMeta = {
    ai: write
      ? write.ok
        ? { used: true, attempts: write.attempts, provider: write.provider }
        : { used: false, reason: write.reason, detail: write.detail, attempts: write.attempts, ...(write.unverified ? { unverified: write.unverified } : {}) }
      : { used: false, reason: "not_allowed" },
    images: imgs.length,
    imageNotes,
    linkMode: cfg.link_mode,
    linkFallback: false,
  };
  const images: InlineImage[] = imgs.map((i, n) => ({ filename: `bieu-do-${n + 1}.png`, content: i.png, cid: i.cid, contentType: "image/png" }));
  return { ok: true, email: built, images, dashboardName: store.name, ownerId: store.ownerId, meta };
}
