-- Google Sheet làm nguồn ĐƠN HÀNG cho các trang lãi (Tổng quan, Lãi lỗ, Chi phí, Hoàn và hủy, Đơn hàng, Sản phẩm). Chạy SAU 0021.
-- Mỗi dòng là một tab Sheet của MỘT kênh bán (Shopee, TikTok Shop...): người bán dán dữ liệu xuất của sàn xuống dưới số liệu cũ, Cerno
-- đọc lại tab (tự động mỗi 2 giờ hoặc bấm Cập nhật), chuẩn hoá giống file tải lên rồi THAY toàn bộ dòng của kênh đó trong nguồn
-- "Đơn hàng đa kênh". Nội dung gốc của Sheet KHÔNG được lưu (có thể chứa thông tin người mua): chỉ giữ các cột đã ánh xạ.
-- mapping: {trường: [tên cột trong dòng tiêu đề]}. Lưu theo TÊN cột (không theo chỉ số) để chèn thêm cột vào Sheet không làm lệch.
-- Đọc: mọi thành viên workspace. Thêm/xoá: owner/editor (can_edit). Ghi trạng thái đồng bộ: chỉ service role.
create table if not exists public.order_sheets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  spreadsheet_id text not null check (length(spreadsheet_id) between 10 and 100),
  sheet_name text not null check (length(btrim(sheet_name)) between 1 and 120),
  name text not null check (length(btrim(name)) between 1 and 160),
  channel text not null check (channel in ('Shopee', 'TikTok Shop', 'Lazada', 'Tiki', 'Facebook', 'Khác')),
  mapping jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sync_interval_minutes integer not null default 120 check (sync_interval_minutes between 15 and 10080),
  last_synced_at timestamptz,
  last_attempt_at timestamptz,
  last_sync_hash text,
  last_error text,
  line_count integer not null default 0,
  order_count integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  -- Mỗi kênh chỉ có MỘT nguồn dữ liệu: hoặc Sheet này, hoặc file tải lên (tải file lên kênh đang nối Sheet bị chặn).
  unique (workspace_id, channel),
  unique (workspace_id, spreadsheet_id, sheet_name)
);

alter table public.order_sheets enable row level security;

create policy order_sheets_read on public.order_sheets for select using (public.is_member(workspace_id));
create policy order_sheets_insert on public.order_sheets for insert with check (public.can_edit(workspace_id));
create policy order_sheets_delete on public.order_sheets for delete using (public.can_edit(workspace_id));

-- Tối đa 8 tab đơn hàng mỗi workspace (thực tế mỗi kênh một tab).
create or replace function public.limit_order_sheets() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.order_sheets where workspace_id = new.workspace_id) >= 8 then
    raise exception 'Đã đạt giới hạn 8 Sheet đơn hàng';
  end if;
  return new;
end $$;
revoke execute on function public.limit_order_sheets() from public, anon, authenticated;

drop trigger if exists order_sheets_limit on public.order_sheets;
create trigger order_sheets_limit before insert on public.order_sheets
  for each row execute function public.limit_order_sheets();
