-- Đánh dấu nguồn của ngành hàng tính phí: 'user' = người bán chọn/xác nhận, 'ai' = AI phân ngành hàng loạt (chưa được xác nhận).
-- Ngành AI vẫn được dùng để ước tính phí nhưng giao diện hiện nhãn "AI đoán" cho tới khi người bán xác nhận. CHẠY SAU 0025.
alter table public.product_fee_categories
  add column if not exists source text not null default 'user' check (source in ('user', 'ai'));
