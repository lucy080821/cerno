-- Bảng giá vốn theo sản phẩm của mỗi workspace (trang "Sản phẩm và giá vốn"). Khoá = SKU, không có SKU thì tên sản phẩm.
-- Giá vốn ở đây được ứng dụng ghi vào cột "Giá vốn" của nguồn "Đơn hàng đa kênh" (giá mỗi cái × số lượng), nên dashboard,
-- trường tính toán và báo cáo đều thấy. Đọc: mọi thành viên workspace. Ghi: owner/editor (can_edit).
create table if not exists public.product_costs (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sku text not null check (length(btrim(sku)) between 1 and 120),
  name text not null default '' check (length(name) <= 200),
  unit_cost numeric(16, 2) not null check (unit_cost >= 0 and unit_cost <= 1000000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, sku)
);

alter table public.product_costs enable row level security;

create policy product_costs_read on public.product_costs for select using (public.is_member(workspace_id));
create policy product_costs_insert on public.product_costs for insert with check (public.can_edit(workspace_id));
create policy product_costs_update on public.product_costs for update
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy product_costs_delete on public.product_costs for delete using (public.can_edit(workspace_id));

-- Tối đa 5.000 sản phẩm mỗi workspace.
create or replace function public.limit_product_costs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.product_costs where workspace_id = new.workspace_id) >= 5000 then
    raise exception 'Đã đạt giới hạn 5.000 sản phẩm trong bảng giá vốn';
  end if;
  return new;
end $$;
revoke execute on function public.limit_product_costs() from public, anon, authenticated;

drop trigger if exists product_costs_limit on public.product_costs;
create trigger product_costs_limit before insert on public.product_costs
  for each row execute function public.limit_product_costs();
