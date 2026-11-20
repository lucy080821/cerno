-- Ước tính phí sàn Shopee khi file đơn hàng không có phí (trang "Sản phẩm và giá vốn"). Chạy SAU 0017.
-- fee_settings: một dòng mỗi workspace (bật ước tính, loại shop, người bán mới). product_fee_categories: ngành hàng (đường dẫn
-- "Cấp 1 › Cấp 2 › Cấp 3" trong biểu Phí Cố Định) của từng sản phẩm. Khoá sku = SKU, không có SKU thì tên sản phẩm (như product_costs).
-- Đọc: mọi thành viên workspace. Ghi: owner/editor (can_edit).
create table if not exists public.fee_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  estimate_enabled boolean not null default false,
  seller_type text not null default 'non_mall' check (seller_type in ('non_mall', 'mall')),
  new_seller boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.product_fee_categories (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sku text not null check (length(btrim(sku)) between 1 and 120),
  category text not null check (length(btrim(category)) between 1 and 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, sku)
);

alter table public.fee_settings enable row level security;
alter table public.product_fee_categories enable row level security;

create policy fee_settings_read on public.fee_settings for select using (public.is_member(workspace_id));
create policy fee_settings_insert on public.fee_settings for insert with check (public.can_edit(workspace_id));
create policy fee_settings_update on public.fee_settings for update
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));

create policy product_fee_categories_read on public.product_fee_categories for select using (public.is_member(workspace_id));
create policy product_fee_categories_insert on public.product_fee_categories for insert with check (public.can_edit(workspace_id));
create policy product_fee_categories_update on public.product_fee_categories for update
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy product_fee_categories_delete on public.product_fee_categories for delete using (public.can_edit(workspace_id));

-- Tối đa 5.000 sản phẩm mỗi workspace (như bảng giá vốn).
create or replace function public.limit_product_fee_categories() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.product_fee_categories where workspace_id = new.workspace_id) >= 5000 then
    raise exception 'Đã đạt giới hạn 5.000 sản phẩm trong bảng ngành hàng tính phí';
  end if;
  return new;
end $$;
revoke execute on function public.limit_product_fee_categories() from public, anon, authenticated;

drop trigger if exists product_fee_categories_limit on public.product_fee_categories;
create trigger product_fee_categories_limit before insert on public.product_fee_categories
  for each row execute function public.limit_product_fee_categories();
