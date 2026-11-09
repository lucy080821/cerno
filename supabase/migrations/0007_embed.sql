-- Chia sẻ công khai và nhúng dashboard vào website khác (iframe), giới hạn theo tên miền.
--
-- Cài đặt chia sẻ nằm ở BẢNG RIÊNG (không phải cột trong `dashboards`) vì mỗi lần UPDATE `dashboards`,
-- trigger đặt lại `updated_at`, mà editor dùng `updated_at` để phát hiện xung đột khi lưu: bật/tắt chia sẻ
-- không được làm editor đang mở báo "xung đột phiên bản".
-- Cột `dashboards.share_token` cũ (0001) không còn dùng, giữ nguyên để không phá dữ liệu.

create table public.dashboard_shares (
  dashboard_id uuid primary key references public.dashboards(id) on delete cascade,
  -- Mã trong link. Sinh ở server (24 byte ngẫu nhiên, base64url = 32 ký tự); ràng buộc định dạng để không ai tự đặt mã yếu.
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  -- Tên miền được phép nhúng (đã chuẩn hoá ở server: chữ thường, ví dụ 'congty.com', '*.congty.com', 'localhost').
  -- (CHECK không dùng được truy vấn con, nên kiểm tra cả mảng bằng một chuỗi ghép, mỗi mục cách nhau một dấu cách.)
  embed_domains text[] not null default '{}' check (
    cardinality(embed_domains) <= 20 and (
      cardinality(embed_domains) = 0 or (
        length(array_to_string(embed_domains, ' ')) <= 5000
        and array_to_string(embed_domains, ' ') ~ '^(\*\.)?[a-z0-9.-]+( (\*\.)?[a-z0-9.-]+)*$'
      )
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_shares enable row level security;

-- Chỉ người có quyền sửa dashboard mới xem/đổi cài đặt chia sẻ. Người xem công khai KHÔNG đọc bảng này trực tiếp:
-- server dùng service role (kèm kiểm tra mã) và middleware gọi hàm embed_domains_for bên dưới.
create policy share_edit on public.dashboard_shares for all
  using (exists (select 1 from public.dashboards d where d.id = dashboard_id and public.can_edit(d.workspace_id)))
  with check (exists (select 1 from public.dashboards d where d.id = dashboard_id and public.can_edit(d.workspace_id)));

-- Middleware (chạy bằng khoá anon) cần biết tên miền nào được nhúng để đặt header CSP `frame-ancestors`.
-- Trả về đúng danh sách tên miền của MỘT mã (null nếu mã không tồn tại), không lộ gì khác.
create function public.embed_domains_for(p_token text) returns text[]
language sql security definer stable set search_path = public as $$
  select embed_domains from public.dashboard_shares where token = p_token;
$$;
revoke all on function public.embed_domains_for(text) from public;
grant execute on function public.embed_domains_for(text) to anon, authenticated;
