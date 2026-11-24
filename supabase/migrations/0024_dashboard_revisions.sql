-- Lịch sử phiên bản dashboard: xem lại và khôi phục bản cũ. Chạy SAU 0023.
-- Tự động: mỗi lần dashboard.doc đổi, nếu bản gần nhất đã cũ hơn 10 phút thì lưu lại bản TRƯỚC khi sửa (nên một buổi chỉnh sửa
-- liên tục chỉ ra vài mốc, không phải mỗi lần tự lưu một bản). Thủ công: nút "Lưu mốc" (RPC create_dashboard_revision, có đặt tên).
-- Giữ 20 bản tự động mới nhất và tối đa 20 mốc đặt tên. Chỉ chủ/người được quyền Sửa xem được; người dùng KHÔNG ghi trực tiếp
-- (chỉ trigger và RPC bên dưới). Khôi phục = nạp doc cũ vào editor rồi tự lưu như mọi lần sửa khác, nên bản vừa bị thay cũng thành
-- một mốc để quay lại.
create table if not exists public.dashboard_revisions (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards (id) on delete cascade,
  doc jsonb not null check (octet_length(doc::text) <= 2000000),
  label text check (label is null or length(btrim(label)) between 1 and 80),
  saved_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists dashboard_revisions_dash on public.dashboard_revisions (dashboard_id, saved_at desc);

alter table public.dashboard_revisions enable row level security;

create policy dashboard_revisions_select on public.dashboard_revisions for select
  using (public.dashboard_role(dashboard_id) in ('owner', 'editor'));
create policy dashboard_revisions_delete on public.dashboard_revisions for delete
  using (public.dashboard_role(dashboard_id) in ('owner', 'editor'));

-- Bỏ bản tự động cũ quá hạn mức (mốc có tên không bị xoá ở đây).
create or replace function public.trim_dashboard_revisions(p_dashboard uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.dashboard_revisions
  where dashboard_id = p_dashboard and label is null
    and id not in (
      select id from public.dashboard_revisions
      where dashboard_id = p_dashboard and label is null
      order by saved_at desc limit 20
    )
$$;
revoke execute on function public.trim_dashboard_revisions(uuid) from public, anon, authenticated;

create or replace function public.snapshot_dashboard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.doc is distinct from old.doc
     and not exists (
       select 1 from public.dashboard_revisions r
       where r.dashboard_id = old.id and r.created_at > now() - interval '10 minutes'
     ) then
    insert into public.dashboard_revisions (dashboard_id, doc, saved_at, created_by)
    values (old.id, old.doc, old.updated_at, auth.uid());
    perform public.trim_dashboard_revisions(old.id);
  end if;
  return new;
end $$;
revoke execute on function public.snapshot_dashboard() from public, anon, authenticated;

drop trigger if exists dashboards_snapshot on public.dashboards;
create trigger dashboards_snapshot after update of doc on public.dashboards
  for each row execute function public.snapshot_dashboard();

-- Lưu mốc có tên từ bản đang lưu trên server.
create or replace function public.create_dashboard_revision(p_dashboard uuid, p_label text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_doc jsonb;
  v_saved timestamptz;
begin
  if public.dashboard_role(p_dashboard) not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_label is null or length(btrim(p_label)) not between 1 and 80 then
    raise exception 'invalid_label';
  end if;
  if (select count(*) from public.dashboard_revisions where dashboard_id = p_dashboard and label is not null) >= 20 then
    raise exception 'named_limit';
  end if;
  select doc, updated_at into v_doc, v_saved from public.dashboards where id = p_dashboard;
  if v_doc is null then
    raise exception 'not_found';
  end if;
  insert into public.dashboard_revisions (dashboard_id, doc, label, saved_at, created_by)
  values (p_dashboard, v_doc, btrim(p_label), v_saved, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_dashboard_revision(uuid, text) from public, anon;
grant execute on function public.create_dashboard_revision(uuid, text) to authenticated;
