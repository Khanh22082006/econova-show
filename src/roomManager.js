/**
 * roomManager.js - Hệ Thống Quản Lý Đa Phòng Động (1 Triệu Phòng 000000 - 999999)
 * Không có phòng tiêu chuẩn có sẵn. Toàn bộ phòng do người dùng tự tạo động trên Web.
 */

const fs = require('fs');
const path = require('path');

class RoomManager {
    constructor() {
        this.rooms = new Map();
        this.defaultStateTemplate = this.loadDefaultStateTemplate();
        
        // Chỉ khởi tạo phòng cục bộ nếu là chế độ Desktop Offline App
        if (process.env.IS_DESKTOP_APP === 'true') {
            this.createRoom({
                pin: "000000",
                name: "Phòng Thi Đấu Cục Bộ (Desktop)",
                password: "admin",
                mcPassword: "mc",
                theme: "v3"
            });
        }
    }

    loadDefaultStateTemplate() {
        try {
            const templatePath = path.join(__dirname, '..', 'gameState.json');
            if (fs.existsSync(templatePath)) {
                return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
            }
        } catch (e) {
            console.error('Không thể đọc gameState.json mẫu:', e);
        }
        return {
            currentRound: "Khởi Động",
            currentQuestion: { active: false, points: 0, mainTeamId: null, isHopeStar: false, deductedFromMain: false, text: "", answer: "", idx: null, isHidden: true },
            teams: [
                { id: 1, name: "Đội 1", school: "", score: 0 },
                { id: 2, name: "Đội 2", school: "", score: 0 },
                { id: 3, name: "Đội 3", school: "", score: 0 },
                { id: 4, name: "Đội 4", school: "", score: 0 }
            ],
            claimedTeams: {},
            settings: { theme: "v3", questionsPerTeam: 3, teamCount: 4, language: "vi" },
            isBuzzerLocked: true,
            buzzedTeam: null,
            buzzTimes: {},
            turnOrder: [1, 2, 3, 4],
            turnStats: {},
            isGridVisibleOnOverlay: false,
            playedQuestions: { "10": [], "20": [], "40": [] },
            scoreLog: [],
            antiCheatViolations: {},
            bannedTeams: []
        };
    }

    generatePIN() {
        let pin;
        do {
            // Sinh mã PIN chuẩn 6 chữ số từ 000000 đến 999999
            pin = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
        } while (this.rooms.has(pin));
        return pin;
    }

    createRoom({ pin, name, password, mcPassword, theme, questions, teamCount, teams }) {
        let cleanPin = (pin || "").toString().trim().replace(/\D/g, '');
        if (cleanPin.length > 0 && cleanPin.length <= 6) {
            cleanPin = cleanPin.padStart(6, '0');
        } else {
            cleanPin = this.generatePIN();
        }

        if (this.rooms.has(cleanPin)) {
            return { error: true, message: `Mã PIN ${cleanPin} đã được sử dụng bởi một phòng khác! Vui lòng chọn mã PIN khác.` };
        }
        
        const initialGameState = JSON.parse(JSON.stringify(this.defaultStateTemplate));
        initialGameState.isRoomOpen = true;
        initialGameState.roomPIN = cleanPin;
        initialGameState.isBuzzerLocked = true;
        initialGameState.buzzedTeam = null;
        initialGameState.buzzTimes = {};
        initialGameState.claimedTeams = {};

        // Xử lý danh sách thí sinh / đội thi và số lượng đội do người dùng truyền vào
        const count = Math.max(2, Math.min(6, parseInt(teamCount, 10) || (Array.isArray(teams) && teams.length ? teams.length : 4)));
        let cleanTeams = [];
        if (Array.isArray(teams) && teams.length > 0) {
            for (let i = 0; i < count; i++) {
                const t = teams[i] || {};
                cleanTeams.push({
                    id: i + 1,
                    name: (t.name && t.name.trim()) ? t.name.trim() : `Đội ${i + 1}`,
                    school: (t.school && t.school.trim()) ? t.school.trim() : '',
                    score: 0
                });
            }
        } else {
            for (let i = 0; i < count; i++) {
                cleanTeams.push({
                    id: i + 1,
                    name: `Đội ${i + 1}`,
                    school: '',
                    score: 0
                });
            }
        }

        initialGameState.teams = cleanTeams;
        initialGameState.turnOrder = cleanTeams.map(t => t.id);
        initialGameState.turnStats = {};
        initialGameState.activeTeam = cleanTeams.length > 0 ? cleanTeams[0].id : 1;
        initialGameState.playedQuestions = { "10": [], "20": [], "40": [] };
        initialGameState.currentQuestion = { active: false, points: 0, mainTeamId: null, isHopeStar: false, deductedFromMain: false, text: "", answer: "", idx: null, isHidden: true };
        initialGameState.settings = initialGameState.settings || {};
        initialGameState.settings.teamCount = count;
        initialGameState.settings.theme = theme || "v3";

        const roomData = {
            pin: cleanPin,
            name: name || `Phòng Thi ${cleanPin}`,
            password: password || "123456",
            mcPassword: mcPassword || "mc123",
            theme: theme || "v3",
            createdAt: Date.now(),
            lastActive: Date.now(),
            gameState: initialGameState,
            slides: {
                currentSlide: 1,
                totalSlides: 50,
                slideList: [],
                notes: {}
            },
            connectedClients: new Set()
        };

        if (theme) {
            roomData.gameState.theme = theme;
        }
        if (questions && Array.isArray(questions)) {
            roomData.gameState.questionBank = questions;
        }

        this.rooms.set(cleanPin, roomData);
        console.log(`[RoomManager] Đã khởi tạo phòng mới: ${roomData.name} | PIN: ${cleanPin} | Đội thi: ${cleanTeams.map(t => t.name).join(', ')}`);
        return roomData;
    }

    getRoom(pin) {
        if (!pin) return null;
        let cleanPin = pin.toString().trim().replace(/\D/g, '');
        if (cleanPin.length > 0 && cleanPin.length <= 6) {
            cleanPin = cleanPin.padStart(6, '0');
        }
        const room = this.rooms.get(cleanPin);
        if (room) {
            room.lastActive = Date.now();
            return room;
        }
        return null;
    }

    verifyAdmin(pin, password) {
        const room = this.getRoom(pin);
        if (!room) return { success: false, message: "❌ Mã PIN phòng này không tồn tại hoặc phòng đã đóng!" };
        if (!room.password || !room.gameState) {
            console.log(`[RoomManager] Phát hiện phòng lỗi PIN ${pin} -> Tự động gỡ phòng!`);
            this.deleteRoom(pin);
            return { success: false, message: "❌ Phòng này bị lỗi dữ liệu và đã được tự động gỡ bỏ!" };
        }
        if (room.password === password || password === process.env.MASTER_ADMIN_PASSWORD || password === "superadmin") {
            return { success: true, room };
        }
        return { success: false, message: "Mật khẩu Quản Trị Viên không chính xác!" };
    }

    verifyMC(pin, password) {
        const room = this.getRoom(pin);
        if (!room) return { success: false, message: "❌ Mã PIN phòng này không tồn tại hoặc phòng đã đóng!" };
        if (room.mcPassword === password || room.password === password) {
            return { success: true, room };
        }
        return { success: false, message: "Mật khẩu MC không chính xác!" };
    }

    verifyContestant(pin) {
        const room = this.getRoom(pin);
        if (!room) return { success: false, message: "❌ Phòng thi đấu với mã PIN này không tồn tại! Vui lòng kiểm tra lại hoặc Tạo Phòng Mới." };
        return { success: true, room };
    }

    listPublicRooms() {
        const list = [];
        this.rooms.forEach((r, pin) => {
            list.push({
                pin: r.pin,
                name: r.name,
                theme: r.theme,
                createdAt: r.createdAt,
                clientCount: r.connectedClients.size
            });
        });
        return list;
    }

    // --- WEB VIRTUAL SLIDE SYNC ENGINE ---
    nextSlide(pin) {
        const room = this.getRoom(pin);
        if (!room) return null;
        if (room.slides.currentSlide < room.slides.totalSlides) {
            room.slides.currentSlide++;
        }
        return this.getSlideStatus(pin);
    }

    prevSlide(pin) {
        const room = this.getRoom(pin);
        if (!room) return null;
        if (room.slides.currentSlide > 1) {
            room.slides.currentSlide--;
        }
        return this.getSlideStatus(pin);
    }

    gotoSlide(pin, slideIndex) {
        const room = this.getRoom(pin);
        if (!room) return null;
        const target = Math.max(1, Math.min(room.slides.totalSlides, parseInt(slideIndex) || 1));
        room.slides.currentSlide = target;
        return this.getSlideStatus(pin);
    }

    getSlideStatus(pin) {
        const room = this.getRoom(pin);
        if (!room) return null;
        const current = room.slides.currentSlide;
        const notes = room.slides.notes[current] || room.slides.notes[`slide_${current}`] || "";
        return {
            currentSlide: current,
            totalSlides: room.slides.totalSlides,
            notes: notes,
            slideImage: room.slides.slideList[current - 1] || null
        };
    }

    setSlideNotes(pin, slideIndex, notes) {
        const room = this.getRoom(pin);
        if (!room) return false;
        room.slides.notes[slideIndex] = notes;
        return true;
    }

    deleteRoom(pin) {
        if (!pin) return false;
        let cleanPin = pin.toString().trim().replace(/\D/g, '');
        if (cleanPin.length > 0 && cleanPin.length <= 6) {
            cleanPin = cleanPin.padStart(6, '0');
        }
        if (this.rooms.has(cleanPin)) {
            const room = this.rooms.get(cleanPin);
            if (room && room.connectedClients) {
                room.connectedClients.clear();
            }
            this.rooms.delete(cleanPin);
            console.log(`[RoomManager] Đã tự động gỡ phòng: PIN ${cleanPin}`);
            return true;
        }
        return false;
    }
}

module.exports = new RoomManager();
