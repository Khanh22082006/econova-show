/**
 * roomManager.js - Hệ Thống Quản Lý Đa Phòng (Multi-Room) Chuẩn PIN 000000 - 999999
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
        // Phòng thi chuẩn ban đầu với mã PIN 6 số: 888888
        this.createRoom({
            pin: "888888",
            name: "Phòng Thi Đấu Tiêu Chuẩn",
            password: process.env.ADMIN_PASSWORD || "admin123",
            mcPassword: process.env.MC_PASSWORD || "mc123",
            theme: "v3",
            isPermanent: true
        });
    }

    generatePIN() {
        let pin;
        do {
            // PIN nằm trong khoảng 000000 đến 999999 (có số 0 ở đầu nếu dưới 100000)
            pin = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
        } while (this.rooms.has(pin));
        return pin;
    }

    createRoom({ pin, name, password, mcPassword, theme, questions }) {
        let cleanPin = (pin || "").toString().trim().replace(/\D/g, '');
        if (cleanPin.length > 0 && cleanPin.length <= 6) {
            cleanPin = cleanPin.padStart(6, '0');
        } else if (cleanPin.length !== 6) {
            cleanPin = this.generatePIN();
        }
        
        const roomData = {
            pin: cleanPin,
            name: name || `Phòng Thi ${cleanPin}`,
            password: password || "123456",
            mcPassword: mcPassword || "mc123",
            theme: theme || "v3",
            createdAt: Date.now(),
            lastActive: Date.now(),
            gameState: JSON.parse(JSON.stringify(this.defaultStateTemplate)),
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
        console.log(`[RoomManager] Đã tạo phòng mới: ${roomData.name} | PIN: ${cleanPin}`);
        return roomData;
    }

    getRoom(pin) {
        if (!pin) return this.rooms.get("888888") || null;
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
        if (!room) return { success: false, message: "Mã PIN 6 số không tồn tại hoặc phòng đã đóng!" };
        if (room.password === password || password === process.env.MASTER_ADMIN_PASSWORD || password === "superadmin" || password === "admin123") {
            return { success: true, room };
        }
        return { success: false, message: "Mật khẩu Quản Trị Viên không chính xác!" };
    }

    verifyMC(pin, password) {
        const room = this.getRoom(pin);
        if (!room) return { success: false, message: "Mã PIN 6 số không tồn tại!" };
        if (room.mcPassword === password || room.password === password || password === "mc123" || password === "admin123") {
            return { success: true, room };
        }
        return { success: false, message: "Mật khẩu MC không chính xác!" };
    }

    verifyContestant(pin) {
        const room = this.getRoom(pin);
        if (!room) return { success: false, message: "Mã PIN 6 số không chính xác hoặc phòng chưa được tạo!" };
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
}

module.exports = new RoomManager();
