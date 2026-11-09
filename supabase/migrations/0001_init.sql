-- Khởi tạo: workspace, dashboard, bình luận, thiết bị push. Bật RLS cho mọi bảng.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  primary key (workspace_id, user_id)
);

-- Một dashboard = một cột jsonb theo @dashboard/schema.
create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  doc jsonb not null,
  share_token text unique,            -- link xem công khai (null = riêng tư)
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Nguồn dữ liệu Google Sheets và bản sao đã đồng bộ.
create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  spreadsheet_id text not null,
  sheet_name text not null,
  columns jsonb not null default '[]',
  sync_interval_minutes int not null default 15 check (sync_interval_minutes >= 15),
  last_synced_at timestamptz,
  last_sync_hash text,                -- so sánh để biết dữ liệu có đổi không
  created_at timestamptz not null default now()
);

create table public.source_rows (
  source_id uuid not null references public.data_sources(id) on delete cascade,
  row_index int not null,
  data jsonb not null,
  primary key (source_id, row_index)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  widget_id text,                     -- null = bình luận cho cả dashboard
  parent_id uuid references public.comments(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  widget_id text not null,
  condition jsonb not null,           -- vd {"op":"lt","value":1000}
  enabled boolean not null default true
);

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);

create index on public.dashboards (workspace_id);
create index on public.comments (dashboard_id, created_at);
create index on public.workspace_members (user_id);

-- Hàm kiểm tra quyền, security definer để tránh đệ quy RLS.
create function public.is_member(ws uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create function public.can_edit(ws uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid() and role in ('owner', 'editor'));
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.dashboards enable row level security;
alter table public.data_sources enable row level security;
alter table public.source_rows enable row level security;
alter table public.comments enable row level security;
alter table public.alert_rules enable row level security;
alter table public.push_devices enable row level security;

create policy ws_read on public.workspaces for select using (public.is_member(id));
create policy ws_insert on public.workspaces for insert with check (owner_id = auth.uid());

create policy wm_read on public.workspace_members for select using (public.is_member(workspace_id));

create policy dash_read on public.dashboards for select using (public.is_member(workspace_id));
create policy dash_write on public.dashboards for all
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));

create policy src_read on public.data_sources for select using (public.is_member(workspace_id));
create policy src_write on public.data_sources for all
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));

create policy rows_read on public.source_rows for select using (
  exists (select 1 from public.data_sources s
          where s.id = source_id and public.is_member(s.workspace_id))
);
-- source_rows chỉ ghi bởi job đồng bộ (service role), không có policy ghi cho client.

create policy cmt_read on public.comments for select using (
  exists (select 1 from public.dashboards d
          where d.id = dashboard_id and public.is_member(d.workspace_id))
);
create policy cmt_insert on public.comments for insert with check (
  author_id = auth.uid() and exists (select 1 from public.dashboards d
          where d.id = dashboard_id and public.is_member(d.workspace_id))
);
create policy cmt_delete on public.comments for delete using (author_id = auth.uid());

create policy alert_own on public.alert_rules for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy dev_own on public.push_devices for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime cho bình luận và thay đổi dashboard (web ↔ mobile đồng bộ).
alter publication supabase_realtime add table public.comments, public.dashboards;
