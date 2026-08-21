const express = require('express');

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
        if (safeState.currentQuestion) safeState.currentQuestion.answer = "";
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
app.use(express.json()); app.post('/log_error', (req, res) => { require('fs').appendFileSync('client_errors.log', JSON.stringify(req.body) + '\n'); res.sendStatus(200); }); app.use(express.static(path.join(__dirname, 'public')));
app.use('/public_v2', express.static(path.join(__dirname, 'public_v2')));

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
    saveRoomsToDisk();
    await saveRoomsToCloud();
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

app.post('/api/room/delete', (req, res) => {
    try {
        const { pin, password } = req.body || {};
        const auth = roomManager.verifyAdmin(pin, password);
        if (!auth.success && password !== process.env.MASTER_ADMIN_PASSWORD && password !== 'superadmin') {
            return res.status(403).json({ success: false, message: "Không có quyền gỡ phòng này!" });
        }
        const ok = roomManager.deleteRoom(pin);
        saveRooms().catch(e => console.error('[RoomPersist] save error on delete:', e));
        io.to(pin).emit('roomClosed', { message: 'Phòng thi này đã được gỡ bỏ.' });
        res.json({ success: true, message: `Đã gỡ phòng ${pin} thành công!` });
    } catch(e) {
        res.status(500).json({ success: false, message: "Lỗi máy chủ khi gỡ phòng!" });
    }
});

app.post('/api/room/create', (req, res) => {
    try {
        const { name, pin, password, mcPassword, theme, questions } = req.body || {};
        const newRoom = roomManager.createRoom({ name, pin, password, mcPassword, theme, questions });
        if (newRoom.error) {
            return res.status(400).json({ success: false, message: newRoom.message });
        }
        // Persist immediately: disk + cloud (async, non-blocking)
        saveRooms().catch(e => console.error('[RoomPersist] save error:', e));
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



app.use('/Themes', express.static(path.join(basePath, 'Themes')));
const thumbsDir = path.join(os.tmpdir(), 'econova_ppt_thumbs');
if (!fs.existsSync(thumbsDir)) {
    fs.mkdirSync(thumbsDir, { recursive: true });
}
app.use('/temp_thumbs', express.static(thumbsDir));
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));
app.use('/questions', express.static(path.join(basePath, 'questions')));
app.get('/ping', (req, res) => res.send('ok'));

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
scanFonts();

app.get('/font/:name', (req, res) => {
    let name = decodeURIComponent(req.params.name);
    let fontPath = fontDictionary[name];
    if (fontPath && fs.existsSync(fontPath)) {
        res.sendFile(fontPath);
    } else {
        res.status(404).send('Not found');
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

// Stream video cục bộ từ đường dẫn tuyệt đối
app.get('/api/video', (req, res) => {
    const videoPath = req.query.path;
    if (!videoPath || !fs.existsSync(videoPath)) {
        return res.status(404).send('Video not found');
    }
    if (videoPath !== authorizedVideoPath) {
        return res.status(403).send('Forbidden: Not authorized by Admin');
    }
    res.sendFile(path.resolve(videoPath));
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
function resetBuzzerState() {
    gameState.buzzedTeam = null;
    gameState.pendingBuzzerTeam = null;
    gameState.isBuzzerLocked = true;
    gameState.buzzerUnlockTime = null;
    gameState.buzzTimes = {};
    gameState.wrongBuzzes = [];
    if (gameState.buzzerDelayTimer) {
        clearTimeout(gameState.buzzerDelayTimer);
        gameState.buzzerDelayTimer = null;
    }
}

function clearBuzzerTimeout() {
    if (gameState.buzzerTimeout) {
        clearTimeout(gameState.buzzerTimeout);
        gameState.buzzerTimeout = null;
    }
}

function closeCurrentQuestion() {
    gameState.currentQuestion.active = false;
    gameState.currentQuestion.mainTeamId = null;
    gameState.currentQuestion.isHopeStar = false;
    gameState.currentQuestion.resolved = false;
    resetBuzzerState();
    clearBuzzerTimeout();
}
        gameState.currentQuestion = null;

function updateTeamScore(teamId, points, reason = "Chỉnh sửa thủ công") {
    let team = gameState.teams.find(t => t.id === teamId);
    if (team) {
        team.score += points;
        if (team.score < 0) team.score = 0;
        
        if (!gameState.scoreLog) gameState.scoreLog = [];
        gameState.scoreLog.unshift({ id: require('crypto').randomUUID(), time: Date.now(), teamId: teamId, delta: points, reason: reason });
        if (gameState.scoreLog.length > 50) gameState.scoreLog.pop();

        updateTurnOrder();
        io.emit('updateState', gameState);
    }
}

function updateTurnOrder(lockActive = true) {
    let rule = gameState.settings.turnOrderRule || 'mode_asc';
    let teamsToSort = gameState.teams;
    if (gameState.turnOrder && gameState.turnOrder.length > 0 && gameState.turnOrder.length < gameState.settings.teamCount) {
        teamsToSort = gameState.teams.filter(t => gameState.turnOrder.includes(t.id));
    }
    
    let lockedTeamId = null;
    if (lockActive && gameState.turnOrder && gameState.turnOrder.length > 0) {
        let candidate = gameState.turnOrder[0];
        let hasStarted = (gameState.turnStats[candidate] && gameState.turnStats[candidate] > 0);
        let isActive = (gameState.currentQuestion && gameState.currentQuestion.active && gameState.currentQuestion.mainTeamId === candidate);
        let hasLocked = (gameState.lockedPackage && gameState.lockedPackage.mainTeamId === candidate);
        let isForced = (gameState.forcedTeamId === candidate);
        
        if (hasStarted || isActive || hasLocked || isForced) {
            lockedTeamId = candidate;
        }
    }
    
    let others = teamsToSort.filter(t => t.id !== lockedTeamId);
    others.sort((a, b) => {
        let aStats = gameState.turnStats[a.id] || 0;
        let bStats = gameState.turnStats[b.id] || 0;
        if (aStats > 0 && bStats === 0) return -1;
        if (bStats > 0 && aStats === 0) return 1;
        if (aStats > 0 && bStats > 0) return gameState.turnOrder.indexOf(a.id) - gameState.turnOrder.indexOf(b.id);
        
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
    gameState.turnOrder = finalOrder;
}

// Khởi tạo lượt chơi nếu mảng trống (ví dụ: lần đầu chạy server)
if (gameState.turnOrder.length === 0) {
    updateTurnOrder();
}

// =============================================
// SOCKET.IO
// =============================================
io.on('connection', (socket) => {

    // --- MULTI-ROOM SOCKET JOIN & AUTH HANDLERS ---
    socket.on('joinRoom', (pin, callback) => {
        const roomPin = (pin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
        const room = roomManager.getRoom(roomPin);
        if (room) {
            socket.join(roomPin);
            socket.currentRoomPin = roomPin;
            room.connectedClients.add(socket.id);
            if (typeof callback === 'function') {
                callback({ success: true, room: { pin: room.pin, name: room.name, theme: room.theme }, gameState: room.gameState });
            }
            let stateToSend = room.gameState;
            if (!socket.isAdmin && !socket.isMC) {
                let safeState = JSON.parse(JSON.stringify(room.gameState));
                delete safeState.questionBank;
                delete safeState.questions;
                if (safeState.currentQuestion) safeState.currentQuestion.answer = "";
                stateToSend = safeState;
            }
            socket.emit('updateState', stateToSend);
            socket.emit('ppt-status', roomManager.getSlideStatus(roomPin));
        } else {
            if (typeof callback === 'function') {
                callback({ success: false, message: "Phòng không tồn tại!" });
            }
        }
    });

    socket.on('verifyRoomPIN', (pin, callback) => {
        const roomPin = (pin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
        const result = roomManager.verifyContestant(roomPin);
        if (result.success) {
            socket.join(roomPin);
            socket.currentRoomPin = roomPin;
            result.room.connectedClients.add(socket.id);
        }
        if (typeof callback === 'function') callback(result);
    });

    socket.on('deleteRoom', (pin, callback) => {
        if (!socket.isAdmin) {
            if (typeof callback === 'function') callback({ success: false, message: 'Unauthorized' });
            return;
        }
        const targetPin = (pin || socket.currentRoomPin || '').toString().trim().replace(/\D/g, '').padStart(6, '0');
        roomManager.deleteRoom(targetPin);
        saveRooms().catch(e => console.error('[RoomPersist] save error on delete:', e));
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
            socket.emit('updateState', result.room.gameState || gameState);
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
            socket.emit('updateState', result.room.gameState || gameState);
            socket.emit('ppt-status', roomManager.getSlideStatus(result.room.pin));
        }
        if (typeof callback === 'function') callback(result);
    });

    // Danh sách các event MC được phép gọi
    const mcAllowedEvents = [
        'correctMainTeam', 'startBuzzer', 'correctBuzzedTeam', 'wrongBuzzedTeam',
        'startCountdown', 'playSound', 'closeQuestion'
    ];

    socket.use(([event, ...args], next) => {
        const publicEvents = ['adminLogin', 'mcLogin', 'verifyRoomPIN', 'claimTeam', 'buzz', 'getSystemFonts', 'disconnect', 'antiCheatViolation', 'secretExitRequest'];
        if (publicEvents.includes(event)) return next();
        if (socket.isAdmin) return next();
        if (socket.isMC && mcAllowedEvents.includes(event)) return next();
        return next(new Error('Unauthorized: Bạn chưa đăng nhập Quản Trị Viên!'));
    });

    socket.on('playSound', (sound) => {
        io.emit('playSound', sound);
    });

    socket.emit('updateState', gameState);
    if (gameState.timerConfig) socket.emit('timer-config-updated', gameState.timerConfig);
    socket.emit('serverIPs', getLocalIPs());
    if (global.activeTunnel) socket.emit('publicLinkResult', { success: true, url: global.activeTunnel.url });
    console.log('[SERVER] Socket connected and updateState emitted to client:', socket.id);
    console.log('[SERVER] Current theme:', gameState.settings.theme);
    console.log('[SERVER] Teams in state:', gameState.teams.length, 'teams');

    // Allow clients to request current state (for late-connecting listeners)
    socket.on('get-state', () => {
        if (socket.currentRoomPin) {
            const room = roomManager.getRoom(socket.currentRoomPin);
            if (room) { socket.emit('updateState', room.gameState); return; }
        }
        socket.emit('updateState', gameState);
    });

    socket.on('requestState', () => {
        console.log('[SERVER] Client requesting state...');
        if (socket.currentRoomPin) {
            const room = roomManager.getRoom(socket.currentRoomPin);
            if (room) { socket.emit('updateState', room.gameState); return; }
        }
        socket.emit('updateState', gameState);
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
        saveRooms().catch(e => console.error('[RoomPersist] save error on toggleRoom:', e));
        io.emit('updateState', gameState);
    });

    // Verify Room PIN for contestants
    socket.on('verifyRoomPIN', (pin, callback) => {
        if (!gameState.isRoomOpen) {
            callback({ success: false, message: 'Phòng thi chưa mở!' });
            return;
        }
        if (pin === gameState.roomPIN) {
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
        data.forEach((item, idx) => {
            if (gameState.teams[idx]) {
                if (item.name && item.name.trim()) gameState.teams[idx].name = item.name.trim();
                if (item.school !== undefined) gameState.teams[idx].school = item.school.trim();
            }
        });
        gameState.claimedTeams = {};
        updateTurnOrder();
        io.emit('updateState', gameState);
    });

    // --- ADMIN: Bật/Tắt Ngôi sao hy vọng ---
    socket.on('toggleHopeStar', (teamId) => {
        // Toggle: nếu đang bật thì tắt, nếu đang tắt thì bật
        var wasOn = gameState.currentQuestion.isHopeStar;
        gameState.currentQuestion.isHopeStar = !wasOn;
        
        if (gameState.currentQuestion.isHopeStar) {
            // Đang bật: gán đội
            let targetTeam = parseInt(teamId);
            if (targetTeam === -1 && gameState.turnOrder && gameState.turnOrder.length > 0) {
                targetTeam = gameState.turnOrder[0];
            } else if (targetTeam === -1) {
                targetTeam = 1;
            }
            gameState.currentQuestion.mainTeamId = targetTeam;
            io.emit('updateState', gameState);
            io.emit('playSound', 'hope_star');
        } else {
            // Đang tắt
            io.emit('updateState', gameState);
        }
    });

    // --- ADMIN: Ép chọn lượt chơi (cho đội) ---
    socket.on('forceTurn', (teamId) => {
        gameState.forcedTeamId = teamId;
        // Find team in turnOrder and move to front
        let idx = gameState.turnOrder.indexOf(teamId);
        if (idx > -1) {
            gameState.turnOrder.splice(idx, 1);
            gameState.turnOrder.unshift(teamId);
        }
        
        // Tắt câu hỏi hiện tại và dọn dẹp viền sáng
        gameState.currentQuestion.active = false;
        gameState.currentQuestion.mainTeamId = null;
        gameState.currentQuestion.isHopeStar = false;
        gameState.isGridVisibleOnOverlay = false;
        
        io.emit('updateState', gameState);
    });

    // --- ADMIN: Đặt câu hỏi ---
    socket.on('setQuestion', (data) => {
        try {
            // If mainTeamId is not provided (auto), pick the first one from turnOrder
            let mainTeamId = data.mainTeamId;
            if (!mainTeamId || mainTeamId === -1) {
                if (gameState.turnOrder && gameState.turnOrder.length > 0) {
                    mainTeamId = gameState.turnOrder[0];
                } else {
                    mainTeamId = 1; // Fallback
                }
            }

            gameState.currentQuestion = {
                active: true,
                resolved: false,
                points: data.points || 0,
                mainTeamId: mainTeamId,
                isHopeStar: (gameState.currentQuestion && gameState.currentQuestion.isHopeStar) ? true : false,
                deductedFromMain: false,
                text: data.text || "",
                answer: data.answer || "",
                vid: data.vid || "",
                idx: data.idx
            };
            
            // Mark question as played
            if (data.points && data.idx !== undefined && data.idx !== -1) {
                if (!gameState.playedQuestions[data.points]) gameState.playedQuestions[data.points] = [];
                if (!gameState.playedQuestions[data.points].includes(data.idx)) {
                    gameState.playedQuestions[data.points].push(data.idx);
                }
                
                // Cập nhật lịch sử của đội
                if (!gameState.teamQuestionHistory) gameState.teamQuestionHistory = { 1: [], 2: [], 3: [], 4: [] };
                if (!gameState.teamQuestionHistory[mainTeamId]) gameState.teamQuestionHistory[mainTeamId] = [];
                let exists = gameState.teamQuestionHistory[mainTeamId].find(q => q.points == data.points && q.idx == data.idx);
                if (!exists) {
                    gameState.teamQuestionHistory[mainTeamId].push({ points: data.points, idx: data.idx, mode: 1 });
                }
            }
            
            resetBuzzerState();
            gameState.isGridVisibleOnOverlay = false;
            
            io.emit('updateState', gameState);
            io.emit('playSound', 'question_open_mode1');
        } catch (err) {
            console.error("Loi server khi setQuestion:", err);
        }
    });

    // --- ADMIN: Chốt gói câu hỏi (Mode 2 & 3) ---
    socket.on('lockPackage', (data) => {
        try {
            let mainTeamId = data.mainTeamId;
            if (!mainTeamId || mainTeamId === -1) {
                if (gameState.turnOrder && gameState.turnOrder.length > 0) {
                    mainTeamId = gameState.turnOrder[0];
                } else {
                    mainTeamId = 1;
                }
            }

            let finalPackage = [];
            
            if (data.mode === 2) {
                // Mode 2: data.package is [{points, idx}, ...]
                finalPackage = data.package;
                // Mode 2: Mark all chosen questions as played immediately
                finalPackage.forEach(q => {
                    if (q.points && q.idx !== undefined && q.idx !== -1) {
                        if (!gameState.playedQuestions[q.points]) gameState.playedQuestions[q.points] = [];
                        if (!gameState.playedQuestions[q.points].includes(q.idx)) {
                            gameState.playedQuestions[q.points].push(q.idx);
                        }
                    }
                });
            } else if (data.mode === 3) {
                // Mode 3: data.package is [{points, idx}, ...]
                data.package.forEach(item => {
                    let points = (item && typeof item === 'object') ? parseInt(item.points) : parseInt(item);
                    if (isNaN(points)) return;
                    let totalQs = gameState.questionCount[points] || 0;
                    let played = gameState.playedQuestions[points] || [];
                    let available = [];
                    for (let i = 0; i < totalQs; i++) {
                        if (!played.includes(i)) available.push(i);
                    }
                    
                    let chosenIdx = -1;
                    if (available.length > 0) {
                        let randIndex = Math.floor(Math.random() * available.length);
                        chosenIdx = available[randIndex];
                        if (!gameState.playedQuestions[points]) gameState.playedQuestions[points] = [];
                        gameState.playedQuestions[points].push(chosenIdx); // mark as played immediately
                    }
                    finalPackage.push({ points: points, idx: chosenIdx });
                });
            }

            gameState.lockedPackage = {
                mode: data.mode,
                mainTeamId: mainTeamId,
                questions: finalPackage,
                currentIndex: -1,
                lockedAt: Date.now()
            };
            
            // Lịch sử câu hỏi
            if (!gameState.teamQuestionHistory) gameState.teamQuestionHistory = { 1: [], 2: [], 3: [], 4: [] };
            if (!gameState.teamQuestionHistory[mainTeamId]) gameState.teamQuestionHistory[mainTeamId] = [];
            finalPackage.forEach(q => {
                if (q.points && q.idx !== undefined) {
                    let exists = gameState.teamQuestionHistory[mainTeamId].find(x => x.points == q.points && x.idx == q.idx);
                    if (!exists) {
                        gameState.teamQuestionHistory[mainTeamId].push({ points: q.points, idx: q.idx, mode: data.mode });
                    }
                }
            });

            gameState.currentQuestion = {
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
            
            gameState.isGridVisibleOnOverlay = false;
            io.emit('updateState', gameState);
            io.emit('playSound', 'question_open');
            
            io.emit('updateState', gameState);
            io.emit('packageLocked', gameState.lockedPackage);
        } catch(err) {
            console.error("Lỗi khi lockPackage:", err);
        }
    });

    // --- ADMIN: Chuyển câu trong gói (Mode 2 & 3) ---
    socket.on('nextQuestionInPackage', (data) => {
        if (data.cancel) {
            gameState.lockedPackage = null;
            gameState.pendingPackage = null;
            
            if (gameState.currentQuestion && gameState.currentQuestion.active) {
                gameState.currentQuestion.active = false;
                gameState.currentQuestion.mainTeamId = null;
                gameState.currentQuestion.isHopeStar = false;
                gameState.buzzedTeam = null;
                gameState.isBuzzerLocked = true;
                clearBuzzerTimeout();
            }
        gameState.currentQuestion = null;
            io.emit('updateState', gameState);
            return;
        }

        let pkg = gameState.lockedPackage;
        if (!pkg) return;

        if (data.revealOnly) {
            gameState.currentQuestion.isHidden = false;
            gameState.currentQuestion.text = data.text || "";
            gameState.currentQuestion.answer = data.answer || "";
            gameState.currentQuestion.vid = data.vid || "";
            gameState.currentQuestion.points = pkg.questions[pkg.currentIndex].points;
            io.emit('updateState', gameState);
            return;
        }

        pkg.currentIndex++;
        
        if (pkg.currentIndex < pkg.questions.length) {
            let qData = pkg.questions[pkg.currentIndex];
            
            gameState.currentQuestion = {
                active: true,
                resolved: false,
                points: qData.points || 0,
                mainTeamId: pkg.mainTeamId || 1,
                isHopeStar: false,
                deductedFromMain: false,
                text: data.text || "",
                answer: data.answer || "",
                vid: data.vid || "",
                idx: qData.idx,
                isHidden: false,
                mode: pkg.mode
            };
            

            gameState.isGridVisibleOnOverlay = false;
            io.emit('updateState', gameState);
            
            resetBuzzerState();
            gameState.isGridVisibleOnOverlay = false;
            
            io.emit('updateState', gameState);
            
            // io.emit('playSound', 'question_open'); // Removed as per request
        } else {
            // End of package
            gameState.lockedPackage = null;
            gameState.isGridVisibleOnOverlay = false;
            io.emit('updateState', gameState);
        }
    });

    socket.on('syncPendingPackage', (data) => {
        gameState.pendingPackage = data;
        io.emit('updateState', gameState);
        if (data.playSound !== false) {
            io.emit('playSound', 'choose_each_question');
        }
    });

    socket.on('setActiveBankSlot', (slotId) => {
        gameState.activeBankSlot = slotId;
        saveStateToDiskSync();
        io.emit('updateState', gameState);
    });

    // --- ADMIN: Đội chính ĐÚNG ---
    socket.on('correctMainTeam', () => {
        let q = gameState.currentQuestion;
        if (!q.active || !q.mainTeamId || q.resolved) return;

        let team = gameState.teams.find(t => t.id === q.mainTeamId);
        if (team) {
            let pts = q.isHopeStar ? q.points * 2 : q.points;
            team.score += pts;
            
            if (!gameState.scoreLog) gameState.scoreLog = [];
            gameState.scoreLog.unshift({ id: require('crypto').randomUUID(), time: Date.now(), teamId: team.id, delta: pts, reason: "Đội chính trả lời ĐÚNG" });
            if (gameState.scoreLog.length > 50) gameState.scoreLog.pop();
        }
        q.resolved = true;
        // Không reset isHopeStar ở đây - để MC tắt thủ công
        if (gameState.turnStats && gameState.turnStats[q.mainTeamId] >= (gameState.settings.questionsPerTeam || 3)) {
            gameState.turnOrder = gameState.turnOrder.filter(id => id !== q.mainTeamId);
        }
        updateTurnOrder(); // Sort after score change
        io.emit('updateState', gameState);
        io.emit('playSound', 'correct');
    });

    // --- ADMIN: Đội chính SAI -> Mở chuông 5s ---
    socket.on('startBuzzer', () => {
        let q = gameState.currentQuestion;

        if (q.active && q.isHopeStar && !q.deductedFromMain) {
            let team = gameState.teams.find(t => t.id === q.mainTeamId);
            if (team) { 
                team.score -= q.points; 
                if (team.score < 0) team.score = 0; 

                if (!gameState.scoreLog) gameState.scoreLog = [];
                gameState.scoreLog.unshift({ id: require('crypto').randomUUID(), time: Date.now(), teamId: team.id, delta: -q.points, reason: "Đội chính SAI (Ngôi sao hy vọng)" });
                if (gameState.scoreLog.length > 50) gameState.scoreLog.pop();
            }
            q.deductedFromMain = true;
        }

        gameState.buzzedTeam = null;
        gameState.isBuzzerLocked = false;
        gameState.buzzerUnlockTime = Date.now();
        gameState.buzzToken = require('crypto').randomUUID();
        gameState.buzzTimes = {};
        io.emit('updateState', gameState);
        io.emit('playSound', 'buzzer_5s');
        
        let hideBar = gameState.settings.disableBuzzerTimerBar || false;
        if (!hideBar) {
            io.emit('startCountdown', 5);
        }
        
        if (gameState.buzzerTimeout) clearTimeout(gameState.buzzerTimeout);
        gameState.buzzerTimeout = setTimeout(() => {
            if (!gameState.isBuzzerLocked && gameState.buzzedTeam === null) {
                gameState.isBuzzerLocked = true;
                io.emit('updateState', gameState);
            }
        }, 5000);
    });

    // --- ADMIN: Đội giành quyền ĐÚNG ---
    socket.on('correctBuzzedTeam', () => {
        let q = gameState.currentQuestion;
        let buzzedId = gameState.buzzedTeam;

        if (buzzedId && !q.resolved) {
            let bTeam = gameState.teams.find(t => t.id === buzzedId);
            if (bTeam) {
                bTeam.score += q.points;
                if (!gameState.scoreLog) gameState.scoreLog = [];
                gameState.scoreLog.unshift({ id: require('crypto').randomUUID(), time: Date.now(), teamId: bTeam.id, delta: q.points, reason: "Giành quyền trả lời ĐÚNG" });
            }

            if (q.active && q.mainTeamId && !q.deductedFromMain) {
                let mTeam = gameState.teams.find(t => t.id === q.mainTeamId);
                if (mTeam && mTeam.id !== buzzedId) { 
                    mTeam.score -= q.points; 
                    if (mTeam.score < 0) mTeam.score = 0; 
                    
                    if (!gameState.scoreLog) gameState.scoreLog = [];
                    gameState.scoreLog.unshift({ id: require('crypto').randomUUID(), time: Date.now(), teamId: mTeam.id, delta: -q.points, reason: "Bị trừ vì đội khác giành quyền" });
                }
                q.deductedFromMain = true;
            }
            if (gameState.scoreLog && gameState.scoreLog.length > 50) gameState.scoreLog.length = 50;
        }
        q.resolved = true;
        // Không reset isHopeStar ở đây - để MC tắt thủ công
        gameState.isBuzzerLocked = true;
        if (gameState.turnStats && gameState.turnStats[q.mainTeamId] >= (gameState.settings.questionsPerTeam || 3)) {
            gameState.turnOrder = gameState.turnOrder.filter(id => id !== q.mainTeamId);
        }
        updateTurnOrder(); // Sort after score change
        io.emit('updateState', gameState);
        io.emit('playSound', 'correct');
    });

    // --- ADMIN: Đội giành quyền SAI ---
    socket.on('wrongBuzzedTeam', () => {
        let q = gameState.currentQuestion;
        let buzzedId = gameState.buzzedTeam;

        if (buzzedId && !q.resolved) {
            updateTeamScore(buzzedId, -(q.points / 2));
        }
        
        q.resolved = true;
        // Không reset isHopeStar ở đây - để MC tắt thủ công
        gameState.buzzedTeam = null;
        gameState.isBuzzerLocked = true;
        gameState.buzzerUnlockTime = null;
        gameState.buzzTimes = {};
        
        clearBuzzerTimeout();
        
        io.emit('updateState', gameState);
        io.emit('playSound', 'wrong');
    });

    // --- ADMIN: Đóng câu hỏi, quay về Grid ---
    socket.on('closeQuestion', () => {
        let mainTeamId = gameState.currentQuestion.mainTeamId;

        gameState.currentQuestion.active = false;
        gameState.currentQuestion.mainTeamId = null;
        gameState.currentQuestion.isHopeStar = false;
        gameState.currentQuestion.resolved = false; // Reset trạng thái
        
        gameState.buzzedTeam = null;
        gameState.isBuzzerLocked = true;
        
        clearBuzzerTimeout();

        // Tăng đếm số câu đã chơi SAU KHI đóng câu hỏi
        if (mainTeamId !== null) {
            if (!gameState.turnStats[mainTeamId]) {
                gameState.turnStats[mainTeamId] = 0;
            }
            gameState.turnStats[mainTeamId]++;
            
            if (gameState.turnStats[mainTeamId] >= (gameState.settings.questionsPerTeam || 3)) {
                gameState.turnOrder = gameState.turnOrder.filter(id => id !== mainTeamId);
                if (gameState.turnOrder.length === 0) updateTurnOrder();
                gameState.isGridVisibleOnOverlay = false;
                io.emit('playSound', 'finish_turn');
            } else {
                gameState.isGridVisibleOnOverlay = true;
            }
        }

        io.emit('updateState', gameState);
    });

    // --- ADMIN: Sửa câu hỏi hiện tại ---
    socket.on('editCurrentQuestion', (data) => {
        if (!socket.isAdmin) return;
        if (gameState.currentQuestion.active) {
            gameState.currentQuestion.text = data.text;
            gameState.currentQuestion.answer = data.answer;
            io.emit('updateState', gameState);
        }
    });

    socket.on('undoScore', (logId) => {
        if (!socket.isAdmin || !gameState.scoreLog) return;
        let logIndex = gameState.scoreLog.findIndex(l => l.id === logId);
        if (logIndex !== -1) {
            let log = gameState.scoreLog[logIndex];
            let team = gameState.teams.find(t => t.id === log.teamId);
            if (team) {
                team.score -= log.delta;
                if (team.score < 0) team.score = 0;
            }
            gameState.scoreLog.splice(logIndex, 1);
            updateTurnOrder();
            io.emit('updateState', gameState);
        }
    });

    // --- ADMIN: Chỉnh điểm thủ công ---
    socket.on('updateTeamAvatarSettings', (data) => {
        let team = gameState.teams.find(t => t.id === data.id);
        if (team) {
            if (data.avatarSize !== undefined) team.avatarSize = data.avatarSize;
            if (data.avatarOverlap !== undefined) team.avatarOverlap = data.avatarOverlap;
            if (data.avatarOffsetX !== undefined) team.avatarOffsetX = data.avatarOffsetX;
            io.emit('updateState', gameState);
        }
    });

    // Cập nhật cài đặt chung avatar cho tất cả các đội
    socket.on('updateAllAvatarSettings', (data) => {
        gameState.teams.forEach(t => {
            if (data.avatarSize !== undefined) t.avatarSize = data.avatarSize;
            if (data.avatarOverlap !== undefined) t.avatarOverlap = data.avatarOverlap;
            if (data.avatarOffsetX !== undefined) t.avatarOffsetX = data.avatarOffsetX;
        });
        io.emit('updateState', gameState);
    });

    socket.on('updateScore', (data) => {
        updateTeamScore(data.teamId, data.points);
    });

    // --- ADMIN: Kết thúc phần chơi của đội hiện tại ---
    socket.on('finishTurn', () => {
        let teamId = null;
        if (gameState.turnOrder && gameState.turnOrder.length > 0) {
            teamId = gameState.turnOrder.shift(); // Gỡ đội hiện tại ra khỏi lượt
        } else if (gameState.currentQuestion.mainTeamId) {
            teamId = gameState.currentQuestion.mainTeamId;
        }

        if (teamId && gameState.forcedTeamId === teamId) gameState.forcedTeamId = null;
        
        if (gameState.currentQuestion.active) {
            gameState.currentQuestion.active = false;
            gameState.currentQuestion.mainTeamId = null;
            gameState.currentQuestion.isHopeStar = false;
            gameState.buzzedTeam = null;
            gameState.isBuzzerLocked = true;
            clearBuzzerTimeout();
        }
        gameState.currentQuestion = null;
        
        gameState.lockedPackage = null;
        gameState.pendingPackage = null;
        gameState.isGridVisibleOnOverlay = false;
        if (gameState.turnOrder && gameState.turnOrder.length === 0) updateTurnOrder();
        
        io.emit('updateState', gameState);
        io.emit('playSound', 'finish_turn');
    });

    // --- ADMIN: Kết thúc phần chơi cho một đội cụ thể ---
    socket.on('finishTurnForTeam', (teamId) => {
        if (gameState.turnOrder && gameState.turnOrder.includes(teamId)) {
            if (gameState.forcedTeamId === teamId) gameState.forcedTeamId = null;
            gameState.turnOrder = gameState.turnOrder.filter(id => id !== teamId);
            
            if (gameState.currentQuestion.active && gameState.currentQuestion.mainTeamId === teamId) {
                gameState.currentQuestion.active = false;
                gameState.currentQuestion.mainTeamId = null;
                gameState.currentQuestion.isHopeStar = false;
                gameState.buzzedTeam = null;
                gameState.isBuzzerLocked = true;
                clearBuzzerTimeout();
            }
        gameState.currentQuestion = null;
            
            gameState.lockedPackage = null;
            gameState.pendingPackage = null;
            gameState.isGridVisibleOnOverlay = false;
            if (gameState.turnOrder.length === 0) updateTurnOrder();
            
            io.emit('updateState', gameState);
            io.emit('playSound', 'finish_turn');
        }
    });
    // --- ADMIN: Cài đặt Hệ thống đồ hoạ ---
    socket.on('updateSettings', (newSettings) => {
        let oldQuestionsPerTeam = gameState.settings.questionsPerTeam || 3;
        let oldRule = gameState.settings.turnOrderRule || 'mode_asc';
        gameState.settings = { ...gameState.settings, ...newSettings };
        let newQuestionsPerTeam = gameState.settings.questionsPerTeam || 3;
        let newRule = gameState.settings.turnOrderRule || 'mode_asc';

        // Xử lý khi thay đổi số câu hỏi mỗi đội
        if (newSettings.questionsPerTeam !== undefined && oldQuestionsPerTeam !== newQuestionsPerTeam) {
            let changed = false;
            gameState.turnOrder = gameState.turnOrder.filter(id => {
                if (gameState.turnStats[id] && gameState.turnStats[id] >= newQuestionsPerTeam) {
                    changed = true;
                    return false;
                }
                return true;
            });
            if (changed && gameState.turnOrder.length === 0) {
                updateTurnOrder();
            }
        }
        
        if (newSettings.turnOrderRule !== undefined && oldRule !== newRule) {
            updateTurnOrder(false);
        }
        
        io.emit('updateState', gameState);
    });

    // --- ADMIN: VÒNG 1 (TIMER CONFIG) ---
    socket.on('update-timer-config', (config) => {
        gameState.timerConfig = { ...gameState.timerConfig, ...config };
        io.emit('timer-config-updated', gameState.timerConfig);
    });

    socket.on('forceUpdateTurnOrder', () => {
        // Manually sort the turn order based on current score
        updateTurnOrder(false);
        io.emit('updateState', gameState);
    });

    socket.on('timer-action', (action) => {
        io.emit('timer-action', action);
    });

    socket.on('change-round', (roundNum) => {
        gameState.activeRound = roundNum;
        
        // Reset turn state when switching rounds so the turn order is properly rebuilt 
        // based on the teams' current scores at the beginning of the new round.
        gameState.forcedTeamId = null;
        gameState.turnStats = {};
        gameState.turnOrder = [];
        updateTurnOrder(false);
        
        io.emit('updateState', gameState);
    });

    socket.on('stop-timer', () => {
        io.emit('timer-action', { type: 'PAUSE' });
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
        const statusStr = await pptController.nextSlideAndGetNotes();
        broadcastPptStatus(statusStr);
    });

    socket.on('ppt-prev', async () => {
        const statusStr = await pptController.prevSlideAndGetNotes();
        broadcastPptStatus(statusStr);
    });

    socket.on('ppt-prewarm', async () => {
        await pptController.getStatus();
        socket.emit('ppt-prewarm-done');
    });

    socket.on('ppt-sync', async () => {
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
        const statusStr = await pptController.gotoSlide(slideIndex);
        broadcastPptStatus(statusStr);
    });

    socket.on('resetGame', () => {
        gameState.teams.forEach(t => t.score = 0);
        gameState.forcedTeamId = null;
        resetBuzzerState();
        gameState.antiCheatViolations = {};
        gameState.bannedTeams = [];
        gameState.currentQuestion = {
            active: false, points: 0, mainTeamId: null,
            isHopeStar: false, deductedFromMain: false, text: "", answer: "", idx: null
        };
        gameState.isGridVisibleOnOverlay = false;
        gameState.showOverallScoreboard = false;
        gameState.activeBankSlot = null;
        gameState.lockedPackage = null;
        gameState.pendingPackage = null;
        gameState.currentMedia = null;
        gameState.isVideoPlaying = false;
        gameState.playedQuestions = { "10": [], "20": [], "40": [] };
        gameState.turnStats = {};
        gameState.turnOrder = []; // Bắt buộc nạp lại toàn bộ 4 đội
        updateTurnOrder(false);
        saveStateToDiskSync();
        io.emit('updateState', gameState);
        io.emit('timer-action', { type: 'STOP' });
    });

    socket.on('changeTeamCount', (newCount) => {
        if (newCount < 2 || newCount > 6) return;
        gameState.forcedTeamId = null;
        gameState.settings.teamCount = newCount;
        
        let newTeams = [];
        for (let i = 1; i <= newCount; i++) {
            let existing = gameState.teams.find(t => t.id === i);
            if (existing) {
                newTeams.push(existing);
            } else {
                newTeams.push({ id: i, name: "Đội " + i, school: "", score: 0, avatarSize: 100, avatarOverlap: 10 });
            }
        }
        gameState.teams = newTeams;
        
        // Cập nhật lại avatar timestamps
        let newTimestamps = {};
        for (let i = 1; i <= newCount; i++) {
            newTimestamps[i] = gameState.avatarTimestamps[i] || 1;
        }
        gameState.avatarTimestamps = newTimestamps;

        // Reset toàn bộ game để tương thích với số lượng đội mới
        gameState.teams.forEach(t => t.score = 0);
        resetBuzzerState();
        gameState.currentQuestion = {
            active: false, points: 0, mainTeamId: null,
            isHopeStar: false, deductedFromMain: false, text: "", answer: "", idx: null
        };
        gameState.isGridVisibleOnOverlay = false;
        gameState.playedQuestions = { "10": [], "20": [], "40": [] };
        gameState.turnStats = {};
        gameState.turnOrder = [];
        updateTurnOrder(false);
        io.emit('updateState', gameState);
    });

    // --- ADMIN: Phát Video ---
    socket.on('playVideo', (url) => {
        authorizedVideoPath = url;
        io.emit('playVideo', url);
    });

    // --- ADMIN: Đóng Video ---
    socket.on('closeVideo', () => {
        authorizedVideoPath = null;
        io.emit('closeVideo');
    });

    socket.on('videoSync', (time) => {
        socket.broadcast.emit('videoSync', time);
    });

    socket.on('videoPlayState', (state) => {
        socket.broadcast.emit('videoPlayState', state);
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
        io.emit('startCountdown', seconds);
        io.emit('playSound', seconds === 10 ? 'countdown_10s' : 'countdown_15s');
    });

    // --- THÍ SINH: Chọn đội ---
    socket.on('claimTeam', (payload) => {
        let teamId = typeof payload === 'object' ? payload.teamId : payload;
        let clientId = typeof payload === 'object' ? payload.clientId : socket.id;
        teamId = parseInt(teamId);
        
        socket.clientId = clientId; // Store on socket object to verify reconnection buzzes
        
        let existingClaim = gameState.claimedTeams[teamId];
        if (existingClaim && existingClaim.clientId !== clientId) {
            return; // Đội đã được người khác chọn
        }

        for (let tid in gameState.claimedTeams) {
            if (gameState.claimedTeams[tid].socketId === socket.id) {
                delete gameState.claimedTeams[tid];
            }
        }
        gameState.claimedTeams[teamId] = { socketId: socket.id, clientId: clientId };
        io.emit('updateState', gameState);
    });

    // --- THÍ SINH: Bấm chuông ---
    socket.on('buzz', (teamId, token) => {
        teamId = parseInt(teamId);
        
        // Chống gian lận: Yêu cầu phải gửi kèm buzzToken khớp với server
        if (gameState.buzzToken && token !== gameState.buzzToken) {
            console.log(`[BUZZ] Token mismatch for team ${teamId} (client token: ${token}, server token: ${gameState.buzzToken}).`);
            // Dự phòng: nếu chuông thực sự đang mở và chưa ai bấm, cho phép bỏ qua kiểm tra token để tránh nghẽn/mất sync
            if (gameState.isBuzzerLocked || gameState.buzzedTeam !== null) {
                return;
            }
        }
        
        // Xác minh xem socket này có đúng là người sở hữu đội không
        let claim = gameState.claimedTeams[teamId];
        if (!claim) return;
        if (claim.socketId !== socket.id) {
            // Reconnection fallback: check if client IDs match
            if (socket.clientId && claim.clientId === socket.clientId) {
                console.log(`[BUZZ] Reconnection fallback: Auto-updating socketId for team ${teamId} from ${claim.socketId} to ${socket.id}`);
                claim.socketId = socket.id;
            } else {
                return;
            }
        }
        
        // Ngăn đội chính bấm chuông giành quyền trong câu hỏi của chính họ
        if (gameState.currentQuestion.active && gameState.currentQuestion.mainTeamId === teamId) return;

        let isNewBuzz = false;
        
        if (gameState.buzzerUnlockTime && typeof gameState.buzzTimes[teamId] !== 'number') {
            let elapsed = Date.now() - gameState.buzzerUnlockTime;
            if (elapsed <= 5000) {
                gameState.buzzTimes[teamId] = elapsed;
                isNewBuzz = true;
            }
        }

        if (!gameState.isBuzzerLocked && gameState.buzzedTeam === null) {
            gameState.isBuzzerLocked = true;
            clearBuzzerTimeout();
            io.emit('playSound', 'buzzed');
            
            let delay = gameState.settings.buzzerDelayMs !== undefined ? gameState.settings.buzzerDelayMs : 500;
            if (delay > 0) {
                gameState.pendingBuzzerTeam = teamId;
                if (gameState.buzzerDelayTimer) clearTimeout(gameState.buzzerDelayTimer);
                gameState.buzzerDelayTimer = setTimeout(() => {
                    if (gameState.pendingBuzzerTeam === teamId) {
                        gameState.buzzedTeam = teamId;
                        gameState.pendingBuzzerTeam = null;
                        io.emit('updateState', gameState);
                    }
                }, delay);
            } else {
                gameState.buzzedTeam = teamId;
                io.emit('updateState', gameState);
            }
        } else if (isNewBuzz) {
            // Cập nhật lại cho admin thấy thời gian của các đội khác
            io.emit('updateState', gameState);
        }
    });

    // --- NGẮT KẾT NỐI -> Giải phóng đội ---
    socket.on('disconnect', () => {
        let changed = false;
        for (let tid in gameState.claimedTeams) {
            if (gameState.claimedTeams[tid].socketId === socket.id) {
                delete gameState.claimedTeams[tid];
                changed = true;
            }
        }
        if (changed) io.emit('updateState', gameState);
    });

    // --- ANTI-CHEAT: Ghi nhận gian lận và mở khoá ---
    socket.on('antiCheatViolation', (data) => {
        console.log("RECEIVED VIOLATION:", data);
        let tid = data.teamId;
        if (!tid) return;

        if (!gameState.antiCheatViolations) gameState.antiCheatViolations = {};
        if (!gameState.bannedTeams) gameState.bannedTeams = [];

        if (gameState.bannedTeams.includes(tid)) return; // Already banned

        gameState.antiCheatViolations[tid] = (gameState.antiCheatViolations[tid] || 0) + 1;
        let count = gameState.antiCheatViolations[tid];

        if (count >= 3) {
            gameState.bannedTeams.push(tid);
            io.emit('antiCheatBanned', { teamId: tid });
            io.emit('playSound', 'wrong');
        } else {
            io.emit('antiCheatWarning', { teamId: tid, count: count, reason: data.reason });
        }

        io.emit('updateState', gameState);
    });
    
    socket.on('unbanTeam', (teamId) => {
        if (!gameState.bannedTeams) return;
        gameState.bannedTeams = gameState.bannedTeams.filter(id => id !== teamId);
        if (gameState.antiCheatViolations) {
            gameState.antiCheatViolations[teamId] = 0;
        }
        io.emit('antiCheatUnbanned', { teamId: teamId });
        io.emit('updateState', gameState);
    });

    // --- LỐI THOÁT KHẨN CẤP BÍ MẬT ---
    socket.on('secretExitRequest', (data) => {
        // Broadcast tới tất cả Admin
        io.emit('secretExitRequest', data); 
    });
    
    socket.on('approveSecretExit', (data) => {
        if (!socket.isAdmin) return;
        // Gửi lệnh thoát trực tiếp tới socket của đội yêu cầu
        for (let tid in gameState.claimedTeams) {
            if (tid === data.teamId) {
                io.to(gameState.claimedTeams[tid].socketId).emit('approveSecretExit');
                break;
            }
        }
    });

    socket.on('showOverlayGrid', () => {
        gameState.isGridVisibleOnOverlay = true;
        io.emit('updateState', gameState);
        io.emit('playSound', 'choose_package');
    });

    socket.on('hideOverlayGrid', () => {
        gameState.isGridVisibleOnOverlay = false;
        io.emit('updateState', gameState);
    });

    socket.on('playSound', (sound) => {
        io.emit('playSound', sound);
    });

    // --- ADMIN: Bảng Điểm Tổng Hợp ---
    socket.on('toggleOverallScoreboard', (show) => {
        gameState.showOverallScoreboard = show;
        io.emit('updateState', gameState);
    });

    socket.on('updateScoreboardBg', (base64Data) => {
        try {
            const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const buffer = Buffer.from(matches[2], 'base64');
                const ext = matches[1] === 'image/jpeg' ? 'jpg' : 'png';
                const filename = `bg_custom_${Date.now()}.${ext}`;
                const bgPath = path.join(basePath, 'Themes', 'Background', filename);
                fs.writeFileSync(bgPath, buffer);
                gameState.scoreboardBg = `/Themes/Background/${filename}`;
                io.emit('updateState', gameState);
            }
        } catch(e) {
            console.error("Lỗi cập nhật ảnh nền bảng điểm:", e);
        }
    });

    socket.on('updateTeamAvatar', (data) => {
        try {
            const matches = data.base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const buffer = Buffer.from(matches[2], 'base64');
                const avatarPath = path.join(basePath, 'Themes', 'Avatars', `${data.teamId}.png`);
                fs.writeFileSync(avatarPath, buffer);
                
                if (!gameState.avatarTimestamps) gameState.avatarTimestamps = {};
                gameState.avatarTimestamps[data.teamId] = Date.now();
                
                io.emit('updateState', gameState);
            }
        } catch(e) {
            console.error("Lỗi cập nhật avatar đội:", e);
        }
    });

    socket.on('setQuestionCount', (counts) => {
        gameState.questionCount = counts;
        io.emit('updateState', gameState);
    });

    socket.on('getSystemFonts', () => {
        socket.emit('systemFonts', Object.keys(fontDictionary).sort());
    });
});

// Use fontDictionary keys for precise system font delivery
app.get('/api/fonts', async (req, res) => {
    // Wait for font scan to complete if still in progress
    if (fontScanPromise) await fontScanPromise;
    res.json(Object.keys(fontDictionary).sort());
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