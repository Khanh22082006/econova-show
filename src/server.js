const express = require('express');
const crypto = require('crypto');
function generateVideoFilename(base, ext) {
    return 'v_' + crypto.randomBytes(8).toString('hex') + ext;
}

// Ngăn sập server Quản trị viên nếu có lỗi không mong đợi từ socket/kết nối
process.on('uncaughtException', (err) => {
    console.error('SERVER ĐÃ BẮT ĐƯỢC LỖI UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('SERVER ĐÃ BẮT ĐƯỢC LỖI UNHANDLED REJECTION:', reason);
});

const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const basePath = process.env.ECONOVA_USER_DATA || __dirname;
const pptController = require('./pptController');
const roomManager = require('./roomManager');
const { exec, execSync } = require('child_process');
const chokidar = require('chokidar');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8, // 100 MB
    pingInterval: 10000,
    pingTimeout: 5000
});

// --- ANTI-CHEAT: OVERRIDE IO.EMIT TO SCRUB ANSWERS FROM CONTESTANTS ---
const originalEmit = io.emit;
io.emit = function(event, data, ...args) {
    if (event === 'updateState' && data) {
        // 1. safeState cho Thí sinh (xóa tất cả đáp án + xoá questionBank khổng lồ để tránh nghẽn mạng/giật lag)
        let safeState = JSON.parse(JSON.stringify(data));
        delete safeState.questionBank;
        delete safeState.questions;
        if (safeState.currentQuestion) { safeState.currentQuestion.answer = ""; safeState.currentQuestion.vid = ""; }
        if (safeState.lockedPackage && safeState.lockedPackage.questions) {
            safeState.lockedPackage.questions.forEach(q => {
                delete q.answer;
                delete q.vid;
            });
        }
        if (safeState.pendingPackage && safeState.pendingPackage.questions) {
            safeState.pendingPackage.questions.forEach(q => {
                delete q.answer;
                delete q.vid;
            });
        }

        // 2. mcPayload cho MC (giữ đáp án câu ACTIVE, trạng thái lưới/gói, nhưng xóa các câu chưa mở)
        let mcPayload = JSON.parse(JSON.stringify(data));
        delete mcPayload.questionBank;
        delete mcPayload.questions;

        if (mcPayload.lockedPackage && mcPayload.lockedPackage.questions) {
            mcPayload.lockedPackage.questions.forEach((q, idx) => {
                // Chỉ giữ lại text/answer cho câu đang active
                if (idx !== mcPayload.lockedPackage.currentIndex) {
                    delete q.text;
                    delete q.answer;
                    delete q.vid;
                }
            });
        }
        if (mcPayload.pendingPackage && mcPayload.pendingPackage.questions) {
            mcPayload.pendingPackage.questions.forEach(q => {
                delete q.text;
                delete q.answer;
                delete q.vid;
            });
        }
        
        io.sockets.sockets.forEach(socket => {
            const referer = socket.handshake.headers.referer || '';
            const isFullStateClient = socket.isAdmin 
                || referer.includes('screen')    // Màn hình chính Econova
                || referer.includes('display')   // Màn hình chính Olympia
                || referer.includes('overlay') 
                || referer.includes('scoreboard');
            const isMcClient = socket.isMC || referer.includes('/mc');
            
            if (isFullStateClient) {
                socket.emit(event, data, ...args);
            } else if (isMcClient) {
                socket.emit(event, mcPayload, ...args);
            } else {
                socket.emit(event, safeState, ...args);
            }
        });
        return true;
    }
    return originalEmit.apply(this, [event, data, ...args]);
};
// ----------------------------------------------------------------------

// Middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    next();
});
app.use(express.json({ limit: '50mb' }));
app.post('/log_error', (req, res) => { require('fs').appendFileSync('client_errors.log', JSON.stringify(req.body) + '\n'); res.sendStatus(200); });
// NOTE: express.static is moved AFTER all API routes so /api/* is handled first

// --- MULTI-ROOM REST APIS (HỖ TRỢ TẠO PHÒNG & XÁC THỰC MÃ PIN / PASSWORD) ---
// ============================================================
// ROOM PERSISTENCE: 3-layer approach
//   Layer 1 (local disk)  — works for Railway/VPS with persistent volumes
//   Layer 2 (Upstash Redis) — cloud KV, survives ANY restart on ANY platform
//   Layer 3 (in-memory)   — fast access during runtime (always active)
// Set env vars: UPSTASH_REDIS_URL + UPSTASH_REDIS_TOKEN to enable Layer 2
// ============================================================
const ROOMS_PERSIST_FILE = process.env.ECONOVA_ROOMS_FILE || path.join(basePath, 'rooms_persist.json');
const UPSTASH_URL = process.env.UPSTASH_REDIS_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_TOKEN || '';
const UPSTASH_KEY = 'econova_rooms_v1';

// --- Upstash REST helpers (uses built-in fetch, Node 18+) ---
async function upstashSet(key, value) {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
    try {
        const res = await fetch(`${UPSTASH_URL}/set/${key}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(value)
        });
        const json = await res.json();
        return json.result === 'OK';
    } catch(e) {
        console.error('[Upstash] set error:', e.message);
        return false;
    }
}

async function upstashGet(key) {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
    try {
        const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
        });
        const json = await res.json();
        if (json.result === null || json.result === undefined) return null;
        return typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
    } catch(e) {
        console.error('[Upstash] get error:', e.message);
        return null;
    }
}

// --- Build serializable snapshot of all rooms ---
function buildRoomsSnapshot() {
    const toSave = [];
    roomManager.rooms.forEach((room, pin) => {
        toSave.push({
            pin: room.pin,
            name: room.name,
            password: room.password,
            mcPassword: room.mcPassword,
            theme: room.theme,
            createdAt: room.createdAt,
            gameState: room.gameState
        });
    });
    return toSave;
}

// --- Restore rooms from a snapshot array ---
function restoreRoomsFromSnapshot(data) {
    if (!Array.isArray(data) || data.length === 0) return 0;
    let count = 0;
    data.forEach(r => {
        if (!r.pin || !r.password) {
            console.log(`[RoomPersist] Bỏ qua và tự động gỡ phòng lỗi: PIN ${r ? r.pin : 'N/A'}`);
            return;
        }
        if (!roomManager.rooms.has(r.pin)) {
            roomManager.createRoom({ pin: r.pin, name: r.name, password: r.password, mcPassword: r.mcPassword, theme: r.theme });
        }
        const room = roomManager.getRoom(r.pin);
        if (room) {
            if (r.gameState) {
                room.gameState = r.gameState;
            }
            // Đảm bảo trạng thái phòng luôn mở và gán đúng PIN
            room.gameState.isRoomOpen = true;
            room.gameState.roomPIN = r.pin;
            if (!Array.isArray(room.gameState.turnOrder) || (room.gameState.turnOrder.length === 0 && (!room.gameState.turnStats || Object.keys(room.gameState.turnStats).length === 0))) {
                room.gameState.turnOrder = (room.gameState.teams || []).map(t => t.id);
            }
            count++;
        }
    });
    return count;
}

// Layer 1: Save to local disk
function saveRoomsToDisk() {
    try {
        fs.writeFileSync(ROOMS_PERSIST_FILE, JSON.stringify(buildRoomsSnapshot(), null, 2), 'utf8');
    } catch(e) {
        console.error('[RoomPersist/Disk] Lỗi lưu phòng:', e.message);
    }
}

// Layer 1: Load from local disk
function loadRoomsFromDisk() {
    try {
        if (fs.existsSync(ROOMS_PERSIST_FILE)) {
            const data = JSON.parse(fs.readFileSync(ROOMS_PERSIST_FILE, 'utf8'));
            const n = restoreRoomsFromSnapshot(data);
            if (n > 0) console.log(`[RoomPersist/Disk] Khôi phục ${n} phòng từ disk`);
        }
    } catch(e) {
        console.error('[RoomPersist/Disk] Lỗi đọc phòng:', e.message);
    }
}

// Layer 2: Save to Upstash Redis cloud
async function saveRoomsToCloud() {
    if (!UPSTASH_URL) return;
    const snapshot = buildRoomsSnapshot();
    const ok = await upstashSet(UPSTASH_KEY, JSON.stringify(snapshot));
    if (ok) console.log(`[RoomPersist/Cloud] Đã lưu ${snapshot.length} phòng lên Upstash Redis`);
}

// Layer 2: Load from Upstash Redis cloud
async function loadRoomsFromCloud() {
    if (!UPSTASH_URL) return false;
    try {
        const data = await upstashGet(UPSTASH_KEY);
        if (!data) return false;
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        const n = restoreRoomsFromSnapshot(parsed);
        if (n > 0) console.log(`[RoomPersist/Cloud] Khôi phục ${n} phòng từ Upstash Redis`);
        return n > 0;
    } catch(e) {
        console.error('[RoomPersist/Cloud] Lỗi khôi phục:', e.message);
        return false;
    }
}

// Full save: disk + cloud
async function saveRooms() {
    try {
        saveRoomsToDisk();
        await saveRoomsToCloud();
    } catch(e) {
        console.error('[RoomPersist] saveRooms error:', e.message);
    }
}

let saveRoomsTimer = null;
function scheduleSaveRooms(delayMs = 2000) {
    if (saveRoomsTimer) clearTimeout(saveRoomsTimer);
    saveRoomsTimer = setTimeout(() => {
        saveRoomsTimer = null;
        saveRooms().catch(e => console.error('[RoomPersist] Scheduled save error:', e));
    }, delayMs);
}

// Full load on startup: try cloud first, then disk as fallback
async function loadRoomsOnStartup() {
    const cloudOk = await loadRoomsFromCloud();
    if (!cloudOk) {
        loadRoomsFromDisk();
    }
    // Auto-save gameState to cloud every 2 minutes
    setInterval(saveRooms, 2 * 60 * 1000);
    console.log('[RoomPersist] Auto-save mỗi 2 phút đã bật');
}

// Fire and forget — don't block server startup
loadRoomsOnStartup().catch(e => console.error('[RoomPersist] Startup error:', e));

// ===================================================================
// TỰ ĐỘNG GIẢI PHÓNG PHÒNG KHÔNG HOẠT ĐỘNG SAU 3 PHÚT
// Điều kiện: không có client nào đang kết nối VÀ admin không ở trong phòng
// Kiểm tra mỗi 60 giây
// ===================================================================
const ROOM_IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 phút

setInterval(() => {
    const now = Date.now();
    const toDelete = [];

    roomManager.rooms.forEach((room, pin) => {
        // Đếm số socket đang thực sự kết nối tới phòng này
        const roomSocketSet = io.sockets.adapter.rooms.get(pin);
        const connectedCount = roomSocketSet ? roomSocketSet.size : 0;

        // Nếu có client online → bỏ qua, cập nhật lastActive
        if (connectedCount > 0) {
            room.lastActive = now;
            return;
        }

        // Không có ai → kiểm tra thời gian không hoạt động
        const idleMs = now - (room.lastActive || room.createdAt || now);
        if (idleMs >= ROOM_IDLE_TIMEOUT_MS) {
            toDelete.push(pin);
        }
    });

    if (toDelete.length > 0) {
        toDelete.forEach(pin => {
            console.log(`[RoomIdle] Tự động gỡ phòng ${pin} (không hoạt động ${Math.round(ROOM_IDLE_TIMEOUT_MS / 60000)} phút)`);
            io.to(pin).emit('roomClosed', { message: 'Phòng thi đã tự động đóng do không có hoạt động trong 3 phút.' });
            roomManager.deleteRoom(pin);
        });
        saveRooms().catch(e => console.error('[RoomIdle] Save after cleanup error:', e));
    }
}, 60 * 1000); // Kiểm tra mỗi 60 giây


app.post('/api/room/delete', (req, res) => {
    try {
        const { pin, password } = req.body || {};
        const auth = roomManager.verifyAdmin(pin, password);
        if (!auth.success && password !== process.env.MASTER_ADMIN_PASSWORD && password !== 'superadmin') {
            return res.status(403).json({ success: false, message: "Không có quyền gỡ phòng này!" });
        }
        const ok = roomManager.deleteRoom(pin);
        scheduleSaveRooms(2000);
        io.to(pin).emit('roomClosed', { message: 'Phòng thi này đã được gỡ bỏ.' });
        res.json({ success: true, message: `Đã gỡ phòng ${pin} thành công!` });
    } catch(e) {
        res.status(500).json({ success: false, message: "Lỗi máy chủ khi gỡ phòng!" });
    }
});

app.post('/api/room/create', (req, res) => {
    try {
        const { name, pin, password, mcPassword, theme, questions, teamCount, teams } = req.body || {};
        const newRoom = roomManager.createRoom({ name, pin, password, mcPassword, theme, questions, teamCount, teams });
        if (newRoom.error) {
            return res.status(400).json({ success: false, message: newRoom.message });
        }
        // Persist immediately: disk + cloud (async, non-blocking)
        scheduleSaveRooms(2000);
        res.json({
            success: true,
            message: "Tạo phòng thi đấu thành công!",
            room: {
                pin: newRoom.pin,
                name: newRoom.name,
                theme: newRoom.theme,
                createdAt: newRoom.createdAt
            }
        });
    } catch (err) {
        console.error('Lỗi khi tạo phòng:', err);
        res.status(500).json({ success: false, message: "Lỗi máy chủ khi tạo phòng!" });
    }
});


// Liveness probe — keeps Render from sleeping AND forces room reload if needed
app.get('/api/ping', async (req, res) => {
    const roomCount = roomManager.rooms ? roomManager.rooms.size : 0;
    if (roomCount === 0) {
        // No rooms in memory — try to restore from cloud
        try {
            await loadRoomsFromCloud();
        } catch(e) {}
    }
    res.json({ ok: true, rooms: roomCount, ts: Date.now() });
});
app.get('/api/room/list', (req, res) => {
    res.json({ success: true, rooms: roomManager.listPublicRooms() });
});

app.post('/api/room/verify_admin', (req, res) => {
    const { pin, password } = req.body || {};
    const result = roomManager.verifyAdmin(pin, password);
    res.json(result);
});

app.post('/api/room/verify_mc', (req, res) => {
    const { pin, password } = req.body || {};
    const result = roomManager.verifyMC(pin, password);
    res.json(result);
});

app.post('/api/room/verify_contestant', (req, res) => {
    const { pin } = req.body || {};
    const result = roomManager.verifyContestant(pin);
    res.json(result);
});

// Instant HTTP pre-fetch for contestant page (loads teams before WebSocket connects)
app.get('/api/room/state', async (req, res) => {
    const pin = (req.query.pin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
    let room = roomManager.getRoom(pin);
    if (!room) {
        try {
            await loadRoomsFromCloud();
            room = roomManager.getRoom(pin);
            if (room) console.log('[RoomState] Room', pin, 'restored from cloud on HTTP fetch');
        } catch(e) {
            console.error('[RoomState] Cloud reload error:', e.message);
        }
    }
    if (!room) {
        return res.status(404).json({ success: false, message: 'Phòng không tồn tại hoặc đã bị gỡ. Vui lòng liên hệ Admin tạo lại phòng.' });
    }
    let safeState = JSON.parse(JSON.stringify(room.gameState));
    delete safeState.questionBank;
    delete safeState.questions;
    if (safeState.currentQuestion) { safeState.currentQuestion.answer = ""; safeState.currentQuestion.vid = ""; }
    if (safeState.lockedPackage && safeState.lockedPackage.questions) {
        safeState.lockedPackage.questions.forEach(q => { delete q.answer; delete q.vid; });
    }
    if (safeState.pendingPackage && safeState.pendingPackage.questions) {
        safeState.pendingPackage.questions.forEach(q => { delete q.answer; delete q.vid; });
    }
    res.json({ success: true, room: { pin: room.pin, name: room.name, theme: room.theme }, gameState: safeState });
});

// HTTP Buzzer Fallback: Cho phép thí sinh bấm chuông qua HTTP POST nếu Socket gián đoạn
app.post('/api/room/buzz', async (req, res) => {
    try {
        const { pin, teamId, token, clientId } = req.body || {};
        const normalizedPin = (pin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
        const room = roomManager.getRoom(normalizedPin);
        if (!room || !room.gameState) {
            return res.status(404).json({ success: false, message: 'Phòng không tồn tại' });
        }
        const state = room.gameState;
        const tid = parseInt(teamId);
        if (isNaN(tid)) return res.json({ success: false, message: 'TeamId không hợp lệ' });

        if (state.currentQuestion && state.currentQuestion.active && state.currentQuestion.mainTeamId != null && Number(state.currentQuestion.mainTeamId) === Number(tid)) {
            return res.json({ success: false, message: 'Đội chính không thể bấm chuông' });
        }

        let isNewBuzz = false;
        if (state.buzzerUnlockTime && state.buzzTimes && typeof state.buzzTimes[tid] !== 'number') {
            let elapsed = Date.now() - state.buzzerUnlockTime;
            if (elapsed <= 5000) {
                state.buzzTimes[tid] = elapsed;
                isNewBuzz = true;
            }
        }

        if (!state.isBuzzerLocked && state.buzzedTeam === null && !state.pendingBuzzerTeam) {
            playSoundInRoom(null, 'buzzed', normalizedPin);
            
            let delay = state.settings && state.settings.buzzerDelayMs !== undefined ? state.settings.buzzerDelayMs : 500;
            if (delay > 0) {
                state.pendingBuzzerTeam = tid;
                setRoomBuzzerDelayTimer(normalizedPin, setTimeout(() => {
                    if (state.pendingBuzzerTeam === tid) {
                        state.buzzedTeam = tid;
                        state.pendingBuzzerTeam = null;
                        const buzzedPayload = {
                            buzzedTeam: tid,
                            buzzTimes: state.buzzTimes,
                            pin: normalizedPin
                        };
                        io.to(normalizedPin).emit('buzzed', buzzedPayload);
                        io.sockets.sockets.forEach(s => {
                            if (s.currentRoomPin === normalizedPin) s.emit('buzzed', buzzedPayload);
                        });
                        broadcastState(null, 'updateState', state);
                    }
                }, delay));
            } else {
                state.buzzedTeam = tid;
                const buzzedPayload = {
                    buzzedTeam: tid,
                    buzzTimes: state.buzzTimes,
                    pin: normalizedPin
                };
                io.to(normalizedPin).emit('buzzed', buzzedPayload);
                io.sockets.sockets.forEach(s => {
                    if (s.currentRoomPin === normalizedPin) s.emit('buzzed', buzzedPayload);
                });
                broadcastState(null, 'updateState', state);
            }
            res.json({ success: true, buzzedTeam: null, timeMs: state.buzzTimes[tid] });
        } else if (isNewBuzz) {
            broadcastState(null, 'updateState', state);
            res.json({ success: true, buzzedTeam: null, timeMs: state.buzzTimes[tid] });
        } else {
            res.json({ success: false, message: 'Chuông đang khóa hoặc đã có đội bấm', buzzedTeam: state.buzzedTeam });
        }
    } catch(err) {
        console.error('Lỗi khi xử lý HTTP buzz:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Static file serving AFTER all API routes (so /api/* requests reach handlers first)
const staticOptions = {
    setHeaders: (res, path) => {
        if (path.endsWith('.html') || path.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
};
app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/public_v2', express.static(path.join(__dirname, 'public_v2'), staticOptions));

app.use('/Themes', express.static(path.join(basePath, 'Themes')));
const thumbsDir = path.join(os.tmpdir(), 'econova_ppt_thumbs');
if (!fs.existsSync(thumbsDir)) {
    fs.mkdirSync(thumbsDir, { recursive: true });
}
app.use('/temp_thumbs', express.static(thumbsDir));
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));
app.use('/questions', express.static(path.join(basePath, 'questions')));
app.get('/ping', (req, res) => res.send('ok'));

function verifyAdminHeader(req) {
    const pin = req.headers['x-admin-pin'];
    const roomPin = req.headers['x-room-pin'];
    
    if (pin === ADMIN_PIN || pin === process.env.MASTER_ADMIN_PASSWORD || pin === 'superadmin') return true;
    
    if (roomPin && pin) {
        if (roomManager.rooms && roomManager.rooms.has(roomPin)) {
            const verified = roomManager.verifyAdmin(roomPin, pin);
            if (verified && verified.success) return true;
        }
    }
    return false;
}
const ADMIN_PIN = Math.floor(100000 + Math.random() * 900000).toString();
app.get('/api/admin_pin', (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        res.json({ success: true, pin: ADMIN_PIN });
    } else {
        res.status(403).json({ success: false, message: 'Forbidden' });
    }
});

// =============================================
// FONT SCANNER & DELIVERY
// =============================================
const STANDARD_FONTS = [
    'Be Vietnam Pro',
    'Montserrat',
    'Orbitron',
    'Myriad Pro',
    'SF Pro Display Bold',
    'Roboto',
    'Oswald',
    'Anton',
    'Kanit',
    'Russo One',
    'Teko',
    'Barlow Condensed',
    'Arial',
    'Segoe UI',
    'Impact',
    'Tahoma',
    'Verdana',
    'Helvetica Neue',
    'Trebuchet MS',
    'Times New Roman'
];
let fontDictionary = {};
let fontScanPromise = null;

function scanFonts() {
    if (process.platform !== 'win32') {
        fontScanPromise = Promise.resolve();
        return fontScanPromise;
    }
    let scanCommand = (regKey) => {
        return new Promise((resolve) => {
            exec(`reg query "${regKey}"`, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
                if (!err && stdout) {
                    let lines = stdout.split('\n');
                    for (let line of lines) {
                        let parts = line.split('REG_SZ');
                        if (parts.length === 2) {
                            let namePart = parts[0].trim().replace(' (TrueType)', '').replace(' (All res)', '');
                            let pathPart = parts[1].trim();
                            if (!pathPart.includes(':\\')) {
                                pathPart = path.join(process.env.windir || 'C:\\Windows', 'Fonts', pathPart);
                            }
                            let names = namePart.split(' & ').map(n => n.trim());
                            names.forEach(n => {
                                fontDictionary[n] = pathPart;
                            });
                        }
                    }
                }
                resolve();
            });
        });
    };

    fontScanPromise = Promise.all([
        scanCommand("HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"),
        scanCommand("HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts")
    ]).then(() => {
        console.log("Font scan complete. Found " + Object.keys(fontDictionary).length + " fonts.");
    });
    return fontScanPromise;
}
// Start scan immediately on server boot
const fontsDir = path.join(basePath, 'Themes', 'Fonts');
if (!fs.existsSync(fontsDir)) {
    try { fs.mkdirSync(fontsDir, { recursive: true }); } catch(e) {}
}

function scanCustomFontsDir() {
    if (fs.existsSync(fontsDir)) {
        try {
            const files = fs.readdirSync(fontsDir);
            files.forEach(file => {
                const ext = path.extname(file).toLowerCase();
                if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
                    const fontName = path.basename(file, ext);
                    fontDictionary[fontName] = path.join(fontsDir, file);
                }
            });
        } catch (e) {
            console.error('Lỗi khi đọc thư mục Themes/Fonts:', e);
        }
    }
}
scanCustomFontsDir();

app.get('/font/:name', (req, res) => {
    let name = decodeURIComponent(req.params.name);
    let fontPath = fontDictionary[name];
    if (fontPath && fs.existsSync(fontPath)) {
        res.sendFile(fontPath);
    } else {
        res.status(404).send('Not found');
    }
});

app.post('/api/font/upload', (req, res) => {
    try {
        const { fontName, fileData, ext } = req.body || {};
        if (!fontName || !fileData) {
            return res.status(400).json({ success: false, message: 'Thiếu dữ liệu file font!' });
        }
        const cleanName = fontName.trim().replace(/[\\/:*?"<>|]/g, '');
        const cleanExt = (ext || 'ttf').toLowerCase().replace('.', '');
        const targetFile = path.join(fontsDir, `${cleanName}.${cleanExt}`);
        
        const base64Data = fileData.replace(/^data:.*?;base64,/, '');
        fs.writeFileSync(targetFile, Buffer.from(base64Data, 'base64'));
        
        fontDictionary[cleanName] = targetFile;
        console.log(`[FontUpload] Đã lưu font mới: ${cleanName} tại ${targetFile}`);
        
        const systemFonts = Object.keys(fontDictionary);
        const combined = Array.from(new Set([...STANDARD_FONTS, ...systemFonts])).sort((a, b) => a.localeCompare(b));
        io.emit('systemFonts', combined);
        
        res.json({ success: true, fontName: cleanName, message: `Đã tải lên font "${cleanName}" thành công!` });
    } catch (err) {
        console.error('Lỗi khi tải font lên:', err);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lưu font!' });
    }
});

function streamVideoFile(filePath, req, res) {
    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('Video not found');
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        res.sendFile(path.resolve(filePath), {
            acceptRanges: true,
            maxAge: '1d',
            immutable: true
        }, (err) => {
            if (err && !res.headersSent && err.code !== 'ECONNABORTED' && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
                console.error('Lỗi khi gửi video file:', err);
                try { res.status(500).send('Video transfer error'); } catch(e) {}
            }
        });
    } catch(err) {
        console.error('Lỗi khi stream video:', err);
        if (!res.headersSent) res.status(500).send('Internal video stream error');
    }
}

const videosDir1 = path.join(__dirname, 'public', 'videos');
const videosDir2 = path.join(basePath, 'public', 'videos');
try { fs.mkdirSync(videosDir1, { recursive: true }); } catch(e) {}
try { fs.mkdirSync(videosDir2, { recursive: true }); } catch(e) {}

app.get('/videos/:filename', (req, res) => {
    const fn = path.basename(req.params.filename);
    const ext = path.extname(fn).toLowerCase();
    const nameWithoutExt = path.basename(fn, ext);
    const basePrefix = nameWithoutExt.replace(/_\d{10,}$/, '');

    const checkDirs = [
        videosDir1,
        videosDir2,
        path.join(basePath, 'videos'),
        path.join(basePath, 'public', 'videos'),
        path.join(__dirname, 'public', 'videos')
    ];

    // 1. Exact filename match
    for (const dir of checkDirs) {
        const cand = path.join(dir, fn);
        if (fs.existsSync(cand)) {
            return streamVideoFile(cand, req, res);
        }
    }

    // 2. Exact base name without timestamp (e.g. KH__1.mp4)
    if (basePrefix !== nameWithoutExt) {
        const exactBaseFn = `${basePrefix}${ext}`;
        for (const dir of checkDirs) {
            const cand = path.join(dir, exactBaseFn);
            if (fs.existsSync(cand)) {
                return streamVideoFile(cand, req, res);
            }
        }
    }

    // 3. Prefix search in directory
    for (const dir of checkDirs) {
        if (fs.existsSync(dir)) {
            try {
                const files = fs.readdirSync(dir);
                const found = files.find(f => {
                    const fExt = path.extname(f).toLowerCase();
                    const fBase = path.basename(f, fExt);
                    return (fBase === basePrefix || fBase.startsWith(basePrefix + '_') || fBase.startsWith(basePrefix)) && (fExt === ext || fExt === '.mp4');
                });
                if (found) {
                    return streamVideoFile(path.join(dir, found), req, res);
                }
            } catch(e) {}
        }
    }

    res.status(404).send('Video not found');
});

app.post('/api/video/upload_raw', (req, res) => {
    try {
        const rawFilename = decodeURIComponent(req.query.filename || 'video.mp4');
        const ext = path.extname(rawFilename).toLowerCase() || '.mp4';
        const baseName = path.basename(rawFilename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        const exactName = `${baseName}${ext}`;
        const finalName = generateVideoFilename(baseName, ext);
        
        const target1 = path.join(videosDir1, finalName);
        const writeStream = fs.createWriteStream(target1);
        req.pipe(writeStream);
        
        writeStream.on('finish', () => {
            try {
                fs.copyFileSync(target1, path.join(videosDir1, exactName));
                if (videosDir1 !== videosDir2) {
                    fs.copyFileSync(target1, path.join(videosDir2, finalName));
                    fs.copyFileSync(target1, path.join(videosDir2, exactName));
                }
            } catch(e) {}
            
            const publicUrl = `/videos/${finalName}`;
            console.log(`[VideoUploadRaw] Đã lưu video thành công: ${publicUrl}`);
            res.json({ success: true, url: publicUrl, exactUrl: `/videos/${exactName}`, originalName: rawFilename, message: 'Đã tải lên video thành công!' });
        });
        writeStream.on('error', (err) => {
            console.error('Lỗi khi ghi file video raw:', err);
            res.status(500).json({ success: false, message: 'Lỗi ghi file video: ' + err.message });
        });
    } catch(err) {
        console.error('Lỗi upload raw:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/video/upload', (req, res) => {
    try {
        const { fileName, fileData } = req.body || {};
        if (!fileName || !fileData) {
            return res.status(400).json({ success: false, message: 'Thiếu dữ liệu file video!' });
        }
        const ext = path.extname(fileName).toLowerCase() || '.mp4';
        const baseName = path.basename(fileName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        const exactName = `${baseName}${ext}`;
        const finalName = `${baseName}_${Date.now()}${ext}`;
        
        const base64Data = fileData.replace(/^data:.*?;base64,/, '');
        const buf = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(path.join(videosDir1, finalName), buf);
        fs.writeFileSync(path.join(videosDir1, exactName), buf);
        if (videosDir1 !== videosDir2) {
            try { 
                fs.writeFileSync(path.join(videosDir2, finalName), buf); 
                fs.writeFileSync(path.join(videosDir2, exactName), buf);
            } catch(e) {}
        }
        
        const publicUrl = `/videos/${finalName}`;
        console.log(`[VideoUpload] Đã lưu video mới: ${publicUrl}`);
        res.json({ success: true, url: publicUrl, exactUrl: `/videos/${exactName}`, message: 'Đã tải lên video thành công!' });
    } catch(err) {
        console.error('Lỗi khi tải video lên:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi lưu video: ' + err.message });
    }
});

app.post('/api/admin_login', (req, res) => {
    res.json({ success: req.body.pass === ADMIN_PIN, pin: ADMIN_PIN });
});

app.post('/api/verify_pin', (req, res) => {
    res.json({ success: req.body.pin === gameState.roomPIN });
});

// Tạo thư mục cần thiết khi khởi động
const dirs = ['sounds', 'questions'];
for (let i = 1; i <= 6; i++) dirs.push(`questions/de${i}`);



const themesDirs = ['Themes/Background', 'Themes/Avatars'];
themesDirs.forEach(d => {
    let p = path.join(basePath, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

dirs.forEach(d => { 
    let p = path.join(basePath, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); 
});

// =============================================
// REST API: Quản lý ngân hàng câu hỏi
// =============================================

// Liệt kê các bộ đề đã lưu
app.get('/api/questions', (req, res) => {
    if (!verifyAdminHeader(req)) return res.status(401).json({ error: 'Unauthorized' });
    const sets = [];
    const questionsDir = path.join(basePath, 'questions');
    if (!fs.existsSync(questionsDir)) fs.mkdirSync(questionsDir, { recursive: true });

    for (let i = 1; i <= 6; i++) {
        const jsonPath = path.join(questionsDir, `de${i}`, 'data.json');
        if (fs.existsSync(jsonPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                const count10 = data.questions?.["10"]?.length || 0;
                const count20 = data.questions?.["20"]?.length || 0;
                const count40 = data.questions?.["40"]?.length || 0;
                sets.push({ id: i.toString(), name: data.name || `Đề ${i}`, isDraft: false, hasData: true, count10, count20, count40 });
            } catch (e) {
                sets.push({ id: i.toString(), name: `Đề ${i}`, isDraft: false, hasData: false });
            }
        } else {
            sets.push({ id: i.toString(), name: `Đề ${i}`, isDraft: false, hasData: false });
        }
    }

    try {
        const draftDirs = fs.readdirSync(questionsDir).filter(d => d.startsWith('draft_'));
        for (const d of draftDirs) {
            const jsonPath = path.join(questionsDir, d, 'data.json');
            if (fs.existsSync(jsonPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    const count10 = data.questions?.["10"]?.length || 0;
                    const count20 = data.questions?.["20"]?.length || 0;
                    const count40 = data.questions?.["40"]?.length || 0;
                    sets.push({ id: d, name: data.name || `Nháp`, isDraft: true, hasData: true, count10, count20, count40 });
                } catch (e) {}
            }
        }
    } catch (e) {}
    res.json(sets);
});

// Lưu bộ đề
app.post('/api/questions/:setId', (req, res) => {
    if (!verifyAdminHeader(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (req.headers['x-admin-pin'] !== ADMIN_PIN) return res.status(403).json({ error: 'Forbidden' });
    const setIdStr = req.params.setId;
    let dirName = '';

    if (setIdStr.startsWith('draft_')) {
        dirName = setIdStr;
    } else {
        const setId = parseInt(setIdStr);
        if (isNaN(setId) || setId < 1 || setId > 6) return res.status(400).json({ error: 'Set ID phải từ 1-6 hoặc bắt đầu bằng draft_' });
        dirName = `de${setId}`;
    }

    const dirPath = path.join(basePath, 'questions', dirName);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    fs.writeFileSync(path.join(dirPath, 'data.json'), JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true, setId: setIdStr });
});

// Đọc bộ đề
app.get('/api/questions/:setId', (req, res) => {
    if (!verifyAdminHeader(req)) return res.status(401).json({ error: 'Unauthorized' });
    const setIdStr = req.params.setId;
    let dirName = setIdStr.startsWith('draft_') ? setIdStr : `de${parseInt(setIdStr)}`;
    const jsonPath = path.join(basePath, 'questions', dirName, 'data.json');
    if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: 'Chưa có dữ liệu' });

    try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: 'Lỗi đọc file' });
    }
});

// Xóa bộ đề (Chính thức & Nháp)
app.delete('/api/questions/:setId', (req, res) => {
    if (!verifyAdminHeader(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (req.headers['x-admin-pin'] !== ADMIN_PIN) return res.status(403).json({ error: 'Forbidden' });
    const setIdStr = req.params.setId;
    let dirName = setIdStr.startsWith('draft_') ? setIdStr : `de${parseInt(setIdStr)}`;
    const dirPath = path.join(basePath, 'questions', dirName);
    
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
    res.json({ success: true });
});

let authorizedVideoPath = null;

// Stream video cục bộ từ đường dẫn tuyệt đối hoặc public với hỗ trợ HTTP Range (Partial Content)
app.get('/api/video', (req, res) => {
    const videoPath = req.query.path;
    if (!videoPath) {
        return res.status(404).send('Video not found');
    }
    let resolved = path.resolve(videoPath);
    if (fs.existsSync(resolved)) {
        return streamVideoFile(resolved, req, res);
    }
    const cleanPath = videoPath.replace(/^[\/\\]+/, '');
    const candidates = [
        path.join(videosDir1, path.basename(videoPath)),
        path.join(videosDir2, path.basename(videoPath)),
        path.join(__dirname, 'public', cleanPath),
        path.join(basePath, 'public', cleanPath),
        path.join(basePath, cleanPath),
        path.join(basePath, 'Themes', cleanPath)
    ];
    for (const cand of candidates) {
        if (fs.existsSync(cand)) {
            return streamVideoFile(cand, req, res);
        }
    }
    res.status(404).send('Video not found');
});

// =============================================
// GAME STATE
// =============================================
const STATE_FILE = process.env.ECONOVA_STATE_FILE || path.join(basePath, 'gameState.json');
let savedData = null;
if (fs.existsSync(STATE_FILE)) {
    try {
        let raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (Array.isArray(raw)) {
            savedData = { teams: raw }; // Hỗ trợ format cũ
        } else {
            savedData = raw;
        }
    } catch (e) {
        console.error("Loi doc file gameState.json:", e);
    }
}

let gameState = {
    roomPIN: (savedData && savedData.roomPIN) || "",
    isRoomOpen: (savedData && savedData.isRoomOpen) || false,
    teams: (savedData && savedData.teams) || [
        { id: 1, name: "Đội 1", school: "", score: 0, avatarSize: 100, avatarOverlap: 10 },
        { id: 2, name: "Đội 2", school: "", score: 0, avatarSize: 100, avatarOverlap: 10 },
        { id: 3, name: "Đội 3", school: "", score: 0, avatarSize: 100, avatarOverlap: 10 },
        { id: 4, name: "Đội 4", school: "", score: 0, avatarSize: 100, avatarOverlap: 10 }
    ],
    buzzedTeam: null,
    isBuzzerLocked: true,
    buzzerUnlockTime: null,
    buzzToken: null,
    scoreLog: [],
    buzzTimes: {},
    wrongBuzzes: [],
    claimedTeams: {},  // { teamId: socketId }
    currentQuestion: (savedData && savedData.currentQuestion) || {
        active: false,
        points: 0,
        mainTeamId: null,
        isHopeStar: false,
        deductedFromMain: false,
        text: "",
        answer: "",
        idx: null
    },
    playedQuestions: (savedData && savedData.playedQuestions) || { "10": [], "20": [], "40": [] },
    turnOrder: (savedData && savedData.turnOrder) || [], // Array of teamIds in order of play
    turnStats: (savedData && savedData.turnStats) || {}, // { teamId: questionsPlayedCount }
    buzzerTimeout: null, // For 5s automatic lock
    settings: (savedData && savedData.settings) || { theme: 'default', brightness: 100, scale: 100, avatarSize: 100, avatarOverlap: 10, teamCount: 4, questionsPerTeam: 3, questionSelectionMode: 1, mode2Rows: 3, mode2StartQ: 1, globalFontEnabled: false, fontGlobal: 'SF Pro Display Bold', fontGeneral: 'SF Pro Display Bold', fontTeamName: 'SF Pro Display Bold', fontScore: 'Orbitron', fontQuestion: 'SF Pro Display Bold', hideRound2Graphics: true },
    lockedTeams: (savedData && savedData.lockedTeams) || [],
    isGridVisibleOnOverlay: false,
    showOverallScoreboard: false,
    scoreboardBg: (savedData && savedData.scoreboardBg) || null,
    avatarTimestamps: (savedData && savedData.avatarTimestamps) || { 1: 1, 2: 1, 3: 1, 4: 1 },
    questionCount: (savedData && savedData.questionCount) || { "10": 12, "20": 12, "40": 12 },
    lockedPackage: (savedData && savedData.lockedPackage) || null,
    teamQuestionHistory: (savedData && savedData.teamQuestionHistory) || { 1: [], 2: [], 3: [], 4: [] },
    timerConfig: (savedData && savedData.timerConfig) || {
        position: 'bottom-right',
        fontSize: 120,
        fontColor: '#FFFFFF',
        strokeColor: '#000000',
        strokeWidth: 4,
        fontFamily: 'Arial',
        isBold: true,
        isItalic: false,
        isUnderline: false,
        timeSeconds: 180, // Default to 3 minutes for Pitching
        isRunning: false
    },
    activeRound: (savedData && savedData.activeRound) || 2,
    activeBankSlot: (savedData && savedData.activeBankSlot) || null,
    antiCheatViolations: (savedData && savedData.antiCheatViolations) || {},
    bannedTeams: (savedData && savedData.bannedTeams) || []
};

// Migration: ensure new settings fields have defaults for old saved states
if (gameState.settings && gameState.settings.hideRound2Graphics === undefined) {
    gameState.settings.hideRound2Graphics = true;
}

// Watch gameState.json for external updates (e.g. from tests)
if (fs.existsSync(STATE_FILE) && process.env.ECONOVA_WATCH_STATE === '1') {
    chokidar.watch(STATE_FILE, { persistent: true, ignoreInitial: true }).on('change', () => {
        try {
            const content = fs.readFileSync(STATE_FILE, 'utf8');
            let raw = JSON.parse(content);
            let loadedData = Array.isArray(raw) ? { teams: raw } : raw;
            
            // Check if there is actual difference
            let hasDiff = false;
            for (let key in loadedData) {
                if (JSON.stringify(gameState[key]) !== JSON.stringify(loadedData[key])) {
                    hasDiff = true;
                    break;
                }
            }
            
            if (hasDiff) {
                Object.assign(gameState, loadedData);
                io.emit('updateState', gameState);
                console.log("Game state reloaded from external change.");
            }
        } catch (e) {
            console.error("Lỗi khi nạp lại gameState từ file:", e);
        }
    });
}

// =============================================
// HELPER: Auto-sort turn order
// =============================================
// QUẢN LÝ TIMER CHUÔNG NGOÀI GAMESTATE (TRÁNH LỖI CIRCULAR SOCKET.IO)
// =============================================
const roomBuzzerTimeouts = new Map();
const roomBuzzerDelayTimers = new Map();

function setRoomBuzzerTimeout(pin, timer) {
    const key = pin || 'DEFAULT';
    if (roomBuzzerTimeouts.has(key)) clearTimeout(roomBuzzerTimeouts.get(key));
    if (timer) roomBuzzerTimeouts.set(key, timer);
    else roomBuzzerTimeouts.delete(key);
}

function clearRoomBuzzerTimeout(pin) {
    setRoomBuzzerTimeout(pin, null);
}

function setRoomBuzzerDelayTimer(pin, timer) {
    const key = pin || 'DEFAULT';
    if (roomBuzzerDelayTimers.has(key)) clearTimeout(roomBuzzerDelayTimers.get(key));
    if (timer) roomBuzzerDelayTimers.set(key, timer);
    else roomBuzzerDelayTimers.delete(key);
}

function clearRoomBuzzerDelayTimer(pin) {
    setRoomBuzzerDelayTimer(pin, null);
}

function resetBuzzerState(state, pin = null) {
    if (!state) state = gameState;
    state.buzzedTeam = null;
    state.pendingBuzzerTeam = null;
    state.isBuzzerLocked = true;
    state.buzzerUnlockTime = null;
    state.buzzTimes = {};
    state.wrongBuzzes = [];
    delete state.buzzerTimeout;
    delete state.buzzerDelayTimer;
    clearRoomBuzzerDelayTimer(pin || state.roomPIN);
}

function clearBuzzerTimeout(state, pin = null) {
    if (!state) state = gameState;
    delete state.buzzerTimeout;
    clearRoomBuzzerTimeout(pin || state.roomPIN);
}

function closeCurrentQuestion(pin = null) {
    if (gameState.currentQuestion) {
        gameState.currentQuestion.active = false;
        gameState.currentQuestion.mainTeamId = null;
        gameState.currentQuestion.isHopeStar = false;
        gameState.currentQuestion.resolved = false;
    }
    resetBuzzerState(gameState, pin);
    clearBuzzerTimeout(gameState, pin);
}
        gameState.currentQuestion = null;

function updateTeamScore(teamId, points, reason = "Chỉnh sửa thủ công", targetState = null) {
    let state = targetState || gameState;
    let team = state.teams ? state.teams.find(t => t.id === teamId) : null;
    if (team) {
        team.score += points;
        if (team.score < 0) team.score = 0;
        
        if (!state.scoreLog) state.scoreLog = [];
        state.scoreLog.unshift({ id: require('crypto').randomUUID(), time: Date.now(), teamId: teamId, delta: points, reason: reason });
        if (state.scoreLog.length > 50) state.scoreLog.pop();

        updateTurnOrder(state);
    }
}

function updateTurnOrder(targetState = gameState, lockActive = true) {
    if (typeof targetState === 'boolean') {
        lockActive = targetState;
        targetState = gameState;
    }
    targetState = targetState || gameState;
    let rule = (targetState.settings && targetState.settings.turnOrderRule) || 'mode_asc';
    let teamsToSort = targetState.teams || [];
    if (targetState.turnOrder && targetState.turnOrder.length > 0 && targetState.settings && targetState.turnOrder.length < targetState.settings.teamCount) {
        teamsToSort = targetState.teams.filter(t => targetState.turnOrder.includes(t.id));
    }
    
    let lockedTeamId = null;
    if (lockActive && targetState.turnOrder && targetState.turnOrder.length > 0) {
        let candidate = targetState.turnOrder[0];
        let hasStarted = (targetState.turnStats && targetState.turnStats[candidate] && targetState.turnStats[candidate] > 0);
        let isActive = (targetState.currentQuestion && targetState.currentQuestion.active && targetState.currentQuestion.mainTeamId === candidate);
        let hasLocked = (targetState.lockedPackage && targetState.lockedPackage.mainTeamId === candidate);
        let isForced = (targetState.forcedTeamId === candidate);
        
        if (hasStarted || isActive || hasLocked || isForced) {
            lockedTeamId = candidate;
        }
    }
    
    let others = teamsToSort.filter(t => t.id !== lockedTeamId);
    others.sort((a, b) => {
        let aStats = (targetState.turnStats && targetState.turnStats[a.id]) || 0;
        let bStats = (targetState.turnStats && targetState.turnStats[b.id]) || 0;
        if (aStats > 0 && bStats === 0) return -1;
        if (bStats > 0 && aStats === 0) return 1;
        if (aStats > 0 && bStats > 0) return targetState.turnOrder.indexOf(a.id) - targetState.turnOrder.indexOf(b.id);
        
        if (rule === 'mode_order') return a.id - b.id;
        if (rule === 'mode_desc') {
            if (a.score !== b.score) return b.score - a.score;
            return a.id - b.id;
        }
        if (a.score !== b.score) return a.score - b.score;
        return a.id - b.id;
    });

    let finalOrder = others.map(t => t.id);
    if (lockedTeamId !== null) {
        finalOrder.unshift(lockedTeamId);
    }
    targetState.turnOrder = finalOrder;
}

// Khởi tạo lượt chơi nếu mảng trống (ví dụ: lần đầu chạy server)
if (gameState.turnOrder.length === 0) {
    updateTurnOrder(gameState);
}

// =============================================
// SOCKET.IO
// =============================================

// =============================================
// QUẢN LÝ THIẾT BỊ & TRẠNG THÁI KẾT NỐI THEO PHÒNG
// =============================================
function getRoomClientsList(roomPin) {
    const list = {
        teams: {},
        mc: false,
        screen: false,
        overlay: false,
        scoreboard: false,
        totalConnected: 0
    };
    
    let targetState = gameState;
    if (roomPin && roomManager && typeof roomManager.getRoom === 'function') {
        const room = roomManager.getRoom(roomPin);
        if (room && room.gameState) {
            targetState = room.gameState;
        }
    }

    const teams = targetState.teams || [];
    teams.forEach(teamObj => {
        const tid = teamObj.id;
        const claim = targetState.claimedTeams ? targetState.claimedTeams[tid] : null;
        list.teams[tid] = {
            id: tid,
            name: teamObj.name || `Đội ${tid}`,
            school: teamObj.school || '',
            claimed: !!claim,
            socketId: claim ? claim.socketId : null,
            online: false
        };
    });

    const pin = roomPin || 'DEFAULT';
    const socketsInRoom = io.sockets.adapter.rooms.get(pin);
    if (socketsInRoom) {
        list.totalConnected = socketsInRoom.size;
        socketsInRoom.forEach(socketId => {
            const s = io.sockets.sockets.get(socketId);
            if (s) {
                const ref = s.handshake.headers.referer || '';
                if (s.isMC || ref.includes('/mc')) list.mc = true;
                if (ref.includes('screen') || ref.includes('display')) list.screen = true;
                if (ref.includes('overlay')) list.overlay = true;
                if (ref.includes('scoreboard')) list.scoreboard = true;
                
                for (let tid in list.teams) {
                    if (list.teams[tid].socketId === socketId) {
                        list.teams[tid].online = true;
                    }
                }
            }
        });
    }

    return list;
}

function broadcastDeviceStatus(roomPin) {
    if (!roomPin) return;
    const info = getRoomClientsList(roomPin);
    io.to(roomPin).emit('deviceStatusUpdate', info);
}


// =============================================
// MULTI-ROOM STATE ROUTING & BROADCASTING
// =============================================
function getActiveState(socket) {
    if (socket && socket.currentRoomPin) {
        const room = roomManager.getRoom(socket.currentRoomPin);
        if (room && room.gameState) return room.gameState;
    }
    return gameState;
}

function emitToSocketFiltered(targetSocket, event, data) {
    if (event === 'updateState' && data) {
        const referer = targetSocket.handshake.headers.referer || '';
        const isFullStateClient = targetSocket.isAdmin 
            || referer.includes('screen') 
            || referer.includes('display') 
            || referer.includes('overlay') 
            || referer.includes('scoreboard');
        const isMcClient = targetSocket.isMC || referer.includes('/mc');

        if (isFullStateClient) {
            targetSocket.emit(event, data);
        } else if (isMcClient) {
            let mcPayload = JSON.parse(JSON.stringify(data));
            delete mcPayload.questionBank;
            delete mcPayload.questions;
            if (mcPayload.lockedPackage && mcPayload.lockedPackage.questions) {
                mcPayload.lockedPackage.questions.forEach((q, idx) => {
                    if (idx !== mcPayload.lockedPackage.currentIndex) {
                        delete q.text; delete q.answer; delete q.vid;
                    }
                });
            }
            if (mcPayload.pendingPackage && mcPayload.pendingPackage.questions) {
                mcPayload.pendingPackage.questions.forEach(q => {
                    delete q.text; delete q.answer; delete q.vid;
                });
            }
            targetSocket.emit(event, mcPayload);
        } else {
            // Thí sinh: Scrub questionBank và đáp án để bảo mật và giảm dung lượng
            let safeState = JSON.parse(JSON.stringify(data));
            delete safeState.questionBank;
            delete safeState.questions;
            if (safeState.currentQuestion) safeState.currentQuestion.answer = "";
            if (safeState.lockedPackage && safeState.lockedPackage.questions) {
                safeState.lockedPackage.questions.forEach(q => { delete q.answer; delete q.vid; });
            }
            if (safeState.pendingPackage && safeState.pendingPackage.questions) {
                safeState.pendingPackage.questions.forEach(q => { delete q.answer; delete q.vid; });
            }
            targetSocket.emit(event, safeState);
        }
        return;
    }
    targetSocket.emit(event, data);
}

function broadcastState(socket, customEvent = 'updateState', customData = null) {
    const targetState = customData || getActiveState(socket);
    const pin = (socket && socket.currentRoomPin) || (targetState && targetState.roomPIN) || null;
    
    if (pin) {
        scheduleSaveRooms(2000);
        const targetSockets = new Set();
        const socketsInRoom = io.sockets.adapter.rooms.get(pin);
        if (socketsInRoom) {
            socketsInRoom.forEach(sid => targetSockets.add(sid));
        }
        io.sockets.sockets.forEach(s => {
            if (s.currentRoomPin === pin) {
                if (!s.rooms.has(pin)) {
                    try { s.join(pin); } catch(e) {}
                }
                targetSockets.add(s.id);
            }
        });
        targetSockets.forEach(sid => {
            const s = io.sockets.sockets.get(sid);
            if (s) emitToSocketFiltered(s, customEvent, targetState);
        });
        broadcastDeviceStatus(pin);
    } else {
        io.sockets.sockets.forEach(s => {
            emitToSocketFiltered(s, customEvent, targetState);
        });
    }
}


function playSoundInRoom(socket, sound, explicitPin = null) {
    const pin = explicitPin || (socket && socket.currentRoomPin) || null;
    if (pin) {
        io.to(pin).emit('playSound', sound);
    } else {
        io.emit('playSound', sound);
    }
}

io.on('connection', (socket) => {

    // --- MULTI-ROOM SOCKET JOIN & AUTH HANDLERS ---
    socket.on('joinRoom', async (pin, callback) => {
        const roomPin = (pin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
        let room = roomManager.getRoom(roomPin);
        if (!room) {
            // Try cloud restore before failing
            try {
                await loadRoomsFromCloud();
                room = roomManager.getRoom(roomPin);
                if (room) console.log('[JoinRoom] Room', roomPin, 'restored from cloud on join');
            } catch(e) {
                console.error('[JoinRoom] Cloud restore error:', e.message);
            }
        }
        if (room) {
            socket.join(roomPin);
            socket.currentRoomPin = roomPin;
            room.connectedClients.add(socket.id);
            
            // Always build safe state (strip questionBank for web clients)
            let safeState = JSON.parse(JSON.stringify(room.gameState));
            delete safeState.questionBank;
            delete safeState.questions;
            if (safeState.currentQuestion) safeState.currentQuestion.answer = "";
            if (safeState.lockedPackage && safeState.lockedPackage.questions) {
                safeState.lockedPackage.questions.forEach(q => { delete q.answer; delete q.vid; });
            }
            if (safeState.pendingPackage && safeState.pendingPackage.questions) {
                safeState.pendingPackage.questions.forEach(q => { delete q.answer; delete q.vid; });
            }
            
            let stateToSend = (socket.isAdmin || socket.isMC) ? room.gameState : safeState;
            
            if (typeof callback === 'function') {
                callback({ success: true, room: { pin: room.pin, name: room.name, theme: room.theme }, gameState: stateToSend });
            }
            socket.emit('ppt-status', roomManager.getSlideStatus(roomPin));
        } else {
            if (typeof callback === 'function') {
                callback({ success: false, message: "Phòng không tồn tại!" });
            }
        }
    });

    socket.on('verifyRoomPIN', (pin, callback) => {
        const state = getActiveState(socket);
const roomPin = (pin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
        const result = roomManager.verifyContestant(roomPin);
        if (result.success) {
            socket.join(roomPin);
            socket.currentRoomPin = roomPin;
            result.room.connectedClients.add(socket.id);
        }
        if (typeof callback === 'function') callback(result);
    });

        // --- QUẢN LÝ THIẾT BỊ ---
    socket.on('getDeviceStatus', () => {
        const pin = socket.currentRoomPin || 'DEFAULT';
        socket.emit('deviceStatusUpdate', getRoomClientsList(pin));
    });


    socket.on('deleteRoom', (pin, callback) => {
        if (!socket.isAdmin) {
            if (typeof callback === 'function') callback({ success: false, message: 'Unauthorized' });
            return;
        }
        const targetPin = (pin || socket.currentRoomPin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
        roomManager.deleteRoom(targetPin);
        scheduleSaveRooms(2000);
        io.to(targetPin).emit('roomClosed', { message: 'Phòng thi này đã được gỡ bỏ.' });
        if (typeof callback === 'function') callback({ success: true, message: `Đã gỡ phòng ${targetPin}` });
    });

    socket.on('adminLogin', (data, callback) => {
        let pin = '';
        let pass = '';
        if (typeof data === 'string') {
            pass = data;
            if (pass === ADMIN_PIN || pass === process.env.MASTER_ADMIN_PASSWORD || pass === 'superadmin') {
                socket.isAdmin = true;
                socket.emit('updateState', gameState);
                if (typeof callback === 'function') callback({ success: true });
                return;
            }
        } else if (data && typeof data === 'object') {
            pin = (data.pin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
            pass = data.password || '';
        }

        if (process.env.IS_DESKTOP_APP === 'true' && pass === ADMIN_PIN) {
            socket.isAdmin = true;
            socket.emit('updateState', gameState);
            if (typeof callback === 'function') callback({ success: true });
            return;
        }

        const result = roomManager.verifyAdmin(pin, pass);
        if (result.success) {
            socket.isAdmin = true;
            socket.join(result.room.pin);
            socket.currentRoomPin = result.room.pin;
            if (result.room.connectedClients) result.room.connectedClients.add(socket.id);
            emitToSocketFiltered(socket, 'updateState', result.room.gameState || gameState);
            socket.emit('ppt-status', roomManager.getSlideStatus(result.room.pin));
        }
        if (typeof callback === 'function') callback(result);
    });

    socket.on('mcLogin', (data, callback) => {
        let pin = '';
        let pass = '';
        if (typeof data === 'string') {
            pass = data;
            if (pass === ADMIN_PIN || pass === process.env.MASTER_ADMIN_PASSWORD || pass === 'superadmin') {
                socket.isMC = true;
                socket.emit('updateState', gameState);
                if (typeof callback === 'function') callback({ success: true });
                return;
            }
        } else if (data && typeof data === 'object') {
            pin = (data.pin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
            pass = data.password || '';
        }

        if (process.env.IS_DESKTOP_APP === 'true' && pass === ADMIN_PIN) {
            socket.isMC = true;
            socket.emit('updateState', gameState);
            if (typeof callback === 'function') callback({ success: true });
            return;
        }

        const result = roomManager.verifyMC(pin, pass);
        if (result.success) {
            socket.isMC = true;
            socket.join(result.room.pin);
            socket.currentRoomPin = result.room.pin;
            if (result.room.connectedClients) result.room.connectedClients.add(socket.id);
            emitToSocketFiltered(socket, 'updateState', result.room.gameState || gameState);
            socket.emit('ppt-status', roomManager.getSlideStatus(result.room.pin));
        }
        if (typeof callback === 'function') callback(result);
    });

    // Danh sách các event MC được phép gọi
    const mcAllowedEvents = [
        'correctMainTeam', 'startBuzzer', 'correctBuzzedTeam', 'wrongBuzzedTeam',
        'startCountdown', 'playSound', 'closeQuestion', 'timer-action', 'stop-timer',
        'ppt-next', 'ppt-prev', 'ppt-jump', 'ppt-sync'
    ];

    socket.use(([event, ...args], next) => {
        const publicEvents = [
            'joinRoom', 'adminLogin', 'mcLogin', 'verifyRoomPIN', 'claimTeam', 'releaseTeam',
            'buzz', 'getSystemFonts', 'get-state', 'requestState', 'getDeviceStatus',
            'ppt-sync', 'disconnect', 'antiCheatViolation', 'secretExitRequest'
        ];
        if (publicEvents.includes(event)) return next();
        if (socket.isAdmin) return next();
        if (socket.isMC && mcAllowedEvents.includes(event)) return next();
        return next(new Error('Unauthorized: Bạn chưa đăng nhập Quản Trị Viên!'));
    });

    socket.on('playSound', (sound) => {
        playSoundInRoom(socket, sound);
    });

    if (process.env.IS_DESKTOP_APP === 'true') {
        socket.emit('updateState', gameState);
        if (gameState.timerConfig) socket.emit('timer-config-updated', gameState.timerConfig);
    }
    socket.emit('serverIPs', getLocalIPs());
    if (global.activeTunnel) socket.emit('publicLinkResult', { success: true, url: global.activeTunnel.url });
    console.log('[SERVER] Socket connected:', socket.id);

    // Allow clients to request current state (for late-connecting listeners)
    socket.on('get-state', () => {
        if (socket.currentRoomPin) {
            const room = roomManager.getRoom(socket.currentRoomPin);
            if (room) { emitToSocketFiltered(socket, 'updateState', room.gameState); return; }
        }
        socket.emit('updateState', gameState);
    });

    socket.on('requestState', () => {
        if (socket.currentRoomPin) {
            const room = roomManager.getRoom(socket.currentRoomPin);
            if (room) { emitToSocketFiltered(socket, 'updateState', room.gameState); return; }
        }
        socket.emit('updateState', gameState);
    });

    // --- THÍ SINH: Chọn đội ---
    socket.on('claimTeam', async (data, callback) => {
        // Accept pin from payload as fallback (race condition: HTTP prefetch faster than WebSocket joinRoom)
        let pin = socket.currentRoomPin;
        if (!pin && data && data.pin) {
            const fallbackPin = (data.pin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
            let fallbackRoom = roomManager.getRoom(fallbackPin);
            if (!fallbackRoom) {
                try {
                    await loadRoomsFromCloud();
                    fallbackRoom = roomManager.getRoom(fallbackPin);
                } catch (e) {
                    console.error('[ClaimTeam] Cloud restore error:', e.message);
                }
            }
            if (fallbackRoom) {
                // Auto-join the socket to this room
                socket.join(fallbackPin);
                socket.currentRoomPin = fallbackPin;
                if (fallbackRoom.connectedClients) fallbackRoom.connectedClients.add(socket.id);
                pin = fallbackPin;
                console.log('[ClaimTeam] Auto-joined socket', socket.id, 'to room', pin, '(race condition recovery)');
            }
        }
        if (!pin) {
            if (typeof callback === 'function') callback({ success: false, message: 'Phòng không tồn tại hoặc chưa tham gia phòng!' });
            return;
        }
        let room = roomManager.getRoom(pin);
        if (!room) {
            try {
                await loadRoomsFromCloud();
                room = roomManager.getRoom(pin);
            } catch (e) {}
        }
        if (!room) {
            if (typeof callback === 'function') callback({ success: false, message: 'Phòng không tồn tại hoặc đã đóng!' });
            return;
        }
        const state = room.gameState;
        const teamId = parseInt(data.teamId);
        const clientId = data.clientId;

        if (!state.claimedTeams) state.claimedTeams = {};

        // Kiểm tra đội này đã bị người khác chọn chưa
        const existing = state.claimedTeams[teamId];
        if (existing) {
            const existingSocket = io.sockets.sockets.get(existing.socketId);
            const isOnline = existingSocket && existingSocket.connected;
            const isSameClient = existing.clientId && clientId && existing.clientId === clientId;
            if (!isSameClient) {
                if (isOnline || !existing.disconnectedAt || (Date.now() - existing.disconnectedAt < 60000)) {
                    if (typeof callback === 'function') callback({ success: false, message: 'Đội này đã có thí sinh khác chọn trên thiết bị khác!' });
                    socket.emit('claimError', { message: 'Đội này đã có thí sinh khác chọn trên thiết bị khác! Vui lòng chọn đội khác.' });
                    return;
                }
            }
        }

        // Đăng ký đội cho socket này
        state.claimedTeams[teamId] = { socketId: socket.id, clientId: clientId, teamId: teamId };
        socket.teamId = teamId;
        socket.clientId = clientId;

        if (typeof callback === 'function') callback({ success: true, teamId: teamId });
        broadcastState(socket);
        scheduleSaveRooms(2000);
    });

    // --- ADMIN: Giải phóng thiết bị thí sinh ---
    socket.on('releaseTeam', (teamId) => {
        const pin = socket.currentRoomPin;
        if (!pin) return;
        const room = roomManager.getRoom(pin);
        if (!room) return;
        const state = room.gameState;
        if (!state.claimedTeams) return;

        const claim = state.claimedTeams[teamId];
        if (claim) {
            const targetSocket = io.sockets.sockets.get(claim.socketId);
            if (targetSocket) targetSocket.emit('teamReleased', { teamId: teamId });
        }
        delete state.claimedTeams[teamId];
        broadcastState(socket);
        scheduleSaveRooms(2000);
    });

    // Mở phòng / Đóng phòng
    socket.on('toggleRoom', (isOpen, pin) => {
        gameState.isRoomOpen = !!isOpen;
        if (socket.currentRoomPin) {
            const room = roomManager.getRoom(socket.currentRoomPin);
            if (room) {
                room.gameState.isRoomOpen = !!isOpen;
                room.gameState.roomPIN = socket.currentRoomPin;
            }
            gameState.roomPIN = socket.currentRoomPin;
        } else if (isOpen) {
            gameState.roomPIN = pin || Math.floor(1000 + Math.random() * 9000).toString();
        }
        if (!isOpen) {
            gameState.claimedTeams = {};
        }
        scheduleSaveRooms(2000);
        io.emit('updateState', gameState);
    });

    // Verify Room PIN for contestants
    socket.on('verifyRoomPIN', (pin, callback) => {
        const state = getActiveState(socket);
if (!state.isRoomOpen) {
            callback({ success: false, message: 'Phòng thi chưa mở!' });
            return;
        }
        if (pin === state.roomPIN) {
            callback({ success: true });
        } else {
            callback({ success: false, message: 'Sai mã phòng!' });
        }
    });

    // Tạo Server Public
    socket.on('startPublicServer', (data) => {
        startFixedTunnel(socket, data);
    });

    socket.on('toggleQRCode', () => {
        io.emit('toggleQRCode');
    });

    // --- ADMIN: Đặt tên đội & trường ---
    socket.on('setTeamNames', (data) => {
        const state = getActiveState(socket);
        // Initialize teams array if missing
        if (!state.teams || !Array.isArray(state.teams)) {
            state.teams = [
                { id: 1, name: 'Đội 1', school: '', score: 0 },
                { id: 2, name: 'Đội 2', school: '', score: 0 },
                { id: 3, name: 'Đội 3', school: '', score: 0 },
                { id: 4, name: 'Đội 4', school: '', score: 0 }
            ];
        }
        data.forEach((item, idx) => {
            if (state.teams[idx]) {
                if (item.name && item.name.trim()) state.teams[idx].name = item.name.trim();
                if (item.school !== undefined) state.teams[idx].school = item.school.trim();
            }
        });
        updateTurnOrder(state);
        broadcastState(socket);
    });

    // --- ADMIN: Bật/Tắt Ngôi sao hy vọng ---
    socket.on('toggleHopeStar', (teamId) => {
        const state = getActiveState(socket);
        if (!state.currentQuestion) {
            state.currentQuestion = { active: false, isHopeStar: false, points: 0, isHidden: true, mainTeamId: null };
        }
        var wasOn = Boolean(state.currentQuestion.isHopeStar);
        state.currentQuestion.isHopeStar = !wasOn;

        if (state.currentQuestion.isHopeStar) {
            // Đang bật: gán đội
            let targetTeam = parseInt(teamId);
            if (targetTeam === -1 && state.turnOrder && state.turnOrder.length > 0) {
                targetTeam = state.turnOrder[0];
            } else if (targetTeam === -1) {
                targetTeam = 1;
            }
            state.currentQuestion.mainTeamId = targetTeam;
            broadcastState(socket);
            playSoundInRoom(socket, 'hope_star');
        } else {
            // Đang tắt
            broadcastState(socket);
        }
    });

    // --- ADMIN: Ép chọn lượt chơi (cho đội) ---
    socket.on('forceTurn', (teamId) => {
        const state = getActiveState(socket);
        state.forcedTeamId = teamId;
        // Find team in turnOrder and move to front
        let idx = state.turnOrder ? state.turnOrder.indexOf(teamId) : -1;
        if (idx > -1) {
            state.turnOrder.splice(idx, 1);
            state.turnOrder.unshift(teamId);
        }

        // Tắt câu hỏi hiện tại và dọn dẹp viền sáng
        if (!state.currentQuestion) {
            state.currentQuestion = { active: false, isHopeStar: false, points: 0, isHidden: true, mainTeamId: null };
        } else {
            state.currentQuestion.active = false;
            state.currentQuestion.mainTeamId = null;
            state.currentQuestion.isHopeStar = false;
        }
        state.isGridVisibleOnOverlay = false;

        broadcastState(socket);
    });

    // --- ADMIN: Đặt câu hỏi ---
    socket.on('setQuestion', (data) => {
        const state = getActiveState(socket);
try {
            // If mainTeamId is not provided (auto), pick the first one from turnOrder
            let mainTeamId = data.mainTeamId;
            if (!mainTeamId || mainTeamId === -1) {
                if (state.turnOrder && state.turnOrder.length > 0) {
                    mainTeamId = state.turnOrder[0];
                } else {
                    mainTeamId = 1; // Fallback
                }
            }

            state.currentQuestion = {
                active: true,
                resolved: false,
                points: data.points || 0,
                mainTeamId: mainTeamId,
                isHopeStar: (state.currentQuestion && state.currentQuestion.isHopeStar) ? true : false,
                deductedFromMain: false,
                text: data.text || "",
                answer: data.answer || "",
                vid: data.vid || "",
                idx: data.idx
            };
            
            // Mark question as played
            if (data.points && data.idx !== undefined && data.idx !== -1) {
                if (!state.playedQuestions[data.points]) state.playedQuestions[data.points] = [];
                if (!state.playedQuestions[data.points].includes(data.idx)) {
                    state.playedQuestions[data.points].push(data.idx);
                }
                
                // Cập nhật lịch sử của đội
                if (!state.teamQuestionHistory) state.teamQuestionHistory = { 1: [], 2: [], 3: [], 4: [] };
                if (!state.teamQuestionHistory[mainTeamId]) state.teamQuestionHistory[mainTeamId] = [];
                let exists = state.teamQuestionHistory[mainTeamId].find(q => q.points == data.points && q.idx == data.idx);
                if (!exists) {
                    state.teamQuestionHistory[mainTeamId].push({ points: data.points, idx: data.idx, mode: 1 });
                }
            }
            
            resetBuzzerState(typeof state !== 'undefined' ? state : gameState);
            state.isGridVisibleOnOverlay = false;
            
            broadcastState(socket);
            playSoundInRoom(socket, 'question_open_mode1');
        } catch (err) {
            console.error("Loi server khi setQuestion:", err);
        }
    });

    // --- ADMIN: Chốt gói câu hỏi (Mode 2 & 3) ---
    socket.on('lockPackage', (data) => {
        const state = getActiveState(socket);
        try {
            if (!data) return;
            const mode = parseInt(data.mode, 10) || 1;
            let mainTeamId = parseInt(data.mainTeamId, 10);
            if (isNaN(mainTeamId) || mainTeamId <= 0) {
                if (state.turnOrder && state.turnOrder.length > 0) {
                    mainTeamId = state.turnOrder[0];
                } else if (state.teams && state.teams.length > 0) {
                    mainTeamId = state.teams[0].id;
                } else {
                    mainTeamId = 1;
                }
            }

            let finalPackage = [];
            
            if (mode === 2) {
                // Mode 2: data.package is [{points, idx}, ...]
                finalPackage = Array.isArray(data.package) ? data.package : [];
                // Mode 2: Mark all chosen questions as played immediately
                finalPackage.forEach(q => {
                    if (q && q.points && q.idx !== undefined && q.idx !== -1) {
                        if (!state.playedQuestions[q.points]) state.playedQuestions[q.points] = [];
                        if (!state.playedQuestions[q.points].includes(q.idx)) {
                            state.playedQuestions[q.points].push(q.idx);
                        }
                    }
                });
            } else if (mode === 3) {
                // Mode 3: data.package is [{points, idx}, ...]
                const pkgArr = Array.isArray(data.package) ? data.package : [];
                pkgArr.forEach(item => {
                    let points = (item && typeof item === 'object') ? parseInt(item.points, 10) : parseInt(item, 10);
                    if (isNaN(points)) return;
                    let totalQs = state.questionCount[points] || 0;
                    let played = state.playedQuestions[points] || [];
                    let available = [];
                    for (let i = 0; i < totalQs; i++) {
                        if (!played.includes(i)) available.push(i);
                    }
                    
                    let chosenIdx = -1;
                    if (available.length > 0) {
                        let randIndex = Math.floor(Math.random() * available.length);
                        chosenIdx = available[randIndex];
                        if (!state.playedQuestions[points]) state.playedQuestions[points] = [];
                        state.playedQuestions[points].push(chosenIdx); // mark as played immediately
                    }
                    finalPackage.push({ points: points, idx: chosenIdx });
                });
            }

            state.isGridVisibleOnOverlay = false;
            state.pendingPackage = null;
            state.lockedPackage = {
                mode: mode,
                mainTeamId: mainTeamId,
                questions: finalPackage,
                currentIndex: -1,
                lockedAt: Date.now()
            };
            
            // Lịch sử câu hỏi
            if (!state.teamQuestionHistory) state.teamQuestionHistory = { 1: [], 2: [], 3: [], 4: [] };
            if (!state.teamQuestionHistory[mainTeamId]) state.teamQuestionHistory[mainTeamId] = [];
            finalPackage.forEach(q => {
                if (q && q.points && q.idx !== undefined) {
                    let exists = state.teamQuestionHistory[mainTeamId].find(x => x.points == q.points && x.idx == q.idx);
                    if (!exists) {
                        state.teamQuestionHistory[mainTeamId].push({ points: q.points, idx: q.idx, mode: mode });
                    }
                }
            });

            state.currentQuestion = {
                active: false,
                resolved: false,
                points: 0,
                mainTeamId: mainTeamId,
                isHopeStar: false,
                deductedFromMain: false,
                text: "",
                answer: "",
                vid: "",
                idx: -1,
                isHidden: true
            };
            
            broadcastState(socket);
            playSoundInRoom(socket, 'open_question');
            if (socket.currentRoomPin) {
                io.to(socket.currentRoomPin).emit('packageLocked', state.lockedPackage);
            } else {
                io.emit('packageLocked', state.lockedPackage);
            }
        } catch(err) {
            console.error("Lỗi khi lockPackage:", err);
        }
    });

    // --- ADMIN: Chuyển câu trong gói (Mode 2 & 3) ---
    socket.on('nextQuestionInPackage', (data) => {
        try {
            const state = getActiveState(socket);
            if (!data) data = {};
            if (data.cancel) {
                state.lockedPackage = null;
                state.pendingPackage = null;
                
                if (state.currentQuestion && state.currentQuestion.active) {
                    state.currentQuestion.active = false;
                    state.currentQuestion.mainTeamId = null;
                    state.currentQuestion.isHopeStar = false;
                    state.buzzedTeam = null;
                    state.isBuzzerLocked = true;
                    clearBuzzerTimeout(typeof state !== 'undefined' ? state : gameState);
                }
                state.currentQuestion = null;
                broadcastState(socket);
                return;
            }

            let pkg = state.lockedPackage;
            if (!pkg || !Array.isArray(pkg.questions)) return;

            if (data.revealOnly) {
                if (state.currentQuestion) {
                    state.currentQuestion.isHidden = false;
                    state.currentQuestion.text = data.text || state.currentQuestion.text || "";
                    state.currentQuestion.answer = data.answer || state.currentQuestion.answer || "";
                    state.currentQuestion.vid = data.vid || state.currentQuestion.vid || "";
                    if (pkg.questions[pkg.currentIndex]) {
                        state.currentQuestion.points = pkg.questions[pkg.currentIndex].points;
                    }
                }
                broadcastState(socket);
                return;
            }

            if (pkg.currentIndex >= 0 && pkg.currentIndex < pkg.questions.length - 1) {
                let mainTeamId = pkg.mainTeamId || (state.currentQuestion ? state.currentQuestion.mainTeamId : null);
                if (mainTeamId !== null) {
                    if (!state.turnStats) state.turnStats = {};
                    if (!state.turnStats[mainTeamId]) state.turnStats[mainTeamId] = 0;
                    state.turnStats[mainTeamId]++;
                }
            }

            pkg.currentIndex++;

            if (pkg.currentIndex < pkg.questions.length) {
                let qData = pkg.questions[pkg.currentIndex] || {};
                let qText = data.text || "";
                let qAns = data.answer || "";
                let qVid = data.vid || "";
                if (!qText && state.questionBank && state.questionBank[qData.points] && state.questionBank[qData.points][qData.idx]) {
                    qText = state.questionBank[qData.points][qData.idx].q || "";
                    qAns = state.questionBank[qData.points][qData.idx].a || "";
                    qVid = state.questionBank[qData.points][qData.idx].vid || "";
                }

                state.currentQuestion = {
                    active: true,
                    resolved: false,
                    points: qData.points || 0,
                    mainTeamId: pkg.mainTeamId || 1,
                    isHopeStar: false,
                    deductedFromMain: false,
                    text: qText,
                    answer: qAns,
                    vid: qVid,
                    idx: qData.idx,
                    isHidden: false,
                    mode: pkg.mode
                };
                
                state.isGridVisibleOnOverlay = false;
                resetBuzzerState(typeof state !== 'undefined' ? state : gameState);
                broadcastState(socket);
            } else {
                // End of package
                state.lockedPackage = null;
                state.isGridVisibleOnOverlay = false;
                broadcastState(socket);
            }
        } catch (err) {
            console.error("Lỗi khi nextQuestionInPackage:", err);
        }
    });

    socket.on('syncPendingPackage', (data) => {
        const state = getActiveState(socket);
state.pendingPackage = data;
        broadcastState(socket);
        if (data.playSound !== false) {
            playSoundInRoom(socket, 'choose_each_question');
        }
    });

    socket.on('setActiveBankSlot', (slotId) => {
        const state = getActiveState(socket);
state.activeBankSlot = slotId;
        saveStateToDiskSync();
        broadcastState(socket);
    });

    // --- ADMIN: Đội chính ĐÚNG ---
    socket.on('correctMainTeam', () => {
        const state = getActiveState(socket);
        if (!state) return;
        let q = state.currentQuestion || {};
        if (!q.active || !q.mainTeamId || q.resolved) return;

        let team = state.teams.find(t => t.id === q.mainTeamId);
        if (team) {
            let pts = q.isHopeStar ? q.points * 2 : q.points;
            team.score += pts;
            
            if (!state.scoreLog) state.scoreLog = [];
            state.scoreLog.unshift({ id: require('crypto').randomUUID(), time: Date.now(), teamId: team.id, delta: pts, reason: "Đội chính trả lời ĐÚNG" });
            if (state.scoreLog.length > 50) state.scoreLog.pop();
        }
        q.resolved = true;
        // Không reset isHopeStar ở đây - để MC tắt thủ công
        if (state.turnStats && state.turnStats[q.mainTeamId] >= (state.settings.questionsPerTeam || 3)) {
            state.turnOrder = state.turnOrder.filter(id => id !== q.mainTeamId);
        }
        updateTurnOrder(state); // Sort after score change
        broadcastState(socket);
        playSoundInRoom(socket, 'correct');
    });

    // --- ADMIN: Đội chính SAI / Mở chuông giành quyền ---
    socket.on('startBuzzer', (data) => {
        let customDuration, pin;
        if (typeof data === 'object' && data !== null) {
            customDuration = data.duration;
            pin = data.pin;
        } else {
            customDuration = data;
        }
        if (pin) {
            const normalizedPin = pin.toString().trim().replace(/\D/g, '').padStart(6, '0');
            if (normalizedPin && normalizedPin !== '000000') {
                socket.currentRoomPin = normalizedPin;
                socket.join(normalizedPin);
            }
        }
        const state = getActiveState(socket);
        if (!state) return;
        const roomPin = socket.currentRoomPin || (state && state.roomPIN) || null;
        if (roomPin && !state.roomPIN) state.roomPIN = roomPin;

        if (!state.currentQuestion) {
            state.currentQuestion = { active: false, points: 10, mainTeamId: null, isHopeStar: false };
        }
        let q = state.currentQuestion;

        if (q && q.active && q.isHopeStar && !q.deductedFromMain) {
            let team = state.teams.find(t => t.id === q.mainTeamId);
            if (team) { 
                team.score -= q.points; 
                if (team.score < 0) team.score = 0; 

                if (!state.scoreLog) state.scoreLog = [];
                state.scoreLog.unshift({ id: require('crypto').randomUUID(), time: Date.now(), teamId: team.id, delta: -q.points, reason: "Đội chính SAI (Ngôi sao hy vọng)" });
                if (state.scoreLog.length > 50) state.scoreLog.pop();
            }
            q.deductedFromMain = true;
        }

        const duration = (typeof customDuration === 'number' && customDuration > 0) ? customDuration : ((state.settings && state.settings.buzzerDuration) ? state.settings.buzzerDuration : 5);

        state.buzzedTeam = null;
        state.isBuzzerLocked = false;
        state.buzzerUnlockTime = Date.now();
        state.buzzToken = require('crypto').randomUUID();
        state.buzzTimes = {};

        const buzzerPayload = {
            duration: duration,
            buzzToken: state.buzzToken,
            mainTeamId: (state.currentQuestion && state.currentQuestion.mainTeamId) || null,
            unlockTime: state.buzzerUnlockTime,
            pin: roomPin
        };
        if (roomPin) {
            io.to(roomPin).emit('openBuzzer', buzzerPayload);
            io.sockets.sockets.forEach(s => {
                if (s.currentRoomPin === roomPin) s.emit('openBuzzer', buzzerPayload);
            });
        } else {
            io.emit('openBuzzer', buzzerPayload);
        }

        broadcastState(socket);
        playSoundInRoom(socket, 'buzzer_5s', roomPin);

        let hideBar = (state.settings && state.settings.disableBuzzerTimerBar) || false;
        if (!hideBar) {
            if (roomPin) {
                io.to(roomPin).emit('startCountdown', duration);
            } else {
                io.emit('startCountdown', duration);
            }
        }

        setRoomBuzzerTimeout(roomPin, setTimeout(() => {
            if (!state.isBuzzerLocked && state.buzzedTeam === null) {
                state.isBuzzerLocked = true;
                const lockPayload = { pin: roomPin };
                if (roomPin) {
                    io.to(roomPin).emit('lockBuzzer', lockPayload);
                    io.sockets.sockets.forEach(s => {
                        if (s.currentRoomPin === roomPin) s.emit('lockBuzzer', lockPayload);
                    });
                } else {
                    io.emit('lockBuzzer', lockPayload);
                }
                broadcastState(socket);
            }
        }, duration * 1000));
    });

    // --- ADMIN: Đội giành quyền ĐÚNG ---
    socket.on('correctBuzzedTeam', () => {
        const state = getActiveState(socket);
        if (!state) return;
        let q = state.currentQuestion || {};
        let buzzedId = state.buzzedTeam;

        if (buzzedId && !q.resolved) {
            let bTeam = state.teams.find(t => t.id === buzzedId);
            let pts = (q && q.points) ? q.points : 10;
            if (bTeam) {
                bTeam.score += pts;
                if (!state.scoreLog) state.scoreLog = [];
                state.scoreLog.unshift({ id: require('crypto').randomUUID(), time: Date.now(), teamId: bTeam.id, delta: pts, reason: "Giành quyền trả lời ĐÚNG" });
            }

            if (q.active && q.mainTeamId && !q.deductedFromMain) {
                let mTeam = state.teams.find(t => t.id === q.mainTeamId);
                if (mTeam && mTeam.id !== buzzedId) { 
                    mTeam.score -= pts; 
                    if (mTeam.score < 0) mTeam.score = 0; 
                    
                    if (!state.scoreLog) state.scoreLog = [];
                    state.scoreLog.unshift({ id: require('crypto').randomUUID(), time: Date.now(), teamId: mTeam.id, delta: -pts, reason: "Bị trừ vì đội khác giành quyền" });
                }
                q.deductedFromMain = true;
            }
            if (state.scoreLog && state.scoreLog.length > 50) state.scoreLog.length = 50;
        }
        q.resolved = true;
        // Không reset isHopeStar ở đây - để MC tắt thủ công
        state.isBuzzerLocked = true;
        if (q.mainTeamId && state.turnStats && state.turnStats[q.mainTeamId] >= (state.settings.questionsPerTeam || 3)) {
            state.turnOrder = state.turnOrder.filter(id => id !== q.mainTeamId);
        }
        updateTurnOrder(state); // Sort after score change
        broadcastState(socket);
        playSoundInRoom(socket, 'correct');
    });

    // --- ADMIN: Đội giành quyền SAI ---
    socket.on('wrongBuzzedTeam', () => {
        const state = getActiveState(socket);
        if (!state) return;
        let q = state.currentQuestion || {};
        let buzzedId = state.buzzedTeam;
        let pts = (q && q.points) ? q.points : 10;

        if (buzzedId && !q.resolved) {
            updateTeamScore(buzzedId, -(pts / 2), "Bấm chuông trả lời SAI", state);
        }

        q.resolved = true;
        // Không reset isHopeStar ở đây - để MC tắt thủ công
        state.buzzedTeam = null;
        state.isBuzzerLocked = true;
        state.buzzerUnlockTime = null;
        state.buzzTimes = {};

        clearBuzzerTimeout(typeof state !== 'undefined' ? state : gameState);

        broadcastState(socket);
        playSoundInRoom(socket, 'wrong');
    });

    // --- ADMIN: Đóng câu hỏi, quay về Grid ---
    socket.on('closeQuestion', () => {
        const state = getActiveState(socket);
        let mainTeamId = (state.currentQuestion && state.currentQuestion.mainTeamId) ? state.currentQuestion.mainTeamId : null;

        if (state.currentQuestion) {
            state.currentQuestion.active = false;
            state.currentQuestion.mainTeamId = null;
            state.currentQuestion.isHopeStar = false;
            state.currentQuestion.resolved = false; // Reset trạng thái
        }

        state.buzzedTeam = null;
        state.isBuzzerLocked = true;

        clearBuzzerTimeout(typeof state !== 'undefined' ? state : gameState);

        // Tăng đếm số câu đã chơi SAU KHI đóng câu hỏi
        if (mainTeamId !== null) {
            if (!state.turnStats) state.turnStats = {};
            if (!state.turnStats[mainTeamId]) {
                state.turnStats[mainTeamId] = 0;
            }
            state.turnStats[mainTeamId]++;
            
            if (state.turnStats[mainTeamId] >= (state.settings.questionsPerTeam || 3)) {
                if (state.turnOrder) state.turnOrder = state.turnOrder.filter(id => id !== mainTeamId);
                if (!state.turnOrder || state.turnOrder.length === 0) updateTurnOrder(state);
                state.isGridVisibleOnOverlay = false;
                playSoundInRoom(socket, 'finish_turn');
            } else {
                state.isGridVisibleOnOverlay = true;
            }
        }

        broadcastState(socket);
    });

    // --- ADMIN: Sửa câu hỏi hiện tại ---
    socket.on('editCurrentQuestion', (data) => {
        const state = getActiveState(socket);
        if (!socket.isAdmin) return;
        if (state.currentQuestion && state.currentQuestion.active) {
            state.currentQuestion.text = data.text;
            state.currentQuestion.answer = data.answer;
            broadcastState(socket);
        }
    });

    socket.on('undoScore', (logId) => {
        const state = getActiveState(socket);
if (!socket.isAdmin || !state.scoreLog) return;
        let logIndex = state.scoreLog.findIndex(l => l.id === logId);
        if (logIndex !== -1) {
            let log = state.scoreLog[logIndex];
            let team = state.teams.find(t => t.id === log.teamId);
            if (team) {
                team.score -= log.delta;
                if (team.score < 0) team.score = 0;
            }
            state.scoreLog.splice(logIndex, 1);
            updateTurnOrder(state);
            broadcastState(socket);
        }
    });

    // --- ADMIN: Chỉnh điểm thủ công ---
    socket.on('updateTeamAvatarSettings', (data) => {
        const state = getActiveState(socket);
let team = state.teams.find(t => t.id === data.id);
        if (team) {
            if (data.avatarSize !== undefined) team.avatarSize = data.avatarSize;
            if (data.avatarOverlap !== undefined) team.avatarOverlap = data.avatarOverlap;
            if (data.avatarOffsetX !== undefined) team.avatarOffsetX = data.avatarOffsetX;
            broadcastState(socket);
        }
    });

    // Cập nhật cài đặt chung avatar cho tất cả các đội
    socket.on('updateAllAvatarSettings', (data) => {
        const state = getActiveState(socket);
        state.teams.forEach(t => {
            if (data.avatarSize !== undefined) t.avatarSize = data.avatarSize;
            if (data.avatarOverlap !== undefined) t.avatarOverlap = data.avatarOverlap;
            if (data.avatarOffsetX !== undefined) t.avatarOffsetX = data.avatarOffsetX;
        });
        broadcastState(socket);
    });

    socket.on('updateScore', (data) => {
        const state = getActiveState(socket);
        updateTeamScore(data.teamId, data.points, "Chỉnh sửa thủ công", state);
        broadcastState(socket);
    });

    // --- ADMIN: Kết thúc phần chơi của đội hiện tại ---
    socket.on('finishTurn', () => {
        const state = getActiveState(socket);
        let teamId = null;
        if (state.turnOrder && state.turnOrder.length > 0) {
            teamId = state.turnOrder.shift(); // Gỡ đội hiện tại ra khỏi lượt
        } else if (state.currentQuestion && state.currentQuestion.mainTeamId) {
            teamId = state.currentQuestion.mainTeamId;
        }

        if (teamId && state.forcedTeamId === teamId) state.forcedTeamId = null;

        if (state.currentQuestion && state.currentQuestion.active) {
            state.currentQuestion.active = false;
            state.currentQuestion.mainTeamId = null;
            state.currentQuestion.isHopeStar = false;
            state.buzzedTeam = null;
            state.isBuzzerLocked = true;
            clearBuzzerTimeout(typeof state !== 'undefined' ? state : gameState);
        }
        state.currentQuestion = { active: false };

        state.lockedPackage = null;
        state.pendingPackage = null;
        state.isGridVisibleOnOverlay = false;
        if (state.turnOrder && state.turnOrder.length === 0) updateTurnOrder(state);

        broadcastState(socket);
        playSoundInRoom(socket, 'finish_turn');
    });

    // --- ADMIN: Kết thúc phần chơi cho một đội cụ thể ---
    socket.on('finishTurnForTeam', (teamId) => {
        const state = getActiveState(socket);
if (state.turnOrder && state.turnOrder.includes(teamId)) {
            if (state.forcedTeamId === teamId) state.forcedTeamId = null;
            state.turnOrder = state.turnOrder.filter(id => id !== teamId);
            
            if (state.currentQuestion && state.currentQuestion.active && state.currentQuestion.mainTeamId === teamId) {
                state.currentQuestion.active = false;
                state.currentQuestion.mainTeamId = null;
                state.currentQuestion.isHopeStar = false;
                state.buzzedTeam = null;
                state.isBuzzerLocked = true;
                clearBuzzerTimeout(typeof state !== 'undefined' ? state : gameState);
            }
            state.currentQuestion = { active: false };
            
            state.lockedPackage = null;
            state.pendingPackage = null;
            state.isGridVisibleOnOverlay = false;
            if (state.turnOrder.length === 0) updateTurnOrder(state);
            
            broadcastState(socket);
            playSoundInRoom(socket, 'finish_turn');
        }
    });
    // --- ADMIN: Cài đặt Hệ thống đồ hoạ ---
    socket.on('updateSettings', (newSettings) => {
        const state = getActiveState(socket);
let oldQuestionsPerTeam = state.settings.questionsPerTeam || 3;
        let oldRule = state.settings.turnOrderRule || 'mode_asc';
        state.settings = { ...state.settings, ...newSettings };
        let newQuestionsPerTeam = state.settings.questionsPerTeam || 3;
        let newRule = state.settings.turnOrderRule || 'mode_asc';

        // Xử lý khi thay đổi số câu hỏi mỗi đội
        if (newSettings.questionsPerTeam !== undefined && oldQuestionsPerTeam !== newQuestionsPerTeam) {
            let changed = false;
            state.turnOrder = state.turnOrder.filter(id => {
                if (state.turnStats[id] && state.turnStats[id] >= newQuestionsPerTeam) {
                    changed = true;
                    return false;
                }
                return true;
            });
            if (changed && state.turnOrder.length === 0) {
                updateTurnOrder(state);
            }
        }

        if (newSettings.turnOrderRule !== undefined && oldRule !== newRule) {
            updateTurnOrder(state, false);
        }

        broadcastState(socket);
    });

    // --- ADMIN: VÒNG 1 (TIMER CONFIG) ---
    socket.on('update-timer-config', (config) => {
        const state = getActiveState(socket);
        state.timerConfig = { ...state.timerConfig, ...config };
        if (socket.currentRoomPin) {
            io.to(socket.currentRoomPin).emit('timer-config-updated', state.timerConfig);
        } else {
            io.emit('timer-config-updated', state.timerConfig);
        }
        scheduleSaveRooms(2000);
    });

    socket.on('forceUpdateTurnOrder', () => {
        const state = getActiveState(socket);
        updateTurnOrder(state, false);
        broadcastState(socket);
    });

    socket.on('timer-action', (action) => {
        if (socket.currentRoomPin) {
            io.to(socket.currentRoomPin).emit('timer-action', action);
        } else {
            io.emit('timer-action', action);
        }
    });

    socket.on('change-round', (roundNum) => {
        const state = getActiveState(socket);
        state.activeRound = roundNum;
        state.forcedTeamId = null;
        state.turnStats = {};
        state.turnOrder = [];
        updateTurnOrder(state, false);
        broadcastState(socket);
    });

    socket.on('stop-timer', () => {
        if (socket.currentRoomPin) {
            io.to(socket.currentRoomPin).emit('timer-action', { type: 'PAUSE' });
        } else {
            io.emit('timer-action', { type: 'PAUSE' });
        }
    });
    // --- PPT FILE WATCHER ---
    let pptWatcher = null;
    let pptWatchTimeout = null;

    async function setupPptWatcher() {
        try {
            const activePath = await pptController.getActivePresentationPath();
            if (activePath && activePath.trim() !== "" && activePath.toLowerCase().endsWith('.pptx')) {
                if (pptWatcher) {
                    pptWatcher.close();
                }
                pptWatcher = chokidar.watch(activePath, {
                    persistent: true,
                    awaitWriteFinish: {
                        stabilityThreshold: 500,
                        pollInterval: 100
                    }
                });

                pptWatcher.on('change', () => {
                    // Debounce: Wait 2 seconds before generating thumbnails
                    if (pptWatchTimeout) clearTimeout(pptWatchTimeout);
                    pptWatchTimeout = setTimeout(async () => {
                        console.log('PPT File saved! Regenerating ONLY current slide thumbnail...');
                        try {
                            const statusStr = await pptController.getStatus();
                            if (statusStr.startsWith("{")) {
                                const status = JSON.parse(statusStr);
                                broadcastPptStatus(statusStr);
                                
                                // Update only the current slide
                                const currentSlide = status.currentSlide;
                                const fileName = `slide_${currentSlide}.jpg`;
                                const filePath = path.join(thumbsDir, fileName);
                                
                                await pptController.exportThumbnail(currentSlide, filePath);
                                io.emit('ppt-thumbnails-ready', { index: currentSlide, url: `temp_thumbs/${fileName}?t=${Date.now()}` });
                            }
                        } catch (e) {}
                    }, 2000);
                });
            }
        } catch (e) {}
    }

    // --- ADMIN: VÒNG 1 (POWERPOINT CONTROL) ---
    // PPT Thumbnails cache state
    let isCachingThumbnails = false;

    async function startCachingThumbnails(totalSlides) {
        if (isCachingThumbnails) return;
        isCachingThumbnails = true;
        
        // Let's cache them one by one with a small delay so we don't block the UI
        for (let i = 1; i <= totalSlides; i++) {
            if (!isCachingThumbnails) break; // if someone refreshed, we might abort or restart
            const fileName = `slide_${i}.jpg`;
            const filePath = path.join(thumbsDir, fileName);
            await pptController.exportThumbnail(i, filePath);
            io.emit('ppt-thumbnails-ready', { index: i, url: `temp_thumbs/${fileName}?t=${Date.now()}` });
            await new Promise(r => setTimeout(r, 100)); // 100ms delay between slides
        }
        isCachingThumbnails = false;
    }

    socket.on('ppt-refresh-thumbs', async () => {
        isCachingThumbnails = false; // stop current
        setTimeout(async () => {
            try {
                const statusStr = await pptController.getStatus();
                if (statusStr.startsWith("{")) {
                    const status = JSON.parse(statusStr);
                    startCachingThumbnails(status.totalSlides);
                }
            } catch (e) {}
        }, 500);
    });

    async function broadcastPptStatus(statusStr) {
        if (statusStr && statusStr.startsWith("{")) {
            try {
                const status = JSON.parse(statusStr);
                io.emit('ppt-status', status);
            } catch (e) {}
        }
    }

    let lastPptStatusStr = "";
    pptController.onAsyncStatus = (statusStr) => {
        if (statusStr && statusStr.startsWith("{") && statusStr !== lastPptStatusStr) {
            lastPptStatusStr = statusStr;
            broadcastPptStatus(statusStr);
        }
    };

    socket.on('ppt-next', async () => {
        const pin = socket.currentRoomPin;
        if (pin) {
            const status = roomManager.nextSlide(pin);
            if (status) io.to(pin).emit('ppt-status', status);
            return;
        }
        const statusStr = await pptController.nextSlideAndGetNotes();
        broadcastPptStatus(statusStr);
    });

    socket.on('ppt-prev', async () => {
        const pin = socket.currentRoomPin;
        if (pin) {
            const status = roomManager.prevSlide(pin);
            if (status) io.to(pin).emit('ppt-status', status);
            return;
        }
        const statusStr = await pptController.prevSlideAndGetNotes();
        broadcastPptStatus(statusStr);
    });

    socket.on('ppt-prewarm', async () => {
        const pin = socket.currentRoomPin;
        if (pin) {
            socket.emit('ppt-prewarm-done');
            return;
        }
        await pptController.getStatus();
        socket.emit('ppt-prewarm-done');
    });

    socket.on('ppt-sync', async () => {
        const pin = socket.currentRoomPin;
        if (pin) {
            const status = roomManager.getSlideStatus(pin);
            if (status) io.to(pin).emit('ppt-status', status);
            return;
        }
        const statusStr = await pptController.getStatus();
        broadcastPptStatus(statusStr);
        try {
            if (statusStr.startsWith("{")) {
                const status = JSON.parse(statusStr);
                startCachingThumbnails(status.totalSlides);
                setupPptWatcher(); // setup watcher when synced
            }
        } catch (e) {}
    });

    socket.on('ppt-jump', async (slideIndex) => {
        const pin = socket.currentRoomPin;
        if (pin) {
            const status = roomManager.gotoSlide(pin, slideIndex);
            if (status) io.to(pin).emit('ppt-status', status);
            return;
        }
        const statusStr = await pptController.gotoSlide(slideIndex);
        broadcastPptStatus(statusStr);
    });

    socket.on('resetGame', () => {
        const state = getActiveState(socket);
        state.teams.forEach(t => t.score = 0);
        state.forcedTeamId = null;
        resetBuzzerState(state);
        state.antiCheatViolations = {};
        state.bannedTeams = [];
        state.currentQuestion = {
            active: false, points: 0, mainTeamId: null,
            isHopeStar: false, deductedFromMain: false, text: "", answer: "", idx: null
        };
        state.isGridVisibleOnOverlay = false;
        state.showOverallScoreboard = false;
        state.activeBankSlot = null;
        state.lockedPackage = null;
        state.pendingPackage = null;
        state.currentMedia = null;
        state.isVideoPlaying = false;
        state.playedQuestions = { "10": [], "20": [], "40": [] };
        state.turnStats = {};
        state.turnOrder = []; // Bắt buộc nạp lại toàn bộ các đội
        updateTurnOrder(state);
        if (socket.currentRoomPin) {
            scheduleSaveRooms(100);
            io.to(socket.currentRoomPin).emit('timer-action', { type: 'STOP' });
        } else {
            saveStateToDiskSync();
            io.emit('timer-action', { type: 'STOP' });
        }
        broadcastState(socket);
    });

    socket.on('changeTeamCount', (newCount) => {
        const state = getActiveState(socket);
if (newCount < 2 || newCount > 6) return;
        state.forcedTeamId = null;
        state.settings.teamCount = newCount;

        let newTeams = [];
        for (let i = 1; i <= newCount; i++) {
            let existing = state.teams.find(t => t.id === i);
            if (existing) {
                newTeams.push(existing);
            } else {
                newTeams.push({ id: i, name: "Đội " + i, school: "", score: 0, avatarSize: 100, avatarOverlap: 10 });
            }
        }
        state.teams = newTeams;

        // Cập nhật lại avatar timestamps
        let newTimestamps = {};
        for (let i = 1; i <= newCount; i++) {
            newTimestamps[i] = state.avatarTimestamps[i] || 1;
        }
        state.avatarTimestamps = newTimestamps;

        // Reset toàn bộ game để tương thích với số lượng đội mới
        state.teams.forEach(t => t.score = 0);
        resetBuzzerState(typeof state !== 'undefined' ? state : gameState);
        state.currentQuestion = {
            active: false, points: 0, mainTeamId: null,
            isHopeStar: false, deductedFromMain: false, text: "", answer: "", idx: null
        };
        state.isGridVisibleOnOverlay = false;
        state.playedQuestions = { "10": [], "20": [], "40": [] };
        state.turnStats = {};
        state.turnOrder = [];
        updateTurnOrder(state, false);
        broadcastState(socket);
    });

    // --- ADMIN: Cập nhật Video câu hỏi ---
    socket.on('updateCurrentQuestionVideo', (data) => {
        const state = getActiveState(socket);
        if (state.currentQuestion) {
            state.currentQuestion.vid = (data && data.vid) ? data.vid : "";
            broadcastState(socket);
            if (state.currentQuestion.vid) {
                if (socket.currentRoomPin) io.to(socket.currentRoomPin).emit('preloadVideo', state.currentQuestion.vid);
                else io.emit('preloadVideo', state.currentQuestion.vid);
            }
        }
    });

    // --- ADMIN: Phát Video ---
    socket.on('playVideo', (url) => {
        authorizedVideoPath = url;
        if(socket.currentRoomPin) io.to(socket.currentRoomPin).emit('playVideo', url); else io.emit('playVideo', url);
    });

    // --- ADMIN: Đóng Video ---
    socket.on('closeVideo', () => {
        authorizedVideoPath = null;
        if(socket.currentRoomPin) io.to(socket.currentRoomPin).emit('closeVideo'); else io.emit('closeVideo');
    });

    socket.on('videoSync', (time) => {
        if(socket.currentRoomPin) socket.to(socket.currentRoomPin).emit('videoSync', time); else socket.broadcast.emit('videoSync', time);
    });

    socket.on('videoPlayState', (state) => {
        if(socket.currentRoomPin) socket.to(socket.currentRoomPin).emit('videoPlayState', state); else socket.broadcast.emit('videoPlayState', state);
    });

    // --- ADMIN: Hàm lấy tất cả IP (LAN, VPN)
    function getLocalIPs() {
        const interfaces = os.networkInterfaces();
        const ips = [];
        for (let k in interfaces) {
            for (let k2 in interfaces[k]) {
                let address = interfaces[k][k2];
                if (address.family === 'IPv4' && !address.internal) {
                    ips.push(address.address);
                }
            }
        }
        return ips;
    }

    // --- ADMIN: Bắt đầu đếm ngược ---
    socket.on('startCountdown', (seconds) => {
        if (socket.currentRoomPin) {
            io.to(socket.currentRoomPin).emit('startCountdown', seconds);
        } else {
            io.emit('startCountdown', seconds);
        }
        playSoundInRoom(socket, seconds === 10 ? 'countdown_10s' : 'countdown_15s');
    });

// Duplicate claimTeam removed

    // --- THÍ SINH: Bấm chuông ---
    socket.on('buzz', (data, tokenArg) => {
        let teamId, token, clientId, pin;
        if (typeof data === 'object' && data !== null) {
            teamId = parseInt(data.teamId);
            token = data.token;
            clientId = data.clientId;
            pin = data.pin;
        } else {
            teamId = parseInt(data);
            token = tokenArg;
        }

        if (pin && !socket.currentRoomPin) {
            const roomPin = pin.toString().trim().replace(/\D/g, '').padStart(6, '0');
            socket.currentRoomPin = roomPin;
            socket.join(roomPin);
        }

        const state = getActiveState(socket);
        if (!state) return;
        
        // Chống gian lận: Yêu cầu phải gửi kèm buzzToken khớp với server
        if (state.buzzToken && token && token !== state.buzzToken) {
            console.log(`[BUZZ] Token mismatch for team ${teamId} (client token: ${token}, server token: ${state.buzzToken}).`);
            if (state.isBuzzerLocked || state.buzzedTeam !== null) {
                return;
            }
        }
        
        // Xác minh xem socket này có đúng là người sở hữu đội không
        if (!state.claimedTeams) state.claimedTeams = {};
        let claim = state.claimedTeams[teamId];
        if (!claim) {
            state.claimedTeams[teamId] = { socketId: socket.id, clientId: clientId || socket.clientId, teamId: teamId };
            claim = state.claimedTeams[teamId];
        }
        if (claim && claim.socketId !== socket.id) {
            const isMatch = (clientId && claim.clientId === clientId) || 
                            (socket.clientId && claim.clientId === socket.clientId) || 
                            (socket.teamId && Number(socket.teamId) === Number(teamId)) ||
                            (!claim.clientId);
            if (isMatch) {
                claim.socketId = socket.id;
                if (clientId) claim.clientId = clientId;
            } else {
                return;
            }
        }
        
        // Ngăn đội chính bấm chuông giành quyền trong câu hỏi của chính họ
        if (state.currentQuestion && state.currentQuestion.active && state.currentQuestion.mainTeamId != null && Number(state.currentQuestion.mainTeamId) === Number(teamId)) return;

        let isNewBuzz = false;
        if (state.buzzerUnlockTime && state.buzzTimes && typeof state.buzzTimes[teamId] !== 'number') {
            let elapsed = Date.now() - state.buzzerUnlockTime;
            if (elapsed <= 5000) {
                state.buzzTimes[teamId] = elapsed;
                isNewBuzz = true;
            }
        }

        if (!state.isBuzzerLocked && state.buzzedTeam === null && !state.pendingBuzzerTeam) {
            playSoundInRoom(socket, 'buzzed');
            
            let delay = state.settings && state.settings.buzzerDelayMs !== undefined ? state.settings.buzzerDelayMs : 500;
            const roomPin = socket.currentRoomPin || (state && state.roomPIN) || null;
            if (delay > 0) {
                state.pendingBuzzerTeam = teamId;
                setRoomBuzzerDelayTimer(roomPin, setTimeout(() => {
                    if (state.pendingBuzzerTeam === teamId) {
                        state.buzzedTeam = teamId;
                        state.pendingBuzzerTeam = null;
                        const buzzedPayload = {
                            buzzedTeam: teamId,
                            buzzTimes: state.buzzTimes,
                            pin: roomPin
                        };
                        if (roomPin) {
                            io.to(roomPin).emit('buzzed', buzzedPayload);
                            io.sockets.sockets.forEach(s => {
                                if (s.currentRoomPin === roomPin) s.emit('buzzed', buzzedPayload);
                            });
                        } else {
                            io.emit('buzzed', buzzedPayload);
                        }
                        broadcastState(socket);
                    }
                }, delay));
            } else {
                state.buzzedTeam = teamId;
                const buzzedPayload = {
                    buzzedTeam: teamId,
                    buzzTimes: state.buzzTimes,
                    pin: roomPin
                };
                if (roomPin) {
                    io.to(roomPin).emit('buzzed', buzzedPayload);
                    io.sockets.sockets.forEach(s => {
                        if (s.currentRoomPin === roomPin) s.emit('buzzed', buzzedPayload);
                    });
                } else {
                    io.emit('buzzed', buzzedPayload);
                }
                broadcastState(socket);
            }
        } else if (isNewBuzz) {
            // Cập nhật lại cho admin thấy thời gian của các đội khác
            broadcastState(socket);
        }
    });

    // --- NGẮT KẾT NỐI -> Xử lý giải phóng đội an toàn (có grace period) ---
    socket.on('disconnect', () => {
        const roomPin = socket.currentRoomPin;
        if (roomPin) {
            const room = roomManager.getRoom(roomPin);
            if (room) {
                if (room.connectedClients) room.connectedClients.delete(socket.id);
                const state = room.gameState;
                if (state.claimedTeams) {
                    for (let tid in state.claimedTeams) {
                        if (state.claimedTeams[tid].socketId === socket.id) {
                            state.claimedTeams[tid].disconnectedAt = Date.now();
                            // Grace period 30s trước khi giải phóng hoàn toàn
                            setTimeout(() => {
                                const currentRoom = roomManager.getRoom(roomPin);
                                if (currentRoom && currentRoom.gameState && currentRoom.gameState.claimedTeams) {
                                    const c = currentRoom.gameState.claimedTeams[tid];
                                    if (c && c.socketId === socket.id && c.disconnectedAt) {
                                        delete currentRoom.gameState.claimedTeams[tid];
                                        broadcastState(null, 'updateState', currentRoom.gameState);
                                        scheduleSaveRooms(2000);
                                    }
                                }
                            }, 30000);
                        }
                    }
                }
                broadcastDeviceStatus(roomPin);
            }
        } else {
            // Legacy desktop mode fallback
            let changed = false;
            for (let tid in gameState.claimedTeams) {
                if (gameState.claimedTeams[tid].socketId === socket.id) {
                    delete gameState.claimedTeams[tid];
                    changed = true;
                }
            }
            if (changed) io.emit('updateState', gameState);
        }
    });

    // --- ANTI-CHEAT: Ghi nhận gian lận và mở khoá ---
    socket.on('antiCheatViolation', (data) => {
        const state = getActiveState(socket);
        let tid = data.teamId;
        if (!tid) return;

        if (!state.antiCheatViolations) state.antiCheatViolations = {};
        if (!state.bannedTeams) state.bannedTeams = [];

        if (state.bannedTeams.includes(tid)) return;

        state.antiCheatViolations[tid] = (state.antiCheatViolations[tid] || 0) + 1;
        let count = state.antiCheatViolations[tid];

        if (count >= 3) {
            state.bannedTeams.push(tid);
            if (socket.currentRoomPin) {
                io.to(socket.currentRoomPin).emit('antiCheatBanned', { teamId: tid });
            } else { io.emit('antiCheatBanned', { teamId: tid }); }
            playSoundInRoom(socket, 'wrong');
        } else {
            if (socket.currentRoomPin) {
                io.to(socket.currentRoomPin).emit('antiCheatWarning', { teamId: tid, count: count, reason: data.reason });
            } else { io.emit('antiCheatWarning', { teamId: tid, count: count, reason: data.reason }); }
        }

        broadcastState(socket);
    });
    
    socket.on('unbanTeam', (teamId) => {
        const state = getActiveState(socket);
        if (!state.bannedTeams) return;
        state.bannedTeams = state.bannedTeams.filter(id => id !== teamId);
        if (state.antiCheatViolations) {
            state.antiCheatViolations[teamId] = 0;
        }
        if (socket.currentRoomPin) {
            io.to(socket.currentRoomPin).emit('antiCheatUnbanned', { teamId: teamId });
        } else { io.emit('antiCheatUnbanned', { teamId: teamId }); }
        broadcastState(socket);
    });


    // --- LỐI THOÁT KHẨN CẤP BÍ MẬT ---
    socket.on('secretExitRequest', (data) => {
        const state = getActiveState(socket);
// Broadcast tới tất cả Admin
        io.emit('secretExitRequest', data);
    });
    
    socket.on('approveSecretExit', (data) => {
        const state = getActiveState(socket);
if (!socket.isAdmin) return;
        // Gửi lệnh thoát trực tiếp tới socket của đội yêu cầu
        for (let tid in state.claimedTeams) {
            if (tid === data.teamId) {
                io.to(state.claimedTeams[tid].socketId).emit('approveSecretExit');
                break;
            }
        }
    });

    socket.on('showOverlayGrid', () => {
        const state = getActiveState(socket);
state.isGridVisibleOnOverlay = true;
        broadcastState(socket);
        playSoundInRoom(socket, 'choose_package');
    });

    socket.on('hideOverlayGrid', () => {
        const state = getActiveState(socket);
state.isGridVisibleOnOverlay = false;
        broadcastState(socket);
    });


    // --- ADMIN: Bảng Điểm Tổng Hợp ---
    socket.on('toggleOverallScoreboard', (show) => {
        const state = getActiveState(socket);
state.showOverallScoreboard = show;
        broadcastState(socket);
    });

    socket.on('updateScoreboardBg', (base64Data) => {
        const state = getActiveState(socket);
try {
            const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const buffer = Buffer.from(matches[2], 'base64');
                const ext = matches[1] === 'image/jpeg' ? 'jpg' : 'png';
                const filename = `bg_custom_${Date.now()}.${ext}`;
                const bgPath = path.join(basePath, 'Themes', 'Background', filename);
                fs.writeFileSync(bgPath, buffer);
                state.scoreboardBg = `/Themes/Background/${filename}`;
                broadcastState(socket);
            }
        } catch(e) {
            console.error("Lỗi cập nhật ảnh nền bảng điểm:", e);
        }
    });

    socket.on('updateTeamAvatar', (data) => {
        const state = getActiveState(socket);
try {
            const matches = data.base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const buffer = Buffer.from(matches[2], 'base64');
                const avatarPath = path.join(basePath, 'Themes', 'Avatars', `${data.teamId}.png`);
                fs.writeFileSync(avatarPath, buffer);
                
                if (!state.avatarTimestamps) state.avatarTimestamps = {};
                state.avatarTimestamps[data.teamId] = Date.now();
                
                broadcastState(socket);
            }
        } catch(e) {
            console.error("Lỗi cập nhật avatar đội:", e);
        }
    });

    socket.on('setQuestionCount', (counts) => {
        const state = getActiveState(socket);
state.questionCount = counts;
        broadcastState(socket);
    });

    socket.on('getSystemFonts', () => {
        const systemFonts = Object.keys(fontDictionary);
        const combined = Array.from(new Set([...STANDARD_FONTS, ...systemFonts])).sort((a, b) => a.localeCompare(b));
        socket.emit('systemFonts', combined);
    });
});

// Use fontDictionary keys merged with standard web fonts for precise font delivery
app.get('/api/fonts', async (req, res) => {
    if (fontScanPromise) await fontScanPromise;
    const systemFonts = Object.keys(fontDictionary);
    const combined = Array.from(new Set([...STANDARD_FONTS, ...systemFonts])).sort((a, b) => a.localeCompare(b));
    res.json(combined);
});

const PORT = process.env.PORT || 39281;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server Econova Show đang chạy tại http://localhost:${PORT}`);
    console.log('Đang khởi tạo kết nối mạng ngoài (Public Link), vui lòng chờ...');
    
    global.startFixedTunnel = async function(socket, data) {
        // Obsolete function since we use Virtual LAN. Just return success with localhost to not break UI logic.
        if (socket) socket.emit('publicLinkResult', { success: true, url: 'Vui lòng dùng IP LAN ở mục 1.' });
    }
});

// Auto-save logic
let lastSavedState = "";
function saveStateToDiskSync() {
    try {
        let stateToSave = {
            roomPIN: gameState.roomPIN,
            isRoomOpen: gameState.isRoomOpen,
            teams: gameState.teams,
            playedQuestions: gameState.playedQuestions,
            turnOrder: gameState.turnOrder,
            turnStats: gameState.turnStats,
            unlockedAudios: gameState.unlockedAudios,
            hasPlayedIntro: gameState.hasPlayedIntro,
            settings: gameState.settings,
            lockedTeams: gameState.lockedTeams,
            scoreboardBg: gameState.scoreboardBg,
            avatarTimestamps: gameState.avatarTimestamps,
            questionCount: gameState.questionCount,
            lockedPackage: gameState.lockedPackage,
            teamQuestionHistory: gameState.teamQuestionHistory,
            currentQuestion: gameState.currentQuestion,
            activeBankSlot: gameState.activeBankSlot,
            pendingPackage: gameState.pendingPackage,
            antiCheatViolations: gameState.antiCheatViolations,
            bannedTeams: gameState.bannedTeams,
            timerConfig: gameState.timerConfig,
            activeRound: gameState.activeRound
        };
        let currentState = JSON.stringify(stateToSave);
        if (currentState !== lastSavedState) {
            const finalPath = STATE_FILE;
            const tempPath = STATE_FILE + '.tmp';
            fs.writeFileSync(tempPath, currentState);
            fs.renameSync(tempPath, finalPath);
            lastSavedState = currentState;
        }
    } catch (e) {
        console.error("Lỗi khi ghi đĩa gameState:", e);
    }
}
global.saveStateToDiskSync = saveStateToDiskSync;

setInterval(() => {
    saveStateToDiskSync();
}, 2000);

// Xử lý tắt an toàn (Graceful Shutdown) để không bị kẹt mạng
function gracefulShutdown() {
    console.log('\n🛑 Đang ngắt kết nối an toàn để giải phóng đường dẫn...');
    if (global.activeTunnel) {
        global.activeTunnel.close();
    }
    setTimeout(() => {
        process.exit(0);
    }, 500); // Chờ nửa giây để tín hiệu kịp gửi đi
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);