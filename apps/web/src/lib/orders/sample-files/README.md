# File mẫu MÔ PHỎNG

Hai file `.xlsx` ở đây do **người viết dựng theo trí nhớ** về định dạng file xuất của Shopee và TikTok Shop. **Không phải file thật của sàn.**
Tên cột, thứ tự cột, hàng mô tả ở dưới tiêu đề của TikTok Shop và tỷ lệ phí (6%, 4%, 4,91%) đều chưa đối chiếu với file thật.

- Dữ liệu hoàn toàn giả: tên người mua, số điện thoại, địa chỉ là chuỗi mẫu. Cột thông tin người mua có mặt để test khẳng định chúng không bao giờ lọt vào kết quả.
- Dùng để kiểm thử logic không phụ thuộc tên cột (đơn nhiều dòng, phí cấp đơn lặp ở mọi dòng, đơn hủy/hoàn, giờ 12 tiếng) và tính ổn định khi nhận diện.
- `generate.py` tạo lại hai file (cần `openpyxl`, chạy `python3 -I generate.py`; hạt giống ngẫu nhiên cố định nên ra cùng nội dung).
- **Khi có file thật của sàn** (đã bỏ cột người mua), thêm vào đây cạnh file mô phỏng, sửa `profiles.ts` nếu tên cột khác, rồi cập nhật test.
