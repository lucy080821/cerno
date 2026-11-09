-- Cho phép người dùng tự xóa tài khoản.
-- Xóa một dòng trong auth.users đã tự xóa dây chuyền: workspace của họ → dashboard, nguồn dữ liệu, bản sao dòng dữ liệu,
-- thành viên, quy tắc cảnh báo, thiết bị push, token Google (nhờ `on delete cascade` ở 0001/0002).
-- Còn 3 khóa ngoại không có quy tắc xóa, sẽ chặn việc xóa tài khoản (đặc biệt khi người đó từng sửa dashboard hay
-- tạo nguồn trong workspace của người khác sau này). Sửa lại:

-- Dashboard còn lại sau khi người sửa cuối cùng bị xóa: chỉ bỏ dấu vết "ai sửa".
alter table public.dashboards drop constraint if exists dashboards_updated_by_fkey;
alter table public.dashboards
  add constraint dashboards_updated_by_fkey foreign key (updated_by) references auth.users(id) on delete set null;

-- Nguồn dữ liệu còn lại: chỉ bỏ dấu vết "ai tạo". (Lưu ý: tự cập nhật dùng quyền Google của `created_by`;
-- nguồn không còn created_by sẽ không được tự cập nhật nữa cho tới khi có người kết nối lại.)
alter table public.data_sources drop constraint if exists data_sources_created_by_fkey;
alter table public.data_sources
  add constraint data_sources_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

-- Bình luận của người bị xóa: xóa theo.
alter table public.comments drop constraint if exists comments_author_id_fkey;
alter table public.comments
  add constraint comments_author_id_fkey foreign key (author_id) references auth.users(id) on delete cascade;
