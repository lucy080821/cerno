-- Báo cáo định kỳ qua email + cảnh báo bất thường. CHẠY SAU 0011.
-- Quyền dựa trên dashboard_role() (0008): 'owner' = thành viên owner/editor của workspace; người được mời (viewer/editor)
-- và thành viên viewer chỉ thấy/sửa dòng của CHÍNH MÌNH.
-- Các cột trạng thái (next_run_at, last_*, last_state...) chỉ service role ghi: người dùng không tự đẩy lịch gửi được.

-- ---------------------------------------------------------------------------------------------
-- 1. Đăng ký nhận báo cáo: MỖI người nhận một dòng (mỗi người có yêu cầu riêng).
create table public.report_subscriptions (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipient_email text not null check (recipient_email = lower(recipient_email) and length(recipient_email) <= 254),
  recipient_name text not null default '' check (length(recipient_name) <= 80),
  prompt text not null default '' check (length(prompt) <= 1000),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday smallint check (weekday between 1 and 7),       -- 1 = thứ Hai … 7 = Chủ nhật
  month_day smallint check (month_day between 1 and 31),  -- 31 = ngày cuối tháng nếu tháng ngắn hơn
  hour_vn smallint not null check (hour_vn between 0 and 23),
  widget_ids text[] not null default '{}' check (cardinality(widget_ids) <= 6),
  include_images boolean not null default true,
  link_mode text not null default 'view_link' check (link_mode in ('view_link', 'login')),
  enabled boolean not null default true,
  next_run_at timestamptz,
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check (frequency <> 'weekly' or weekday is not null),
  check (frequency <> 'monthly' or month_day is not null)
);
create index report_subscriptions_dashboard_idx on public.report_subscriptions (dashboard_id);
create index report_subscriptions_due_idx on public.report_subscriptions (next_run_at) where enabled;

alter table public.report_subscriptions enable row level security;

create policy rs_select on public.report_subscriptions for select using (
  public.dashboard_role(dashboard_id) = 'owner'
  or (created_by = auth.uid() and recipient_email = public.my_email() and public.dashboard_role(dashboard_id) is not null)
);
create policy rs_insert on public.report_subscriptions for insert with check (
  created_by = auth.uid() and (
    public.dashboard_role(dashboard_id) = 'owner'
    or (recipient_email = public.my_email() and public.dashboard_role(dashboard_id) is not null)
  )
);
create policy rs_update on public.report_subscriptions for update using (
  public.dashboard_role(dashboard_id) = 'owner'
  or (created_by = auth.uid() and recipient_email = public.my_email() and public.dashboard_role(dashboard_id) is not null)
) with check (
  public.dashboard_role(dashboard_id) = 'owner'
  or (created_by = auth.uid() and recipient_email = public.my_email() and public.dashboard_role(dashboard_id) is not null)
);
create policy rs_delete on public.report_subscriptions for delete using (
  public.dashboard_role(dashboard_id) = 'owner'
  or (created_by = auth.uid() and recipient_email = public.my_email() and public.dashboard_role(dashboard_id) is not null)
);

-- Người dùng chỉ được ghi các cột "cấu hình". Lịch chạy kế tiếp và trạng thái do server (service role) đặt.
revoke all on public.report_subscriptions from anon;
revoke insert, update on public.report_subscriptions from authenticated;
grant insert (dashboard_id, created_by, recipient_email, recipient_name, prompt, frequency, weekday, month_day, hour_vn,
              widget_ids, include_images, link_mode, enabled)
  on public.report_subscriptions to authenticated;
grant update (recipient_email, recipient_name, prompt, frequency, weekday, month_day, hour_vn,
              widget_ids, include_images, link_mode, enabled)
  on public.report_subscriptions to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Nhật ký gửi và danh sách từ chối nhận: chỉ service role (bật RLS, không có policy).
create table public.notification_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('report', 'alert')),
  ref_id uuid,                                   -- id đăng ký báo cáo hoặc luật cảnh báo
  dashboard_id uuid,                             -- để đếm hạn mức gửi theo workspace (không khoá ngoại: nhật ký sống lâu hơn dashboard)
  channel text not null default 'email',
  recipient text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index notification_log_ref_idx on public.notification_log (kind, ref_id, created_at desc);
create index notification_log_dash_idx on public.notification_log (dashboard_id, created_at desc);

create table public.notification_optouts (
  id bigint generated always as identity primary key,
  email text not null check (email = lower(email)),
  ref_kind text not null check (ref_kind in ('report', 'alert')),
  ref_id uuid,                                   -- null = tất cả báo cáo/cảnh báo loại đó gửi cho email này
  created_at timestamptz not null default now()
);
create unique index notification_optouts_uniq
  on public.notification_optouts (email, ref_kind, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.notification_log enable row level security;
alter table public.notification_optouts enable row level security;
revoke all on public.notification_log, public.notification_optouts from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Luật cảnh báo: mở rộng bảng alert_rules của 0001 (chưa có code nào dùng nó).
alter table public.alert_rules
  alter column owner_id drop not null,
  alter column widget_id drop not null,
  add column created_by uuid references auth.users(id) on delete cascade,
  add column name text not null default 'Cảnh báo' check (length(name) between 1 and 120),
  add column source_prompt text check (length(source_prompt) <= 1000),
  add column metric jsonb,
  add column recipients text[] not null default '{}' check (cardinality(recipients) <= 20),
  add column channels text[] not null default '{email}',
  add column cooldown_minutes integer not null default 360 check (cooldown_minutes between 15 and 10080),
  add column notify_recover boolean not null default false,
  add column snooze_until timestamptz,
  add column last_state text not null default 'ok' check (last_state in ('ok', 'firing', 'error', 'insufficient')),
  add column last_value double precision,
  add column last_checked_at timestamptz,
  add column last_triggered_at timestamptz,
  add column last_error text,
  add column group_state jsonb not null default '{}'::jsonb,   -- luật "theo từng nhóm": nhóm nào đang vi phạm, từ lúc nào
  add column created_at timestamptz not null default now();

update public.alert_rules set created_by = owner_id where created_by is null;
alter table public.alert_rules
  alter column created_by set not null,
  alter column created_by set default auth.uid();

create index alert_rules_dashboard_idx on public.alert_rules (dashboard_id);
create index alert_rules_source_idx on public.alert_rules ((metric ->> 'sourceId')) where enabled;

drop policy alert_own on public.alert_rules;
create policy al_select on public.alert_rules for select using (
  public.dashboard_role(dashboard_id) = 'owner'
  or (created_by = auth.uid() and public.dashboard_role(dashboard_id) is not null)
);
create policy al_insert on public.alert_rules for insert with check (
  created_by = auth.uid() and public.dashboard_role(dashboard_id) is not null
);
create policy al_update on public.alert_rules for update using (
  public.dashboard_role(dashboard_id) = 'owner'
  or (created_by = auth.uid() and public.dashboard_role(dashboard_id) is not null)
) with check (
  public.dashboard_role(dashboard_id) = 'owner'
  or (created_by = auth.uid() and public.dashboard_role(dashboard_id) is not null)
);
create policy al_delete on public.alert_rules for delete using (
  public.dashboard_role(dashboard_id) = 'owner'
  or (created_by = auth.uid() and public.dashboard_role(dashboard_id) is not null)
);

-- Trạng thái đánh giá (last_*, group_state) chỉ service role ghi; người dùng chỉ ghi cột cấu hình (và tạm hoãn).
revoke all on public.alert_rules from anon;
revoke insert, update on public.alert_rules from authenticated;
grant insert (dashboard_id, created_by, name, source_prompt, widget_id, metric, condition, recipients, channels,
              cooldown_minutes, notify_recover, enabled)
  on public.alert_rules to authenticated;
grant update (name, source_prompt, widget_id, metric, condition, recipients, channels,
              cooldown_minutes, notify_recover, enabled, snooze_until)
  on public.alert_rules to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Nhận các báo cáo đến hạn cho cron. Mỗi dòng được "thuê" 30 phút (next_run_at đẩy lên trong CÙNG giao dịch) nên cron
-- chạy chồng nhau không gửi trùng; gửi xong server ghi next_run_at thật (tính bằng nextRunAt ở TypeScript).
-- Nếu tiến trình chết giữa chừng thì sau 30 phút dòng tự được nhận lại.
create function public.claim_due_reports(p_limit integer default 20)
returns setof public.report_subscriptions
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select id from public.report_subscriptions
    where enabled and next_run_at is not null and next_run_at <= now()
    order by next_run_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.report_subscriptions s
     set next_run_at = now() + interval '30 minutes'
    from due
   where s.id = due.id
  returning s.*;
end $$;

revoke all on function public.claim_due_reports(integer) from public, anon, authenticated;
grant execute on function public.claim_due_reports(integer) to service_role;
