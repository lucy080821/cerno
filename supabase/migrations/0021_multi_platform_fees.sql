-- Ước tính phí sàn cho TikTok Shop (cùng cách làm với Shopee) và phí tự nhập cho kênh khác (Lazada, Tiki...). Chạy SAU 0020.
-- 1) fee_settings: loại shop TikTok Shop và hoa hồng affiliate trung bình (% giá trị sản phẩm).
-- 2) product_fee_categories: thêm cột channel (ngành hàng chọn riêng cho từng sàn; dòng cũ là của Shopee).
-- 3) channel_fee_rates: tỷ lệ phí người bán tự nhập cho kênh chưa có biểu phí (hoa hồng %, phí thanh toán %, phí cố định mỗi đơn).
alter table public.fee_settings
  add column if not exists tiktok_seller_type text not null default 'non_mall' check (tiktok_seller_type in ('non_mall', 'mall')),
  add column if not exists tiktok_affiliate_pct numeric(5, 2) not null default 0 check (tiktok_affiliate_pct >= 0 and tiktok_affiliate_pct <= 50);

alter table public.product_fee_categories
  add column if not exists channel text not null default 'Shopee' check (channel in ('Shopee', 'TikTok Shop'));
alter table public.product_fee_categories drop constraint if exists product_fee_categories_pkey;
alter table public.product_fee_categories add primary key (workspace_id, sku, channel);

-- Giới hạn tổng số dòng nay tính cho cả hai sàn.
create or replace function public.limit_product_fee_categories() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.product_fee_categories where workspace_id = new.workspace_id) >= 10000 then
    raise exception 'Đã đạt giới hạn 10.000 dòng trong bảng ngành hàng tính phí';
  end if;
  return new;
end $$;
revoke execute on function public.limit_product_fee_categories() from public, anon, authenticated;

create table if not exists public.channel_fee_rates (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel text not null check (length(btrim(channel)) between 1 and 40),
  commission_pct numeric(5, 2) not null default 0 check (commission_pct >= 0 and commission_pct <= 60),
  payment_pct numeric(5, 2) not null default 0 check (payment_pct >= 0 and payment_pct <= 20),
  per_order numeric(12, 2) not null default 0 check (per_order >= 0 and per_order <= 1000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, channel)
);

alter table public.channel_fee_rates enable row level security;

create policy channel_fee_rates_read on public.channel_fee_rates for select using (public.is_member(workspace_id));
create policy channel_fee_rates_insert on public.channel_fee_rates for insert with check (public.can_edit(workspace_id));
create policy channel_fee_rates_update on public.channel_fee_rates for update
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy channel_fee_rates_delete on public.channel_fee_rates for delete using (public.can_edit(workspace_id));

create or replace function public.limit_channel_fee_rates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.channel_fee_rates where workspace_id = new.workspace_id) >= 20 then
    raise exception 'Đã đạt giới hạn 20 kênh trong bảng phí tự nhập';
  end if;
  return new;
end $$;
revoke execute on function public.limit_channel_fee_rates() from public, anon, authenticated;

drop trigger if exists channel_fee_rates_limit on public.channel_fee_rates;
create trigger channel_fee_rates_limit before insert on public.channel_fee_rates
  for each row execute function public.limit_channel_fee_rates();
