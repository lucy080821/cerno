-- Trang "Hỏi AI": cuộc trò chuyện và lịch sử tin nhắn của từng người dùng. Chạy SAU 0022.
-- Mỗi cuộc trò chuyện thuộc MỘT người dùng và một workspace, nhớ các nguồn dữ liệu đã chọn (source_ids = data_sources.id). Chỉ chính
-- người đó đọc/ghi được (RLS theo user_id); thành viên khác của workspace KHÔNG thấy. Xoá workspace hoặc tài khoản thì xoá theo.
-- Nội dung tin nhắn chỉ là chữ hỏi/đáp (không lưu kết quả truy vấn thô); xoá cuộc trò chuyện là xoá hết tin nhắn.
create table if not exists public.ai_chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Cuộc trò chuyện mới' check (length(btrim(title)) between 1 and 200),
  source_ids uuid[] not null default '{}' check (cardinality(source_ids) <= 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.ai_chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 30000),
  -- Ghi chú về lượt trả lời: nhà cung cấp AI, các công cụ đã dùng, nguồn dữ liệu...
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_chats_user_updated on public.ai_chats (user_id, updated_at desc);
create index if not exists ai_messages_chat_created on public.ai_messages (chat_id, created_at);

alter table public.ai_chats enable row level security;
alter table public.ai_messages enable row level security;

create policy ai_chats_select on public.ai_chats for select using (user_id = auth.uid());
create policy ai_chats_insert on public.ai_chats for insert with check (user_id = auth.uid() and public.is_member(workspace_id));
create policy ai_chats_update on public.ai_chats for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_chats_delete on public.ai_chats for delete using (user_id = auth.uid());

create policy ai_messages_select on public.ai_messages for select
  using (exists (select 1 from public.ai_chats c where c.id = chat_id and c.user_id = auth.uid()));
create policy ai_messages_insert on public.ai_messages for insert
  with check (exists (select 1 from public.ai_chats c where c.id = chat_id and c.user_id = auth.uid()));
create policy ai_messages_delete on public.ai_messages for delete
  using (exists (select 1 from public.ai_chats c where c.id = chat_id and c.user_id = auth.uid()));

-- Giới hạn: 200 cuộc trò chuyện mỗi người, 400 tin nhắn mỗi cuộc (tránh phình bảng).
create or replace function public.limit_ai_chats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.ai_chats where user_id = new.user_id) >= 200 then
    raise exception 'Đã đạt giới hạn 200 cuộc trò chuyện, hãy xoá bớt cuộc cũ';
  end if;
  return new;
end $$;
revoke execute on function public.limit_ai_chats() from public, anon, authenticated;
drop trigger if exists ai_chats_limit on public.ai_chats;
create trigger ai_chats_limit before insert on public.ai_chats for each row execute function public.limit_ai_chats();

create or replace function public.limit_ai_messages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.ai_messages where chat_id = new.chat_id) >= 400 then
    raise exception 'Cuộc trò chuyện đã quá dài, hãy bắt đầu cuộc mới';
  end if;
  return new;
end $$;
revoke execute on function public.limit_ai_messages() from public, anon, authenticated;
drop trigger if exists ai_messages_limit on public.ai_messages;
create trigger ai_messages_limit before insert on public.ai_messages for each row execute function public.limit_ai_messages();
