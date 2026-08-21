# HƯỚNG DẪN KẾT NỐI THÍ SINH TỪ XA - ECONOVA SHOW 2026

Tài liệu này hướng dẫn ban tổ chức cách mở máy chủ ra mạng ngoài (Internet) bằng Ngrok để các thí sinh (dù ở nhà hay hội trường) có thể kết nối vào bằng điện thoại thông qua mã QR cố định.

## BƯỚC 1: KHỞI ĐỘNG MÁY CHỦ TRUNG TÂM
1. Mở thư mục `Econova Show`.
2. Chạy file `START.bat` để bật máy chủ.
3. **Tuyệt đối không được tắt** cửa sổ màu đen này trong suốt quá trình thi.

## BƯỚC 2: MỞ CỔNG NGROK (Tạo Link Public)
1. Mở một cửa sổ dòng lệnh (Command Prompt) mới bằng cách: Nhấn tổ hợp phím `Windows + R`, gõ `cmd` và nhấn Enter.
2. Dán dòng lệnh sau vào bảng đen và nhấn Enter:
   ```cmd
   ngrok http --domain=jawline-collar-truffle.ngrok-free.dev 3000
   ```
3. Giữ nguyên cửa sổ màu đen của Ngrok. Lúc này bạn phải có **2 cửa sổ màu đen chạy song song**.
*(Lưu ý: Nếu máy tính bị Sleep (ngủ đông) hoặc mất mạng, đường truyền sẽ bị ngắt làm thí sinh văng ra ngoài. Hãy cài đặt máy tính ở chế độ "Never Sleep").*

## BƯỚC 3: THÍ SINH KẾT NỐI BẰNG ĐIỆN THOẠI
1. Ban tổ chức chiếu Mã QR (Mã QR này được tạo từ link `https://jawline-collar-truffle.ngrok-free.dev`) lên màn hình lớn.
2. Yêu cầu tất cả thí sinh dùng điện thoại quét Mã QR.
3. **CỰC KỲ QUAN TRỌNG:** Lần đầu tiên truy cập, màn hình điện thoại sẽ hiện ra một trang cảnh báo miễn phí bằng tiếng Anh của Ngrok. MC phải nhắc thí sinh **bấm vào nút "Visit Site"** (màu xanh) để xác nhận.
4. Sau khi bấm, trang Cổng Thông Tin sẽ hiện ra. Thí sinh chọn "Vào Phòng Thi", nhập mã PIN (do BTC cung cấp) và tham gia.

---

## 🛠 DÀNH RIÊNG CHO KỸ THUẬT VIÊN (OBS / MÀN HÌNH LỚN)
Máy tính kỹ thuật (chính là máy đang chạy START.bat) **KHÔNG CẦN** và **KHÔNG NÊN** dùng link Ngrok để tránh giật lag.

Trong phần mềm OBS, hãy sử dụng các đường link nội bộ (localhost) sau để chèn vào Browser Source. Chữ `?pass=econo2` ở cuối giúp OBS tự động vượt qua lớp mật khẩu bảo vệ:
- **Bảng Điểm:** `http://localhost:3000/scoreboard.html?pass=econo2`
- **Màn Hình Đồ Họa:** `http://localhost:3000/screen.html?pass=econo2`
- **Overlay:** `http://localhost:3000/overlay.html?pass=econo2`
- **Khu vực Quản Trị (Mở bằng Chrome/Edge):** `http://localhost:3000/admin.html` (Mật khẩu: `econo2`)
