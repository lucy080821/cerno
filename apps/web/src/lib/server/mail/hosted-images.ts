import { randomUUID } from "node:crypto";

/**
 * Đưa ảnh biểu đồ của email lên Supabase Storage (bucket công khai `report-images`, migration 0015) để nhúng bằng link HTTPS.
 * Lý do: app Gmail trên điện thoại hay không hiển thị ảnh đính kèm kiểu CID. Mọi lỗi (chưa có bucket, chưa cấu hình,
 * mạng...) trả null để người gọi quay về ảnh đính kèm như cũ: email KHÔNG bao giờ mất ảnh vì việc này.
 * Tên file ngẫu nhiên (UUID) nên chỉ ai có link trong thư mới mở được; file bị dọn sau `KEEP_DAYS` ngày.
 */

export const REPORT_IMAGE_BUCKET = "report-images";
export const KEEP_DAYS = 30;

export interface HostableImage {
  cid: string;
  content: Buffer;
  contentType: string;
}

/** Phần của client Storage mà file này dùng (để kiểm thử bằng bản giả). */
export interface StorageLike {
  storage: {
    from(bucket: string): {
      upload(path: string, body: Buffer, opts: { contentType: string; upsert: boolean }): Promise<{ error: unknown }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
      list(path: string, opts: { limit: number; sortBy: { column: string; order: string } }): Promise<{ data: { name: string }[] | null; error: unknown }>;
      remove(paths: string[]): Promise<{ error: unknown }>;
    };
  };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

/** Tải các ảnh lên; trả {cid → link công khai}, hoặc null nếu có BẤT KỲ ảnh nào lỗi (không dùng một nửa). */
export async function hostImages(client: StorageLike, images: HostableImage[], now: Date = new Date()): Promise<Record<string, string> | null> {
  if (images.length === 0) return {};
  try {
    const bucket = client.storage.from(REPORT_IMAGE_BUCKET);
    const out: Record<string, string> = {};
    const uploaded: string[] = [];
    for (const img of images) {
      if (img.contentType !== "image/png") return null;
      const name = `${ymd(now)}-${randomUUID()}.png`;
      const { error } = await bucket.upload(name, img.content, { contentType: img.contentType, upsert: false });
      if (error) {
        // Bỏ các ảnh đã tải của thư này (không để rác), rồi để người gọi dùng ảnh đính kèm.
        if (uploaded.length) await bucket.remove(uploaded).catch(() => {});
        return null;
      }
      uploaded.push(name);
      const url = bucket.getPublicUrl(name).data.publicUrl;
      if (!/^https:\/\//.test(url)) {
        await bucket.remove(uploaded).catch(() => {});
        return null;
      }
      out[img.cid] = url;
    }
    return out;
  } catch {
    return null;
  }
}

/** Thay `cid:<id>` trong HTML bằng link công khai tương ứng. */
export function useHostedUrls(html: string, urls: Record<string, string>): string {
  let out = html;
  for (const [cid, url] of Object.entries(urls)) out = out.split(`cid:${cid}`).join(url);
  return out;
}

/**
 * Xoá ảnh cũ hơn `keepDays` ngày (tên file bắt đầu bằng yyyymmdd nên không cần đọc ngày tạo). Làm hết sức, không ném lỗi.
 * Trả số file đã xoá.
 */
export async function purgeOldReportImages(client: StorageLike, now: Date = new Date(), keepDays = KEEP_DAYS): Promise<number> {
  try {
    const bucket = client.storage.from(REPORT_IMAGE_BUCKET);
    const cutoff = ymd(new Date(now.getTime() - keepDays * 86_400_000));
    const { data, error } = await bucket.list("", { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error || !data) return 0;
    const old = data.map((f) => f.name).filter((n) => /^\d{8}-/.test(n) && n.slice(0, 8) < cutoff);
    if (old.length === 0) return 0;
    const { error: rmErr } = await bucket.remove(old);
    return rmErr ? 0 : old.length;
  } catch {
    return 0;
  }
}
