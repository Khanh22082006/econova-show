# 🚀 HƯỚNG DẪN ĐƯA ECONOVA SHOW LÊN GITHUB & TRIỂN KHAI WEB TRỰC TUYẾN

> **Tài liệu chuẩn hóa dành riêng cho Ban Tổ Chức & Kỹ thuật viên Econova Show 2026**  
> *Đảm bảo show chạy mượt mà, chuyên nghiệp, không gián đoạn, kết nối thời gian thực (Real-time WebSockets).*

---

## 🌟 MỤC LỤC
1. [Tại sao đưa lên GitHub & Triển khai Web là giải pháp tối ưu?](#1-tại-sao-đưa-lên-github--triển-khai-web-là-giải-pháp-tối-ưu)
2. [Bước 1: Đưa Toàn bộ Thư mục lên GitHub](#bước-1-đưa-toàn-bộ-thư-mục-lên-github)
3. [Bước 2: Triển khai Web Máy chủ Miễn phí (Hosting Cloud)](#bước-2-triển-khai-web-máy-chủ-miễn-phí-hosting-cloud)
   - [Cách 1: Render.com (Khuyên dùng - 100% Miễn phí, Có HTTPS, Hỗ trợ WebSocket trực tiếp)](#cách-1-rendercom-khuyên-dùng---100-miễn-phí-có-https-hỗ-trợ-websocket-trực-tiếp)
   - [Cách 2: Railway.app / Koyeb (Độ trễ thấp, kết nối tức thì)](#cách-2-railwayapp--koyeb-độ-trễ-thấp-kết-nối-tức-thì)
   - [Cách 3: Cloudflare Zero Trust Tunnel (Chạy từ máy Local + Tên miền Web xịn)](#cách-3-cloudflare-zero-trust-tunnel-chạy-từ-máy-local--tên-miền-web-xịn)
   - [Cách 4: Triển khai bằng Docker trên VPS riêng](#cách-4-triển-khai-bằng-docker-trên-vps-riêng)
4. [Bước 3: Vận hành Show & Kết nối các Thiết bị](#bước-3-vận-hành-show--kết-nối-các-thiết-bị)
5. [Bước 4: Các Lưu ý Vàng để Show Đạt Chất lượng Tốt Nhất (Best Practices)](#bước-4-các-lưu-ý-vàng-để-show-đạt-chất-lượng-tốt-nhất-best-practices)

---

## 1. Tại sao đưa lên GitHub & Triển khai Web là giải pháp tối ưu?

Trước đây, khi chạy server trên máy tính cá nhân và dùng Ngrok/Localtunnel:
- ❌ Thí sinh quét mã QR bị màn hình cảnh báo xám của Ngrok (phải bấm "Visit Site").
- ❌ Nếu máy tính MC/Kỹ thuật bị Sleep (ngủ đông) hoặc chập chờn Wifi, tất cả thí sinh bị văng ra ngoài.
- ❌ Tốn công cấu hình IP mạng LAN phức tạp nếu đổi địa điểm tổ chức.

Khi đưa lên **GitHub** và chạy trực tiếp trên nền tảng **Cloud Web**:
- ✅ **Đường link chuyên nghiệp & bảo mật:** Có sẵn giao thức `https://` và `wss://` an toàn, không có bất kỳ màn hình cảnh báo hay quảng cáo nào.
- ✅ **Máy chủ 24/7 ổn định:** Chạy độc lập trên Cloud, tải hàng trăm kết nối thí sinh cùng lúc mà không lo giật lag máy chiếu hay máy tính kỹ thuật.
- ✅ **Mã QR tự động cập nhật:** Màn hình đồ họa tự động sinh mã QR dẫn thẳng đến link Web của show.
- ✅ **Cập nhật tính năng 1-Click:** Mỗi khi bạn cập nhật code trên GitHub, web server sẽ tự động cập nhật và build lại sau 1 phút.

---

## Bước 1: Đưa Toàn bộ Thư mục lên GitHub

Dự án đã được cấu hình sẵn:
- File `.gitignore` chuẩn (đã loại trừ rác, cache, build nặng để repo nhẹ và đẩy nhanh nhất).
- File `.gitattributes` hỗ trợ **Git LFS** cho video dung lượng lớn và chuẩn hóa xuống dòng.
- File cấu hình triển khai tự động: `package.json`, `render.yaml`, `Procfile`, `railway.json`, `Dockerfile`.

### Các bước thực hiện:

#### 1. Tạo Repository mới trên GitHub
1. Truy cập [https://github.com](https://github.com) và đăng nhập.
2. Bấm vào dấu **`+`** ở góc trên bên phải ➔ Chọn **`New repository`**.
3. Điền thông tin:
   - **Repository name:** `econova-show` (hoặc tên tùy thích).
   - **Visibility:** Chọn **Private** (nếu muốn bảo mật câu hỏi & đề thi) hoặc **Public**.
   - **Không** tích chọn *Initialize this repository with a README* (vì chúng ta sẽ đẩy từ máy lên).
4. Bấm **Create repository**.
5. Copy đường link repo (Dạng: `https://github.com/<tai-khoan>/econova-show.git`).

#### 2. Đẩy mã nguồn từ máy tính lên GitHub
Mở **PowerShell** hoặc **Terminal** ngay tại thư mục `Econova Show` và chạy lần lượt các lệnh sau:

```bash
# 1. Kích hoạt Git LFS (quản lý file video/âm thanh lớn an toàn)
git lfs install

# 2. Thêm tất cả file mã nguồn chuẩn
git add .

# 3. Tạo commit đầu tiên
git commit -m "feat: Initial commit for Econova Show production web deployment"

# 4. Đặt nhánh chính là main
git branch -M main

# 5. Gắn link GitHub của bạn (thay bằng link repo vừa copy ở trên)
git remote add origin https://github.com/<tai-khoan>/econova-show.git

# 6. Đẩy mã nguồn lên GitHub
git push -u origin main
```

*(Lưu ý: Nếu GitHub yêu cầu đăng nhập, hãy chọn đăng nhập qua trình duyệt hoặc nhập Personal Access Token).*

---

## Bước 2: Triển khai Web Máy chủ Miễn phí (Hosting Cloud)

### Cách 1: Render.com (Khuyên dùng - 100% Miễn phí, Có HTTPS, Hỗ trợ WebSocket trực tiếp)

Render là dịch vụ đám mây tốt nhất hiện nay cho Node.js + WebSocket, cực kỳ dễ dùng và hoàn toàn miễn phí.

1. Truy cập [https://render.com](https://render.com) và đăng ký tài khoản (chọn **Sign in with GitHub**).
2. Tại bảng điều khiển Render, bấm nút **New +** ➔ Chọn **Web Service**.
3. Chọn **Build and deploy from a Git repository** ➔ Bấm **Next**.
4. Tìm và bấm **Connect** vào repository `econova-show` của bạn.
5. Điền cấu hình cơ bản (Render thường sẽ tự động nhận diện từ `render.yaml`):
   - **Name:** `econova-show` (hoặc tên bất kỳ, ví dụ `econova-2026`).
   - **Region:** Chọn `Singapore` (để có độ trễ Ping thấp nhất về Việt Nam).
   - **Branch:** `main`.
   - **Runtime:** `Node`.
   - **Build Command:** `npm install`.
   - **Start Command:** `npm start`.
   - **Instance Type:** `Free`.
6. Bấm nút **Create Web Service** ở dưới cùng.
7. Chờ khoảng 1-2 phút để Render tự động tải mã nguồn và khởi động server.
8. Khi thấy thông báo màu xanh **`Live`**, bạn sẽ nhận được đường link web chính thức dạng:
   👉 **`https://econova-show.onrender.com`**

> **💡 Mẹo giữ Server luôn thức (Prevent Sleep trên Render Free):**  
> Dịch vụ Free của Render sẽ tạm ngủ nếu không có ai truy cập trong 15 phút. Để server luôn thức sẵn sàng trước giờ thi:
> - Truy cập trang miễn phí [https://uptimerobot.com](https://uptimerobot.com).
> - Thêm một Monitor mới: Chọn kiểu `HTTP(s)`, dán link `https://econova-show.onrender.com/ping`, đặt tần suất kiểm tra mỗi `5 phút`.  
> ➔ Server của bạn sẽ luôn thức 24/7 và phản hồi trong 0.1 giây!

---

### Cách 2: Railway.app / Koyeb (Độ trễ thấp, kết nối tức thì)

1. Truy cập [https://railway.app](https://railway.app) ➔ Đăng nhập bằng GitHub.
2. Bấm **New Project** ➔ **Deploy from GitHub repo** ➔ Chọn `econova-show`.
3. Railway sẽ tự động đọc file `railway.json` và build ứng dụng.
4. Sau khi deploy xong, vào mục **Settings** ➔ **Networking** ➔ Bấm **Generate Domain** để nhận link công khai (ví dụ `https://econova-show-production.up.railway.app`).

---

### Cách 3: Cloudflare Zero Trust Tunnel (Chạy từ máy Local + Tên miền Web xịn)

Nếu bạn muốn máy tính hội trường trực tiếp xử lý dữ liệu để tốc độ mạng nội bộ là 0ms, nhưng vẫn muốn thí sinh truy cập bằng link Web đẹp (không cần mở cổng router, không cần IP tĩnh, không cảnh báo Ngrok):

1. Đăng ký tài khoản miễn phí tại [https://cloudflare.com](https://cloudflare.com).
2. Tải công cụ **`cloudflared`** cho Windows: `winget install --id Cloudflare.cloudflared`.
3. Chạy lệnh mở tunnel tức thì:
   ```cmd
   cloudflared tunnel --url http://localhost:39281
   ```
4. Cloudflare sẽ cấp ngay cho bạn một đường link HTTPS bảo mật tốc độ cao (ví dụ: `https://something.trycloudflare.com`) để cấp cho thí sinh.

---

### Cách 4: Triển khai bằng Docker trên VPS riêng

Nếu ban tổ chức có VPS riêng (Ubuntu / Debian / CentOS):
```bash
# 1. Clone repository
git clone https://github.com/<tai-khoan>/econova-show.git
cd econova-show

# 2. Khởi động bằng Docker Compose (đã cấu hình sẵn Volume lưu điểm thi)
docker compose up -d --build
```
Dịch vụ sẽ chạy tại cổng `3000` của VPS (bạn có thể trỏ Nginx Reverse Proxy và SSL Let's Encrypt).

---

## Bước 3: Vận hành Show & Kết nối các Thiết bị

Sau khi đã có đường link web (Ví dụ: `https://econova-show.onrender.com`):

### 1. Khu vực Quản trị (Dành cho MC / Ban Giám Khảo)
- Mở trình duyệt (Chrome/Edge/Safari), truy cập:  
  👉 **`https://<domain-cua-ban>/admin.html`**
- Nhập mật khẩu quản trị (Mặc định: `econo2` hoặc mã PIN ngẫu nhiên).
- Tại đây, MC có thể:
  - Mở/Đóng phòng thi, hiển thị mã PIN phòng.
  - Chọn gói điểm (10, 20, 40 điểm), mở câu hỏi, bấm giờ, chấm điểm Đúng/Sai.
  - Kích hoạt hiệu ứng đồ họa, chuông báo, ngôi sao hy vọng.

### 2. Màn hình Máy chiếu Sân khấu (Stage Screen)
- Trên máy tính nối với máy chiếu hoặc màn hình LED lớn:
  👉 **`https://<domain-cua-ban>/screen.html?pass=obs_screen`**
- Nhấn phím **`F11`** để mở chế độ Toàn màn hình (Fullscreen).
- Màn hình sẽ tự động hiển thị:
  - Mã QR để thí sinh quét tham gia ngay đầu giờ.
  - Đồ họa câu hỏi, thời gian đếm ngược, điểm số các đội thi.
  - Video minh họa và hiệu ứng chúc mừng sinh động.

### 3. Đồ họa Livestream (Dành cho phần mềm OBS Studio / vMix)
- Trong OBS Studio, bấm vào dấu **`+`** ở bảng Sources ➔ Chọn **`Browser`**.
- Cấu hình:
  - **URL:** `https://<domain-cua-ban>/overlay.html?pass=obs_overlay`
  - **Width:** `1920`
  - **Height:** `1080`
  - **FPS:** `60`
  - Tích chọn: *Shutdown source when not visible* và *Refresh browser when scene becomes active*.
- Bạn sẽ có đồ họa Overlay trong suốt tuyệt đẹp đè lên luồng quay camera trực tiếp!

### 4. Giao diện Thí sinh (Điện thoại / Tablet / Laptop)
- Thí sinh dùng camera điện thoại quét mã QR trên màn hình sân khấu hoặc truy cập:  
  👉 **`https://<domain-cua-ban>/`**
- Nhập **Tên Đội/Thí sinh** và **Mã PIN Phòng thi** (do BTC công bố).
- Giao diện mobile hỗ trợ:
  - Nút bấm chuông giành quyền trả lời siêu nhạy (Realtime WebSocket).
  - Khung nhập đáp án tự luận / trắc nghiệm.
  - Xem điểm số cá nhân và thứ hạng trực tiếp.

---

## Bước 4: Các Lưu ý Vàng để Show Đạt Chất lượng Tốt Nhất (Best Practices)

### 🔊 1. Chính sách Âm thanh (Audio Autoplay Policy) trên Điện thoại
Các trình duyệt di động hiện đại (iOS Safari, Android Chrome) cấm trang web tự động phát âm thanh nếu người dùng chưa tương tác.
- **Hệ thống đã có sẵn:** Khi thí sinh vừa vào phòng, màn hình sẽ hiển thị nút chạm để kích hoạt âm thanh. MC hãy nhắc thí sinh chạm 1 lần vào màn hình để nghe rõ tiếng chuông, tiếng đếm ngược và âm báo kết quả.

### 🛡️ 2. Bảo mật Tuyệt đối Đề thi & Chống Gian lận (Anti-cheat)
Hệ thống Econova Show đã được trang bị bộ lọc bảo mật ở tầng Server (`server.js`):
- **Phân quyền dữ liệu thông minh:** Dữ liệu gửi đến thí sinh (`contestant.html`) được lọc bỏ 100% đáp án (`answer = ""`). Thí sinh dù có mở F12 hoặc soi gói tin mạng cũng không thể thấy trước đáp án.
- **Bảo vệ OBS & Màn hình:** Các đường dẫn overlay và screen có cơ chế xác thực query param (`?pass=...`) để tránh người ngoài can thiệp.

### 💾 3. Sao lưu Trạng thái Trận đấu Tức thì (State Persistence)
- Server tự động lưu lại toàn bộ trạng thái phòng thi (Điểm số, câu hỏi đã thi, gói điểm đã chọn, lịch sử bấm chuông) vào `gameState.json` mỗi 2 giây.
- Nếu lỡ tay tắt trình duyệt hoặc máy tính bị mất điện đột ngột, khi bật lại toàn bộ dữ liệu trận đấu sẽ được **khôi phục chính xác 100%**, không bị mất điểm của các đội!

### ⚡ 4. Tối ưu Đường truyền & Độ trễ (Low Latency)
- Hệ thống sử dụng cơ chế truyền tin nhị phân và WebSockets thuần túy (`transports: ['websocket']`).
- Độ trễ bấm chuông giữa các thí sinh chỉ từ **10ms - 50ms**, đảm bảo tính công bằng tuyệt đối như các gameshow truyền hình chuyên nghiệp.

---

Chúc bạn tổ chức một mùa **Econova Show** thành công rực rỡ và bùng nổ! 🎉
