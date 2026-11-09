-- Chia sẻ dashboard cho người khác: (1) link xem công khai, (2) mời theo email Google với quyền Xem hoặc Sửa.
-- Chạy SAU 0007. Người được mời KHÔNG vào workspace của chủ: họ chỉ chạm tới đúng dashboard được mời
-- (và các nguồn dữ liệu mà dashboard đó đang dùng), không thấy dashboard hay nguồn nào khác của chủ.

-- ---------------------------------------------------------------------------------------------
-- Link xem công khai (tách khỏi mã nhúng ở dashboard_shares để bật/tắt/thu hồi độc lập).
create table public.dashboard_links (
  dashboard_id uuid primary key references public.dashboards(id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.dashboard_links enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Lời mời theo email. Email lưu chữ thường; khớp với email Google của người đăng nhập (đã được Google xác minh).
create table public.dashboard_access (
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role text not null check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  primary key (dashboard_id, email)
);
create index on public.dashboard_access (email);
alter table public.dashboard_access enable row level security;

-- Tối đa 50 người được mời mỗi dashboard (hạn mức mềm giai đoạn miễn phí).
create function public.limit_dashboard_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.dashboard_access where dashboard_id = new.dashboard_id) >= 50 then
    raise exception 'access_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger dashboard_access_limit before insert on public.dashboard_access
  for each row execute function public.limit_dashboard_access();

-- ---------------------------------------------------------------------------------------------
-- Hàm kiểm tra quyền. security definer để policy KHÔNG đệ quy qua RLS của các bảng liên quan.

create function public.my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- Vai trò của người đang đăng nhập trên một dashboard:
--   'owner'  = thành viên owner/editor của workspace chứa dashboard (toàn quyền, kể cả chia sẻ, xoá)
--   'member' = thành viên viewer của workspace (chỉ xem)
--   'editor' / 'viewer' = được mời theo email (sửa nội dung / chỉ xem)
--   null     = không có quyền
create function public.dashboard_role(d uuid) returns text
language sql security definer stable set search_path = public as $$
  select case
    when exists (select 1 from public.dashboards x where x.id = d and public.can_edit(x.workspace_id)) then 'owner'
    when exists (select 1 from public.dashboards x where x.id = d and public.is_member(x.workspace_id)) then 'member'
    else (select a.role from public.dashboard_access a where a.dashboard_id = d and a.email = public.my_email())
  end
$$;

-- Nguồn dữ liệu này có đang được dùng bởi một dashboard mà tôi được mời không?
create function public.source_shared_with_me(src uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.data_sources s
    join public.dashboards d on d.workspace_id = s.workspace_id
    join public.dashboard_access a on a.dashboard_id = d.id and a.email = public.my_email()
    where s.id = src
      and d.doc -> 'sources' @> jsonb_build_array(jsonb_build_object('id', src::text))
  )
$$;

-- Danh sách dashboard được chia sẻ với tôi (không gồm dashboard trong workspace của tôi).
create function public.shared_dashboards() returns table (id uuid, name text, updated_at timestamptz, role text)
language sql security definer stable set search_path = public as $$
  select d.id, d.name, d.updated_at, a.role
  from public.dashboard_access a
  join public.dashboards d on d.id = a.dashboard_id
  where a.email = public.my_email() and not public.is_member(d.workspace_id)
  order by d.updated_at desc
$$;

revoke all on function public.my_email(), public.dashboard_role(uuid), public.source_shared_with_me(uuid),
  public.shared_dashboards() from public;
grant execute on function public.my_email(), public.dashboard_role(uuid), public.source_shared_with_me(uuid),
  public.shared_dashboards() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Policy của hai bảng mới: chỉ 'owner' của dashboard quản lý link và lời mời.
create policy links_owner on public.dashboard_links for all
  using (public.dashboard_role(dashboard_id) = 'owner') with check (public.dashboard_role(dashboard_id) = 'owner');

create policy access_owner on public.dashboard_access for all
  using (public.dashboard_role(dashboard_id) = 'owner') with check (public.dashboard_role(dashboard_id) = 'owner');
-- Người được mời đọc được dòng của chính mình (để biết vai trò).
create policy access_self_read on public.dashboard_access for select using (email = public.my_email());

-- ---------------------------------------------------------------------------------------------
-- Mở rộng quyền đọc/sửa cho người được mời.

-- Đọc dashboard: thành viên workspace HOẶC được mời.
drop policy dash_read on public.dashboards;
create policy dash_read on public.dashboards for select using (public.dashboard_role(id) is not null);

-- Người được mời quyền 'editor' chỉ được UPDATE (không tạo mới, không xoá: các policy ghi cũ vẫn chỉ cho thành viên workspace).
create policy dash_update_shared on public.dashboards for update
  using (public.dashboard_role(id) = 'editor') with check (public.dashboard_role(id) = 'editor');

-- Chặn tuyệt đối việc chuyển dashboard sang workspace khác. Nếu không, người được mời quyền sửa có thể UPDATE
-- workspace_id sang workspace của chính họ để "lấy" dashboard (policy WITH CHECK không thấy giá trị mới qua hàm).
create function public.lock_dashboard_workspace() returns trigger
language plpgsql as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_locked' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger dashboards_lock_workspace before update on public.dashboards
  for each row execute function public.lock_dashboard_workspace();

-- Đọc nguồn dữ liệu và dòng dữ liệu mà dashboard được mời đang dùng (chỉ đọc; không sửa/đồng bộ được).
drop policy src_read on public.data_sources;
create policy src_read on public.data_sources for select using (
  public.is_member(workspace_id) or public.source_shared_with_me(id)
);

drop policy rows_read on public.source_rows;
create policy rows_read on public.source_rows for select using (
  exists (select 1 from public.data_sources s
          where s.id = source_id and (public.is_member(s.workspace_id) or public.source_shared_with_me(s.id)))
);
