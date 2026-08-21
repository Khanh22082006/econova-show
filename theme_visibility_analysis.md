# Phân tích nguyên nhân lỗi đồ hoạ ở Theme 1 và Theme 3

Dưới đây là báo cáo phân tích chi tiết nguyên nhân vì sao toàn bộ đồ hoạ của **Theme 1 (Cổ điển / Default)** và **Theme 3 (Hiệu ứng Bay Lượn / V3)** không hiển thị được trên màn hình chính (`screen.html`) và màn hình overlay (`overlay.html`).

---

## 1. Nguyên nhân ở Theme 1 (Default / Cổ điển)

### Lỗi 1.1: Bảng điểm (Scoreboard) bị khóa hiển thị trên Overlay
* **Tệp tin:** [overlay.html](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/overlay.html#L582)
* **Chi tiết:** Thẻ HTML của default scoreboard được viết cứng thuộc tính `!important` trong inline style:
  ```html
  <div class="scoreboard-area default-only" id="defaultScoreboard" style="display: none !important;"></div>
  ```
  Khi hàm `applyVisibilityOld()` trong JavaScript chạy và cố gắng cập nhật hiển thị:
  ```javascript
  defScoreboard.style.display = currentTheme === 'ascend_2026' ? 'none' : 'grid';
  ```
  Giá trị `'grid'` gán qua thuộc tính `style.display` thông thường **không thể** ghi đè được quy tắc `none !important` viết trực tiếp trong HTML. Do đó, bảng điểm của Theme 1 luôn bị ẩn.

### Lỗi 1.2: Khung câu hỏi (Question Box) bị sai ID trên Overlay
* **Tệp tin:** [overlay.html](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/overlay.html#L1031)
* **Chi tiết:** Trong hàm `applyVisibilityOld()`, khung câu hỏi được lấy ra bằng ID `'qBox'`:
  ```javascript
  const qBoxNode = document.getElementById('qBox');
  ```
  Tuy nhiên, trong phần body HTML của `overlay.html` (dòng 525), ID thực tế đã bị đổi thành `'qBoxoverlay-mode'`:
  ```html
  <div class="center-box graphics-wrapper" id="qBoxoverlay-mode">
  ```
  Vì vậy, biến `qBoxNode` luôn bằng `null`, dẫn đến lệnh `qBoxNode.style.display = 'flex'` không bao giờ được thực thi. Khung câu hỏi của Theme 1 hoàn toàn biến mất trên màn hình Overlay.

---

## 2. Nguyên nhân ở Theme 3 (V3 / Hiệu ứng Bay Lượn)

### Lỗi 2.1: Lỗi bất đồng bộ (Race Condition) làm mất dữ liệu cập nhật đầu tiên trên Screen
* **Tệp tin:** [screen.html](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/screen.html#L1774)
* **Chi tiết:** 
  * Trình duyệt kết nối Socket.io ngay lập tức và nhận sự kiện `updateState` đầu tiên từ server.
  * Tuy nhiên, khối mã xử lý vẽ đồ hoạ V3 nằm trong sự kiện trì hoãn `DOMContentLoaded`:
    ```javascript
    document.addEventListener('DOMContentLoaded', () => {
        // ... đăng ký socket.on('updateState') ở đây ...
    });
    ```
  * Khi sự kiện `updateState` ban đầu được kích hoạt, khối mã V3 **chưa được đăng ký lắng nghe**, do đó nó bỏ lỡ gói tin khởi tạo trạng thái game. 
  * Biến trạng thái cục bộ `lastV3State` vẫn bằng `null` và hàm `renderV3()` không bao giờ được gọi. Kết quả là giao diện V3 luôn ở trạng thái mặc định ẩn (`display: none`).

### Lỗi 2.2: Lỗi ghi đè trạng thái hiển thị của Theme 1 đè lên V3 trên Screen
* **Tệp tin:** [screen.html](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/screen.html#L1363)
* **Chi tiết:** Hàm `applyVisibility` (ở listener thứ nhất của socket) chạy trước và không có điều kiện thoát sớm nếu theme là V3. Do đó, khi theme là V3, nó vẫn tự động chạy nhánh `else` (không phải `ascend_2026`) và bật hiển thị của bảng điểm cổ điển (`defScoreboard.style.display = 'flex'`). Điều này làm giao diện cổ điển xuất hiện đè lên hoặc gây xung đột vị trí với V3.

### Lỗi 2.3: Sai lệch ID phần tử trong điều phối Shutter Transition trên Overlay
* **Tệp tin:** [overlay.html](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/overlay.html#L1224-L1227)
* **Chi tiết:** Khi chuyển cảnh sang câu hỏi mới, hàm chuyển cảnh sử dụng các ID không tồn tại trong file HTML:
  ```javascript
  const qBoxContainer = document.getElementById('qBoxContainer'); // Thực tế là: v3AnimContainer
  const v3QBox = document.getElementById('v3-qBox');             // Thực tế là: qBoxoverlay-mode
  const v3QGrid = document.getElementById('v3-qGrid');           // Thực tế là: qGridCenterBox
  ```
  Vì toàn bộ các biến trên đều trả về `null`, hiệu ứng mở màn trập (shutter open) không bao giờ diễn ra, khiến khung câu hỏi V3 bị kẹt lại ở trạng thái ẩn.

### Lỗi 2.4: Thiếu chiều cao cơ bản của Khung Trung tâm (.center-box) trong CSS V3
* **Tệp tin:** [v3_anim.css](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/v3_anim.css#L122)
* **Chi tiết:** Trong quy tắc CSS của lớp `.center-box`, thuộc tính chiều cao `height: 100%;` đã bị bỏ quên so với bản backup:
  ```css
  body.v3 .center-box { 
      background: #05164d; 
      clip-path: polygon(...); 
      /* Thiếu: height: 100% */
  }
  ```
  Do các phần tử con bên trong sử dụng absolute positioning, `.center-box` bị sập chiều cao về `0px`, khiến toàn bộ phần đồ hoạ câu hỏi trung tâm bị vô hình hóa.

---

## 3. Giải pháp Khắc phục Đề xuất

1. **Với Theme 1:**
   * Loại bỏ thuộc tính `!important` trong inline style của `#defaultScoreboard` ở [overlay.html](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/overlay.html#L582).
   * Thay thế `document.getElementById('qBox')` thành `document.getElementById('qBoxoverlay-mode')` trong hàm `applyVisibilityOld()` ở [overlay.html](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/overlay.html#L1031).

2. **Với Theme 3:**
   * **Bổ sung tự động kích hoạt:** Ở cuối sự kiện `DOMContentLoaded` trong [screen.html](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/screen.html), thêm kiểm tra nếu `window.currentState` đã tồn tại thì tự động nạp trạng thái đó để tránh race condition:
     ```javascript
     if (window.currentState && window.currentState.settings && window.currentState.settings.theme === 'v3') {
         isEconovaV3 = true;
         v3Wrapper.style.display = 'block';
         renderV3(window.currentState);
     }
     ```
   * **Thoát sớm khi là V3:** Bổ sung `if (currentTheme === 'v3') return;` lên dòng đầu tiên của hàm `applyVisibility()` trong [screen.html](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/screen.html#L1363) để tránh hiện đè giao diện cổ điển.
   * **Sửa lại ID trong transition:** Cập nhật các ID chuẩn xác trong [overlay.html](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/overlay.html#L1224-L1227):
     * `'qBoxContainer'` -> `'v3AnimContainer'`
     * `'v3-qBox'` -> `'qBoxoverlay-mode'`
     * `'v3-qGrid'` -> `'qGridCenterBox'`
   * **Sửa CSS:** Thêm `height: 100%;` vào các lớp định nghĩa `body.v3 .center-box` trong [v3_anim.css](file:///c:/Users/khanh/Videos/Econova%20Show/src/public/v3_anim.css).
