-- Đăng nhập Google + token đồng bộ Sheets.

-- 1) Mỗi người dùng mới tự có một workspace cá nhân (và là owner).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  insert into public.workspaces (name, owner_id)
  values (coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'Workspace') || ' – cá nhân', new.id)
  returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, new.id, 'owner');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Refresh token của Google, đã mã hoá AES-256-GCM ở server.
-- Bật RLS và KHÔNG tạo policy nào: client không đọc/ghi được, chỉ service role (server).
create table public.google_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_enc text not null,
  scope text,
  updated_at timestamptz not null default now()
);
alter table public.google_credentials enable row level security;

-- 3) Nguồn dữ liệu: ai tạo + trạng thái đồng bộ + chống trùng.
alter table public.data_sources
  add column created_by uuid references auth.users(id),
  add column name text,
  add column row_count int not null default 0,
  add column last_error text;

create unique index data_sources_unique_tab
  on public.data_sources (workspace_id, spreadsheet_id, sheet_name);
