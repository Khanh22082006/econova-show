/**
 * server_launcher.js
 * Khởi chạy server.js như một child process độc lập.
 * Nếu Server ngầm đã chạy sẵn (port 39281 đã bị chiếm), sẽ không spawn lại.
 */

const { fork } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 39281;
let serverProcess = null;

/**
 * Kiểm tra xem port có đang được sử dụng hay không.
 * @returns {Promise<boolean>} true nếu Server đang chạy trên port
 */
function isServerAlive() {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${PORT}/ping`, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}

/**
 * Khởi chạy Server ngầm. Nếu đã chạy sẵn thì bỏ qua.
 * @returns {Promise<boolean>} true nếu Server đã sẵn sàng (dù mới spawn hay đã có sẵn)
 */
async function launchServer() {
    // Kiểm tra nếu Server đã chạy sẵn
    const alive = await isServerAlive();
    if (alive) {
        console.log('[Launcher] Server ngầm đã chạy sẵn trên port', PORT);
        return true;
    }

    console.log('[Launcher] Đang khởi chạy Server ngầm...');
    
    const serverPath = path.join(__dirname, 'server.js');
    
    const { app } = require('electron');
    const userDataPath = app ? app.getPath('userData') : __dirname;
    
    serverProcess = fork(serverPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        detached: false, // Giữ liên kết với parent để có thể kill khi cần
        env: { ...process.env, ECONOVA_BACKGROUND_SERVER: '1', ECONOVA_USER_DATA: userDataPath }
    });

    // Pipe stdout/stderr của Server ngầm ra console chính
    if (serverProcess.stdout) {
        serverProcess.stdout.on('data', (data) => {
            process.stdout.write(`[Server] ${data}`);
        });
    }
    if (serverProcess.stderr) {
        serverProcess.stderr.on('data', (data) => {
            process.stderr.write(`[Server ERROR] ${data}`);
        });
    }

    serverProcess.on('error', (err) => {
        console.error('[Launcher] Lỗi khi spawn Server ngầm:', err);
    });

    serverProcess.on('exit', (code, signal) => {
        console.log(`[Launcher] Server ngầm đã thoát (code=${code}, signal=${signal})`);
        serverProcess = null;
    });

    // Chờ Server sẵn sàng (tối đa 15 giây)
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        const ready = await isServerAlive();
        if (ready) {
            console.log('[Launcher] Server ngầm đã sẵn sàng!');
            return true;
        }
    }

    console.error('[Launcher] Server ngầm không phản hồi sau 15 giây!');
    return false;
}

/**
 * Tắt Server ngầm một cách an toàn.
 */
function killServer() {
    if (serverProcess && !serverProcess.killed) {
        console.log('[Launcher] Đang tắt Server ngầm...');
        serverProcess.kill('SIGTERM');
        
        // Nếu sau 3 giây vẫn chưa tắt, force kill
        setTimeout(() => {
            if (serverProcess && !serverProcess.killed) {
                console.log('[Launcher] Force kill Server ngầm...');
                serverProcess.kill('SIGKILL');
            }
        }, 3000);
    }
}

/**
 * Trả về trạng thái Server ngầm.
 */
function getServerProcess() {
    return serverProcess;
}

module.exports = { launchServer, killServer, isServerAlive, getServerProcess };
