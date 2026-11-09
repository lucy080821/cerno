-- Ảnh người dùng tải lên cho widget "Ảnh" của dashboard.
-- Bucket công khai (ảnh hiển thị trong dashboard cần URL xem được ngay, kể cả khi chia sẻ link).
-- Chỉ chủ sở hữu được ghi/xoá, trong thư mục mang đúng user id của mình.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dashboard-images', 'dashboard-images', true,
  5242880,                                         -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "dash_img_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'dashboard-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "dash_img_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'dashboard-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "dash_img_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'dashboard-images' and (storage.foldername(name))[1] = auth.uid()::text);
