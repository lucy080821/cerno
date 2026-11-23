-- Phí vận chuyển SHOP CHỊU ước tính theo trung bình mỗi đơn của từng kênh (trang "Chi phí"). Chạy SAU 0019.
-- File đơn hàng của sàn thường không có khoản này (phí ship thực tế trừ phần khách trả, thêm phí chiều hoàn của đơn hoàn), nên người
-- bán nhập mức trung bình lấy từ báo cáo đối soát của sàn. Chỉ dùng ở lớp tính lãi, không ghi vào bảng đơn hàng.
-- channel = tên kênh của đơn hàng. per_order: mỗi đơn đã gửi đi. per_return: thêm cho mỗi đơn hoàn trả (chiều hoàn về).
-- Đọc: mọi thành viên workspace. Ghi: owner/editor (can_edit).
create table if not exists public.shipping_costs (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel text not null check (length(btrim(channel)) between 1 and 40),
  per_order numeric(12, 2) not null default 0 check (per_order >= 0 and per_order <= 10000000),
  per_return numeric(12, 2) not null default 0 check (per_return >= 0 and per_return <= 10000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (workspace_id, channel)
);

alter table public.shipping_costs enable row level security;

create policy shipping_costs_read on public.shipping_costs for select using (public.is_member(workspace_id));
create policy shipping_costs_insert on public.shipping_costs for insert with check (public.can_edit(workspace_id));
create policy shipping_costs_update on public.shipping_costs for update
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy shipping_costs_delete on public.shipping_costs for delete using (public.can_edit(workspace_id));

-- Tối đa 20 kênh mỗi workspace (thực tế chỉ vài kênh).
create or replace function public.limit_shipping_costs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.shipping_costs where workspace_id = new.workspace_id) >= 20 then
    raise exception 'Đã đạt giới hạn 20 kênh trong bảng phí vận chuyển';
  end if;
  return new;
end $$;
revoke execute on function public.limit_shipping_costs() from public, anon, authenticated;

drop trigger if exists shipping_costs_limit on public.shipping_costs;
create trigger shipping_costs_limit before insert on public.shipping_costs
  for each row execute function public.limit_shipping_costs();
