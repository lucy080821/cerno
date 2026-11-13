-- Ảnh biểu đồ trong email báo cáo/cảnh báo. App Gmail trên điện thoại hay lỗi với ảnh đính kèm kiểu CID, nên ảnh được đưa lên
-- đường link HTTPS rồi nhúng vào thư. Bucket công khai THEO ĐƯỜNG DẪN (tên file ngẫu nhiên, khó đoán); chỉ máy chủ
-- (service role) ghi/xoá, nên không cần policy. File cũ hơn 30 ngày bị dọn bởi cron /api/cron/reports.
-- Chưa chạy migration này thì thư vẫn gửi được: tự quay về ảnh đính kèm như cũ.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-images', 'report-images', true,
  2097152,                      -- 2 MB mỗi ảnh
  array['image/png']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
