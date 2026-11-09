-- Hạn mức và chi phí của AI trả phí (Anthropic). Groq miễn phí không đi qua bảng này.
--
-- Mục tiêu: một người dùng nhiều không thể ăn hết ngân sách tháng, và tổng chi phí tự dừng khi chạm trần.
-- Chỉ server (service role) đọc/ghi: bật RLS và KHÔNG tạo policy nào, người dùng không đọc được trực tiếp.

create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,                       -- ngày theo giờ Việt Nam
  provider text not null check (provider in ('anthropic')),
  requests int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_micro bigint not null default 0,    -- chi phí, đơn vị micro-USD (1 USD = 1.000.000)
  primary key (user_id, day, provider)
);
create index on public.ai_usage (day);
alter table public.ai_usage enable row level security;

-- Giữ chỗ MỘT lượt AI trả phí: kiểm tra hạn mức rồi tăng bộ đếm, tất cả trong một bước nguyên tử (khoá theo người dùng)
-- để nhiều yêu cầu cùng lúc không cùng lọt qua. Trả về 'ok' hoặc lý do bị từ chối: 'daily' | 'monthly' | 'budget'.
create function public.ai_usage_reserve(p_user uuid, p_daily int, p_monthly int, p_budget_micro bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_month date := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_day_req int;
  v_month_req int;
  v_month_cost bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));

  select coalesce(sum(requests) filter (where day = v_today), 0), coalesce(sum(requests), 0)
    into v_day_req, v_month_req
    from public.ai_usage where user_id = p_user and day >= v_month;
  if v_day_req >= p_daily then return 'daily'; end if;
  if v_month_req >= p_monthly then return 'monthly'; end if;

  select coalesce(sum(cost_micro), 0) into v_month_cost from public.ai_usage where day >= v_month;
  if v_month_cost >= p_budget_micro then return 'budget'; end if;

  insert into public.ai_usage (user_id, day, provider, requests) values (p_user, v_today, 'anthropic', 1)
    on conflict (user_id, day, provider) do update set requests = public.ai_usage.requests + 1;
  return 'ok';
end $$;

-- Ghi số token và chi phí thực tế sau khi gọi xong (cộng dồn vào dòng của hôm nay).
create function public.ai_usage_record(p_user uuid, p_input bigint, p_output bigint, p_cost_micro bigint) returns void
language sql security definer set search_path = public as $$
  insert into public.ai_usage (user_id, day, provider, requests, input_tokens, output_tokens, cost_micro)
  values (p_user, (now() at time zone 'Asia/Ho_Chi_Minh')::date, 'anthropic', 0, p_input, p_output, p_cost_micro)
  on conflict (user_id, day, provider) do update set
    input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    cost_micro = public.ai_usage.cost_micro + excluded.cost_micro;
$$;

-- Tổng quan tháng này cho chủ app (không có trong UI người dùng): chi phí và số lượt.
create function public.ai_usage_month_summary() returns table (requests bigint, cost_micro bigint, users bigint)
language sql security definer stable set search_path = public as $$
  select coalesce(sum(requests), 0), coalesce(sum(cost_micro), 0), count(distinct user_id)
  from public.ai_usage
  where day >= date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')::date
$$;

-- Chỉ service role gọi được (server kiểm tra người dùng rồi mới gọi).
revoke all on function public.ai_usage_reserve(uuid, int, int, bigint), public.ai_usage_record(uuid, bigint, bigint, bigint),
  public.ai_usage_month_summary() from public, anon, authenticated;
grant execute on function public.ai_usage_reserve(uuid, int, int, bigint), public.ai_usage_record(uuid, bigint, bigint, bigint),
  public.ai_usage_month_summary() to service_role;

-- Trả lại một lượt đã giữ chỗ (cuộc gọi thất bại trước khi sinh được gì): không để lỗi hệ thống tốn lượt của người dùng.
create function public.ai_usage_release(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update public.ai_usage set requests = greatest(requests - 1, 0)
  where user_id = p_user and provider = 'anthropic'
    and day = (now() at time zone 'Asia/Ho_Chi_Minh')::date and requests > 0
$$;
revoke all on function public.ai_usage_release(uuid) from public, anon, authenticated;
grant execute on function public.ai_usage_release(uuid) to service_role;
