-- Cảnh báo và báo cáo định kỳ theo CỬA HÀNG (workspace), không còn bắt buộc gắn với một dashboard. CHẠY SAU 0024.
-- Luật/đăng ký cũ gắn dashboard (dashboard_id có giá trị) vẫn chạy y như trước. Dòng mới của cửa hàng có dashboard_id = null,
-- đọc dữ liệu "Đơn hàng đa kênh" (các trang lãi) thay vì widget của dashboard.
-- Quyền: thành viên owner/editor của workspace quản lý mọi dòng của cửa hàng; thành viên viewer chỉ thấy/sửa dòng của CHÍNH MÌNH.

-- ---------------------------------------------------------------------------------------------
-- 1. Cột workspace_id (luôn có giá trị) + dashboard_id cho phép null.
alter table public.report_subscriptions
  alter column dashboard_id drop not null,
  add column workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.alert_rules
  alter column dashboard_id drop not null,
  add column workspace_id uuid references public.workspaces(id) on delete cascade;

update public.report_subscriptions s set workspace_id = d.workspace_id from public.dashboards d where d.id = s.dashboard_id;
update public.alert_rules r set workspace_id = d.workspace_id from public.dashboards d where d.id = r.dashboard_id;

alter table public.report_subscriptions alter column workspace_id set not null;
alter table public.alert_rules alter column workspace_id set not null;

create index report_subscriptions_workspace_idx on public.report_subscriptions (workspace_id);
create index alert_rules_workspace_idx on public.alert_rules (workspace_id);

-- Dòng gắn dashboard luôn lấy workspace của dashboard đó (client cũ không gửi workspace_id, và không được tự đặt khác đi).
create function public.notify_set_workspace() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.dashboard_id is not null then
    select workspace_id into new.workspace_id from public.dashboards where id = new.dashboard_id;
    if new.workspace_id is null then raise exception 'dashboard không tồn tại'; end if;
  end if;
  return new;
end $$;
revoke all on function public.notify_set_workspace() from public, anon, authenticated;

create trigger report_subscriptions_set_ws before insert on public.report_subscriptions
  for each row execute function public.notify_set_workspace();
create trigger alert_rules_set_ws before insert on public.alert_rules
  for each row execute function public.notify_set_workspace();

-- ---------------------------------------------------------------------------------------------
-- 2. Quyền cho dòng của cửa hàng (dashboard_id is null). Các policy cũ (theo dashboard_role) không đổi; policy được cộng (OR).
create policy rs_ws_select on public.report_subscriptions for select using (
  dashboard_id is null and (
    public.can_edit(workspace_id)
    or (created_by = auth.uid() and recipient_email = public.my_email() and public.is_member(workspace_id))
  )
);
create policy rs_ws_insert on public.report_subscriptions for insert with check (
  dashboard_id is null and created_by = auth.uid() and (
    public.can_edit(workspace_id)
    or (recipient_email = public.my_email() and public.is_member(workspace_id))
  )
);
create policy rs_ws_update on public.report_subscriptions for update using (
  dashboard_id is null and (
    public.can_edit(workspace_id)
    or (created_by = auth.uid() and recipient_email = public.my_email() and public.is_member(workspace_id))
  )
) with check (
  dashboard_id is null and (
    public.can_edit(workspace_id)
    or (created_by = auth.uid() and recipient_email = public.my_email() and public.is_member(workspace_id))
  )
);
create policy rs_ws_delete on public.report_subscriptions for delete using (
  dashboard_id is null and (
    public.can_edit(workspace_id)
    or (created_by = auth.uid() and recipient_email = public.my_email() and public.is_member(workspace_id))
  )
);

create policy al_ws_select on public.alert_rules for select using (
  dashboard_id is null and (
    public.can_edit(workspace_id)
    or (created_by = auth.uid() and public.is_member(workspace_id))
  )
);
create policy al_ws_insert on public.alert_rules for insert with check (
  dashboard_id is null and created_by = auth.uid() and public.is_member(workspace_id)
);
create policy al_ws_update on public.alert_rules for update using (
  dashboard_id is null and (
    public.can_edit(workspace_id)
    or (created_by = auth.uid() and public.is_member(workspace_id))
  )
) with check (
  dashboard_id is null and (
    public.can_edit(workspace_id)
    or (created_by = auth.uid() and public.is_member(workspace_id))
  )
);
create policy al_ws_delete on public.alert_rules for delete using (
  dashboard_id is null and (
    public.can_edit(workspace_id)
    or (created_by = auth.uid() and public.is_member(workspace_id))
  )
);

-- Cột workspace_id được đặt lúc tạo (không sửa sau đó).
grant insert (workspace_id) on public.report_subscriptions to authenticated;
grant insert (workspace_id) on public.alert_rules to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Nhật ký gửi: thêm workspace_id để đếm hạn mức email của luật/báo cáo không gắn dashboard.
alter table public.notification_log add column workspace_id uuid;
create index notification_log_ws_idx on public.notification_log (workspace_id, created_at desc);

create or replace function public.mails_sent_since(p_workspace uuid, p_since timestamptz)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.notification_log l
    left join public.dashboards d on d.id = l.dashboard_id
   where l.status = 'sent' and l.created_at >= p_since
     and (l.workspace_id = p_workspace or d.workspace_id = p_workspace)
$$;
