-- Tự động cập nhật dữ liệu Google Sheets.

-- 1) Chu kỳ tự cập nhật mặc định: 2 giờ (trước là 15 phút). Ràng buộc >= 15 phút giữ nguyên để không vượt hạn mức Google.
alter table public.data_sources alter column sync_interval_minutes set default 120;
update public.data_sources set sync_interval_minutes = 120 where sync_interval_minutes = 15;

-- 2) Lần THỬ đồng bộ gần nhất (kể cả thất bại). Nguồn lỗi (vd quyền Google hết hạn) được thử lại nhiều nhất
--    mỗi 15 phút thay vì bị gọi liên tục mỗi lần bộ hẹn giờ chạy.
alter table public.data_sources add column last_attempt_at timestamptz;

-- 3) Truy vấn tìm nguồn đến hạn chạy theo last_synced_at.
create index if not exists data_sources_last_synced_idx on public.data_sources (last_synced_at nulls first);
