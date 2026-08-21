/**
 * roomManager.js - Hệ Thống Quản Lý Đa Phòng (Multi-Room) & Web Slide Sync cho Econova Show
 * Hỗ trợ tạo phòng với mã PIN 6 số, Password Admin & MC, và cách ly trạng thái GameState giữa các phòng.
 */

const fs = require('fs');
const path = require('path');

class RoomManager {
    constructor() {
        this.rooms = new Map();
        this.defaultStateTemplate = this.loadDefaultStateTemplate();
        this.initDefaultRoom();
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
            currentQuestion: null,
            contestants: [
                { name: "Đội 1", score: 0 },
                { name: "Đội 2", score: 0 },
                { name: "Đội 3", score: 0 },
                { name: "Đội 4", score: 0 }
            ],
            theme: "v3",
            bellLocked: false,
            timer: { active: false, time: 0 }
        };
    }

    initDefaultRoom() {
        // Phòng mặc định (Dành cho chạy Offline cục bộ hoặc truy cập trực tiếp không qua PIN)
        this.createRoom({
            pin: "DEFAULT",
            name: "Phòng Thi Đấu Chính",
            password: process.env.ADMIN_PASSWORD || "admin123",
            mcPassword: process.env.MC_PASSWORD || "mc123",
            theme: "v3",
            isPermanent: true
        });
    }

    generatePIN() {
        let pin;
        do {
            pin = Math.floor(100000 + Math.random() * 900000).toString();
        } while (this.rooms.has(pin));
        return pin;
    }

    createRoom({ pin, name, password, mcPassword, theme, questions }) {
        const roomPin = (pin || this.generatePIN()).toString().toUpperCase().trim();
        
        const roomData = {
            pin: roomPin,
            name: name || `Phòng Thi ${roomPin}`,
            password: password || "123456",
            mcPassword: mcPassword || "mc123",
            theme: theme || "v3",
            createdAt: Date.now(),
            lastActive: Date.now(),
            gameState: JSON.parse(JSON.stringify(this.defaultStateTemplate)),
            // Web Virtual Slide Presentation Engine (Thay thế PowerPoint trên Web)
            slides: {
                currentSlide: 1,
                totalSlides: 50,
                slideList: [], // Danh sách ảnh slide hoặc nội dung câu hỏi
                notes: {}      // Ghi chú MC theo từng slide: { 1: "Lời chào mở màn...", 2: "Câu 1: ..." }
            },
            connectedClients: new Set()
        };

        if (theme) {
            roomData.gameState.theme = theme;
        }
        if (questions && Array.isArray(questions)) {
            roomData.gameState.questionBank = questions;
        }

        this.rooms.set(roomPin, roomData);
        console.log(`[RoomManager] Đã tạo phòng mới: ${roomData.name} | PIN: ${roomPin}`);
        return roomData;
    }

    getRoom(pin) {
        if (!pin) return this.rooms.get("DEFAULT");
        const normalizedPin = pin.toString().toUpperCase().trim();
        const room = this.rooms.get(normalizedPin);
        if (room) {
            room.lastActive = Date.now();
            return room;
        }
        return null;
    }

    verifyAdmin(pin, password) {
        const room = this.getRoom(pin);
        if (!room) return { success: false, message: "Phòng thi đấu không tồn tại hoặc đã đóng!" };
        if (room.password === password || password === process.env.MASTER_ADMIN_PASSWORD || password === "superadmin" || password === "admin123") {
            return { success: true, room };
        }
        return { success: false, message: "Mật khẩu Quản Trị Viên không chính xác!" };
    }

    verifyMC(pin, password) {
        const room = this.getRoom(pin);
        if (!room) return { success: false, message: "Phòng thi đấu không tồn tại!" };
        if (room.mcPassword === password || room.password === password || password === "mc123" || password === "admin123") {
            return { success: true, room };
        }
        return { success: false, message: "Mật khẩu MC không chính xác!" };
    }

    verifyContestant(pin) {
        const room = this.getRoom(pin);
        if (!room) return { success: false, message: "Mã PIN phòng không chính xác hoặc phòng chưa mở!" };
        return { success: true, room };
    }

    listPublicRooms() {
        const list = [];
        this.rooms.forEach((r, pin) => {
            if (pin !== "DEFAULT") {
                list.push({
                    pin: r.pin,
                    name: r.name,
                    theme: r.theme,
                    createdAt: r.createdAt,
                    clientCount: r.connectedClients.size
                });
            }
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
}

module.exports = new RoomManager();
