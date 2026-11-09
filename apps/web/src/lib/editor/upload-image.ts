import { createClient } from "@/lib/supabase/client";

export const IMAGE_BUCKET = "dashboard-images";
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_INPUT = 15 * 1024 * 1024; // ảnh gốc
const MAX_OUTPUT = 5 * 1024 * 1024; // khớp giới hạn của bucket
const MAX_SIDE = 2000;

export class UploadError extends Error {}

/** Thu nhỏ ảnh (cạnh dài ≤ 2000px) và nén WebP để nhẹ khi tải. GIF giữ nguyên để không mất hoạt ảnh. */
async function shrink(file: File): Promise<{ blob: Blob; ext: string }> {
  const ext = file.type === "image/gif" ? "gif" : "webp";
  if (file.type === "image/gif") return { blob: file, ext };
  const bmp = await createImageBitmap(file).catch(() => {
    throw new UploadError("Không đọc được ảnh này.");
  });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.85));
  if (!blob || blob.type !== "image/webp") throw new UploadError("Trình duyệt không nén được ảnh này.");
  return { blob, ext };
}

/** Tải ảnh từ máy lên Supabase Storage, trả URL công khai. */
export async function uploadImage(file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new UploadError("Chỉ nhận ảnh PNG, JPG, WebP hoặc GIF.");
  if (file.size > MAX_INPUT) throw new UploadError("Ảnh quá lớn (tối đa 15 MB).");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UploadError("Bạn cần đăng nhập để tải ảnh.");

  const { blob, ext } = await shrink(file);
  if (blob.size > MAX_OUTPUT) throw new UploadError("Ảnh vẫn quá nặng sau khi nén (tối đa 5 MB).");

  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, blob, {
    contentType: blob.type,
    cacheControl: "31536000", // tên file là UUID, không bao giờ đổi nội dung
  });
  if (error) {
    const missing = /bucket not found/i.test(error.message);
    throw new UploadError(missing ? "Chưa tạo kho ảnh: chạy migration 0003_images.sql trên Supabase." : error.message);
  }
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
