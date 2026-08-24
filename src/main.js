const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { launchServer, killServer, isServerAlive } = require('./server_launcher');

try {
    require('electron-reload')(path.join(__dirname, 'public'), {
        electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
    });
} catch (e) {}

// Ngăn sập app Admin do các lỗi không lường trước từ socket hoặc client crash
process.on('uncaughtException', (err) => {
    console.error('Đã bắt được lỗi không xử lý (uncaughtException):', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Đã bắt được lỗi Promise bị từ chối (unhandledRejection):', reason);
});


let exeName = path.basename(process.execPath).toLowerCase();
const originalExeArg = process.argv.find(arg => arg.startsWith('--original-exe='));
if (originalExeArg) {
    exeName = originalExeArg.split('=')[1].replace(/"/g, '').toLowerCase();
}

let globalRole = 'index';
if (exeName.includes('admin') || exeName.includes('quan tri') || exeName.includes('quản trị')) globalRole = 'admin';
else if (exeName.includes('display') || exeName.includes('chinh') || exeName.includes('chính')) globalRole = 'screen';
else if (exeName.includes('overlay')) globalRole = 'overlay';
else if (exeName.includes('score') || exeName.includes('diem') || exeName.includes('điểm')) globalRole = 'scoreboard';
else if (exeName.includes('team') || exeName.includes('thi sinh') || exeName.includes('thí sinh')) globalRole = 'contestant';
else if (exeName.includes('mc')) globalRole = 'mc';

try {
    let userDataPath = path.join(app.getPath('appData'), 'Econova Show Data', globalRole);
    if (globalRole === 'contestant') {
        userDataPath += '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    }
    app.setPath('userData', userDataPath);
} catch (e) {
    console.error('Failed to set userData path:', e);
}

let mainWindow;

let isAntiCheatEnabled = false;

function createWindow() {
    // Tạo một cửa sổ ứng dụng mới
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        show: false,
        autoHideMenuBar: true, // Ẩn thanh menu trên cùng
        icon: path.join(__dirname, 'public/favicon.ico'), // Tuỳ chọn icon nếu có
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false
        }
    });

    let role = globalRole;
    // Auto-grant permissions (like local-fonts)
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'local-fonts') {
            callback(true);
        } else {
            callback(true);
        }
    });

    // Handle getDisplayMedia requests
    mainWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['window', 'screen'] }).then((sources) => {
            let pptSources = sources.filter(s => 
                s.name.toLowerCase().includes('powerpoint') || 
                s.name.toLowerCase().includes('powerpnt') ||
                s.name.toLowerCase().includes('slide show')
            );
            
            if (pptSources.length === 1) {
                // Auto-connect if exactly one PPT window is found
                callback({ video: pptSources[0] });
            } else if (pptSources.length > 1) {
                // Show picker with PPT windows
                global.mediaPickerCallback = callback;
                mainWindow.webContents.send('show-media-picker', pptSources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() })));
            } else {
                // Show picker with all windows if no PPT found
                global.mediaPickerCallback = callback;
                mainWindow.webContents.send('show-media-picker', sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() })));
            }
        }).catch(err => {
            console.error('getSources error:', err);
            callback();
        });
    });

    // Catch frontend console logs
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[FRONTEND LOG] ${message} (line: ${line}, source: ${sourceId})`);
    });

    // Bắt đầu chạy máy chủ Node.js (Background Process) nếu là Admin hoặc bản gốc
    if (role === 'admin' || role === 'index') {
        launchServer().then((ok) => {
            if (!ok) console.error('[Main] Không thể khởi chạy Server ngầm!');
            if (role === 'index') {
                mainWindow.loadURL('http://localhost:39281/');
            } else {
                mainWindow.loadFile(path.join(__dirname, 'public', 'connect.html'), { query: { role: role } });
            }
        });
    } else {
        mainWindow.loadFile(path.join(__dirname, 'public', 'connect.html'), { query: { role: role } });
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.focus();
    });

    // Lối thoát khẩn cấp: Ctrl + Shift + Q để thoát ngay lập tức
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F11') {
            event.preventDefault();
        }
        if (input.control && input.shift && input.key.toLowerCase() === 'q') {
            console.log('Emergency exit triggered');
            global.isQuitting = true;
            app.quit();
        }
    });

    // Handle full screen leave for anti-cheat
    mainWindow.on('leave-full-screen', () => {
        if (isAntiCheatEnabled && mainWindow && !mainWindow.isDestroyed()) {
            // Force it back to fullscreen immediately if anti-cheat is enabled
            mainWindow.setFullScreen(true);
        }
    });

    // Removed immediate blur reporting to allow the 2.5s grace period in contestant.html to handle it instead

    // Intercept Window Close (Alt+F4, Task Manager close)
    mainWindow.on('close', (e) => {
        if (role === 'admin' && !global.isQuitting) {
            const { dialog } = require('electron');
            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'warning',
                buttons: ['Thoát và Tắt Server', 'Chỉ đóng cửa sổ Admin', 'Huỷ thao tác'],
                title: 'CẢNH BÁO TẮT MÁY CHỦ',
                message: 'Bạn đang đóng ứng dụng Quản trị viên.\n\n• "Thoát và Tắt Server" — Tắt hoàn toàn hệ thống. Tất cả máy MC, Thí sinh sẽ mất kết nối.\n• "Chỉ đóng cửa sổ Admin" — Server ngầm vẫn chạy. MC và Thí sinh không bị ảnh hưởng. Bạn có thể mở lại Admin sau.\n\nDữ liệu đã được tự động lưu ổ cứng.',
                defaultId: 2,
                cancelId: 2
            });
            if (choice === 0) {
                // Thoát & Tắt Server ngầm
                killServer();
                global.isQuitting = true;
            } else if (choice === 1) {
                // Chỉ đóng cửa sổ, Server ngầm vẫn sống
                global.isQuitting = true;
            } else {
                // Huỷ thao tác
                e.preventDefault();
            }
        } else if (isAntiCheatEnabled && !global.isQuitting) {
            e.preventDefault();
            // Removed the force-report-cheat so it just silently blocks Alt+F4
        }
    });

    // Xử lý khi cửa sổ đóng
    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

// IPC: Renderer gọi khi cần cưỡng chế focus lại cửa sổ (sau confirm/alert)
ipcMain.on('focus-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (isAntiCheatEnabled) {
            mainWindow.setKiosk(true);
            mainWindow.setFullScreen(true);
            mainWindow.setAlwaysOnTop(true, "screen-saver");
        } else {
            mainWindow.setAlwaysOnTop(true, "screen-saver");
        }
        mainWindow.show();
        mainWindow.focus();
        if (!isAntiCheatEnabled) {
            mainWindow.setAlwaysOnTop(false);
        }
        
        // Thêm một lần blur/focus để chắc chắn
        setTimeout(() => {
            mainWindow.focus();
            mainWindow.webContents.focus();
            if (isAntiCheatEnabled) {
                mainWindow.setFullScreen(true);
            }
        }, 50);
    }
});

// Handle Media Picker result from renderer
ipcMain.on('media-picker-result', (event, sourceId) => {
    if (global.mediaPickerCallback) {
        if (sourceId) {
            desktopCapturer.getSources({ types: ['window', 'screen'] }).then(sources => {
                const selectedSource = sources.find(s => s.id === sourceId);
                if (selectedSource) {
                    global.mediaPickerCallback({
                        audio: false,
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: selectedSource.id
                            }
                        }
                    });
                } else {
                    global.mediaPickerCallback(null);
                }
            });
        } else {
            global.mediaPickerCallback(null);
        }
        global.mediaPickerCallback = null;
    }
});

// IPC: Anti-Cheat
ipcMain.on('set-anti-cheat', (event, enabled) => {
    isAntiCheatEnabled = enabled;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setClosable(!enabled);
        mainWindow.setContentProtection(enabled);
        if (enabled) {
            mainWindow.setKiosk(true);
            mainWindow.setFullScreen(true);
            mainWindow.setAlwaysOnTop(true, "screen-saver");
        } else {
            mainWindow.setKiosk(false);
            mainWindow.setFullScreen(false);
            mainWindow.setAlwaysOnTop(false);
        }
    }
});

ipcMain.on('force-quit', () => {
    app.exit(0);
});


app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('browser-window-created', (e, window) => {
    window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F5' || (input.control && (input.key === 'r' || input.key === 'R'))) {
            window.reload();
            event.preventDefault();
        }
    });
});

app.on('before-quit', () => {
    global.isQuitting = true;
});

app.on('window-all-closed', function () {
    // Thoát hoàn toàn ứng dụng trên Windows
    if (process.platform !== 'darwin') {
        app.quit();
    }
});


ipcMain.handle('save-match-history', async (event, historyData) => {
    try {
        const historyDir = path.join(app.getPath('userData'), 'matches_history');
        if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
        const sanitizedPin = (historyData.pin || 'match').replace(/[^a-zA-Z0-9_-]/g, '');
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `match_${sanitizedPin}_${dateStr}_${Date.now()}.json`;
        const filePath = path.join(historyDir, fileName);
        fs.writeFileSync(filePath, JSON.stringify(historyData, null, 2), 'utf-8');
        console.log('[Electron] Đã lưu lịch sử trận đấu vào:', filePath);
        return { success: true, filePath };
    } catch(e) {
        console.error('[Electron] Lỗi lưu lịch sử:', e);
        return { success: false, error: e.message };
    }
});
