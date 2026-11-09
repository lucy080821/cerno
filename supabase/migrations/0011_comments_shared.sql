-- Bình luận trên dashboard được chia sẻ. Chạy SAU 0008.
-- Ai có quyền XEM dashboard (chủ, thành viên workspace, người được mời Xem hoặc Sửa) đều đọc và viết được bình luận.
-- Link xem công khai (không đăng nhập) KHÔNG bình luận được vì cần biết người viết là ai.
-- Xoá: tác giả xoá bình luận của mình; chủ dashboard (vai trò 'owner') xoá được mọi bình luận.

-- Tên hiển thị của tác giả, chụp lại lúc viết (không đọc được bảng auth.users từ client).
alter table public.comments add column if not exists author_name text not null default '';

create function public.comments_before_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  new.author_id := auth.uid();
  new.body := btrim(new.body);
  new.author_name := left(coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() ->> 'email', ''),
    'Người dùng'
  ), 120);
  -- Bình luận trả lời phải cùng dashboard và chỉ một cấp.
  if new.parent_id is not null and not exists (
    select 1 from public.comments p
    where p.id = new.parent_id and p.dashboard_id = new.dashboard_id and p.parent_id is null
  ) then
    raise exception 'bad_parent' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger comments_before_insert before insert on public.comments
  for each row execute function public.comments_before_insert();

-- Tối đa 500 bình luận mỗi dashboard (hạn mức mềm giai đoạn miễn phí).
create function public.limit_comments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.comments where dashboard_id = new.dashboard_id) >= 500 then
    raise exception 'comment_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger comments_limit before insert on public.comments
  for each row execute function public.limit_comments();

drop policy cmt_read on public.comments;
drop policy cmt_insert on public.comments;
drop policy cmt_delete on public.comments;

create policy cmt_read on public.comments for select using (public.dashboard_role(dashboard_id) is not null);
create policy cmt_insert on public.comments for insert
  with check (author_id = auth.uid() and public.dashboard_role(dashboard_id) is not null);
create policy cmt_delete on public.comments for delete
  using (author_id = auth.uid() or public.dashboard_role(dashboard_id) = 'owner');

-- Realtime tính theo RLS ở trên; cần đủ dữ liệu hàng cũ để nhận sự kiện xoá.
alter table public.comments replica identity full;
