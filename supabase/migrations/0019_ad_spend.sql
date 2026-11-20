-- Chi phí quảng cáo theo ngày và kênh của mỗi workspace (trang "Chi phí"). Người dùng tải file báo cáo quảng cáo
-- (Shopee Ads, Facebook Ads, TikTok Ads...); ứng dụng cộng theo ngày rồi CHIA cho các đơn của ngày đó theo tỉ lệ doanh thu và
-- ghi vào cột "Chi phí quảng cáo" của nguồn "Đơn hàng đa kênh". channel = tên kênh của đơn hàng, hoặc '*' = chia cho mọi kênh.
-- Đọc: mọi thành viên workspace. Ghi: owner/editor (can_edit).
create table if not exists public.ad_spend (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel text not null check (length(btrim(channel)) between 1 and 40),
  day date not null,
  amount numeric(16, 2) not null check (amount >= 0 and amount <= 10000000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, channel, day)
);

alter table public.ad_spend enable row level security;

create policy ad_spend_read on public.ad_spend for select using (public.is_member(workspace_id));
create policy ad_spend_insert on public.ad_spend for insert with check (public.can_edit(workspace_id));
create policy ad_spend_update on public.ad_spend for update
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy ad_spend_delete on public.ad_spend for delete using (public.can_edit(workspace_id));

-- Tối đa 20.000 dòng (ngày × kênh) mỗi workspace, đủ vài năm cho vài kênh.
create or replace function public.limit_ad_spend() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.ad_spend where workspace_id = new.workspace_id) >= 20000 then
    raise exception 'Đã đạt giới hạn 20.000 dòng chi phí quảng cáo';
  end if;
  return new;
end $$;
revoke execute on function public.limit_ad_spend() from public, anon, authenticated;

drop trigger if exists ad_spend_limit on public.ad_spend;
create trigger ad_spend_limit before insert on public.ad_spend
  for each row execute function public.limit_ad_spend();
