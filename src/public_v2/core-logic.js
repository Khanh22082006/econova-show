/**
 * Econova Show - Core Logic & Unified Display Controller
 * Implementing Unified Core Logic, High-Precision Timer & Dynamic Theme Loader
 */

class EconovaThemeLoader {
    constructor() {
        this.linkEl = document.getElementById('econova-theme-styles');
        if (!this.linkEl) {
            this.linkEl = document.createElement('link');
            this.linkEl.id = 'econova-theme-styles';
            this.linkEl.rel = 'stylesheet';
            document.head.appendChild(this.linkEl);
        }
    }

    load(themeName) {
        const theme = themeName || 'default';
        const url = `/public_v2/Themes/${theme}.css`;
        
        this.linkEl.onload = null;
        this.linkEl.onerror = null;

        return new Promise((resolve) => {
            this.linkEl.onload = () => {
                document.body.setAttribute('data-theme', theme);
                resolve();
            };
            this.linkEl.onerror = () => {
                console.warn(`Theme ${theme} styles failed to load, falling back to default.css`);
                this.linkEl.href = '/public_v2/Themes/default.css';
                document.body.setAttribute('data-theme', 'default');
                resolve();
            };
            this.linkEl.href = url;
        });
    }
}

class EconovaTimer {
    constructor(onTick, onComplete) {
        this.onTick = onTick;
        this.onComplete = onComplete;
        this.animationFrameId = null;
        this.duration = 0;
        this.startTime = null;
        this.isRunning = false;
    }

    start(seconds) {
        this.stop();
        this.duration = seconds * 1000;
        this.startTime = performance.now();
        this.isRunning = true;
        
        const tick = (now) => {
            if (!this.isRunning) return;
            const elapsed = now - this.startTime;
            let percent = (elapsed / this.duration) * 100;
            const remaining = this.duration - elapsed;

            if (percent >= 100) {
                percent = 100;
                this.isRunning = false;
                this.onTick(100, 0, false);
                if (this.onComplete) this.onComplete();
                return;
            }

            const warning = remaining <= this.duration * 0.3 && remaining > 0;
            this.onTick(percent, remaining, warning);

            this.animationFrameId = requestAnimationFrame(tick);
        };

        this.animationFrameId = requestAnimationFrame(tick);
    }

    stop() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
}

class EconovaDisplayController {
    constructor(isScreenMode) {
        this.isScreenMode = isScreenMode;
        this.socket = null;
        this.themeLoader = new EconovaThemeLoader();
        this.timer = null;
        
        this.currentTheme = 'default';
        this.audioContextUnlocked = false;
        this.currentQrIp = '';
        this.round1TimeSeconds = 0;
        this.round1TimerInterval = null;
        
        this.lastV3State = null;
        this.currentV3State = 0;
        this.v3Transitioning = false;
        this.v3IsFirstEntry = false;
        this.v3TransitionTimeout = null;
        this.v3LockedPackageTime = null;
        this.forceQuestionState = false;
        this.packageTransitionTimeout = null;
        this.lastTheme1ActiveQId = null;
        this.lastQKeyForTimer = null;
        this.lastActiveState = false;
        this.currentState = null;
    }

    init() {
        // Unlock Audio Overlay
        const hideUnlockOverlay = () => {
            const overlay = document.getElementById('audioUnlockOverlay');
            if (overlay) {
                overlay.style.display = 'none';
                overlay.style.visibility = 'hidden';
                overlay.style.opacity = '0';
                overlay.style.pointerEvents = 'none';
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }
        };
        
        document.addEventListener('DOMContentLoaded', () => {
            hideUnlockOverlay();
            setTimeout(hideUnlockOverlay, 100);
        });
        window.addEventListener('load', hideUnlockOverlay);

        const unlockAudio = (event) => {
            if (event && event.stopPropagation) event.stopPropagation();
            hideUnlockOverlay();
            if (this.audioContextUnlocked) return;
            this.audioContextUnlocked = true;
            const testAudio = new Audio();
            testAudio.play().catch(() => {});
        };
        
        document.addEventListener('pointerdown', unlockAudio, { capture: true });
        document.addEventListener('keydown', unlockAudio, { capture: true });

        // Initialize high-precision timer
        this.timer = new EconovaTimer(
            (percent, remaining, warning) => this.handleTimerTick(percent, remaining, warning),
            () => this.handleTimerComplete()
        );

        // Pre-render DOM elements once to avoid innerHTML updates
        this.preRenderScoreboards();
        this.preRenderGrids();
        
        // Socket connection
        try {
            window.socket = window.socket || io();
            this.socket = window.socket;
        } catch (e) {
            console.warn('Socket.io unavailable, using mock socket:', e);
            this.socket = { on: () => {}, emit: () => {}, off: () => {} };
            window.socket = this.socket;
        }

        this.setupSocketListeners();
        
        // Window events
        window.addEventListener('resize', () => {
            this.autoScale();
            this.autoResizeText('defaultQText');
            this.autoResizeText('ascendQText');
        });
        window.addEventListener('load', () => this.autoScale());
        this.autoScale();
        
        setInterval(() => this.autoScaleTeamNames(), 1000);
    }

    preRenderScoreboards() {
        const renderCardsHtml = (isCompact = false) => {
            return Array.from({length: 4}, (_, i) => {
                if (isCompact) {
                    return `
                        <div class="compact-team" data-team-index="${i}" style="display: none;">
                            <div class="compact-team-name">
                                <span class="name-inner" style="display:inline-block; transform-origin:left center;"></span>
                            </div>
                            <div class="compact-team-score">0</div>
                        </div>
                    `;
                }
                return `
                    <div class="team-card" data-team-index="${i}" style="display: none;">
                        <div class="team-name" style="display:flex; align-items:center; justify-content:center;">
                            <span class="name-inner" style="display:inline-block; transform-origin:center center;"></span>
                        </div>
                        <div class="team-school" style="display:flex; align-items:center; justify-content:center; overflow:hidden;">
                            <span class="school-inner" style="display:inline-block; transform-origin:center center; white-space:nowrap;">&nbsp;</span>
                        </div>
                        <div class="team-score">0</div>
                    </div>
                `;
            }).join('');
        };

        const defaultScore = document.getElementById('defaultScoreboard');
        if (defaultScore) defaultScore.innerHTML = renderCardsHtml(false);

        const ascendScore = document.getElementById('ascendScoreboard');
        if (ascendScore) ascendScore.innerHTML = renderCardsHtml(false);

        const compactScore = document.getElementById('compactScoreboard');
        if (compactScore) compactScore.innerHTML = renderCardsHtml(true);

        const qBoxScore = document.getElementById('qBoxScoreboard');
        if (qBoxScore) {
            qBoxScore.innerHTML = Array.from({length: 4}, (_, i) => `
                <div class="q-score-item q-team-tab" data-team-index="${i}" style="display: none;">
                    <span class="q-score-name q-team-name"></span>
                    <span class="q-score-value q-team-score">0</span>
                </div>
                ${i < 3 ? `<div class="q-separator" data-separator-index="${i}" style="display: none;"></div>` : ''}
            `).join('');
        }

        const overallScoreGrid = document.getElementById('overallScoreboardGrid');
        if (overallScoreGrid) {
            overallScoreGrid.innerHTML = Array.from({length: 4}, (_, i) => `
                <div class="overall-team-col" data-team-index="${i}" style="display: none; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; position: relative; min-width: 0;">
                    <img class="overall-avatar" src="" style="width: 100%; height: auto; max-height: 65vh; object-fit: contain; z-index: 1;" onerror="this.style.visibility='hidden'">
                    <div style="width: 100%; margin-top: -10%; z-index: 2; display: flex; flex-direction: column; border: 3px solid rgba(255, 255, 255, 0.9); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); overflow: hidden;">
                        <div class="overall-team-name-container" style="background: linear-gradient(180deg, #d2e4f6, #9bc2ea); padding: 8px 10px; text-align: center; border-bottom: 2px solid rgba(255,255,255,0.5); overflow: hidden; display: flex; justify-content: center;">
                            <div class="overall-team-name-inner" style="font-size: 26px; font-weight: normal; color: #012a5e; margin: 0; text-transform: uppercase; white-space: nowrap; transform-origin: center;"></div>
                        </div>
                        <div style="background: linear-gradient(180deg, #1059a4, #083466); padding: 12px 10px; text-align: center;">
                            <div class="overall-score-text" style="font-size: 50px; font-weight: normal; color: #ffffff; margin: 0; line-height: 1;">0</div>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        const v3TeamArea = document.getElementById('v3TeamArea');
        if (v3TeamArea) {
            v3TeamArea.innerHTML = Array.from({length: 4}, (_, i) => `
                <div class="v3-team-row" data-team-index="${i}" style="display: none; transform: skewX(-20deg); padding: 5px 15px; justify-content: space-between; align-items: center; border: 2px solid #00cfff; box-shadow: 0 0 10px rgba(0,0,0,0.5); margin-bottom: 10px;">
                    <div class="v3-team-name" style="transform: skewX(20deg); font-weight: bold; font-size: 24px; color: #00cfff;"></div>
                    <div class="v3-team-score" style="transform: skewX(20deg); font-weight: bold; font-size: 24px; color: #fff;">0</div>
                </div>
            `).join('');
        }
    }

    preRenderGrids() {
        const ptsList = ['10', '20', '40'];
        ptsList.forEach(pts => {
            const container = document.getElementById('grid' + pts);
            if (container) {
                // Pre-render 24 cell elements
                container.innerHTML = Array.from({length: 24}, (_, i) => `
                    <div class="q-cell" data-cell-index="${i}" style="display: none;"></div>
                `).join('');
            }
        });

        const pkgContainers = [
            document.getElementById('packagePointsContainer'),
            document.getElementById('defaultPackagePointsContainer'),
            document.getElementById('ascendPackagePointsContainer'),
            document.getElementById('v3PointsArea')
        ];
        pkgContainers.forEach(container => {
            if (container) {
                container.innerHTML = Array.from({length: 3}, (_, i) => `
                    <div class="package-pts-box" data-chip-index="${i}" style="display: none;"></div>
                `).join('');
            }
        });
    }

    setupSocketListeners() {
        this.socket.on('playSound', (soundId) => this.playSound(soundId));
        this.socket.on('playVideo', (url) => this.playVideo(url));
        this.socket.on('closeVideo', () => this.closeVideo());
        this.socket.on('videoSync', (time) => {
            const mainVideo = document.getElementById('mainVideo');
            if (mainVideo && Math.abs(mainVideo.currentTime - time) > 0.3) {
                mainVideo.currentTime = time;
            }
        });
        this.socket.on('videoPlayState', (state) => {
            const mainVideo = document.getElementById('mainVideo');
            if (mainVideo) {
                if (state === 'play') mainVideo.play().catch(() => {});
                else if (state === 'pause') mainVideo.pause();
            }
        });
        this.socket.on('startCountdown', (seconds) => this.startCountdown(seconds));
        this.socket.on('stopCountdown', () => this.timer.stop());
        this.socket.on('toggleQRCode', () => this.toggleQRCode());
        this.socket.on('serverIPs', (ips) => this.serverIPs(ips));
        this.socket.on('runV3Anim', (type) => this.runV3Anim(type));
        this.socket.on('timer-config-updated', (config) => this.handleTimerConfigUpdated(config));
        this.socket.on('timer-action', (action) => this.handleTimerAction(action));
        this.socket.on('updateState', (state) => this.updateState(state));
    }

    playSound(soundId) {
        if (!this.audioContextUnlocked) return;
        const el = document.getElementById('snd_' + soundId);
        if (el) {
            el.currentTime = 0;
            el.play().catch(() => {});
        }
    }

    playVideo(url) {
        const videoOverlay = document.getElementById('videoOverlay');
        const mainVideo = document.getElementById('mainVideo');
        if (videoOverlay && mainVideo && url) {
            videoOverlay.style.display = 'flex';
            if (url.includes('\\') || url.includes(':\\') || url.startsWith('C:') || url.startsWith('D:')) {
                mainVideo.src = '/api/video?path=' + encodeURIComponent(url);
            } else {
                mainVideo.src = url;
            }
            mainVideo.play().catch(() => {});
        }
    }

    closeVideo() {
        const videoOverlay = document.getElementById('videoOverlay');
        const mainVideo = document.getElementById('mainVideo');
        if (videoOverlay && mainVideo) {
            mainVideo.pause();
            mainVideo.src = '';
            videoOverlay.style.display = 'none';
        }
    }

    startCountdown(seconds) {
        const els = this.getTimerEls();
        if (els.c) els.c.style.display = 'block';
        if (els.b) {
            els.b.style.width = '0%';
            els.b.classList.remove('warning');
            els.b.style.background = '';
            const handle = els.b.querySelector('#timerHandleV3');
            if (handle) handle.style.display = 'none';
        }
        
        const indDef = document.getElementById('timerIndicatorDefault');
        if (indDef) indDef.style.left = '0%';
        
        this.timer.start(seconds);
    }

    handleTimerTick(percent, remaining, warning) {
        const els = this.getTimerEls();
        if (els.b) {
            els.b.style.width = percent + '%';
            if (warning) {
                els.b.classList.add('warning');
                if (this.currentTheme === 'v3') els.b.style.background = '#ff4757';
            } else {
                els.b.classList.remove('warning');
                if (this.currentTheme === 'v3') els.b.style.background = '';
            }
            const handle = els.b.querySelector('#timerHandleV3');
            if (handle) handle.style.display = (percent <= 0) ? 'none' : 'block';
        }
        const indDef = document.getElementById('timerIndicatorDefault');
        if (indDef) indDef.style.left = percent + '%';
    }

    handleTimerComplete() {
        const els = this.getTimerEls();
        setTimeout(() => {
            if (els.c) els.c.style.display = 'none';
            if (els.b) {
                els.b.style.width = '0%';
                const handle = els.b.querySelector('#timerHandleV3');
                if (handle) handle.style.display = 'none';
            }
            const indDef = document.getElementById('timerIndicatorDefault');
            if (indDef) indDef.style.left = '0%';
        }, 500);
    }

    getTimerEls() {
        if (this.currentTheme === 'ascend_2026') {
            return { c: document.getElementById('timerContainerAscend'), b: document.getElementById('timerBarAscend') };
        } else if (this.currentTheme === 'v3') {
            return { c: document.getElementById('timerContainerV3'), b: document.getElementById('timerBarV3') };
        } else {
            return { c: document.getElementById('timerContainerDefault'), b: document.getElementById('timerBarDefault') };
        }
    }

    toggleQRCode() {
        const overlay = document.getElementById('qrCodeOverlay');
        if (!overlay) return;
        if (overlay.style.display === 'flex') {
            overlay.style.display = 'none';
        } else {
            overlay.style.display = 'flex';
            if (!this.currentQrIp) {
                this.serverIPs([window.location.hostname]);
            }
        }
    }

    serverIPs(ips) {
        let ip = 'localhost';
        if (ips && ips.length > 0) {
            ip = ips.find(i => i !== '127.0.0.1' && i !== '::1') || ips[0];
        }
        const port = window.location.port || 39281;
        const url = `http://${ip}:${port}`;
        if (this.currentQrIp === url) return; 

        this.currentQrIp = url;
        const qrIpText = document.getElementById('qrIpText');
        if (qrIpText) qrIpText.innerText = url;
        
        const container = document.getElementById('qrCodeContainer');
        if (container) {
            container.innerHTML = ''; 
            try {
                new QRCode(container, {
                    text: url,
                    width: 400,
                    height: 400,
                    colorDark : "#040f21",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });
            } catch(e) {
                console.error("QRCode generation error:", e);
                container.innerHTML = '<div style="color:red; font-size:20px;">Lỗi tạo QR Code. Đảm bảo qrcode.min.js đã được tải.</div>';
            }
        }
    }

    runV3Anim(typeOrId) {
        let id = typeOrId;
        if (typeOrId === 'box') id = 'qBoxContainer';
        else if (typeOrId === 'grid') id = 'qGridContainer';
        
        const container = document.getElementById(id);
        if (!container) return;
        
        container.classList.remove('run-anim');
        void container.offsetWidth; 
        container.classList.add('run-anim');
        container.style.display = ''; 
    }

    handleTimerConfigUpdated(config) {
        const container = document.getElementById('round1-timer-container');
        const text = document.getElementById('round1-timer-text');
        if (!container || !text) return;
        
        container.style.top = 'auto';
        container.style.bottom = 'auto';
        container.style.left = 'auto';
        container.style.right = 'auto';
        container.style.transform = 'none';

        const margin = '50px';
        switch (config.position) {
            case 'top-left': container.style.top = margin; container.style.left = margin; break;
            case 'top-center': container.style.top = margin; container.style.left = '50%'; container.style.transform = 'translateX(-50%)'; break;
            case 'top-right': container.style.top = margin; container.style.right = margin; break;
            case 'bottom-left': container.style.bottom = margin; container.style.left = margin; break;
            case 'bottom-center': container.style.bottom = margin; container.style.left = '50%'; container.style.transform = 'translateX(-50%)'; break;
            case 'bottom-right': container.style.bottom = margin; container.style.right = margin; break;
        }

        text.style.fontSize = config.fontSize + 'px';
        text.style.color = config.fontColor;
        text.style.webkitTextStroke = `${config.strokeWidth}px ${config.strokeColor}`;
        text.style.fontFamily = config.fontFamily;
        text.style.fontWeight = config.isBold ? 'bold' : 'normal';
        text.style.fontStyle = config.isItalic ? 'italic' : 'normal';
        text.style.textDecoration = config.isUnderline ? 'underline' : 'none';
    }

    handleTimerAction(action) {
        const container = document.getElementById('round1-timer-container');
        if (!container) return;
        if (action.type === 'SET_TIME') {
            this.round1TimeSeconds = action.seconds;
            this.updateRound1TimerDisplay();
            container.style.display = 'block';
        } else if (action.type === 'PLAY') {
            container.style.display = 'block';
            if (!this.round1TimerInterval) {
                this.round1TimerInterval = setInterval(() => {
                    if (this.round1TimeSeconds > 0) {
                        this.round1TimeSeconds--;
                        this.updateRound1TimerDisplay();
                    } else {
                        clearInterval(this.round1TimerInterval);
                        this.round1TimerInterval = null;
                    }
                }, 1000);
            }
        } else if (action.type === 'PAUSE') {
            if (this.round1TimerInterval) {
                clearInterval(this.round1TimerInterval);
                this.round1TimerInterval = null;
            }
        } else if (action.type === 'RESET') {
            if (this.round1TimerInterval) {
                clearInterval(this.round1TimerInterval);
                this.round1TimerInterval = null;
            }
            container.style.display = 'none';
        }
    }

    updateRound1TimerDisplay() {
        const text = document.getElementById('round1-timer-text');
        if (!text) return;
        const m = Math.floor(this.round1TimeSeconds / 60);
        const s = this.round1TimeSeconds % 60;
        text.innerText = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    autoResizeText(textId) {
        const el = document.getElementById(textId);
        if (!el) return;
        el.style.fontSize = '38px';
        let currentSize = 38;
        while (el.scrollHeight > el.clientHeight && currentSize > 16) {
            currentSize--;
            el.style.fontSize = currentSize + 'px';
        }
    }

    autoScale() {
        const baseW = 1920;
        const baseH = 1080;
        const scaleX = window.innerWidth / baseW;
        const scaleY = window.innerHeight / baseH;
        const responsiveScale = Math.min(scaleX, scaleY);
        const manualScale = (this.currentState && this.currentState.settings && this.currentState.settings.scale) ? this.currentState.settings.scale / 100 : 1;
        const scale = Math.max(0.2, Math.min(2.5, responsiveScale * manualScale));

        const mainContainer = document.getElementById('main-container');
        if (mainContainer) {
            mainContainer.style.transform = `scale(${scale})`;
            mainContainer.style.transformOrigin = this.isScreenMode ? 'center center' : 'bottom center';
        }

        const v3w = document.getElementById('v3-wrapper') || document.getElementById('v3-wrapper-overlay');
        if (v3w) {
            if (this.isScreenMode) {
                v3w.style.transform = `translate(-50%, -50%) scale(${scale})`;
                v3w.style.transformOrigin = 'center center';
            } else {
                v3w.style.transform = `translateX(-50%) scale(${scale})`;
                v3w.style.transformOrigin = 'bottom center';
            }
        }
        document.documentElement.style.setProperty('--v3-scale', scale);
    }

    autoScaleTeamNames() {
        if (this.currentTheme === 'ascend_2026') {
            document.querySelectorAll('#ascendScoreboard .team-card').forEach(card => {
                const nameContainer = card.querySelector('.team-name');
                const inner = card.querySelector('.name-inner');
                if (nameContainer && inner) {
                    inner.style.transform = 'scaleX(1)';
                    const avail = nameContainer.clientWidth - 10;
                    if (inner.scrollWidth > avail && avail > 0) {
                        inner.style.transform = `scaleX(${avail / inner.scrollWidth})`;
                    }
                }
            });
        } else if (this.currentTheme === 'default') {
            document.querySelectorAll('#defaultScoreboard .team-card').forEach(card => {
                const nameContainer = card.querySelector('.team-name');
                const inner = card.querySelector('.name-inner');
                if (nameContainer && inner) {
                    inner.style.transform = 'scaleX(1)';
                    const avail = nameContainer.clientWidth - 2;
                    if (inner.scrollWidth > avail && avail > 0) {
                        inner.style.transform = `scaleX(${avail / inner.scrollWidth})`;
                    }
                }

                const schoolContainer = card.querySelector('.team-school');
                const schoolInner = card.querySelector('.school-inner');
                if (schoolContainer && schoolInner) {
                    schoolInner.style.transform = 'scaleX(1)';
                    const availSchool = schoolContainer.clientWidth - 4;
                    if (schoolInner.scrollWidth > availSchool && availSchool > 0) {
                        schoolInner.style.transform = `scaleX(${availSchool / schoolInner.scrollWidth})`;
                    }
                }
            });
        } else {
            document.querySelectorAll('#compactScoreboard .compact-team-name').forEach(nameContainer => {
                const inner = nameContainer.querySelector('.name-inner');
                if (nameContainer && inner) {
                    inner.style.transform = 'scaleX(1)';
                    const avail = nameContainer.clientWidth - 5;
                    if (inner.scrollWidth > avail && avail > 0) {
                        inner.style.transform = `scaleX(${avail / inner.scrollWidth})`;
                    }
                }
            });
        }
        document.querySelectorAll('#overallScoreboardGrid .overall-team-name-container').forEach(container => {
            const inner = container.querySelector('.overall-team-name-inner');
            if (inner) {
                inner.style.transform = 'scaleX(1)';
                const avail = container.clientWidth - 20;
                if (inner.scrollWidth > avail && avail > 0) {
                    inner.style.transform = `scaleX(${avail / inner.scrollWidth})`;
                }
            }
        });
    }

    updateState(state) {
        this.currentState = state;

        // Apply Global & Custom Fonts
        if (state.settings) {
            const s = state.settings;
            const globalEnabled = s.globalFontEnabled || false;
            const fGlobal = s.fontGlobal || 'SF Pro Display Bold';
            const fGeneral = s.fontGeneral || 'SF Pro Display Bold';
            const fQuestion = s.fontQuestion || 'SF Pro Display Bold';
            const fTeam = s.fontTeamName || 'SF Pro Display Bold';
            const fScore = s.fontScore || 'Orbitron';
            
            let styleEl = document.getElementById('dynamic-font-styles-global');
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = 'dynamic-font-styles-global';
                document.head.appendChild(styleEl);
            }
            
            let rules = '';
            if (globalEnabled) {
                rules += `@font-face { font-family: 'CustomFontGlobal'; src: url('/font/${encodeURIComponent(fGlobal)}') format('truetype'); }\n`;
                rules += `:root { 
                    --font-general: 'CustomFontGlobal', 'SF Pro Display Bold', 'Segoe UI', sans-serif;
                    --font-team-name: 'CustomFontGlobal', 'SF Pro Display Bold', 'Segoe UI', sans-serif;
                    --font-score: 'CustomFontGlobal', 'Orbitron', sans-serif;
                    --font-question: 'CustomFontGlobal', 'SF Pro Display Bold', 'Segoe UI', sans-serif;
                }`;
            } else {
                rules += `@font-face { font-family: 'CustomFontGeneral'; src: url('/font/${encodeURIComponent(fGeneral)}') format('truetype'); }\n`;
                rules += `@font-face { font-family: 'CustomFontQuestion'; src: url('/font/${encodeURIComponent(fQuestion)}') format('truetype'); }\n`;
                rules += `@font-face { font-family: 'CustomFontTeamName'; src: url('/font/${encodeURIComponent(fTeam)}') format('truetype'); }\n`;
                rules += `@font-face { font-family: 'CustomFontScore'; src: url('/font/${encodeURIComponent(fScore)}') format('truetype'); }\n`;
                
                rules += `:root { 
                    --font-general: 'CustomFontGeneral', 'SF Pro Display Bold', 'Segoe UI', sans-serif;
                    --font-team-name: 'CustomFontTeamName', 'SF Pro Display Bold', 'Segoe UI', sans-serif;
                    --font-score: 'CustomFontScore', 'Orbitron', sans-serif;
                    --font-question: 'CustomFontQuestion', 'SF Pro Display Bold', 'Segoe UI', sans-serif;
                }`;
            }
            
            if (styleEl.innerHTML !== rules) {
                styleEl.innerHTML = rules;
            }
        }

        if (!state.teams) return;

        // Centralized wrapper animations
        const mainContainer = document.getElementById('main-container');
        if (mainContainer) {
            mainContainer.style.transition = 'opacity 0.3s, visibility 0.3s';
            mainContainer.style.visibility = 'visible';
            mainContainer.style.opacity = '1';
        }
        const v3Wrapper = document.getElementById('v3-wrapper') || document.getElementById('v3-wrapper-overlay');
        if (v3Wrapper) {
            v3Wrapper.style.transition = 'opacity 0.3s, visibility 0.3s';
            v3Wrapper.style.visibility = 'visible';
            v3Wrapper.style.opacity = '1';
        }

        const round1Timer = document.getElementById('round1-timer-container');
        if (round1Timer) {
            round1Timer.style.opacity = state.activeRound === 1 ? '1' : '0';
            round1Timer.style.visibility = state.activeRound === 1 ? 'visible' : 'hidden';
        }

        const bgGrid = document.querySelector('.bg-grid');
        if (state.activeRound === 1) {
            if (bgGrid) bgGrid.style.display = 'none';
        } else {
            document.body.style.background = '';
            document.documentElement.style.background = '';
            if (bgGrid) bgGrid.style.display = '';
        }

        // Apply theme through loader
        if (state.settings && state.settings.theme) {
            const nextTheme = state.settings.theme;
            if (nextTheme !== this.currentTheme) {
                this.currentTheme = nextTheme;
                this.themeLoader.load(nextTheme).then(() => {
                    this.autoScale();
                });
            }
            document.body.style.filter = `brightness(${(state.settings.brightness || 100) / 100})`;
        }

        // 1. Sync properties to dataset variables on body
        document.body.setAttribute('data-theme', this.currentTheme);
        document.body.setAttribute('data-active-round', state.activeRound || '');

        // Update Scoreboards (Default, Ascend, Compact)
        state.teams.forEach((team, idx) => {
            let isMain = false;
            if (state.currentQuestion && state.currentQuestion.active) {
                isMain = (state.currentQuestion.mainTeamId === team.id);
            } else {
                isMain = (state.turnOrder && state.turnOrder.length > 0 && state.turnOrder[0] === team.id);
            }
            const isBuzzed = state.buzzedTeam === team.id;
            
            const updateCard = (containerId) => {
                const container = document.getElementById(containerId);
                if (!container) return;
                const card = container.querySelector(`[data-team-index="${idx}"]`);
                if (!card) return;
                
                card.style.display = '';
                card.setAttribute('data-team', team.id);
                card.className = `team-card${isMain ? ' is-main' : ''}${isBuzzed ? ' buzzed' : ''}`;
                
                const nameEl = card.querySelector('.team-name .name-inner');
                if (nameEl) nameEl.textContent = team.name;
                
                const schoolEl = card.querySelector('.team-school .school-inner') || card.querySelector('.team-school');
                if (schoolEl) schoolEl.innerHTML = team.school || '&nbsp;';
                
                const scoreEl = card.querySelector('.team-score');
                if (scoreEl) scoreEl.textContent = team.score;
            };

            updateCard('defaultScoreboard');
            updateCard('ascendScoreboard');

            // Compact scoreboard updates
            const compactContainer = document.getElementById('compactScoreboard');
            if (compactContainer) {
                const card = compactContainer.querySelector(`[data-team-index="${idx}"]`);
                if (card) {
                    card.style.display = 'flex';
                    card.className = `compact-team${isMain ? ' active-team' : ''}${isBuzzed ? ' buzzed-team' : ''}`;
                    const nameEl = card.querySelector('.compact-team-name .name-inner');
                    if (nameEl) nameEl.textContent = team.name;
                    const scoreEl = card.querySelector('.compact-team-score');
                    if (scoreEl) scoreEl.textContent = team.score;
                }
            }

            // QBox scoreboard updates
            const qBoxContainer = document.getElementById('qBoxScoreboard');
            if (qBoxContainer) {
                const item = qBoxContainer.querySelector(`[data-team-index="${idx}"]`);
                const sep = qBoxContainer.querySelector(`[data-separator-index="${idx}"]`);
                if (item) {
                    item.style.display = 'flex';
                    if (this.currentTheme === 'v3') {
                        item.className = `q-score-item q-team-tab${isMain ? ' active' : ''}`;
                        const nameEl = item.querySelector('.q-score-name');
                        if (nameEl) nameEl.textContent = isMain ? `${idx + 1}. ${team.name}` : `${idx + 1}. ${team.name} (${team.score})`;
                        const scoreVal = item.querySelector('.q-score-value');
                        if (scoreVal) scoreVal.style.display = 'none';
                    } else {
                        item.className = `q-score-item q-team-tab${isMain ? ' active' : ''}`;
                        const nameEl = item.querySelector('.q-score-name');
                        if (nameEl) nameEl.textContent = `${idx + 1}. ${team.name}`;
                        const scoreVal = item.querySelector('.q-score-value');
                        if (scoreVal) {
                            scoreVal.style.display = '';
                            scoreVal.textContent = team.score;
                        }
                    }
                }
                if (sep) {
                    sep.style.display = (this.currentTheme === 'v3' && idx < state.teams.length - 1) ? 'block' : 'none';
                }
            }
        });

        // Hide extra cards
        const hideExtraCards = (containerId, numTeams) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            for (let i = numTeams; i < 4; i++) {
                const card = container.querySelector(`[data-team-index="${i}"]`);
                if (card) card.style.display = 'none';
            }
        };
        hideExtraCards('defaultScoreboard', state.teams.length);
        hideExtraCards('ascendScoreboard', state.teams.length);
        const compactScore = document.getElementById('compactScoreboard');
        if (compactScore) {
            for (let i = state.teams.length; i < 4; i++) {
                const card = compactScore.querySelector(`[data-team-index="${i}"]`);
                if (card) card.style.display = 'none';
            }
        }
        const qBoxScore = document.getElementById('qBoxScoreboard');
        if (qBoxScore) {
            for (let i = state.teams.length; i < 4; i++) {
                const card = qBoxScore.querySelector(`[data-team-index="${i}"]`);
                const sep = qBoxScore.querySelector(`[data-separator-index="${i}"]`);
                if (card) card.style.display = 'none';
                if (sep) sep.style.display = 'none';
            }
        }

        // Overall scoreboard updates
        const overallOverlay = document.getElementById('overallScoreboardOverlay');
        if (overallOverlay) {
            if (state.showOverallScoreboard) {
                overallOverlay.style.display = 'flex';
                overallOverlay.style.backgroundImage = state.scoreboardBg ? `url(${state.scoreboardBg})` : `url('/Themes/Background/B1.png')`;
                
                const fontTeamName = (state.settings && state.settings.fontTeamName) || 'SF Pro Display Bold';
                const fontScore = (state.settings && state.settings.fontScore) || 'Orbitron';
                
                let styleEl = document.getElementById('dynamic-font-styles-overall');
                if (!styleEl) {
                    styleEl = document.createElement('style');
                    styleEl.id = 'dynamic-font-styles-overall';
                    document.head.appendChild(styleEl);
                }
                styleEl.innerHTML = `
                    @font-face { font-family: 'CustomTeamFont'; src: url('/font/${encodeURIComponent(fontTeamName)}') format('truetype'); }
                    @font-face { font-family: 'CustomScoreFont'; src: url('/font/${encodeURIComponent(fontScore)}') format('truetype'); }
                `;

                // Set overall title
                let titleNode = overallOverlay.querySelector('.overall-title');
                const titleText = (state.settings && state.settings.scoreboardTitle) || '';
                if (!titleNode && titleText) {
                    titleNode = document.createElement('div');
                    titleNode.className = 'overall-title';
                    titleNode.style.cssText = "position:absolute; top: 10%; width: 100%; text-align: center; z-index: 10;";
                    overallOverlay.appendChild(titleNode);
                }
                if (titleNode) {
                    titleNode.innerHTML = titleText 
                        ? `<span style="font-family:'CustomTeamFont', '${fontTeamName}', sans-serif; font-size:75px; font-weight:normal; color:#fff; text-shadow:0 4px 15px rgba(0,0,0,0.8), 0 2px 5px rgba(0,0,0,0.5); letter-spacing:4px; text-transform:uppercase;">${titleText}</span>`
                        : '';
                }

                // Update columns
                const overallGrid = document.getElementById('overallScoreboardGrid');
                if (overallGrid) {
                    const yOffset = (state.settings && state.settings.scoreboardY !== undefined) ? state.settings.scoreboardY : 50;
                    overallGrid.parentElement.style.top = yOffset + '%';
                    overallGrid.parentElement.style.transform = `translateY(-${yOffset}%)`;

                    state.teams.forEach((team, idx) => {
                        const col = overallGrid.querySelector(`[data-team-index="${idx}"]`);
                        if (col) {
                            col.style.display = 'flex';
                            
                            let avatarUrl = `/Themes/Avatars/${team.id}.png`;
                            if (state.avatarTimestamps && state.avatarTimestamps[team.id]) {
                                avatarUrl += `?t=${state.avatarTimestamps[team.id]}`;
                            }
                            
                            const avatar = col.querySelector('.overall-avatar');
                            if (avatar) {
                                avatar.src = avatarUrl;
                                avatar.style.width = (team.avatarSize !== undefined ? team.avatarSize : 100) + '%';
                                avatar.style.transform = `translateX(${team.avatarOffsetX !== undefined ? team.avatarOffsetX : 0}%)`;
                            }
                            
                            const nameBox = col.querySelector('.overall-team-name-container');
                            const nameInner = col.querySelector('.overall-team-name-inner');
                            if (nameBox && nameInner) {
                                nameInner.textContent = team.name;
                                nameInner.style.fontFamily = `'CustomTeamFont', '${fontTeamName}', sans-serif`;
                                nameBox.style.marginTop = `-${team.avatarOverlap !== undefined ? team.avatarOverlap : 10}%`;
                            }

                            const scoreBox = col.querySelector('.overall-score-text');
                            if (scoreBox) {
                                scoreBox.textContent = team.score;
                                scoreBox.style.fontFamily = `'CustomScoreFont', '${fontScore}', sans-serif`;
                            }
                        }
                    });

                    // Hide unused overall cols
                    for (let i = state.teams.length; i < 4; i++) {
                        const col = overallGrid.querySelector(`[data-team-index="${i}"]`);
                        if (col) col.style.display = 'none';
                    }

                    requestAnimationFrame(() => {
                        overallGrid.querySelectorAll('.overall-team-name-container').forEach(container => {
                            const inner = container.querySelector('.overall-team-name-inner');
                            if (inner) {
                                inner.style.transform = 'scaleX(1)';
                                const avail = container.clientWidth - 20; 
                                if (inner.scrollWidth > avail && avail > 0) {
                                    inner.style.transform = `scaleX(${avail / inner.scrollWidth})`;
                                }
                            }
                        });
                    });
                }
            } else {
                overallOverlay.style.display = 'none';
            }
        }

        // Update translations
        const lang = (state.settings && state.settings.language) || 'vi';
        if (typeof applyTranslations === 'function') applyTranslations(lang);
        const textPts = (typeof t === 'function') ? t('scr_pts', lang) : 'ĐIỂM';

        const gh10 = document.getElementById('gh10');
        const gh20 = document.getElementById('gh20');
        const gh40 = document.getElementById('gh40');
        if (gh10) gh10.textContent = `10 ${textPts}`;
        if (gh20) gh20.textContent = `20 ${textPts}`;
        if (gh40) gh40.textContent = `40 ${textPts}`;

        // Grid selection mode
        const mode = state.lockedPackage ? state.lockedPackage.mode : (state.settings ? state.settings.questionSelectionMode : 1);
        let questionsArray = null;
        if (state.lockedPackage) {
            questionsArray = state.lockedPackage.questions || state.lockedPackage.package || [];
        } else if (state.pendingPackage) {
            if (mode === 1) {
                questionsArray = Array.isArray(state.pendingPackage) 
                    ? state.pendingPackage.map(pts => ({ points: pts, played: false }))
                    : state.pendingPackage;
            } else {
                questionsArray = state.pendingPackage.questions || state.pendingPackage.package || [];
            }
        }

        // Populate grids
        const ptsList = [10, 20, 40];
        ptsList.forEach(pts => {
            const container = document.getElementById('grid' + pts);
            if (container) {
                const cells = container.querySelectorAll('.q-cell');
                let cellCount = 0;
                
                if (mode === 1) {
                    container.classList.add('mode1-grid');
                    container.style.display = '';
                    container.style.flexWrap = 'wrap';
                    container.style.justifyContent = 'center';
                    cellCount = (state.questionCount && state.questionCount[pts] !== undefined) ? state.questionCount[pts] : 12;
                    const rows = cellCount > 18 ? 3 : (cellCount > 6 ? 2 : 1);

                    for (let i = 0; i < cells.length; i++) {
                        const cell = cells[i];
                        if (i < cellCount) {
                            cell.style.display = '';
                            const isPlayed = state.playedQuestions && state.playedQuestions[pts] && state.playedQuestions[pts].includes(i);
                            cell.className = `q-cell active-tab ${isPlayed ? 'played' : ''}`;
                            cell.textContent = i + 1;
                            
                            let itemsThisRow = cellCount;
                            if (rows === 2) {
                                const itemsR1 = Math.floor(cellCount / 2);
                                const itemsR2 = cellCount - itemsR1;
                                itemsThisRow = (i < itemsR1) ? itemsR1 : itemsR2;
                            } else if (rows === 3) {
                                const base = Math.floor(cellCount / 3);
                                const extra = cellCount % 3;
                                const itemsR1 = base + (extra > 0 ? 1 : 0);
                                const itemsR2 = base + (extra > 1 ? 1 : 0);
                                if (i < itemsR1) itemsThisRow = itemsR1;
                                else if (i < itemsR1 + itemsR2) itemsThisRow = itemsR2;
                                else itemsThisRow = cellCount - itemsR1 - itemsR2;
                            }
                            const flexBasis = `calc((100% - ${(itemsThisRow - 1) * 10}px) / ${itemsThisRow})`;
                            cell.style.flex = `0 0 ${flexBasis}`;
                            cell.style.width = flexBasis;
                            cell.style.maxWidth = flexBasis;
                            cell.style.minWidth = '0';
                            cell.style.padding = '0';
                            cell.style.boxSizing = 'border-box';
                            cell.style.animationDelay = `${i * 0.05}s`;
                        } else {
                            cell.style.display = 'none';
                        }
                    }
                } else {
                    container.classList.remove('mode1-grid');
                    const pkg = state.lockedPackage || state.pendingPackage;
                    const rawQuestions = questionsArray || [];
                    const qPerTeam = (state.settings && state.settings.questionsPerTeam) || 3;
                    cellCount = qPerTeam;

                    for (let i = 0; i < cells.length; i++) {
                        const cell = cells[i];
                        if (i < qPerTeam) {
                            const qData = rawQuestions[i];
                            if (qData && qData.points === pts) {
                                cell.style.display = '';
                                cell.style.flex = '';
                                cell.style.width = '';
                                cell.style.maxWidth = '';
                                cell.style.padding = '';

                                let isPlayed = false;
                                let isCurrent = false;
                                if (state.lockedPackage) {
                                    if (pkg.currentIndex > i) {
                                        isPlayed = true;
                                    } else if (pkg.currentIndex === i) {
                                        if (state.currentQuestion && state.currentQuestion.resolved) {
                                            isPlayed = true;
                                        } else if (state.currentQuestion && state.currentQuestion.active) {
                                            isCurrent = true;
                                        }
                                    }
                                }
                                
                                let qNumberText = "";
                                let cellClass = "inactive-tab";
                                let isChosen = (qData.idx !== undefined && qData.idx !== -1);
                                let chosenIdx = qData.idx !== undefined ? qData.idx : -1;
                                
                                if (isPlayed) {
                                    cellClass = "played";
                                    qNumberText = pkg.mode === 3 ? "" : (chosenIdx + 1);
                                } else if (isCurrent) {
                                    cellClass = "active-tab";
                                    qNumberText = pkg.mode === 3 ? "" : (chosenIdx + 1);
                                } else if (isChosen) {
                                    if (state.lockedPackage) {
                                        cellClass = "inactive-tab";
                                    } else {
                                        cellClass = "active-tab";
                                    }
                                    qNumberText = pkg.mode === 3 ? "" : (chosenIdx + 1);
                                }

                                cell.setAttribute('data-idx', chosenIdx);

                                if (this.currentTheme === 'v3') {
                                    const isSelected = isPlayed || isCurrent || isChosen;
                                    let content = `<span>${pts}</span>`;
                                    if (isSelected && pkg.mode === 2) {
                                        content += `<div class="v3-cell-index-badge">${chosenIdx + 1}</div>`;
                                    }
                                    cell.className = `q-cell ${isSelected ? `${cellClass} v3-selected` : cellClass}`;
                                    cell.innerHTML = content;
                                } else {
                                    cell.className = `q-cell ${cellClass}`;
                                    cell.textContent = qNumberText;
                                }
                            } else {
                                cell.style.display = 'none'; // Hide mismatching cells to fix diagonal layout gaps!
                            }
                        } else {
                            cell.style.display = 'none';
                        }
                    }
                }
            }
        });

        // Question Details
        const q = state.currentQuestion || {};
        
        // Hope Star
        if (state.activeRound !== this.lastActiveRound) {
            const hasPendingPackage = state.pendingPackage && !state.lockedPackage;
            const setHopeStarDisplay = (badgeId) => {
                const el = document.getElementById(badgeId);
                if (el) el.style.display = hasPendingPackage ? 'flex' : 'none';
            };
            setHopeStarDisplay('defaultHopeStarBadge');
            setHopeStarDisplay('ascendHopeStarBadge');
        }

        const ascendPtsBox = document.getElementById('ascendPtsBox');
        const ptsVal = (q && q.points !== undefined && q.points !== null) ? (typeof q.points === 'object' ? (q.points.value || q.points.points || q.points.score || parseInt(JSON.stringify(q.points))) : parseInt(q.points) || q.points) : null;
        
        const defQPoints = document.getElementById('defaultQPoints');
        const ascQPoints = document.getElementById('ascendQPoints');
        
        if (q.active) {
            if (defQPoints && this.currentTheme === 'default') {
                const isMode1 = Boolean((state.lockedPackage && state.lockedPackage.mode === 1) || (state.pendingPackage && state.pendingPackage.mode === 1));
                defQPoints.style.display = isMode1 ? 'block' : 'none';
                defQPoints.textContent = ptsVal ? `${ptsVal} ${textPts}` : '';
            }
            if (ascQPoints && this.currentTheme === 'ascend_2026') ascQPoints.textContent = ptsVal ? `${ptsVal} ${textPts}` : '';
        } else {
            if (defQPoints) defQPoints.textContent = '';
            if (ascQPoints) ascQPoints.textContent = '';
        }
        
        const defQText = document.getElementById('defaultQText');
        const ascQText = document.getElementById('ascendQText');
        
        if (q.active && q.text) {
            if (defQText && this.currentTheme === 'default') defQText.innerHTML = q.text;
            if (ascQText && this.currentTheme === 'ascend_2026') {
                if (ascQText.innerHTML !== q.text) {
                    ascQText.classList.remove('ascend-qtext-anim');
                    void ascQText.offsetWidth; 
                    ascQText.innerHTML = q.text;
                    ascQText.classList.add('ascend-qtext-anim');
                }
            }
        } else {
            if (defQText) defQText.innerHTML = '';
            if (ascQText) ascQText.innerHTML = '';
        }

        // Package chips in Ascend theme
        if (ascendPtsBox && this.currentTheme === 'ascend_2026') {
            const showPackageChips = Boolean((state.lockedPackage || state.pendingPackage) && ((state.lockedPackage && state.lockedPackage.mode === 2) || (state.lockedPackage && state.lockedPackage.mode === 3) || (state.pendingPackage && state.pendingPackage.mode === 2) || (state.pendingPackage && state.pendingPackage.mode === 3)));
            if (showPackageChips) {
                ascendPtsBox.style.display = 'flex';
                const pkg2 = state.lockedPackage || state.pendingPackage || {};
                const questions2 = Array.isArray(pkg2.questions) ? pkg2.questions : (Array.isArray(pkg2.package) ? pkg2.package : []);
                const currentQuestionKey2 = q ? (q.idx !== undefined ? q.idx : (q.id !== undefined ? q.id : (q.questionId !== undefined ? q.questionId : q._id))) : null;
                const chipCount = Math.max(1, questions2.length);
                const chipWidthPercent = chipCount > 0 ? `${100 / chipCount}%` : '100%';
                ascendPtsBox.style.setProperty('--ascend-chip-count', String(chipCount));
                ascendPtsBox.innerHTML = questions2.map((question, index) => {
                    const pointValue = question ? (question.points !== undefined ? question.points : (question.point !== undefined ? question.point : (question.score !== undefined ? question.score : question.value))) : undefined;
                    const label = pointValue !== undefined && pointValue !== null ? pointValue : (index + 1);
                    const isActive = q && q.active && !q.isHidden && state.lockedPackage && (state.lockedPackage.currentIndex === index);
                    return `<div class="ascend-pts-chip${isActive ? ' active-pts' : ''}" style="background:${isActive ? 'linear-gradient(135deg, #5bd4ff 0%, #24b0ff 100%)' : 'rgba(255,255,255,0.85)'}; color:${isActive ? '#07131f' : '#000000'}; width:${chipWidthPercent}; flex:0 0 ${chipWidthPercent}; max-width:${chipWidthPercent};">${label}</div>`;
                }).join('');
            } else {
                ascendPtsBox.style.display = 'none';
                ascendPtsBox.style.setProperty('--ascend-chip-count', '1');
                ascendPtsBox.innerHTML = '';
            }
        }

        // Package chips in Default theme
        const defaultPkgContainer = document.getElementById('defaultPackagePointsContainer');
        if (defaultPkgContainer && this.currentTheme === 'default') {
            const showPackageChips2 = Boolean((state.lockedPackage || state.pendingPackage) && ((state.lockedPackage && state.lockedPackage.mode === 2) || (state.lockedPackage && state.lockedPackage.mode === 3) || (state.pendingPackage && state.pendingPackage.mode === 2) || (state.pendingPackage && state.pendingPackage.mode === 3)));
            if (showPackageChips2) {
                defaultPkgContainer.style.display = 'flex';
                defaultPkgContainer.style.gap = '10px';
                defaultPkgContainer.style.justifyContent = 'center';
                defaultPkgContainer.style.marginBottom = '20px';
                const pkg3 = state.lockedPackage || state.pendingPackage || {};
                const questions3 = Array.isArray(pkg3.questions) ? pkg3.questions : (Array.isArray(pkg3.package) ? pkg3.package : []);
                const currentQuestionKey3 = q ? (q.idx !== undefined ? q.idx : (q.id !== undefined ? q.id : (q.questionId !== undefined ? q.questionId : q._id))) : null;
                defaultPkgContainer.innerHTML = questions3.map((question, index) => {
                    const pointValue = question ? (question.points !== undefined ? question.points : (question.point !== undefined ? question.point : (question.score !== undefined ? question.score : question.value))) : undefined;
                    const label = pointValue !== undefined && pointValue !== null ? pointValue : (index + 1);
                    const isActive = q && q.active && !q.isHidden && state.lockedPackage && (state.lockedPackage.currentIndex === index);
                    const bg = isActive ? 'linear-gradient(180deg, #ff9900, #ff5500)' : 'linear-gradient(180deg, #111, #333)';
                    const border = isActive ? '2px solid #fff' : '2px solid #555';
                    const color = isActive ? '#fff' : '#aaa';
                    return `<div style="background:${bg}; border:${border}; color:${color}; font-size:30px; font-weight:bold; padding:10px 20px; border-radius:10px; min-width:80px; text-align:center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">${label}</div>`;
                }).join('');
            } else {
                defaultPkgContainer.style.display = 'none';
                defaultPkgContainer.innerHTML = '';
            }
        }

        // Force Question State timer (Question Selection Grid visibility timing rule)
        const isMode1a = Boolean((state.lockedPackage && state.lockedPackage.mode === 1) || (state.pendingPackage && state.pendingPackage.mode === 1));
        const defQBox = document.getElementById('defaultQBox');
        if (defQBox && this.currentTheme === 'default') {
            if (q && q.active) {
                const currentQId2 = (q.idx !== undefined ? q.idx : q.id);
                if (isMode1a && currentQId2 !== this.lastTheme1ActiveQId) {
                    this.lastTheme1ActiveQId = currentQId2;
                    defQBox.style.transition = 'none';
                    defQBox.style.opacity = '0';
                    setTimeout(() => {
                        defQBox.style.transition = 'opacity 0.5s ease-in';
                        defQBox.style.opacity = '1';
                    }, 1000);
                }
            } else {
                this.lastTheme1ActiveQId = null;
                defQBox.style.transition = 'none';
                defQBox.style.opacity = '1';
            }
        }

        // Hope star badge logic
        const hsbDef = document.getElementById('defaultHopeStarBadge') || document.getElementById('hopeStarBadge');
        const hsbAsc = document.getElementById('ascendHopeStarBadge');
        if (q && q.hopeStar && q.active) {
            if (hsbDef) { hsbDef.style.display = 'block'; hsbDef.classList.add('active'); }
            if (hsbAsc) { hsbAsc.style.display = 'block'; hsbAsc.classList.add('active'); }
        } else {
            if (hsbDef) { hsbDef.style.display = 'none'; hsbDef.classList.remove('active'); }
            if (hsbAsc) { hsbAsc.style.display = 'none'; hsbAsc.classList.remove('active'); }
        }

        // Question key check for resetting timer bars
        const currentQKeyForTimer = q ? (q.idx !== undefined ? q.idx : (q.id !== undefined ? q.id : (q.questionId !== undefined ? q.questionId : q._id))) : null;
        if (this.lastQKeyForTimer !== currentQKeyForTimer) {
            this.lastQKeyForTimer = currentQKeyForTimer;
            const elsAscend = { c: document.getElementById('timerContainerAscend'), b: document.getElementById('timerBarAscend') };
            if (elsAscend.c) elsAscend.c.style.display = 'none';
            if (elsAscend.b) elsAscend.b.style.width = '100%';
        }

        // Track transitions & timing
        this.lastActiveState = q.active;
        
        if (state.lockedPackage) {
            const elapsed = Date.now() - state.lockedPackage.lockedAt;
            if (elapsed < 1000) {
                clearTimeout(this.packageTransitionTimeout);
                this.packageTransitionTimeout = setTimeout(() => {
                    this.packageTransitionTimeout = null;
                    this.applyVisibility(this.currentState);
                }, 1000 - elapsed);
            }
        } else {
            clearTimeout(this.packageTransitionTimeout);
            this.packageTransitionTimeout = null;
        }

        this.applyVisibility(state);
    }

    clearThemeQuestionText() {
        const defaultQText = document.getElementById('defaultQText');
        const ascendQText = document.getElementById('ascendQText');
        const qTextV3 = document.getElementById('qTextV3');
        const qText = document.getElementById('qText');
        if (defaultQText) defaultQText.textContent = '';
        if (ascendQText) ascendQText.textContent = '';
        if (qTextV3) {
            qTextV3.textContent = '';
            qTextV3.removeAttribute('data-raw');
        }
        if (qText) qText.textContent = '';
    }

    applyVisibility(state) {
        const theme = this.currentTheme || 'default';
        const qObj = state.currentQuestion || {};
        
        let withinLockDelay = false;
        if (state.lockedPackage && state.lockedPackage.lockedAt) {
            const elapsed = Date.now() - state.lockedPackage.lockedAt;
            if (elapsed < 1000) {
                withinLockDelay = true;
            }
        }
        
        const showGrid = Boolean((state.isGridVisibleOnOverlay || withinLockDelay) && !this.forceQuestionState);
        const showQuestion = Boolean(((state.lockedPackage && !withinLockDelay) || (qObj && qObj.active && !withinLockDelay)) || this.forceQuestionState);
        
        const displayState = showQuestion ? 2 : (showGrid ? 1 : 0);

        // Update body data-display-state for theme CSS selector usage
        document.body.setAttribute('data-display-state', displayState);

        if (!showQuestion) {
            this.clearThemeQuestionText();
        }

        if (theme === 'v3') {
            const elementsToHide = [
                'ascendFrame', 'defaultScoreboard', 'defaultQuestionArea', 
                'ascendQuestionArea', 'defaultQBox', 'ascendQBox', 'qGrid'
            ];
            elementsToHide.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.setProperty('display', 'none', 'important');
            });
            
            const v3Wrapper = document.getElementById('v3-wrapper') || document.getElementById('v3-wrapper-overlay');
            const v3Master = document.getElementById('v3MasterContainer');
            
            if (v3Wrapper) {
                v3Wrapper.style.setProperty('display', 'block', 'important');
                v3Wrapper.style.setProperty('visibility', 'visible', 'important');
                v3Wrapper.style.setProperty('opacity', '1', 'important');
            }
            if (v3Master) v3Master.style.setProperty('display', 'block', 'important');
            
            this.renderV3(state);
            return;
        }

        const v3Wrapper = document.getElementById('v3-wrapper') || document.getElementById('v3-wrapper-overlay');
        const v3Master = document.getElementById('v3MasterContainer');
        if (v3Wrapper) v3Wrapper.style.setProperty('display', 'none', 'important');
        if (v3Master) v3Master.style.setProperty('display', 'none', 'important');

        if (theme === 'ascend_2026') {
            const elementsToHide = ['defaultScoreboard', 'defaultQuestionArea', 'defaultQBox'];
            elementsToHide.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.setProperty('display', 'none', 'important');
            });

            const ascendFrame = document.getElementById('ascendFrame');
            const ascendQArea = document.getElementById('ascendQuestionArea') || document.getElementById('qArea');
            const ascendQBox = document.getElementById('ascendQBox') || document.getElementById('qBox');
            const qGridNode = document.getElementById('qGrid');

            const showAscendGraphic = (displayState === 2) || (state.lockedPackage != null && displayState === 0);
            if (showAscendGraphic) {
                if (ascendFrame) ascendFrame.style.setProperty('display', 'flex', 'important');
                if (ascendQArea) ascendQArea.style.setProperty('display', 'flex', 'important');  
                if (ascendQBox) ascendQBox.style.setProperty('display', 'flex', 'important');
                if (qGridNode) qGridNode.style.setProperty('display', 'none', 'important');  
            } else if (displayState === 1) {
                if (ascendFrame) ascendFrame.style.setProperty('display', 'none', 'important');
                if (ascendQArea) ascendQArea.style.setProperty('display', 'none', 'important');  
                if (ascendQBox) ascendQBox.style.setProperty('display', 'none', 'important');
                if (qGridNode) qGridNode.style.setProperty('display', 'flex', 'important');  
            } else {
                if (ascendFrame) ascendFrame.style.setProperty('display', 'none', 'important');
                if (ascendQArea) ascendQArea.style.setProperty('display', 'none', 'important');
                if (ascendQBox) ascendQBox.style.setProperty('display', 'none', 'important');
                if (qGridNode) qGridNode.style.setProperty('display', 'none', 'important');
            }
            return;
        }

        // Default Theme Layout
        const ascendFrame = document.getElementById('ascendFrame');
        const ascendQArea = document.getElementById('ascendQuestionArea') || document.getElementById('qArea');
        const ascendQBox = document.getElementById('ascendQBox') || document.getElementById('qBox');
        if (ascendFrame) ascendFrame.style.setProperty('display', 'none', 'important');
        if (ascendQArea) ascendQArea.style.setProperty('display', 'none', 'important');
        if (ascendQBox) ascendQBox.style.setProperty('display', 'none', 'important');

        const defScoreboard = document.getElementById('defaultScoreboard');
        const defQArea = document.getElementById('defaultQuestionArea') || document.getElementById('qArea');
        const defQBox = document.getElementById('defaultQBox') || document.getElementById('qBox');
        const qGridNode = document.getElementById('qGrid');

        const showClassicGraphic = (displayState === 2) || (state.lockedPackage != null && displayState === 0);
        if (showClassicGraphic) {
            if (defScoreboard) defScoreboard.style.setProperty('display', 'flex', 'important');
            if (defQArea) defQArea.style.setProperty('display', 'flex', 'important');
            if (defQBox) defQBox.style.setProperty('display', 'flex', 'important');
            if (qGridNode) qGridNode.style.setProperty('display', 'none', 'important');
        } else if (displayState === 1) {
            if (defScoreboard) defScoreboard.style.setProperty('display', 'flex', 'important');
            if (defQArea) defQArea.style.setProperty('display', 'none', 'important');
            if (defQBox) defQBox.style.setProperty('display', 'none', 'important');
            if (qGridNode) qGridNode.style.setProperty('display', 'flex', 'important');
        } else {
            if (defScoreboard) defScoreboard.style.setProperty('display', 'none', 'important');
            if (defQArea) defQArea.style.setProperty('display', 'none', 'important');
            if (defQBox) defQBox.style.setProperty('display', 'none', 'important');
            if (qGridNode) qGridNode.style.setProperty('display', 'none', 'important');
        }
    }

    renderV3(state) {
        if (this.isScreenMode) {
            this.renderV3Screen(state);
        } else {
            this.renderV3Overlay(state);
        }
    }

    // ----------------------------------------------------
    // V3 SCREEN-MODE LOGIC (From screen.html v3-script)
    // ----------------------------------------------------
    renderV3Screen(state) {
        const q = state.currentQuestion || {};
        let computedMachineState = 0; 

        let isMode1 = state.settings ? state.settings.questionSelectionMode === 1 : true;
        if (state.lockedPackage) isMode1 = (state.lockedPackage.mode === 1);

        if (isMode1) {
            if (q.active) {
                computedMachineState = 2;
            } else if (state.lockedPackage || state.pendingPackage || state.isGridVisibleOnOverlay) {
                computedMachineState = 1;
            }
        } else {
            if (state.lockedPackage) {
                const lockedAt = state.lockedPackage.lockedAt || (Date.now() - 1000);
                const elapsed = Date.now() - lockedAt;
                if (elapsed >= 1000) {
                    computedMachineState = 2;
                } else {
                    computedMachineState = 1;
                    if (!this.v3TransitionTimeout) {
                        this.v3TransitionTimeout = setTimeout(() => {
                            this.v3TransitionTimeout = null;
                            if (this.lastV3State) this.renderV3Screen(this.lastV3State);
                        }, 1000 - elapsed);
                    }
                }
            } else if (state.pendingPackage || state.isGridVisibleOnOverlay) {
                computedMachineState = 1;
                clearTimeout(this.v3TransitionTimeout); this.v3TransitionTimeout = null;
            } else {
                clearTimeout(this.v3TransitionTimeout); this.v3TransitionTimeout = null;
            }
        }

        this.lastV3State = state;
        if (computedMachineState !== this.currentV3State && !this.v3Transitioning) {
            this.triggerV3TransitionScreen(computedMachineState, state);
        } else if (!this.v3Transitioning) { 
            if (computedMachineState === 1) this.renderV3GridScreen(state); 
            else if (computedMachineState === 2) this.renderV3QBoxScreen(state); 
            else {
                const v3Master = document.getElementById('v3MasterContainer');
                if (v3Master) v3Master.style.display = 'none';
            }
        }
    }

    triggerV3TransitionScreen(newState, stateObj) {
        if (this.v3Transitioning) return;
        this.v3Transitioning = true;
        const v3Master = document.getElementById('v3MasterContainer');
        this.v3IsFirstEntry = (this.currentV3State === 0);
        if (newState === 0) {
            this.applyAnimStateScreen('closing');
            setTimeout(() => { 
                v3Master.style.transition = 'transform 0.85s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.85s cubic-bezier(0.25, 1, 0.5, 1)';
                v3Master.style.transform = 'scale(0.8)';
                v3Master.style.opacity = '0';
                this.applyAnimStateScreen('exit-sides');
                setTimeout(() => {
                    v3Master.style.display = 'none'; 
                    v3Master.style.transition = 'none';
                    v3Master.style.transform = '';
                    v3Master.style.opacity = '1';
                    this.applyAnimStateScreen('pre-entry'); 
                    v3Master.style.transition = 'none';
                    v3Master.style.transform = '';
                    v3Master.style.opacity = '1';
                    this.v3Transitioning = false; 
                    this.currentV3State = 0; 
                    if (this.currentState) this.renderV3Screen(this.currentState);
                }, 850);
            }, 1200);
        } else if (newState === 1) {
            v3Master.style.display = 'block'; this.renderV3GridScreen(stateObj); 
            if (this.currentV3State === 0) {
                this.applyAnimStateScreen('pre-entry');
                v3Master.style.transition = 'none';
                v3Master.style.transform = 'scale(0.8)';
                v3Master.style.opacity = '0';
                setTimeout(() => { 
                    this.applyAnimStateScreen('closing'); 
                    v3Master.style.transition = 'transform 0.85s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.85s cubic-bezier(0.25, 1, 0.5, 1)';
                    v3Master.style.transform = 'scale(1)';
                    v3Master.style.opacity = '1';
                    setTimeout(() => { this.applyAnimStateScreen('grid'); setTimeout(() => { this.v3Transitioning = false; this.currentV3State = 1; if (this.currentState) this.renderV3Screen(this.currentState); }, 1200); }, 1200); 
                }, 50);
            } else { this.applyAnimStateScreen('closing'); setTimeout(() => { this.applyAnimStateScreen('grid'); setTimeout(() => { this.v3Transitioning = false; this.currentV3State = 1; if (this.currentState) this.renderV3Screen(this.currentState); }, 1200); }, 1200); }
        } else if (newState === 2) {
            v3Master.style.display = 'block'; this.renderV3QBoxScreen(stateObj); 
            if (this.currentV3State === 0) {
                this.applyAnimStateScreen('pre-entry');
                v3Master.style.transition = 'none';
                v3Master.style.transform = 'scale(0.8)';
                v3Master.style.opacity = '0';
                setTimeout(() => { 
                    this.applyAnimStateScreen('closing'); 
                    v3Master.style.transition = 'transform 0.85s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.85s cubic-bezier(0.25, 1, 0.5, 1)';
                    v3Master.style.transform = 'scale(1)';
                    v3Master.style.opacity = '1';
                    setTimeout(() => { this.applyAnimStateScreen('question'); setTimeout(() => { this.v3Transitioning = false; this.currentV3State = 2; if (this.currentState) this.renderV3Screen(this.currentState); }, 1200); }, 1200); 
                }, 50);
            } else { this.applyAnimStateScreen('closing'); setTimeout(() => { this.applyAnimStateScreen('question'); setTimeout(() => { this.v3Transitioning = false; this.currentV3State = 2; if (this.currentState) this.renderV3Screen(this.currentState); }, 1200); }, 1200); }
        }
    }

    applyAnimStateScreen(targetState) {
        const tv = document.getElementById('v3MasterContainer');
        if (!tv) return;

        if (window.v3RunAnimTimeout) {
            clearTimeout(window.v3RunAnimTimeout);
            window.v3RunAnimTimeout = null;
        }

        const gridGroup = tv.querySelector('.anim-grid-group');
        const qGroup = tv.querySelector('.anim-question-group');
        const dur = 0.85;
        const wipeOut = 'inset(0 50% 0 50%)'; 

        const getEls = (side, layer) => {
            if (side === 'left') return tv.querySelectorAll(`.layer-${layer}.a-aln, .layer-${layer}.a-alc, .layer-${layer} .s-g-aln, .layer-${layer} .s-g-alc`);
            else return tv.querySelectorAll(`.layer-${layer}.a-arn, .layer-${layer}.a-arc, .layer-${layer} .s-g-arn, .layer-${layer} .s-g-arc`);
        };

        const layers = [1, 2, 3];
        
        // Helper function configurations
        const toPoly = (pts) => pts.map(p => p[0]+'px '+p[1]+'px').join(', ');
        const toSvgPath = (pts) => 'M ' + pts.map(p => p[0]+','+p[1]).join(' L ') + ' Z';
        
        const qShapesCfg = window.V3_CONFIGS.tv3;
        const gShapesCfg = window.V3_CONFIGS.tv1;
        const qShapes = qShapesCfg.shapes;
        const gShapes = gShapesCfg.shapes;
        
        const tvW = qShapesCfg.width || 1600;
        const gW = 1600;
        const gH = 360;
        const scoreW = 500;
        const actual_S = gH * 0.3571;
        
        const thick = 40;
        const cThick = 30;
        const slope = actual_S / (qShapesCfg.height || 360);
        const midY = (qShapesCfg.height || 360) / 2;
        const pS = actual_S / 2;
        const y1 = (qShapesCfg.height || 360) * 0.125;
        const y2 = (qShapesCfg.height || 360) * 0.875;
        const cShift = slope * (midY - y1);
        
        const makeShape = (L, R, H) => {
            return {
                bgPts: [[L+pS, 0], [R-pS, 0], [R, midY], [R-pS, H], [L+pS, H], [L, midY]],
                alnPts: [[L+pS-thick, 0], [L+pS, 0], [L, midY], [L+pS, H], [L+pS-thick, H], [L-thick, midY]],
                arnPts: [[R-pS, 0], [R-pS+thick, 0], [R+thick, midY], [R-pS+thick, H], [R-pS, H], [R, midY]],
                alcPts: [[L-thick-cThick+cShift, y1], [L-thick+cShift, y1], [L-thick, midY], [L-thick+cShift, y2], [L-thick-cThick+cShift, y2], [L-thick-cThick, midY]],
                arcPts: [[R+thick-cShift, y1], [R+thick+cThick-cShift, y1], [R+thick+cThick, midY], [R+thick+cThick-cShift, y2], [R+thick-cShift, y2], [R+thick, midY]]
            };
        };
        const cShapes = makeShape(tvW/2, tvW/2, qShapesCfg.height);

        if (targetState === 'pre-entry') {
            tv.classList.remove('is-closing');
            tv.classList.remove('run-anim');
            ['aln', 'alc', 'arn', 'arc'].forEach(k => {
                const pts = cShapes[k+'Pts'];
                const isLeft = k.startsWith('al');
                const startX = isLeft ? 1300 : -1300;
                tv.querySelectorAll(`.a-${k}`).forEach(el => { 
                    el.style.transition = 'none'; 
                    el.style.clipPath = `polygon(${toPoly(pts)})`; 
                    el.style.transform = `translateX(${startX}px) scale(1)`; 
                    el.style.opacity = '0'; 
                });
                tv.querySelectorAll(`.s-g-${k}`).forEach(path => { 
                    if(path) { 
                        path.style.transition = 'none'; 
                        path.setAttribute('d', toSvgPath(pts)); 
                        path.style.transform = `translateX(${startX}px) scale(1)`; 
                        path.style.opacity = '0'; 
                    } 
                });
            });
            gridGroup.style.transition = 'none'; gridGroup.style.opacity = '0'; gridGroup.style.clipPath = wipeOut;
            qGroup.style.transition = 'none'; qGroup.style.opacity = '0'; qGroup.style.clipPath = wipeOut;

        } else if (targetState === 'grid') {
            tv.classList.remove('is-closing');
            qGroup.style.opacity = '0';
            
            if (this.v3IsFirstEntry) {
                tv.classList.remove('run-anim');
                void tv.offsetWidth;
                tv.classList.add('run-anim');
                window.v3RunAnimTimeout = setTimeout(() => {
                    tv.classList.remove('run-anim');
                    window.v3RunAnimTimeout = null;
                }, 3000);
            } else {
                tv.classList.remove('run-anim');
            }

            ['aln', 'alc', 'arn', 'arc'].forEach(k => {
                const pts = gShapes[k+'Pts'];
                tv.querySelectorAll(`.a-${k}`).forEach(el => { 
                    el.style.transition = 'none'; 
                    el.style.clipPath = `polygon(${toPoly(pts)})`; 
                    el.style.transform = 'translateX(0px) scale(1)'; 
                });
                tv.querySelectorAll(`.s-g-${k}`).forEach(path => { 
                    if(path) { 
                        path.style.transition = 'none'; 
                        path.setAttribute('d', toSvgPath(pts)); 
                        path.style.transform = 'translateX(0px) scale(1)'; 
                    } 
                });
            });
            
            gridGroup.style.transition = 'none';
            gridGroup.style.clipPath = `polygon(${toPoly(cShapes.bgPts)})`;
            gridGroup.style.opacity = '1';
            
            void tv.offsetWidth;

            const dist_grid = 800 - (1600 - 1080)/2; // 540px
            layers.forEach((l, i) => {
                const delay = i * 0.125;
                const op = l === 1 ? '0.3' : (l === 2 ? '0.65' : '1');
                getEls('left', l).forEach(el => {
                    el.style.transition = `transform ${dur}s cubic-bezier(0.25, 1, 0.5, 1) ${delay}s, opacity ${dur}s ${delay}s`;
                    el.style.transform = `translateX(${-dist_grid}px) scale(1)`;
                    el.style.opacity = op;
                });
                getEls('right', l).forEach(el => {
                    el.style.transition = `transform ${dur}s cubic-bezier(0.25, 1, 0.5, 1) ${delay}s, opacity ${dur}s ${delay}s`;
                    el.style.transform = `translateX(${dist_grid}px) scale(1)`;
                    el.style.opacity = op;
                });
            });

            gridGroup.style.transition = `clip-path ${dur}s cubic-bezier(0.25, 1, 0.5, 1) 0s, opacity ${dur}s 0s`;
            gridGroup.style.clipPath = `polygon(${toPoly(gShapes.bgPts)})`;
            gridGroup.style.opacity = '1';

        } else if (targetState === 'exit-sides') {
            tv.classList.add('is-closing');
            tv.classList.remove('run-anim');
            ['aln', 'alc', 'arn', 'arc'].forEach(k => {
                const isLeft = k.startsWith('al');
                const endX = isLeft ? 1300 : -1300;
                tv.querySelectorAll(`.a-${k}`).forEach(el => { 
                    el.style.transition = `transform ${dur}s cubic-bezier(0.25, 1, 0.5, 1), opacity ${dur}s`; 
                    el.style.transform = `translateX(${endX}px) scale(1)`; 
                    el.style.opacity = '0'; 
                });
                tv.querySelectorAll(`.s-g-${k}`).forEach(path => { 
                    if(path) { 
                        path.style.transition = `transform ${dur}s cubic-bezier(0.25, 1, 0.5, 1), opacity ${dur}s`; 
                        path.style.transform = `translateX(${endX}px) scale(1)`; 
                        path.style.opacity = '0'; 
                    } 
                });
            });
        } else if (targetState === 'closing') {
            tv.classList.add('is-closing');
            
            if (this.v3IsFirstEntry) {
                tv.classList.remove('run-anim');
                void tv.offsetWidth;
                tv.classList.add('run-anim');
                window.v3RunAnimTimeout = setTimeout(() => {
                    tv.classList.remove('run-anim');
                    window.v3RunAnimTimeout = null;
                }, 3000);
            } else {
                tv.classList.remove('run-anim');
            }
            
            gridGroup.style.transition = `clip-path ${dur}s cubic-bezier(0.25, 1, 0.5, 1) 0s, opacity ${dur}s 0s`;
            gridGroup.style.clipPath = `polygon(${toPoly(cShapes.bgPts)})`;
            gridGroup.style.opacity = '0';
            
            qGroup.style.transition = `clip-path ${dur}s cubic-bezier(0.25, 1, 0.5, 1) 0s`;
            qGroup.style.clipPath = `polygon(${toPoly(cShapes.bgPts)})`;
            qGroup.style.opacity = '0';

            layers.forEach((l, i) => {
                const delay = (2 - i) * 0.125; 
                const op = l === 1 ? '0.3' : (l === 2 ? '0.65' : '1');
                getEls('left', l).forEach(el => {
                    el.style.transition = `transform ${dur}s cubic-bezier(0.25, 1, 0.5, 1) ${delay}s, opacity ${dur}s ${delay}s`;
                    el.style.transform = 'translateX(0px) scale(1)';
                    el.style.opacity = op;
                });
                getEls('right', l).forEach(el => {
                    el.style.transition = `transform ${dur}s cubic-bezier(0.25, 1, 0.5, 1) ${delay}s, opacity ${dur}s ${delay}s`;
                    el.style.transform = 'translateX(0px) scale(1)';
                    el.style.opacity = op;
                });
            });

        } else if (targetState === 'question') {
            tv.classList.remove('is-closing');
            gridGroup.style.opacity = '0';
            
            if (!this.v3IsFirstEntry) {
                tv.classList.remove('run-anim');
            }

            ['aln', 'alc', 'arn', 'arc'].forEach(k => {
                const pts = cShapes[k+'Pts'];
                tv.querySelectorAll(`.a-${k}`).forEach(el => { 
                    el.style.transition = 'none'; 
                    el.style.clipPath = `polygon(${toPoly(pts)})`; 
                    el.style.transform = 'translateX(0px) scale(1)'; 
                });
                tv.querySelectorAll(`.s-g-${k}`).forEach(path => { 
                    if(path) { 
                        path.style.transition = 'none'; 
                        path.setAttribute('d', toSvgPath(pts)); 
                        path.style.transform = 'translateX(0px) scale(1)'; 
                    } 
                });
            });
            
            const oBg = qGroup.querySelector('.a-q-bg');
            if (oBg) { oBg.style.clipPath = `polygon(${toPoly(qShapesCfg.bgPts)})`; }
            const oScore = qGroup.querySelector('.a-q-score');
            if (oScore) { oScore.style.clipPath = `polygon(${toPoly(qShapesCfg.scorePts)})`; }
            const oSep = qGroup.querySelector('.a-q-sep');
            if (oSep) {
                oSep.style.left = qShapesCfg.separator.left + 'px';
                oSep.style.height = qShapesCfg.separator.height + 'px';
                oSep.style.transform = `skewX(-${qShapesCfg.separator.angle}deg)`;
            }
            
            qGroup.style.transition = 'none';
            qGroup.style.clipPath = `polygon(${toPoly(cShapes.bgPts)})`;
            qGroup.style.opacity = '1';
            
            const dist_question = 800 - 100; // 700px
            void tv.offsetWidth;

            layers.forEach((l, i) => {
                const delay = i * 0.125;
                const op = l === 1 ? '0.3' : (l === 2 ? '0.65' : '1');
                getEls('left', l).forEach(el => {
                    el.style.transition = `transform ${dur}s cubic-bezier(0.25, 1, 0.5, 1) ${delay}s, opacity ${dur}s ${delay}s`;
                    el.style.transform = `translateX(${-dist_question}px) scale(1)`;
                    el.style.opacity = op;
                });
                getEls('right', l).forEach(el => {
                    el.style.transition = `transform ${dur}s cubic-bezier(0.25, 1, 0.5, 1) ${delay}s, opacity ${dur}s ${delay}s`;
                    el.style.transform = `translateX(${dist_question}px) scale(1)`;
                    el.style.opacity = op;
                });
            });

            const qGroupAnimPts = [
                qShapes.bgPts[0],
                [gW + 400, 0],
                [gW + 400 - pS, gH / 2],
                [gW + 400 - actual_S, gH],
                qShapes.bgPts[4],
                qShapes.bgPts[5]
            ];
            qGroup.style.transition = `clip-path ${dur}s cubic-bezier(0.25, 1, 0.5, 1) 0s, opacity ${dur}s 0s`;
            qGroup.style.clipPath = `polygon(${toPoly(qGroupAnimPts)})`;
            qGroup.style.opacity = '1';
        }
    }

    renderV3GridScreen(state) {
        const tv = document.getElementById('v3MasterContainer'); 
        if (!tv) return; 
        const gridContent = tv.querySelector('.a-grid-content'); 
        if (!gridContent) return;

        const mode = state.lockedPackage ? state.lockedPackage.mode : (state.settings ? state.settings.questionSelectionMode : 1);
        let gHtml = ''; 
        let gSvgCells = ''; 
        
        const gridW = 1080;
        const gW = 1600;
        const gH = 360;
        const actual_S = gH * 0.3571;
        const pS = actual_S / 2;
        const midY = gH / 2;
        const L = (gW - gridW) / 2; 
        const R = L + gridW;
        
        const getL0 = (y) => (y <= midY) ? L + pS - (pS/midY)*y : L + (pS/midY)*(y - midY);
        const getL3 = (y) => (y <= midY) ? R - pS + (pS/midY)*y : R - (pS/midY)*(y - midY);
        
        const toPoly = (pts) => pts.map(p => p[0]+'px '+p[1]+'px').join(', ');
        const toSvgPath = (pts) => 'M ' + pts.map(p => p[0]+','+p[1]).join(' L ') + ' Z';

        if (mode === 1) {
            const pkg = state.lockedPackage || state.pendingPackage;
            const pkgQuestions = pkg ? (pkg.questions || pkg.package || []) : [];
            const numQ = pkgQuestions.length || 3;
            const colW = gridW / numQ;
            for (let qIdx = 0; qIdx < numQ; qIdx++) {
                const qData = pkgQuestions[qIdx] || {};
                const qPts = parseInt(qData.points) || 10;
                let cellStateClass = 'inactive-tab';
                let isActive = false;
                let isPlayed = false;
                if (state.lockedPackage) {
                    const played = state.lockedPackage.playedQuestions || [];
                    if (played.includes(qIdx)) { isPlayed = true; cellStateClass = 'played'; }
                    else if (state.currentQuestion && state.currentQuestion.idx === qData.idx && state.currentQuestion.active) { isActive = true; cellStateClass = 'active-tab'; }
                    else { cellStateClass = 'active-tab'; } 
                } else if (pkg) { cellStateClass = 'active-tab'; } 
                const x1L = L + qIdx * colW, x2R = L + (qIdx + 1) * colW;
                const bgColor = isActive ? 'rgba(200, 0, 0, 0.85)' : (isPlayed ? 'rgba(0,0,0,0.7)' : 'rgba(20, 40, 90, 0.7)');
                const fontColor = isPlayed ? '#444' : '#fff';
                const fontSize = '60px';
                
                gHtml += `
                    <div class="v3-cell ${cellStateClass}" style="position:absolute; left:${x1L}px; top:0px; width:${colW}px; height:${gH}px; pointer-events:auto; transition:all 0.3s; background:${bgColor}; border-right:1px solid rgba(255,255,255,0.2);">
                        <div style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
                            <div style="font-size:${fontSize}; font-weight:900; line-height:1; color:${fontColor}; font-family: var(--font-general);">${qPts}</div>
                        </div>
                    </div>
                `;
            }
        } else {
            const pkg2 = state.lockedPackage || state.pendingPackage;
            const rawQuestions = pkg2 ? (pkg2.questions || pkg2.package || []) : [];
            let numCols = state.settings ? (state.settings.questionsPerTeam || 3) : 3;
            if (numCols > 3) numCols = 3;
            if (numCols === 1) numCols = 2; 

            const rowH = gH / 3; 
            const mode2StartQ = (state.settings && state.settings.mode2StartQ) || 1; 
            const c = [];
            
            for(let r=0; r<3; r++) {
                const y1_2 = r*rowH, y2_2 = (r+1)*rowH;
                for(let col=0; col<numCols; col++) {
                    let getLeft, getRight;
                    if (numCols === 2) {
                        getLeft = (y) => (col === 0) ? getL0(y) : (L + gridW/2);
                        getRight = (y) => (col === 0) ? (L + gridW/2) : getL3(y);
                    } else {
                        const colW2 = gridW / 3;
                        getLeft = (y) => {
                            if (col === 0) return getL0(y);
                            if (col === 1) return getL0(y) + colW2;
                            return getL3(y) - colW2;
                        };
                        getRight = (y) => {
                            if (col === 0) return getL0(y) + colW2;
                            if (col === 1) return getL3(y) - colW2;
                            return getL3(y);
                        };
                    }
                    
                    let pts2 = [];
                    if (r === 1) {
                        pts2 = [ [getLeft(y1_2), y1_2], [getRight(y1_2), y1_2], [getRight(midY), midY], [getRight(y2_2), y2_2], [getLeft(y2_2), y2_2], [getLeft(midY), midY] ];
                    } else {
                        pts2 = [ [getLeft(y1_2), y1_2], [getRight(y1_2), y1_2], [getRight(y2_2), y2_2], [getLeft(y2_2), y2_2] ];
                    }
                    c.push({ pts: pts2, r: r, col: col });
                }
            }
            
            const ptsTypes = [10, 20, 40];

            c.forEach((cell) => {
                const { pts, r, col } = cell;
                const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0])), minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
                const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
                
                const colPts = ptsTypes[r]; 
                
                const targetQ = rawQuestions[col];
                let cellStateClass = 'inactive-tab';
                let isChosen = false;
                let badgeText = '';

                if (targetQ) {
                    if (parseInt(targetQ.points) === colPts) {
                        const qIndex = col; 
                        
                        if (state.lockedPackage) { 
                            const played = state.lockedPackage.playedQuestions || [];
                            if (played.includes(qIndex)) {
                                cellStateClass = 'played'; isChosen = true;
                            } else if (state.currentQuestion && state.currentQuestion.idx === targetQ.idx) {
                                cellStateClass = 'active-tab'; isChosen = true;
                            } else isChosen = true; 
                        } else isChosen = true; 
                    }

                    if (mode === 2 && parseInt(targetQ.points) === colPts) {
                        if (targetQ.idx !== undefined && targetQ.idx !== -1) {
                            badgeText = `Câu ${targetQ.idx + 1}`;
                        } else {
                            badgeText = `Câu ${mode2StartQ + col}`;
                        }
                    } 
                }

                if (isChosen && cellStateClass === 'inactive-tab') {
                    cellStateClass = 'active-tab';
                }

                let badgeHtml = '';
                if (badgeText) {
                    badgeHtml = `<div class="v3-q-order-badge" style="position:static !important; bottom:auto !important; left:auto !important; transform:none !important; margin-top:2px !important; font-size:22px !important; background:rgba(0,0,0,0.6) !important; padding:2px 8px !important; border-radius:6px !important; font-weight:bold !important; color:#00cfff !important; border:1px solid rgba(0, 207, 255, 0.4) !important; text-transform:uppercase !important;">${badgeText}</div>`;
                }
                
                const fsClass = '60px';
                const fontStyle = `font-size:${fsClass}; font-weight:900; line-height:1; color:#fff; font-family: var(--font-general);`;
                
                gHtml += `
                    <div class="v3-cell ${cellStateClass}" style="width:100%; height:100%; top:0; left:0; clip-path:polygon(${toPoly(pts)}); pointer-events:auto; position:absolute; transition:all 0.3s;">
                        <div style="position:absolute; left:${cx}px; top:${cy}px; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
                            <div style="${fontStyle}">${colPts}</div>
                            ${badgeHtml}
                        </div>
                    </div>
                `;
                gSvgCells += `<path d="${toSvgPath(pts)}" />`;
            });
        }
        gridContent.innerHTML = gHtml; 
        const sSvg = tv.querySelector('.s-g-cells');
        if (sSvg) sSvg.innerHTML = gSvgCells;
    }

    renderV3QBoxScreen(state) {
        const tv = document.getElementById('v3MasterContainer');
        if (!tv) return;

        const gW = 1600;
        const gH = 360;
        const pad = 100;
        const scoreW = 500;
        const actual_S = gH * 0.3571;
        const topH = 72;

        const toPoly = (pts) => pts.map(p => p[0]+'px '+p[1]+'px').join(', ');
        const toSvgPath = (pts) => 'M ' + pts.map(p => p[0]+','+p[1]).join(' L ') + ' Z';
        
        const qShapesCfg = window.V3_CONFIGS.tv3;
        const qShapes = qShapesCfg.shapes;
        const colorL = '#051433';
        const colorR = '#103b99';

        const topBar = tv.querySelector('.o-top-bar');
        if (topBar && state.teams) {
            const pBoxSlant = actual_S * (topH / gH); 
            let pTopHtml = '';
            
            let mainTeamId = null;
            if (state.currentQuestion && state.currentQuestion.active) {
                mainTeamId = state.currentQuestion.mainTeamId;
            } else if (state.turnOrder && state.turnOrder.length > 0) {
                mainTeamId = state.turnOrder[0];
            }
            
            let separatorsHtml = '';
            const numTeams = state.teams.length;
            const topBarWidthVal = gW - scoreW + actual_S - (pad + actual_S/2) + pBoxSlant;
            const W_item = (topBarWidthVal + (numTeams - 1) * pBoxSlant) / numTeams;
            const skewDeg = Math.atan(pBoxSlant / topH) * 180 / Math.PI;

            state.teams.forEach((team, i) => {
                const style = `clip-path: polygon(${pBoxSlant}px 0, 100% 0, calc(100% - ${pBoxSlant}px) 100%, 0 100%); margin-left: ${i===0?'0':(-pBoxSlant+'px')}`;
                
                const isActive = team.id === mainTeamId;
                if (isActive) {
                    pTopHtml += `<div class="player-poly t-active" style="${style}">${team.name}</div>`;
                } else {
                    pTopHtml += `<div class="player-poly" style="${style}">${team.name} (${team.score})</div>`;
                }

                if (i < numTeams - 1) {
                    const xPos = (i + 1) * W_item - i * pBoxSlant;
                    separatorsHtml += `<div style="position: absolute; bottom: 12.5%; left: ${xPos - pBoxSlant}px; width: 4px; height: 75%; background: #ffffff; border-radius: 99px; transform-origin: bottom center; transform: skewX(-${skewDeg}deg); z-index: 15; box-shadow: 0 0 8px rgba(255,255,255,0.6); pointer-events: none;"></div>`;
                }
            });
            topBar.style.left = (pad + actual_S/2 - pBoxSlant) + 'px';
            topBar.style.right = (scoreW - actual_S) + 'px';
            topBar.style.width = 'auto';
            topBar.style.marginLeft = '0px';
            topBar.innerHTML = pTopHtml + separatorsHtml;
        }

        let finalActiveQNum = null;

        const pointsArea = document.getElementById('v3PointsArea');
        if (pointsArea) {
            let activeTeamId = null;
            if (state.turnOrder && state.turnOrder.length > 0) activeTeamId = state.turnOrder[0];
            if (state.currentQuestion && state.currentQuestion.active) activeTeamId = state.currentQuestion.mainTeamId;
            
            let p = state.lockedPackage || state.pendingPackage;
            if (!p && state.packages && activeTeamId) {
                p = state.packages.find(pkg => pkg.teamId === activeTeamId);
            }
            
            let mode = parseInt(state.settings ? state.settings.questionSelectionMode : 1);
            if (p) mode = parseInt(p.mode);
            
            let ptsHtml = '';
            const packH = gH * 0.15;
            const boxSlant = actual_S * (packH / gH); 
            const packW = scoreW - pad - actual_S/2 + boxSlant;
            let cellSeparatorsHtml = '';

            if (p && p.questions && (mode === 2 || mode === 3)) {
                let activeQNum = null;
                const ptsTypes = [10, 20, 40];
                const mode2StartQ = (state.settings && state.settings.mode2StartQ) || 1;
                const numPoints = p.questions.length;
                const W_cell = (packW + (numPoints - 1) * boxSlant) / numPoints;
                const cellSkewDeg = Math.atan(boxSlant / packH) * 180 / Math.PI;
                
                p.questions.forEach((qItem, idx) => {
                    let color = '#aaaaaa';
                    let bgColor = 'rgba(0,0,0,0.6)';
                    
                    let isActive = false;
                    let isPlayed = false;
                    
                    if (state.currentQuestion && state.currentQuestion.active) {
                        if (mode === 1) {
                            const qId1 = state.currentQuestion.id || state.currentQuestion._id || state.currentQuestion.questionId;
                            const qId2 = qItem.id || qItem._id || qItem.questionId;
                            if (qId1 && qId2) isActive = (qId1 == qId2);
                            else isActive = (state.currentQuestion.idx == qItem.idx);
                        } else {
                            isActive = (p.currentIndex === idx);
                        }
                    }
                    
                    if (p.currentIndex > idx) {
                        isPlayed = true;
                    } else if (p.currentIndex === idx && state.currentQuestion && state.currentQuestion.resolved) {
                        isPlayed = true;
                    }
                    
                    if (isActive) {
                        color = '#ffffff';
                        bgColor = 'linear-gradient(135deg, #cc0000, #880000)';
                        if (mode === 2) {
                            activeQNum = mode2StartQ + qItem.idx * 3 + ptsTypes.indexOf(parseInt(qItem.points));
                        } else {
                            activeQNum = idx + 1;
                        }
                        finalActiveQNum = activeQNum;
                    } else if (isPlayed) {
                        color = '#555555';
                        bgColor = 'rgba(0,0,0,0.8)';
                    }
                    
                    ptsHtml += `<div class="pack-poly ${isActive?'active':''}" style="clip-path: polygon(${boxSlant}px 0, 100% 0, calc(100% - ${boxSlant}px) 100%, 0 100%); margin-left: ${idx===0?'0':(-boxSlant+'px')}; background: ${bgColor}; color: ${color}; flex: 1; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 900;">${qItem.points}</div>`;

                    if (idx < numPoints - 1) {
                        const xPosCell = (idx + 1) * W_cell - idx * boxSlant;
                        cellSeparatorsHtml += `<div style="position: absolute; bottom: 12.5%; left: ${xPosCell - boxSlant}px; width: 4px; height: 75%; background: #ffffff; border-radius: 99px; transform-origin: bottom center; transform: skewX(-${cellSkewDeg}deg); z-index: 15; box-shadow: 0 0 8px rgba(255,255,255,0.6); pointer-events: none;"></div>`;
                    }
                });
            }
            pointsArea.style.width = packW + 'px';
            pointsArea.innerHTML = ptsHtml + cellSeparatorsHtml;
        }

        const qTextV3 = document.getElementById('qTextV3');
        if (qTextV3) {
            if (state.currentQuestion && state.currentQuestion.active) {
                const textHtml = state.currentQuestion.isHidden ? '' : (state.currentQuestion.text || state.currentQuestion.content || state.currentQuestion.question || '').toString().replace(/\n/g, '<br>');
                
                if (qTextV3.getAttribute('data-raw') !== textHtml) {
                    qTextV3.innerHTML = textHtml;
                    qTextV3.setAttribute('data-raw', textHtml);
                }
                
                const wrapper = qTextV3.parentElement;
                if (wrapper) {
                    const doResize = () => {
                        let fs = 34;
                        qTextV3.style.fontSize = fs + 'px';
                        qTextV3.style.lineHeight = '1.3';
                        qTextV3.style.width = '100%';
                        
                        const maxH = wrapper.clientHeight - 40;
                        if (maxH <= 0 || qTextV3.scrollHeight === 0) return;
                        
                        while (qTextV3.scrollHeight > maxH && fs > 16) {
                            fs -= 1;
                            qTextV3.style.fontSize = fs + 'px';
                        }
                        
                        if (qTextV3.scrollHeight < maxH - 20) {
                            wrapper.style.alignItems = 'center';
                            wrapper.style.paddingTop = '0px';
                        } else {
                            wrapper.style.alignItems = 'flex-start';
                            wrapper.style.paddingTop = '10px';
                        }
                    };
                    
                    doResize();
                    requestAnimationFrame(doResize);
                    setTimeout(doResize, 150);
                    setTimeout(doResize, 600);
                    setTimeout(doResize, 1300);
                }
            } else {
                qTextV3.innerHTML = '';
                qTextV3.removeAttribute('data-raw');
            }
        }

        const scoreMain = document.getElementById('v3ActiveScore');
        if (scoreMain) {
            let mainTeamId = null;
            if (state.currentQuestion && state.currentQuestion.active) {
                mainTeamId = state.currentQuestion.mainTeamId;
            } else if (state.turnOrder && state.turnOrder.length > 0) {
                mainTeamId = state.turnOrder[0];
            }
            const mainTeam = (mainTeamId && state.teams) ? state.teams.find(t => t.id === mainTeamId) : null;
            scoreMain.textContent = mainTeam ? mainTeam.score : '';
            scoreMain.style.boxSizing = 'border-box';
            scoreMain.style.paddingLeft = (actual_S / 2) + 'px';
            scoreMain.style.paddingRight = pad + 'px';
        }
        const scorePts = [ [actual_S, 0], [scoreW - pad - actual_S/2, 0], [scoreW - pad, gH/2], [scoreW - pad - actual_S/2, gH], [0, gH] ];

        const oBg = tv.querySelector('.o-bg');
        if (oBg) {
            const newBgClip = `polygon(${toPoly(qShapesCfg.bgPts)})`;
            if (oBg.style.clipPath !== newBgClip) oBg.style.clipPath = newBgClip;
            const newBgStyle = `linear-gradient(135deg, ${colorL}, #000)`;
            if (oBg.style.background !== newBgStyle) oBg.style.background = newBgStyle;
        }

        const soBg = tv.querySelector('.s-o-bg');
        if (soBg) {
            const newSoBgD = toSvgPath(qShapesCfg.bgPts);
            if (soBg.getAttribute('d') !== newSoBgD) soBg.setAttribute('d', newSoBgD);
        }

        const scoreEl = tv.querySelector('.o-score');
        if (scoreEl) {
            scoreEl.style.right = 'auto'; 
            scoreEl.style.left = (gW - scoreW) + 'px'; 

            const newScoreClip = `polygon(${toPoly(scorePts)})`;
            if (scoreEl.style.clipPath !== newScoreClip) scoreEl.style.clipPath = newScoreClip;
            const newScoreW = scoreW + 'px';
            if (scoreEl.style.width !== newScoreW) scoreEl.style.width = newScoreW;
            const newScoreBg = `linear-gradient(135deg, ${colorR}, #050a14)`;
            if (scoreEl.style.background !== newScoreBg) scoreEl.style.background = newScoreBg;
        }

        const soScore = tv.querySelector('.s-o-score');
        if (soScore) {
            const newSoScoreD = toSvgPath(scorePts);
            if (soScore.getAttribute('d') !== newSoScoreD) soScore.setAttribute('d', newSoScoreD);
            const newSoScoreTransform = `translate(${gW - scoreW}, 0)`;
            if (soScore.getAttribute('transform') !== newSoScoreTransform) soScore.setAttribute('transform', newSoScoreTransform);
        }

        const sep = tv.querySelector('.o-separator');
        if (sep) {
            const newSepH = qShapesCfg.separator.height + 'px';
            if (sep.style.height !== newSepH) sep.style.height = newSepH;
            const newSepLeft = (gW - scoreW) + 'px';
            if (sep.style.left !== newSepLeft) sep.style.left = newSepLeft;
            const newSepTransform = `skewX(-${qShapesCfg.separator.angle}deg)`;
            if (sep.style.transform !== newSepTransform) sep.style.transform = newSepTransform;
        }

        tv.querySelectorAll('.s-o-svg, .s-o-svg-arrows, .s-g-svg, .s-g-svg-arrows').forEach(svg => {
            const newVB = `0 0 ${gW} ${gH}`;
            if (svg.getAttribute('viewBox') !== newVB) svg.setAttribute('viewBox', newVB);
        });
    }

    // ----------------------------------------------------
    // V3 OVERLAY-MODE LOGIC (From overlay.html v3-script)
    // ----------------------------------------------------
    renderV3Overlay(state) {
        this.lastV3State = state;
        
        let isMode1 = state.settings ? state.settings.questionSelectionMode === 1 : true;
        if (state.lockedPackage) isMode1 = (state.lockedPackage.mode === 1);
        
        let computedMachineState = 0;
        
        if (isMode1) {
            if (state.currentQuestion && state.currentQuestion.active) {
                computedMachineState = 2;
            } else if (state.lockedPackage || state.pendingPackage || state.isGridVisibleOnOverlay) {
                computedMachineState = 1;
            }
        } else {
            if (state.lockedPackage) {
                const lockedAt = state.lockedPackage.lockedAt || (Date.now() - 1000);
                const elapsed = Date.now() - lockedAt;
                if (elapsed >= 1000) {
                    computedMachineState = 2;
                } else {
                    computedMachineState = 1;
                    if (!this.v3TransitionTimeout) {
                        this.v3TransitionTimeout = setTimeout(() => {
                            this.v3TransitionTimeout = null;
                            if (this.lastV3State) this.renderV3Overlay(this.lastV3State);
                        }, 1000 - elapsed);
                    }
                }
            } else if (state.pendingPackage || state.isGridVisibleOnOverlay) {
                computedMachineState = 1;
                this.v3LockedPackageTime = null;
            } else {
                this.v3LockedPackageTime = null;
            }
        }
        
        state.machineState = computedMachineState;

        const v3Master = document.getElementById('v3MasterContainer');
        const qBoxV3 = document.getElementById('qBoxV3');
        const qGridV3 = document.getElementById('qGridV3');
        
        if (this.v3Transitioning || !v3Master || !qBoxV3 || !qGridV3) return;

        const mode = state.lockedPackage ? state.lockedPackage.mode : (state.settings ? state.settings.questionSelectionMode : 1);
        let maxCols = 3;
        if (mode === 3) {
            maxCols = (state.settings && state.settings.questionsPerTeam) || 3;
        }
        const col_w = 260;
        const g_pt = 25;
        const targetW_grid = (maxCols * col_w - (maxCols - 1) * g_pt) + 'px';
        const targetW_qbox = '1100px';

        if (state.machineState === 0) {
            if (this.currentV3State !== 0) {
                this.v3Transitioning = true;
                v3Master.classList.remove('v3-shutter-open', 'v3-shutter-close', 'run-anim');
                void v3Master.offsetWidth;
                v3Master.classList.add('v3-shutter-close');
                
                setTimeout(() => {
                    v3Master.style.display = 'none';
                    qBoxV3.style.display = 'none';
                    qGridV3.style.display = 'none';
                    v3Master.classList.remove('v3-shutter-open', 'v3-shutter-close', 'run-anim');
                    setTimeout(() => { this.v3Transitioning = false; }, 100);
                }, 500);
            }
            this.currentV3State = 0;
        } else if (state.machineState === 1) {
            if (this.currentV3State !== 1) {
                this.v3Transitioning = true;
                
                if (this.currentV3State === 0) {
                    v3Master.style.setProperty('--target-w', targetW_grid);
                    v3Master.style.display = 'flex';
                    qBoxV3.style.display = 'none';
                    qGridV3.style.display = 'flex';
                    
                    v3Master.classList.remove('v3-shutter-open', 'v3-shutter-close', 'run-anim');
                    void v3Master.offsetWidth;
                    v3Master.classList.add('v3-shutter-open', 'run-anim');
                    setTimeout(() => { this.v3Transitioning = false; }, 600);
                } else {
                    v3Master.classList.remove('v3-shutter-open', 'v3-shutter-close', 'run-anim');
                    void v3Master.offsetWidth;
                    v3Master.classList.add('v3-shutter-close');
                    
                    setTimeout(() => {
                        v3Master.style.setProperty('--target-w', targetW_grid);
                        v3Master.style.display = 'flex';
                        qBoxV3.style.display = 'none';
                        qGridV3.style.display = 'flex';
                        
                        v3Master.classList.remove('v3-shutter-open', 'v3-shutter-close', 'run-anim');
                        void v3Master.offsetWidth;
                        v3Master.classList.add('v3-shutter-open');
                        setTimeout(() => { this.v3Transitioning = false; }, 600);
                    }, 500);
                }
            }
            this.currentV3State = 1;
            this.renderV3GridOverlay(state);
        } else if (state.machineState === 2) {
            if (this.currentV3State !== 2) {
                this.v3Transitioning = true;
                
                if (this.currentV3State === 0) {
                    v3Master.style.setProperty('--target-w', targetW_qbox);
                    v3Master.style.display = 'flex';
                    qGridV3.style.display = 'none';
                    qBoxV3.style.display = 'flex';
                    
                    v3Master.classList.remove('v3-shutter-open', 'v3-shutter-close', 'run-anim');
                    void v3Master.offsetWidth;
                    v3Master.classList.add('v3-shutter-open', 'run-anim');
                    setTimeout(() => { this.v3Transitioning = false; }, 600);
                } else {
                    v3Master.classList.remove('v3-shutter-open', 'v3-shutter-close', 'run-anim');
                    void v3Master.offsetWidth;
                    v3Master.classList.add('v3-shutter-close');
                    
                    setTimeout(() => {
                        v3Master.style.setProperty('--target-w', targetW_qbox);
                        v3Master.style.display = 'flex';
                        qGridV3.style.display = 'none';
                        qBoxV3.style.display = 'flex';
                        
                        v3Master.classList.remove('v3-shutter-open', 'v3-shutter-close', 'run-anim');
                        void v3Master.offsetWidth;
                        v3Master.classList.add('v3-shutter-open');
                        setTimeout(() => { this.v3Transitioning = false; }, 600);
                    }, 500);
                }
            }
            this.currentV3State = 2;
            this.renderV3QBoxOverlay(state);
        }
    }

    renderV3GridOverlay(state) {
        let gridContainer = document.getElementById('grid10-v3');
        if (!gridContainer) {
            const gridv3 = document.getElementById('qGridV3');
            if (gridv3) gridContainer = gridv3.querySelector('.v3-grid-row');
        }
        if (!gridContainer) return;
        
        let mode = state.settings ? state.settings.questionSelectionMode : 1;
        if (state.lockedPackage) mode = state.lockedPackage.mode;
        
        let html = '';
        const col_w = 260;
        const g_pt = 25;
        const inner_w = col_w - g_pt;

        const leftChevron = `polygon(0 0, ${inner_w}px 0, ${col_w}px 50%, ${inner_w}px 100%, 0 100%, ${g_pt}px 50%)`;
        const centerHexagon = `polygon(${g_pt}px 0, ${inner_w}px 0, ${col_w}px 50%, ${inner_w}px 100%, ${g_pt}px 100%, 0 50%)`;
        const rightChevron = `polygon(${g_pt}px 0, ${col_w}px 0, ${col_w}px 100%, ${g_pt}px 100%, 0 50%, ${inner_w}px 50%)`;

        const maxCols = 3;

        if (mode === 1) {
            const rows = 4;
            for (let colIdx = 0; colIdx < maxCols; colIdx++) {
                const ml = colIdx > 0 ? `-${g_pt}px` : '0';
                let shapeClip = '';
                if (colIdx === 0) shapeClip = leftChevron;
                else if (colIdx === 1) shapeClip = centerHexagon;
                else shapeClip = rightChevron;
                
                html += `<div class="v3-col-wrapper" style="width: ${col_w}px; height: 100%; background: #0a1936; display: flex; flex-direction: column; align-items: center; padding-top: 0px; clip-path: ${shapeClip}; margin-left: ${ml}; z-index: ${10 - colIdx};">`;
                
                for (let r = 0; r < rows; r++) {
                    const num = r * maxCols + colIdx + 1;
                    
                    let bgCol = (colIdx === 0) ? '#ff3b30' : ((colIdx === 1) ? '#007aff' : '#ffcc00');
                    if (num === 2 || num === 8 || num === 12) bgCol = '#007aff';
                    else if (num === 3 || num === 5 || num === 7) bgCol = '#ffcc00';
                    else if (num === 4 || num === 6 || num === 10) bgCol = '#ff3b30';
                    else if (num === 9) bgCol = '#34c759';
                    
                    const isAvailable = state.packageSelection && state.packageSelection.available ? state.packageSelection.available.includes(num) : true;
                    let cellColor = isAvailable ? bgCol : '#333';
                    let textColor = isAvailable ? '#fff' : '#666';
                    
                    const isLocked = state.lockedPackage && state.lockedPackage.number === num;
                    let lockedStyle = '';
                    if (isLocked) {
                        cellColor = '#fff';
                        textColor = '#000';
                        lockedStyle = 'animation: pulse-v3-selected 1.5s infinite;';
                    }
                    
                    const borderB = r < rows - 1 ? 'border-bottom: 2px solid #000;' : '';
                    
                    html += `<div class="q-cell" style="background: ${cellColor} !important; color: ${textColor}; display: flex; justify-content: center; align-items: center; font-size: 32px; font-weight: bold; position: relative; flex: 1; width: 100%; box-sizing: border-box; ${borderB} ${lockedStyle}">`;
                    html += num;
                    html += `</div>`;
                }
                html += `</div>`;
            }
        } else {
            let maxCols2 = 3;
            if (mode === 3) {
                maxCols2 = (state.settings && state.settings.questionsPerTeam) || 3;
            }
            
            const mode2Rows = (state.settings && state.settings.mode2Rows) || 3;
            const mode2StartQ = (state.settings && state.settings.mode2StartQ) || 1;
            const pkg = state.lockedPackage || state.pendingPackage;
            
            for(let col = 0; col < maxCols2; col++) {
                const clip = col === 0 ? leftChevron : (col === maxCols2 - 1 ? rightChevron : centerHexagon);
                const ml = col > 0 ? `-${g_pt}px` : '0';
                
                html += `<div class="v3-col-wrapper" style="width: ${col_w}px; height: 100%; background: #0a1936; display: flex; flex-direction: column; align-items: center; padding-top: 0px; clip-path: ${clip}; margin-left: ${ml}; z-index: ${10 - col};">`;
                
                if (mode === 2) {
                    const pts = col === 0 ? 10 : (col === 1 ? 20 : 40);
                    
                    for (let r = 0; r < mode2Rows; r++) {
                        const qNum = mode2StartQ + r * 3 + col;
                        let cellBg = '#007aff';
                        let cellColor = '#fff';
                        
                        let isLocked = false;
                        let qIndex = -1;
                        let isPlayed = false;
                        let isCurrent = false;
                        let isChosen = false;
                        
                        if (pkg && (pkg.questions || pkg.package)) {
                            const pQ = pkg.questions || pkg.package || [];
                            const found = pQ.find(qItem => qItem.points == pts && qItem.idx == r);
                            if (found) {
                                isLocked = true;
                                qIndex = pQ.indexOf(found);
                                
                                if (state.lockedPackage) {
                                    if (pkg.currentIndex > qIndex) {
                                        isPlayed = true;
                                    } else if (pkg.currentIndex === qIndex) {
                                        if (state.currentQuestion && state.currentQuestion.resolved) {
                                            isPlayed = true;
                                        } else if (state.currentQuestion && state.currentQuestion.active) {
                                            isCurrent = true;
                                        } else {
                                            isChosen = true;
                                        }
                                    } else {
                                        isChosen = true;
                                    }
                                } else {
                                    isChosen = true;
                                }
                            }
                        }
                        
                        const isPlayedGlobal = state.playedQuestions && state.playedQuestions[pts] && state.playedQuestions[pts].includes(r);
                        let cellClass = 'inactive-tab';
                        let lockedStyle = '';
                        if (isPlayedGlobal || isPlayed) {
                            cellClass = 'played';
                            cellBg = '#333';
                            cellColor = '#666';
                        } else if (isCurrent || isChosen) {
                            cellClass = 'active-tab v3-selected';
                            cellBg = '#ffffff';
                            cellColor = '#000000';
                            lockedStyle = 'animation: pulse-v3-selected 1.5s infinite;';
                        }
                        
                        const borderB = r < mode2Rows - 1 ? 'border-bottom: 2px solid #000;' : '';
                        
                        html += `
                            <div style="flex: 1; width: 100%; background: ${cellBg}; display: flex; flex-direction: column; justify-content: center; align-items: center; position: relative; box-sizing: border-box; ${borderB} ${lockedStyle}" class="${cellClass}">
                                <div style="font-size: 36px; font-weight: 900; line-height: 1; color: ${cellColor};">${pts}</div>
                                <div style="margin-top: 5px; font-size: 12px; background: ${isCurrent||isChosen?'#ff3b30':'rgba(0,0,0,0.5)'}; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: ${isCurrent||isChosen?'#fff':'#00cfff'}; border: 1px solid ${isCurrent||isChosen?'#ff3b30':'rgba(0, 207, 255, 0.3)'};">Câu ${qNum}</div>
                            </div>
                        `;
                    }
                } else {
                    // Mode 3
                    [10, 20, 40].forEach((pts, rowIdx) => {
                        let cellBg = '#007aff';
                        let cellColor = '#fff';
                        
                        let isPlayed = false;
                        let isCurrent = false;
                        let isChosen = false;
                        
                        if (pkg && (pkg.questions || pkg.package)) {
                            const pQ = pkg.questions || pkg.package || [];
                            if (pQ[col] && pQ[col].points === pts) {
                                if (state.lockedPackage) {
                                    if (pkg.currentIndex > col) {
                                        isPlayed = true;
                                    } else if (pkg.currentIndex === col) {
                                        if (state.currentQuestion && state.currentQuestion.resolved) {
                                            isPlayed = true;
                                        } else if (state.currentQuestion && state.currentQuestion.active) {
                                            isCurrent = true;
                                        } else {
                                            isChosen = true;
                                        }
                                    } else {
                                        isChosen = true;
                                    }
                                } else {
                                    isChosen = true;
                                }
                            }
                        }
                        
                        let cellClass = 'inactive-tab';
                        let lockedStyle = '';
                        if (isPlayed) {
                            cellClass = 'played';
                            cellBg = '#333';
                            cellColor = '#666';
                        } else if (isCurrent || isChosen) {
                            cellClass = 'active-tab v3-selected';
                            cellBg = '#ffffff';
                            cellColor = '#000000';
                            lockedStyle = 'animation: pulse-v3-selected 1.5s infinite;';
                        }
                        
                        const borderB = rowIdx < 2 ? 'border-bottom: 2px solid #000;' : '';
                        
                        html += `
                            <div style="flex: 1; width: 100%; background: ${cellBg}; display: flex; justify-content: center; align-items: center; font-size: 48px; color: ${cellColor}; font-weight: bold; position: relative; box-sizing: border-box; ${borderB} ${lockedStyle}" class="${cellClass}">
                                ${pts}
                            </div>
                        `;
                    });
                }
                
                html += `</div>`;
            }
        }
        
        gridContainer.innerHTML = html;
    }

    renderV3QBoxOverlay(state) {
        // Teams (Left side)
        const teamArea = document.getElementById('v3TeamArea');
        if (teamArea && state.teams) {
            let html = '';
            state.teams.forEach((team) => {
                let isMain = false;
                if (state.currentQuestion && state.currentQuestion.active) {
                    isMain = (state.currentQuestion.mainTeamId === team.id);
                } else if (state.turnOrder && state.turnOrder.length > 0) {
                    isMain = (state.turnOrder[0] === team.id);
                }
                
                const bgColor = isMain ? 'linear-gradient(90deg, #e74c3c, #c0392b)' : 'linear-gradient(90deg, #05164d, #030e33)';
                const border = isMain ? '2px solid #fff' : '2px solid #00cfff';
                const textColor = isMain ? '#fff' : '#00cfff';
                const scoreColor = isMain ? '#ffff00' : '#fff';
                
                html += `
                    <div style="background: ${bgColor}; transform: skewX(-20deg); padding: 5px 15px; display: flex; justify-content: space-between; align-items: center; border: ${border}; box-shadow: 0 0 10px rgba(0,0,0,0.5);">
                        <div style="transform: skewX(20deg); color: ${textColor}; font-weight: bold; font-size: 24px;">${team.name}</div>
                        <div style="transform: skewX(20deg); color: ${scoreColor}; font-weight: bold; font-size: 24px;">${team.score}</div>
                    </div>
                `;
            });
            teamArea.innerHTML = html;
        }

        // Question Text (Right Side)
        const qTextV3 = document.getElementById('qTextV3');
        if (qTextV3) {
            if (state.currentQuestion && state.currentQuestion.active) {
                qTextV3.innerHTML = state.currentQuestion.isHidden ? '' : (state.currentQuestion.text || '').replace(/\n/g, '<br>');
            } else {
                qTextV3.innerHTML = '';
            }
        }

        // Clock
        const clockEl = document.getElementById('qBoxClockV3');
        if (clockEl) {
            clockEl.innerText = state.clock !== undefined ? state.clock : '';
        }

        // Points Area (Right Side Bottom)
        const pointsArea = document.getElementById('v3PointsArea');
        if (pointsArea) {
            let activeTeamId = null;
            if (state.turnOrder && state.turnOrder.length > 0) activeTeamId = state.turnOrder[0];
            if (state.currentQuestion && state.currentQuestion.active) activeTeamId = state.currentQuestion.mainTeamId;
            
            let p = state.lockedPackage || state.pendingPackage;
            if (!p && state.packages && activeTeamId) {
                p = state.packages.find(pkg => pkg.teamId === activeTeamId);
            }
            
            let mode = state.settings ? state.settings.questionSelectionMode : 1;
            if (p) mode = p.mode;
            
            let ptsHtml = '';
            if (p && p.questions && (mode === 2 || mode === 3)) {
                ptsHtml += `<div style="display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%;">`;
                ptsHtml += `<div style="display: flex; flex-direction: row; gap: 10px; justify-content: center; align-items: center; width: 100%;">`;
                
                let activeQNum = null;
                const ptsTypes = [10, 20, 40];
                const mode2StartQ = (state.settings && state.settings.mode2StartQ) || 1;
                
                p.questions.forEach((qItem, idx) => {
                    let color = '#ffffff';
                    let bgColor = 'rgba(0,0,0,0.5)';
                    let border = '2px solid #00cfff';
                    
                    let isActive = false;
                    let isPlayed = false;
                    
                    if (state.currentQuestion && state.currentQuestion.active) {
                        isActive = (state.currentQuestion.points === qItem.points && state.currentQuestion.idx === qItem.idx);
                    } else {
                        isActive = (p.currentIndex === idx);
                    }
                    
                    if (p.currentIndex > idx) {
                        isPlayed = true;
                    } else if (p.currentIndex === idx && state.currentQuestion && state.currentQuestion.resolved) {
                        isPlayed = true;
                    }
                    
                    if (isActive) {
                        color = '#ffffff';
                        bgColor = '#ff3b30';
                        border = '2px solid #fff';
                        
                        if (mode === 2) {
                            activeQNum = mode2StartQ + qItem.idx * 3 + ptsTypes.indexOf(parseInt(qItem.points));
                        } else {
                            activeQNum = idx + 1;
                        }
                    } else if (isPlayed) {
                        color = '#aaaaaa';
                        bgColor = 'rgba(0,0,0,0.2)';
                        border = '2px solid #555';
                    }
                    
                    ptsHtml += `
                        <div style="background: ${bgColor}; transform: skewX(-20deg); padding: 5px 30px; border: ${border}; box-shadow: 0 0 10px rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; min-width: 50px;">
                            <div style="transform: skewX(20deg); color: ${color}; font-weight: bold; font-size: 28px; line-height: 1.2;">${qItem.points}</div>
                        </div>
                    `;
                });
                
                ptsHtml += `</div>`;
                
                if (activeQNum !== null) {
                    ptsHtml += `<div style="background: #ff3b30; color: #fff; padding: 4px 14px; border-radius: 6px; font-weight: bold; font-size: 16px; border: 1.5px solid #fff; box-shadow: 0 0 10px rgba(255,0,0,0.4); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 5px;">Câu ${activeQNum}</div>`;
                }
                
                ptsHtml += `</div>`;
            }
            pointsArea.innerHTML = ptsHtml;
        }
    }
}

// Attach to window so html can instantiate it
window.EconovaDisplayController = EconovaDisplayController;
