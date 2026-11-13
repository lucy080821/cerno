-- Loại báo cáo định kỳ: 'compare' (so sánh kỳ này với kỳ trước, mặc định như trước đây) hoặc 'overview' (tổng quan: chỉ
-- mô tả kỳ hiện tại, không so sánh). Người dùng được ghi cột này như các cột cấu hình khác.
alter table public.report_subscriptions
  add column if not exists report_type text not null default 'compare'
  check (report_type in ('compare', 'overview'));

grant insert (report_type) on public.report_subscriptions to authenticated;
grant update (report_type) on public.report_subscriptions to authenticated;
