-- Đọc một đoạn dòng của một nguồn trong MỘT lần gọi (trả về mảng jsonb), để server nạp nguồn lớn (tới ~200.000 dòng)
-- vào bộ nhớ nhanh. PostgREST giới hạn 1000 dòng mỗi truy vấn thường, nhưng hàm này trả về đúng 1 giá trị jsonb nên không bị cắt.
--
-- CHỈ service role gọi được: không có kiểm tra quyền bên trong, việc xác thực người dùng/mã chia sẻ làm ở server
-- trước khi gọi (xem lib/server/row-cache.ts).
create function public.source_rows_chunk(p_source uuid, p_from int, p_to int) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(data order by row_index), '[]'::jsonb)
  from public.source_rows
  where source_id = p_source and row_index >= p_from and row_index < p_to
$$;
revoke all on function public.source_rows_chunk(uuid, int, int) from public, anon, authenticated;
grant execute on function public.source_rows_chunk(uuid, int, int) to service_role;
