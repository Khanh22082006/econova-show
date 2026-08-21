# 🏆 Econova Show - Nền Tảng Gameshow Tương Tác Trực Tuyến Thời Gian Thực

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

**Econova Show** là hệ thống phần mềm điều khiển và trình chiếu Gameshow tương tác thời gian thực (Real-time Game Show Platform) lấy cảm hứng từ chương trình *Đường Lên Đỉnh Olympia*, tích hợp đồ họa trình chiếu sân khấu (Stage Screen), đồ họa Livestream trong suốt (OBS Overlay), bảng điều khiển quản trị (Admin Panel) và giao diện điện thoại cho thí sinh (Contestant Buzzer & Input).

---

## 🌟 Tính Năng Nổi Bật

- ⚡ **Độ trễ cực thấp (Sub-50ms Realtime Sockets):** Đồng bộ hóa tức thời mọi thao tác chọn câu hỏi, bấm chuông, khóa gói điểm, đếm ngược và chấm điểm.
- 📱 **Giao diện Thí sinh Mobile-First:** Thí sinh chỉ cần quét mã QR trên màn hình lớn để tham gia thi trực tiếp trên điện thoại di động mà không cần cài đặt ứng dụng.
- 🎬 **Hỗ trợ OBS Studio / vMix 60FPS:** Đồ họa Overlay trong suốt chuẩn truyền hình (Chế độ Cổ Điển, Ascend, V3 Hexagon).
- 🔒 **Chống gian lận (Anti-Cheat Security):** Server tự động loại bỏ đáp án khỏi socket payload gửi về thiết bị thí sinh.
- 🔄 **Tự động lưu trạng thái (State Persistence):** Điểm số và lượt thi được lưu định kỳ mỗi 2 giây, không lo mất dữ liệu khi mất mạng hoặc sự cố trình duyệt.
- 🌐 **Triển khai Web 1-Click:** Tương thích 100% với các nền tảng Cloud hiện đại (Render, Railway, Fly.io, Docker, VPS).

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Cục Bộ (Local)

### Yêu cầu:
- [Node.js](https://nodejs.org) phiên bản `>= 18.0.0`
- [Git](https://git-scm.com) & [Git LFS](https://git-lfs.com)

### Các bước:
```bash
# 1. Cài đặt các gói phụ thuộc
npm install

# 2. Khởi chạy máy chủ
npm start

# 3. Chế độ phát triển (Tự động tải lại khi sửa code)
npm run dev
```

Sau khi chạy, mở trình duyệt và truy cập:
- **Trang chủ / Thí sinh:** `http://localhost:39281/`
- **Quản trị viên / MC:** `http://localhost:39281/admin.html`
- **Màn hình Sân khấu:** `http://localhost:39281/screen.html?pass=obs_screen`
- **Đồ họa OBS Overlay:** `http://localhost:39281/overlay.html?pass=obs_overlay`
- **Bảng điểm trực tiếp:** `http://localhost:39281/scoreboard.html?pass=obs_scoreboard`

---

## 📖 Hướng Dẫn Triển Khai Web Chi Tiết

Xem cẩm nang hướng dẫn đầy đủ tại:  
👉 [**HUONG_DAN_GITHUB_VA_WEB.md**](./HUONG_DAN_GITHUB_VA_WEB.md)

---

## 📄 Bản Quyền & Giấy Phép
Phát triển bởi đội ngũ **Econova**. Bảo lưu mọi quyền.
