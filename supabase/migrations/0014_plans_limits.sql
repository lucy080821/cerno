-- Gói (miễn phí / trả phí) cho báo cáo định kỳ và cảnh báo. CHẠY SAU 0013. Chưa có thanh toán: đổi gói bằng tay:
--   update public.workspaces set plan = 'paid' where id = '<workspace id>';

-- 1. Gói của workspace.
alter table public.workspaces
  add column if not exists plan text not null default 'free' check (plan in ('free', 'paid'));

-- 2. Bộ đếm tính năng theo người dùng và kỳ (vd số lần tạo cảnh báo bằng AI trong tháng). Chỉ service role.
create table if not exists public.feature_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  period text not null,                -- "2025-11" (tháng theo giờ Việt Nam)
  n integer not null default 0 check (n >= 0),
  primary key (user_id, feature, period)
);
alter table public.feature_usage enable row level security;
revoke all on public.feature_usage from anon, authenticated;

-- Giữ chỗ MỘT lượt NGUYÊN TỬ: tăng bộ đếm nếu còn dưới hạn mức; trả true nếu được, false nếu đã hết.
create or replace function public.feature_usage_reserve(p_user uuid, p_feature text, p_period text, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare cur integer;
begin
  insert into public.feature_usage (user_id, feature, period, n) values (p_user, p_feature, p_period, 0)
    on conflict (user_id, feature, period) do nothing;
  update public.feature_usage set n = n + 1
    where user_id = p_user and feature = p_feature and period = p_period and n < p_limit
    returning n into cur;
  return cur is not null;
end $$;

-- Trả lại một lượt (khi thao tác thất bại trước khi dùng dịch vụ).
create or replace function public.feature_usage_release(p_user uuid, p_feature text, p_period text)
returns void language sql security definer set search_path = public as $$
  update public.feature_usage set n = greatest(n - 1, 0) where user_id = p_user and feature = p_feature and period = p_period
$$;

-- Số email đã gửi thành công của một workspace kể từ `p_since` (đếm trong notification_log theo dashboard của workspace).
create or replace function public.mails_sent_since(p_workspace uuid, p_since timestamptz)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.notification_log l
    join public.dashboards d on d.id = l.dashboard_id
   where d.workspace_id = p_workspace and l.status = 'sent' and l.created_at >= p_since
$$;

revoke all on function public.feature_usage_reserve(uuid, text, text, integer), public.feature_usage_release(uuid, text, text),
  public.mails_sent_since(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.feature_usage_reserve(uuid, text, text, integer), public.feature_usage_release(uuid, text, text),
  public.mails_sent_since(uuid, timestamptz) to service_role;
