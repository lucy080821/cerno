-- Thời điểm DỮ LIỆU của nguồn thật sự đổi (khác last_synced_at: lần đọc Sheet gần nhất, kể cả khi nội dung y hệt).
-- Dùng cho luật cảnh báo "không có dữ liệu mới trong X giờ". CHẠY SAU 0012.
alter table public.data_sources add column if not exists data_changed_at timestamptz;

-- Nguồn đã có: coi như dữ liệu đổi lần cuối vào lần đồng bộ gần nhất (chưa có thông tin chính xác hơn).
update public.data_sources set data_changed_at = last_synced_at where data_changed_at is null;
