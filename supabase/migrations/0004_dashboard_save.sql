-- Lưu dashboard: dấu thời gian cập nhật tin cậy (dùng phát hiện xung đột), hạn mức mềm, giới hạn kích thước.

-- 1) Mỗi lần UPDATE, DB tự đặt updated_at/updated_by. Client không tự khai được, nên so sánh
--    updated_at để phát hiện hai tab/hai người cùng sửa là đáng tin.
create function public.touch_dashboard() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger dashboards_touch before update on public.dashboards
  for each row execute function public.touch_dashboard();

-- 2) Hạn mức mềm giai đoạn miễn phí: tối đa 20 dashboard mỗi workspace.
create function public.limit_dashboards() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.dashboards where workspace_id = new.workspace_id) >= 20 then
    raise exception 'dashboard_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger dashboards_limit before insert on public.dashboards
  for each row execute function public.limit_dashboards();

-- 3) Chặn file JSON quá lớn (2 MB), tránh phình bảng khi nhập file lạ.
alter table public.dashboards
  add constraint dashboards_doc_size check (octet_length(doc::text) <= 2000000);
