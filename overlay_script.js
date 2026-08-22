
        const socket = io();
        let audioContextUnlocked = true;

        function unlockAudio() {
            let testAudio = new Audio(); testAudio.play().catch(e => {});
        }

        document.addEventListener('click', unlockAudio, { once: true });
        document.addEventListener('keydown', unlockAudio, { once: true });

        function playSound(soundId) {
            if (!audioContextUnlocked) return;
            const el = document.getElementById('snd_' + soundId);
            if (el) { el.currentTime = 0; el.play().catch(e => {}); }
        }
        socket.on('playSound', (soundId) => { playSound(soundId); });

        // VIDEO
        const videoOverlay = document.getElementById('videoOverlay');
        const mainVideo = document.getElementById('mainVideo');
        socket.on('playVideo', (url) => {
            if (url) {
                videoOverlay.style.display = 'flex';
                if (url.includes(':\\') || url.startsWith('C:') || url.startsWith('D:')) {
                    mainVideo.src = '/api/video?path=' + encodeURIComponent(url);
                } else {
                    mainVideo.src = url;
                }
                mainVideo.play().catch(e => {});
            }
        });
        socket.on('closeVideo', () => {
            mainVideo.pause(); mainVideo.src = ""; videoOverlay.style.display = 'none';
        });

        // Slave video sync
        socket.on('videoSync', (time) => {
            if (mainVideo && !mainVideo.paused && Math.abs(mainVideo.currentTime - time) > 2.5) {
                mainVideo.currentTime = time;
            }
        });

        socket.on('videoPlayState', (state) => {
            if (state === 'play') {
                mainVideo.play().catch(e => {});
            } else if (state === 'pause') {
                mainVideo.pause();
            }
        });

        // COUNTDOWN
        let timerInterval = null;
        let currentTheme = 'default';

        function getTimerEls() {
            if (currentTheme === 'v3') {
                return { c: document.getElementById('v3-timerContainerDefault'), b: document.getElementById('v3-timerBarDefault') };
            } else if (currentTheme === 'ascend_2026') {
                return { c: document.getElementById('timerContainerAscend'), b: document.getElementById('timerBarAscend') };
            } else {
                return { c: document.getElementById('timerContainerDefault'), b: document.getElementById('timerBarDefault') };
            }
        }

        function stopCountdown() {
            let elsDefault = { c: document.getElementById('timerContainerDefault'), b: document.getElementById('timerBarDefault') };
            let elsAscend = { c: document.getElementById('timerContainerAscend'), b: document.getElementById('timerBarAscend') };
            let elsV3 = { c: document.getElementById('v3-timerContainerDefault'), b: document.getElementById('v3-timerBarDefault') };
            clearInterval(timerInterval);
            if (elsDefault.c) { elsDefault.c.style.display = 'none'; elsDefault.b.style.width = '0%'; }
            if (elsAscend.c) { elsAscend.c.style.display = 'none'; elsAscend.b.style.width = '0%'; }
            if (elsV3.c) { elsV3.c.style.display = 'none'; elsV3.b.style.width = '0%'; }
        }

        socket.on('startCountdown', (seconds) => {
            let els = getTimerEls();
            els.c.style.display = 'block';
            els.b.style.width = '0%';
            let startTime = Date.now();
            let duration = seconds * 1000;
            
            clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                let elapsed = Date.now() - startTime;
                let percent = (elapsed / duration) * 100;
                if (percent >= 100) {
                    percent = 100;
                    clearInterval(timerInterval);
                    setTimeout(() => { els.c.style.display = 'none'; els.b.style.width = '0%'; }, 500);
                }
                els.b.style.width = percent + '%';
            }, 50);
        });

        // STATE UPDATE
        socket.on('updateState', (state) => {
            console.log('[DEBUG overlay.html updateState] callback triggered, theme =', state.settings ? state.settings.theme : 'N/A');
            // ================= FONT LOGIC =================
            if (state.settings) {
                let s = state.settings;
                let globalEnabled = s.globalFontEnabled || false;
                let fGlobal = s.fontGlobal || 'SF Pro Display Bold';
                let fGeneral = s.fontGeneral || 'SF Pro Display Bold';
                let fQuestion = s.fontQuestion || 'SF Pro Display Bold';
                let fTeam = s.fontTeamName || 'SF Pro Display Bold';
                let fScore = s.fontScore || 'Orbitron';
                
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
            // ===============================================

            if (!state.teams) return;

            // Xử lý ẩn hiện theo vòng (activeRound)
            const mainContainer = document.getElementById('main-container');
            if (mainContainer) {
                mainContainer.style.transition = 'opacity 0.3s, visibility 0.3s';
                mainContainer.style.visibility = state.activeRound === 1 ? 'hidden' : 'visible';
                mainContainer.style.opacity = state.activeRound === 1 ? '0' : '1';
            }
            const round1Timer = document.getElementById('round1-timer-container');
            if (round1Timer) {
                round1Timer.style.opacity = state.activeRound === 1 ? '1' : '0';
                round1Timer.style.visibility = state.activeRound === 1 ? 'visible' : 'hidden';
            }

            // 0. Settings
            if (state.settings) {
                currentTheme = state.settings.theme || 'default';
                document.body.className = currentTheme;
                document.body.style.filter = `brightness(${(state.settings.brightness || 100) / 100})`;
                autoScale();
            }

            // 1. Scoreboard (Render to both places, CSS handles visibility)
            let html = '';
            state.teams.forEach(team => {
                let isMain = false;
                if (state.currentQuestion.active) {
                    isMain = (state.currentQuestion.mainTeamId === team.id);
                } else {
                    isMain = (state.turnOrder && state.turnOrder.length > 0 && state.turnOrder[0] === team.id);
                }
                
                let isBuzzed = state.buzzedTeam === team.id;
                let classes = 'team-card';
                if (isMain) classes += ' is-main';
                if (isBuzzed) classes += ' buzzed';
                
                let teamNameDisplay = team.name;

                html += `
                    <div class="${classes}" data-team="${team.id}">
                        <div class="team-name" style="display:flex; align-items:center; justify-content:center;"><span class="name-inner" style="display:inline-block; transform-origin:center center;">${teamNameDisplay}</span></div>
                        <div class="team-school">${team.school || '&nbsp;'}</div>
                        <div class="team-score">${team.score}</div>
                    </div>
                `;
            });
            document.getElementById('defaultScoreboard').innerHTML = html;
            document.getElementById('ascendScoreboard').innerHTML = html;

            // Apply dynamic grid columns for default theme
            document.getElementById('defaultScoreboard').style.gridTemplateColumns = `repeat(${state.teams.length}, 1fr)`;

            // Removed scale from here to call it inside applyVisibility after display flex is set

            // Language settings applied dynamically now via applyTranslations
            const lang = (state.settings && state.settings.language) || 'vi';
            applyTranslations(lang);
            const textPts = t('scr_pts', lang);
            const textWait = t('scr_wait', lang);

            // 2. Grid updates across all theme prefixes
            ['v1', 'v2', 'v3'].forEach(prefix => {
                const gh10 = document.getElementById(`${prefix}-gh10`);
                const gh20 = document.getElementById(`${prefix}-gh20`);
                const gh40 = document.getElementById(`${prefix}-gh40`);
                if (gh10) gh10.textContent = `10 ${textPts}`;
                if (gh20) gh20.textContent = `20 ${textPts}`;
                if (gh40) gh40.textContent = `40 ${textPts}`;
            });

            const mode = state.lockedPackage ? state.lockedPackage.mode : (state.settings ? state.settings.questionSelectionMode : 1);
            const ptsList = [10, 20, 40];
            
            ['v1', 'v2', 'v3'].forEach(prefix => {
                ptsList.forEach(pts => {
                    const container = document.getElementById(`${prefix}-grid` + pts);
                    if (container) {
                        container.innerHTML = '';
                        
                        if (mode === 1) {
                            if (prefix === 'v3') {
                                // V3 mode 1: cells stacked in column via .v3-grid-col CSS
                                if (mode === 1) { container.classList.add('mode1-grid'); } else { container.classList.remove('mode1-grid'); }
                                container.style.display = '';
                                container.style.flexWrap = '';
                                container.style.justifyContent = '';
                                let count = (state.questionCount && state.questionCount[pts] !== undefined) ? state.questionCount[pts] : 12;
                                for (let i = 0; i < count; i++) {
                                    let isPlayed = false;
                                    if (state.playedQuestions && state.playedQuestions[pts] && state.playedQuestions[pts].includes(i)) {
                                        isPlayed = true;
                                    }
                                    container.innerHTML += `<div class="q-cell active-tab ${isPlayed ? 'played' : ''}">${i + 1}</div>`;
                                }
                            } else {
                                container.classList.add('mode1-grid');
                                container.style.display = 'flex';
                                container.style.flexWrap = 'wrap';
                                container.style.justifyContent = 'center';
                                let count = (state.questionCount && state.questionCount[pts] !== undefined) ? state.questionCount[pts] : 12;
                                let rows = count > 18 ? 3 : (count > 6 ? 2 : 1);
                                for (let i = 0; i < count; i++) {
                                    let isPlayed = false;
                                    if (state.playedQuestions && state.playedQuestions[pts] && state.playedQuestions[pts].includes(i)) {
                                        isPlayed = true;
                                    }
                                    
                                    let itemsThisRow = count;
                                    if (rows === 2) {
                                        let itemsR1 = Math.floor(count / 2);
                                        let itemsR2 = count - itemsR1;
                                        itemsThisRow = (i < itemsR1) ? itemsR1 : itemsR2;
                                    } else if (rows === 3) {
                                        let base = Math.floor(count / 3);
                                        let extra = count % 3;
                                        let itemsR1 = base + (extra > 0 ? 1 : 0);
                                        let itemsR2 = base + (extra > 1 ? 1 : 0);
                                        if (i < itemsR1) itemsThisRow = itemsR1;
                                        else if (i < itemsR1 + itemsR2) itemsThisRow = itemsR2;
                                        else itemsThisRow = count - itemsR1 - itemsR2;
                                    }
                                    
                                    let flexBasis = `calc((100% - ${(itemsThisRow - 1) * 10}px) / ${itemsThisRow})`;
                                    container.innerHTML += `<div class="q-cell active-tab ${isPlayed ? 'played' : ''}" style="flex: 0 0 ${flexBasis}; width: ${flexBasis}; max-width: ${flexBasis}; min-width: 0; padding: 0; box-sizing: border-box;">${i + 1}</div>`;
                                }
                            }
                        } else {
                            if (mode === 1) { container.classList.add('mode1-grid'); } else { container.classList.remove('mode1-grid'); }
                            let pkg = state.lockedPackage || state.pendingPackage;
                            let rawQuestions = pkg ? (pkg.questions || pkg.package || []) : [];
                            let qPerTeam = (state.settings && state.settings.questionsPerTeam) || 3;
                            
                            for (let i = 0; i < qPerTeam; i++) {
                                let qData = rawQuestions[i];
                                if (qData && qData.points === pts) {
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
                                    
                                    if (isPlayed) {
                                        cellClass = "played";
                                        qNumberText = pkg.mode === 3 ? "" : (qData.idx + 1);
                                    } else if (isCurrent) {
                                        cellClass = "active-tab";
                                        qNumberText = pkg.mode === 3 ? "" : (qData.idx + 1);
                                    } else if (isChosen) {
                                        cellClass = "active-tab";
                                        qNumberText = pkg.mode === 3 ? "" : (qData.idx + 1);
                                    }

                                    if (prefix === 'v3') {
                                        let isSelected = isPlayed || isCurrent || isChosen;
                                        let content = `<span>${pts}</span>`;
                                        if (isSelected && pkg.mode === 2 && qData.idx !== undefined && qData.idx !== null) {
                                            let N = qData.idx + 1;
                                            content += `<div class="v3-cell-index-badge">${N}</div>`;
                                        }
                                        let v3Class = isSelected ? `${cellClass} v3-selected` : cellClass;
                                        container.innerHTML += `<div class="q-cell ${v3Class}" data-idx="${qData.idx}">${content}</div>`;
                                    } else {
                                        container.innerHTML += `<div class="q-cell ${cellClass}" data-idx="${qData.idx}">${qNumberText}</div>`;
                                    }
                                } else {
                                    container.innerHTML += `<div class="q-cell inactive-tab"></div>`;
                                }
                            }
                        }
                    }
                });
            });

            // 3. Question Logic
            let q = state.currentQuestion;
            let activeTeamId = q.mainTeamId;
            if (!activeTeamId && state.turnOrder && state.turnOrder.length > 0) activeTeamId = state.turnOrder[0];

            // Render compact scoreboard for V1
            const v1CompactScoreboard = document.getElementById('v1-compactScoreboard');
            if (v1CompactScoreboard && state.teams) {
                let compactHtml = '';
                state.teams.forEach(t => {
                    let isActive = t.id === activeTeamId;
                    let isBuzzed = state.buzzedTeam === t.id;
                    let activeClass = '';
                    if (isBuzzed) activeClass = 'buzzed-team';
                    else if (isActive) activeClass = 'active-team';
                    
                    compactHtml += `<div class="compact-team ${activeClass}">
                        <span class="compact-team-name"><span class="name-inner">${t.name}</span></span>
                        <span class="compact-team-score">${t.score}</span>
                    </div>`;
                });
                v1CompactScoreboard.innerHTML = compactHtml;
            }

            // Render compact scoreboard for V3
            const v3CompactScoreboard = document.getElementById('v3-compactScoreboard');
            if (v3CompactScoreboard && state.teams) {
                let qScoreHtml = '';
                state.teams.forEach((team, idx) => {
                    let isMain = (activeTeamId === team.id);
                    if (isMain) {
                        qScoreHtml += `
                            <div class="q-score-item q-team-tab active" id="qt-${idx}">
                                <span class="q-score-name q-team-name"><span class="name-inner">${idx + 1}. ${team.name}</span></span>
                            </div>
                        `;
                    } else {
                        qScoreHtml += `
                            <div class="q-score-item q-team-tab" id="qt-${idx}">
                                <span class="q-score-name q-team-name"><span class="name-inner">${idx + 1}. ${team.name} (${team.score})</span></span>
                            </div>
                        `;
                    }
                    if (idx < state.teams.length - 1) {
                        qScoreHtml += `<div class="q-separator"></div>`;
                    }
                });
                v3CompactScoreboard.innerHTML = qScoreHtml;
            }

            // Update V3 active team score
            let activeTeam = state.teams.find(t => t.id === activeTeamId);
            let activeTeamScore = activeTeam ? activeTeam.score : 0;
            const v3ScoreEl = document.getElementById('v3EconovaScoreoverlay-mode');
            if (v3ScoreEl) {
                v3ScoreEl.textContent = activeTeamScore;
            }

            // Update V3 active package points
            const v3PtsWrapper = document.getElementById('v3EconovaPointsWrapperoverlay-mode');
            if (v3PtsWrapper) {
                v3PtsWrapper.innerHTML = '';
                if (state.lockedPackage && state.lockedPackage.questions) {
                    state.lockedPackage.questions.forEach((pq, idx) => {
                        let isActive = (idx === state.lockedPackage.currentIndex && q.active && !q.isHidden);
                        let ptBox = document.createElement('div');
                        ptBox.className = 'pt-box' + (isActive ? ' active' : '');
                        ptBox.innerHTML = `<span>${pq.points}</span>`;
                        v3PtsWrapper.appendChild(ptBox);
                        if (idx < state.lockedPackage.questions.length - 1) {
                            let separator = document.createElement('div');
                            separator.className = 'pt-separator';
                            v3PtsWrapper.appendChild(separator);
                        }
                    });
                } else {
                    v3PtsWrapper.innerHTML = `
                        <div class="pt-box"><span>10</span></div>
                        <div class="pt-separator"></div>
                        <div class="pt-box"><span>20</span></div>
                        <div class="pt-separator"></div>
                        <div class="pt-box"><span>40</span></div>
                    `;
                }
            }

            // Update V1 and V2 package points lists
            ['v1', 'v2'].forEach(prefix => {
                const container = document.getElementById(`${prefix}-packagePointsContainer`);
                const qPoints = document.getElementById(`${prefix}-qPoints`);
                const ascendPtsBox = document.getElementById(`${prefix}-ascendPtsBox`);
                
                if (state.lockedPackage && (mode === 2 || mode === 3)) {
                    if (qPoints) qPoints.style.display = 'none';
                    if (ascendPtsBox && currentTheme === 'ascend_2026') {
                        ascendPtsBox.style.display = 'flex';
                        let totalQs = state.lockedPackage.questions.length;
                        let ptsWidth = Math.min(60, totalQs * 5);
                        ptsWidth = Math.max(20, ptsWidth);
                        ascendPtsBox.style.width = ptsWidth + '%';
                        ascendPtsBox.style.justifyContent = 'flex-start';
                        ascendPtsBox.style.paddingLeft = '0px';
                        ascendPtsBox.style.gap = '0px';
                        ascendPtsBox.style.overflow = 'hidden';
                        ascendPtsBox.style.flexWrap = totalQs > 10 ? 'wrap' : 'nowrap';
                        ascendPtsBox.style.alignContent = 'stretch';
                        
                        const sb = document.getElementById('ascendScoreboard');
                        if (sb) sb.style.width = (100 - ptsWidth) + '%';
                        ascendPtsBox.innerHTML = '';
                        if (container) container.style.display = 'none';
                        
                        state.lockedPackage.questions.forEach((pq, idx) => {
                            let div = document.createElement('div');
                            div.className = 'package-pts-box';
                            div.innerText = `${pq.points}`;
                            div.style.flex = '1';
                            div.style.height = '100%';
                            div.style.fontSize = '32px';
                            div.style.display = 'flex';
                            div.style.alignItems = 'center';
                            div.style.justifyContent = 'center';
                            if (idx === state.lockedPackage.currentIndex && q.active && !q.isHidden) {
                                div.classList.add('active-pts');
                                let c = pq.points == 10 ? '#10ac84' : (pq.points == 20 ? '#f39c12' : '#ff4757');
                                div.style.background = c;
                            }
                            ascendPtsBox.appendChild(div);
                        });
                    } else {
                        if (ascendPtsBox) ascendPtsBox.style.display = 'none';
                        if (container) {
                            container.style.display = 'flex';
                            container.innerHTML = '';
                            state.lockedPackage.questions.forEach((pq, idx) => {
                                let div = document.createElement('div');
                                div.className = 'package-pts-box';
                                div.innerText = `${pq.points}`;
                                div.style.width = '80px';
                                div.style.borderRadius = '8px 8px 0 0';
                                div.style.textAlign = 'center';
                                if (idx === state.lockedPackage.currentIndex && q.active && !q.isHidden) {
                                    div.classList.add('active-pts');
                                    let c = pq.points == 10 ? '#10ac84' : (pq.points == 20 ? '#f39c12' : '#ff4757');
                                    div.style.background = c;
                                }
                                container.appendChild(div);
                            });
                        }
                    }
                } else {
                    if (container) container.style.display = 'none';
                    if (currentTheme === 'ascend_2026' && prefix === 'v2') {
                        if (qPoints) qPoints.style.display = 'none';
                        if (ascendPtsBox) {
                            ascendPtsBox.style.display = 'flex';
                            ascendPtsBox.style.width = '15%';
                            ascendPtsBox.style.justifyContent = 'center';
                            ascendPtsBox.style.paddingLeft = '0';
                            const sb = document.getElementById('ascendScoreboard');
                            if (sb) sb.style.width = '85%';
                            ascendPtsBox.textContent = `${q.points} ${textPts}`;
                        }
                    } else {
                        if (ascendPtsBox) ascendPtsBox.style.display = 'none';
                        if (qPoints) {
                            qPoints.style.display = 'block';
                            qPoints.textContent = `${q.points} ${textPts}`;
                        }
                    }
                }
            });

            // Update question texts across all prefixes
            let cleanText = q.isHidden ? "" : (q.mode === 3 ? (q.text || "") : (q.text || textWait));
            ['v1', 'v2', 'v3'].forEach(prefix => {
                const qTextEl = document.getElementById(`${prefix}-qText`);
                if (qTextEl) {
                    qTextEl.textContent = cleanText;
                    qTextEl.style.fontSize = '';
                    requestAnimationFrame(() => {
                        let maxH = prefix === 'v2' ? 120 : 150;
                        if (prefix === 'v3') maxH = 120;
                        let size = prefix === 'v3' ? 32 : 32;
                        while (qTextEl.scrollHeight > maxH && size > 16) {
                            size -= 1;
                            qTextEl.style.fontSize = size + 'px';
                        }
                    });
}
                        });
            });

            // 3. Question Logic
            let q = state.currentQuestion;
            let activeTeamId = q.mainTeamId;
            if (!activeTeamId && state.turnOrder && state.turnOrder.length > 0) activeTeamId = state.turnOrder[0];

            // Render compact scoreboard for V1
            const v1CompactScoreboard = document.getElementById('v1-compactScoreboard');
            if (v1CompactScoreboard && state.teams) {
                let compactHtml = '';
                state.teams.forEach(t => {
                    let isActive = t.id === activeTeamId;
                    let isBuzzed = state.buzzedTeam === t.id;
                    let activeClass = '';
                    if (isBuzzed) activeClass = 'buzzed-team';
                    else if (isActive) activeClass = 'active-team';
                    
                    compactHtml += `<div class="compact-team ${activeClass}">
                        <span class="compact-team-name"><span class="name-inner">${t.name}</span></span>
                        <span class="compact-team-score">${t.score}</span>
                    </div>`;
                });
                v1CompactScoreboard.innerHTML = compactHtml;
            }

            // Render compact scoreboard for V3
            const v3CompactScoreboard = document.getElementById('v3-compactScoreboard');
            if (v3CompactScoreboard && state.teams) {
                let qScoreHtml = '';
                state.teams.forEach((team, idx) => {
                    let isMain = (activeTeamId === team.id);
                    if (isMain) {
                        qScoreHtml += `
                            <div class="q-score-item q-team-tab active" id="qt-${idx}">
                                <span class="q-score-name q-team-name"><span class="name-inner">${idx + 1}. ${team.name}</span></span>
                            </div>
                        `;
                    } else {
                        qScoreHtml += `
                            <div class="q-score-item q-team-tab" id="qt-${idx}">
                                <span class="q-score-name q-team-name"><span class="name-inner">${idx + 1}. ${team.name} (${team.score})</span></span>
                            </div>
                        `;
                    }
                    if (idx < state.teams.length - 1) {
                        qScoreHtml += `<div class="q-separator"></div>`;
                    }
                });
                v3CompactScoreboard.innerHTML = qScoreHtml;
            }

            // Update V3 active team score
            let activeTeam = state.teams.find(t => t.id === activeTeamId);
            let activeTeamScore = activeTeam ? activeTeam.score : 0;
            const v3ScoreEl = document.getElementById('v3EconovaScoreoverlay-mode');
            if (v3ScoreEl) {
                v3ScoreEl.textContent = activeTeamScore;
            }

            // Update V3 active package points
            const v3PtsWrapper = document.getElementById('v3EconovaPointsWrapperoverlay-mode');
            if (v3PtsWrapper) {
                v3PtsWrapper.innerHTML = '';
                if (state.lockedPackage && state.lockedPackage.questions) {
                    state.lockedPackage.questions.forEach((pq, idx) => {
                        let isActive = (idx === state.lockedPackage.currentIndex && q.active && !q.isHidden);
                        let ptBox = document.createElement('div');
                        ptBox.className = 'pt-box' + (isActive ? ' active' : '');
                        ptBox.innerHTML = `<span>${pq.points}</span>`;
                        v3PtsWrapper.appendChild(ptBox);
                        if (idx < state.lockedPackage.questions.length - 1) {
                            let separator = document.createElement('div');
                            separator.className = 'pt-separator';
                            v3PtsWrapper.appendChild(separator);
                        }
                    });
                } else {
                    v3PtsWrapper.innerHTML = `
                        <div class="pt-box"><span>10</span></div>
                        <div class="pt-separator"></div>
                        <div class="pt-box"><span>20</span></div>
                        <div class="pt-separator"></div>
                        <div class="pt-box"><span>40</span></div>
                    `;
                }
            }

            // Update V1 and V2 package points lists
            ['v1', 'v2'].forEach(prefix => {
                const container = document.getElementById(`${prefix}-packagePointsContainer`);
                const qPoints = document.getElementById(`${prefix}-qPoints`);
                const ascendPtsBox = document.getElementById(`${prefix}-ascendPtsBox`);
                
                if (state.lockedPackage && (mode === 2 || mode === 3)) {
                    if (qPoints) qPoints.style.display = 'none';
                    if (ascendPtsBox && currentTheme === 'ascend_2026') {
                        ascendPtsBox.style.display = 'flex';
                        let totalQs = state.lockedPackage.questions.length;
                        let ptsWidth = Math.min(60, totalQs * 5);
                        ptsWidth = Math.max(20, ptsWidth);
                        ascendPtsBox.style.width = ptsWidth + '%';
                        ascendPtsBox.style.justifyContent = 'flex-start';
                        ascendPtsBox.style.paddingLeft = '0px';
                        ascendPtsBox.style.gap = '0px';
                        ascendPtsBox.style.overflow = 'hidden';
                        ascendPtsBox.style.flexWrap = totalQs > 10 ? 'wrap' : 'nowrap';
                        ascendPtsBox.style.alignContent = 'stretch';
                        
                        const sb = document.getElementById('ascendScoreboard');
                        if (sb) sb.style.width = (100 - ptsWidth) + '%';
                        ascendPtsBox.innerHTML = '';
                        if (container) container.style.display = 'none';
                        
                        state.lockedPackage.questions.forEach((pq, idx) => {
                            let div = document.createElement('div');
                            div.className = 'package-pts-box';
                            div.innerText = `${pq.points}`;
                            div.style.flex = '1';
                            div.style.height = '100%';
                            div.style.fontSize = '32px';
                            div.style.display = 'flex';
                            div.style.alignItems = 'center';
                            div.style.justifyContent = 'center';
                            if (idx === state.lockedPackage.currentIndex && q.active && !q.isHidden) {
                                div.classList.add('active-pts');
                                let c = pq.points == 10 ? '#10ac84' : (pq.points == 20 ? '#f39c12' : '#ff4757');
                                div.style.background = c;
                            }
                            ascendPtsBox.appendChild(div);
                        });
                    } else {
                        if (ascendPtsBox) ascendPtsBox.style.display = 'none';
                        if (container) {
                            container.style.display = 'flex';
                            container.innerHTML = '';
                            state.lockedPackage.questions.forEach((pq, idx) => {
                                let div = document.createElement('div');
                                div.className = 'package-pts-box';
                                div.innerText = `${pq.points}`;
                                div.style.width = '80px';
                                div.style.borderRadius = '8px 8px 0 0';
                                div.style.textAlign = 'center';
                                if (idx === state.lockedPackage.currentIndex && q.active && !q.isHidden) {
                                    div.classList.add('active-pts');
                                    let c = pq.points == 10 ? '#10ac84' : (pq.points == 20 ? '#f39c12' : '#ff4757');
                                    div.style.background = c;
                                }
                                container.appendChild(div);
                            });
                        }
                    }
                } else {
                    if (container) container.style.display = 'none';
                    if (currentTheme === 'ascend_2026' && prefix === 'v2') {
                        if (qPoints) qPoints.style.display = 'none';
                        if (ascendPtsBox) {
                            ascendPtsBox.style.display = 'flex';
                            ascendPtsBox.style.width = '15%';
                            ascendPtsBox.style.justifyContent = 'center';
                            ascendPtsBox.style.paddingLeft = '0';
                            const sb = document.getElementById('ascendScoreboard');
                            if (sb) sb.style.width = '85%';
                            ascendPtsBox.textContent = `${q.points} ${textPts}`;
                        }
                    } else {
                        if (ascendPtsBox) ascendPtsBox.style.display = 'none';
                        if (qPoints) {
                            qPoints.style.display = 'block';
                            qPoints.textContent = `${q.points} ${textPts}`;
                        }
                    }
                }
            });

            // Update question texts across all prefixes
            let cleanText = q.isHidden ? "" : (q.mode === 3 ? (q.text || "") : (q.text || textWait));
            ['v1', 'v2', 'v3'].forEach(prefix => {
                const qTextEl = document.getElementById(`${prefix}-qText`);
                if (qTextEl) {
                    qTextEl.textContent = cleanText;
                    qTextEl.style.fontSize = '';
                    requestAnimationFrame(() => {
                        let maxH = prefix === 'v2' ? 120 : 150;
                        if (prefix === 'v3') maxH = 120;
                        let size = prefix === 'v3' ? 32 : 32;
                        while (qTextEl.scrollHeight > maxH && size > 16) {
                            size -= 1;
                            qTextEl.style.fontSize = size + 'px';
                        }
                    });
                }
            });

            // Update hope star badges across all prefixes
            ['v1', 'v2', 'v3'].forEach(prefix => {
                const badge = document.getElementById(`${prefix}-hopeStarBadge`);
                if (badge) {
                    badge.style.display = q.isHopeStar ? 'flex' : 'none';
                }
            });

            // Moved applyVisibility to the global scope to prevent closure issues
            window.applyVisibilityOld = function(state) {
                if (!state) return;
                let currentTheme = state.settings ? state.settings.theme : 'default';
                let mode = state.lockedPackage ? state.lockedPackage.mode : (state.settings ? state.settings.questionSelectionMode : 1);
                let q = state.currentQuestion;

                // FALLBACK FOR OLD THEMES
                const ascendFrame = document.getElementById('ascendFrame');
                const defScoreboard = document.getElementById('defaultScoreboard');
                const qArea = document.querySelector('.question-area');
                let showGrid = state.isGridVisibleOnOverlay;
                let showQBox = false;
                if (!showGrid) {
                    if (mode === 1) { showQBox = q && q.active; }
                    else if (mode === 2 || mode === 3) { showQBox = state.lockedPackage !== null; }
                }
                const qBoxNode = document.getElementById(currentTheme === 'ascend_2026' ? 'v2-qBox' : 'v1-qBox');
                const qGridNode = document.getElementById(currentTheme === 'ascend_2026' ? 'v2-qGrid' : 'v1-qGrid');
                if (showQBox || showGrid) {
                    if (showQBox) {
                        if (qGridNode) qGridNode.style.display = 'none';
                        if (qArea) qArea.style.display = 'flex';
                        if (ascendFrame) {
                            ascendFrame.style.display = 'flex';
                            if (currentTheme === 'ascend_2026') {
                                if (ascendFrame.style.display !== 'flex') {
                                    ascendFrame.classList.remove('slide-up-in');
                                    void ascendFrame.offsetWidth;
                                    ascendFrame.classList.add('slide-up-in');
                                }
                            }
                        }
                        if (defScoreboard) defScoreboard.style.display = 'none';
                        if (qBoxNode) {
                            qBoxNode.style.display = (q && q.active) ? 'flex' : 'none';
                            if (q && q.active && !qBoxNode.classList.contains('slide-up-in')) {
                                qBoxNode.classList.remove('slide-up-in');
                                void qBoxNode.offsetWidth;
                                qBoxNode.classList.add('slide-up-in');
                            }
                        }
                        const v1Compact = document.getElementById('v1-compactScoreboard');
                        if (v1Compact) v1Compact.style.display = (q && q.active) ? 'flex' : 'none';
                    } else {
                        if (qArea) qArea.style.display = 'flex';
                        if (qBoxNode) qBoxNode.style.display = 'none';
                        if (defScoreboard) defScoreboard.style.display = 'none';
                        if (ascendFrame) ascendFrame.style.display = 'flex';
                        if (qGridNode) {
                            qGridNode.style.display = 'flex';
                            qGridNode.classList.remove('slide-up-in');
                            void qGridNode.offsetWidth;
                            qGridNode.classList.add('slide-up-in');
                        }
                        const v1Compact = document.getElementById('v1-compactScoreboard');
                        if (v1Compact) v1Compact.style.display = 'none';
                    }
                } else {
                    if (ascendFrame) ascendFrame.style.display = 'none';
                    if (qArea) qArea.style.display = 'none';
                    if (qBoxNode) qBoxNode.style.display = 'none';
                    if (defScoreboard) defScoreboard.style.display = 'flex';
                    if (qGridNode) qGridNode.style.display = 'none';
                    const v1Compact = document.getElementById('v1-compactScoreboard');
                    if (v1Compact) v1Compact.style.display = 'none';
                }
            };

                window.applyVisibility = function(state) {
                if (!state) return;
                let currentTheme = state.settings ? state.settings.theme : 'default';
                if (currentTheme !== 'v3') {
                    return window.applyVisibilityOld(state);
                }

                let mode = state.lockedPackage ? state.lockedPackage.mode : (state.settings ? state.settings.questionSelectionMode : 1);
                let q = state.currentQuestion;

                let showGrid = state.isGridVisibleOnOverlay;
                let showQBox = false;
                if (!showGrid) {
                    if (mode === 1) { showQBox = q && q.active; }
                    else if (mode === 2 || mode === 3) { showQBox = state.lockedPackage !== null; }
                }

                const qBoxContainer = document.getElementById('qBoxContainer') || document.getElementById('v3AnimContainer');
                const qGridContainer = document.getElementById('qGridContainer');
                const v3QBox = document.getElementById('v3-qBox');
                const v3QGrid = document.getElementById('v3-qGrid');

                const panelId = document.getElementById('v3EconovaPanelscreen-mode') ? 'v3EconovaPanelscreen-mode' : 'v3EconovaPaneloverlay-mode';
                const qBoxElement = v3QBox ? v3QBox.querySelector('.question-box') : null;
                if (qBoxElement) {
                    if (mode === 2 || mode === 3) {
                        qBoxElement.classList.add('econova-mode');
                    } else {
                        qBoxElement.classList.remove('econova-mode');
                    }
                }

                const v3Panel = document.getElementById(panelId);
                if (v3Panel) {
                    if (showQBox && (mode === 2 || mode === 3)) {
                        v3Panel.style.display = 'flex';
                    } else {
                        v3Panel.style.display = 'none';
                    }
                }

                if (showQBox) {
                    if (qGridContainer) {
                        qGridContainer.classList.remove('run-anim');
                        qGridContainer.style.display = 'none';
                    }
                    if (v3QGrid) { v3QGrid.style.display = 'none'; }

                    if (qBoxContainer && !qBoxContainer.classList.contains('run-anim')) {
                        qBoxContainer.classList.remove('run-anim');
                        qBoxContainer.style.removeProperty('display');
                        void qBoxContainer.offsetWidth;
                        qBoxContainer.classList.add('run-anim');
                    }
                    if (v3QBox) { v3QBox.style.display = 'flex'; }
                } else if (showGrid) {
                    if (qBoxContainer) {
                        qBoxContainer.classList.remove('run-anim');
                        qBoxContainer.style.display = 'none';
                    }
                    if (v3QBox) { v3QBox.style.display = 'none'; }

                    if (qGridContainer && !qGridContainer.classList.contains('run-anim')) {
                        qGridContainer.classList.remove('run-anim');
                        qGridContainer.style.removeProperty('display');
                        void qGridContainer.offsetWidth;
                        qGridContainer.classList.add('run-anim');
                    }
                    if (v3QGrid) { v3QGrid.style.display = 'flex'; }
                } else {
                    if (qBoxContainer) { qBoxContainer.classList.remove('run-anim'); qBoxContainer.style.display = 'none'; }
                    if (v3QBox) { v3QBox.style.display = 'none'; }
                    if (qGridContainer) { qGridContainer.classList.remove('run-anim'); qGridContainer.style.display = 'none'; }
                    if (v3QGrid) { v3QGrid.style.display = 'none'; }
                }
            };

            if (q.active && !window.lastActiveState && q.idx !== null && q.idx !== undefined && q.idx !== -1) {
                window.isAnimating = true;
                
                let activePrefix = currentTheme === 'v3' ? 'v3' : (currentTheme === 'ascend_2026' ? 'v2' : 'v1');
                const container = document.getElementById(activePrefix + '-grid' + q.points);
                let cell = null;
                let mode = state.lockedPackage ? state.lockedPackage.mode : (state.settings ? state.settings.questionSelectionMode : 1);
                
                if (container) {
                    if (mode === 1) {
                        if (container.children[q.idx]) cell = container.children[q.idx];
                    } else {
                        // In mode 2/3, use data-idx to find the cell instead of direct child index
                        cell = container.querySelector(`.q-cell[data-idx="${q.idx}"]`);
                    }
                }
                
                if (cell) {
                    cell.classList.add('selected-anim');
                }
                setTimeout(() => {
                    if (cell) cell.classList.remove('selected-anim');
                    
                    if (currentTheme === 'v3') {
                        const qGridContainer = document.getElementById('qGridContainer');
                        const qBoxContainer = document.getElementById('qBoxContainer') || document.getElementById('v3AnimContainer');
                        const v3QBox = document.getElementById('v3-qBox');
                        const v3QGrid = document.getElementById('v3-qGrid');
                        
                        // 1. Trigger Shutter Close
                        if (qGridContainer) {
                            qGridContainer.classList.remove('v3-shutter-close');
                            void qGridContainer.offsetWidth; // trigger reflow
                            qGridContainer.classList.add('v3-shutter-close');
                        }
                        
                        // 2. Switch containers after close completes (0.5s)
                        setTimeout(() => {
                            if (qGridContainer) {
                                qGridContainer.style.display = 'none';
                                qGridContainer.classList.remove('v3-shutter-close');
                            }
                            if (v3QGrid) v3QGrid.style.display = 'none';
                            
                            if (qBoxContainer) {
                                qBoxContainer.classList.remove('v3-shutter-open');
                                qBoxContainer.style.display = '';
                                void qBoxContainer.offsetWidth;
                                qBoxContainer.classList.add('v3-shutter-open');
                            }
                            if (v3QBox) v3QBox.style.display = 'flex';
                            
                            // 3. Complete transition after open completes (0.6s)
                            setTimeout(() => {
                                if (qBoxContainer) {
                                    qBoxContainer.classList.remove('v3-shutter-open');
                                }
                                window.isAnimating = false;
                                if (window.currentState) window.applyVisibility(window.currentState);
                            }, 600);
                            
                        }, 500);
                    } else {
                        window.isAnimating = false;
                        if (window.currentState) window.applyVisibility(window.currentState);
                    }
                }, 1000);
            } else if (!window.isAnimating) {
                window.applyVisibility(state);
            }
            window.lastActiveState = q.active;
            window.currentState = state;

        });

        function autoScale() {
            const baseW = 1920, baseH = 1080;
            const scaleX = window.innerWidth / baseW;
            const scaleY = window.innerHeight / baseH;
            const responsiveScale = Math.min(scaleX, scaleY);
            const manualScale = (window.currentState && window.currentState.settings && window.currentState.settings.scale) ? window.currentState.settings.scale / 100 : 1;
            document.getElementById('main-container').style.transform = 'translateX(-50%) scale(' + (responsiveScale * manualScale) + ')';
        }
        window.addEventListener('resize', autoScale);
        autoScale();

        function autoScaleTeamNames() {
            document.querySelectorAll('#defaultScoreboard .team-name').forEach(nc => {
                let inner = nc.querySelector('.name-inner');
                if (nc && inner) {
                    inner.style.transform = 'scaleX(1)';
                    let avail = nc.clientWidth - 10;
                    if (inner.scrollWidth > avail && avail > 0) inner.style.transform = 'scaleX(' + (avail / inner.scrollWidth) + ')';
                }
            });
            document.querySelectorAll('#ascendScoreboard .team-card').forEach(card => {
                let nc = card.querySelector('.team-name');
                let inner = card.querySelector('.name-inner');
                if (nc && inner) {
                    inner.style.transform = 'scaleX(1)';
                    let avail = nc.clientWidth - 10;
                    if (inner.scrollWidth > avail && avail > 0) inner.style.transform = 'scaleX(' + (avail / inner.scrollWidth) + ')';
                }
            });
            document.querySelectorAll('#v3-compactScoreboard .q-team-name').forEach(nc => {
                let inner = nc.querySelector('.name-inner');
                if (nc && inner) {
                    inner.style.transform = 'scaleX(1)';
                    let avail = nc.clientWidth - 10;
                    if (inner.scrollWidth > avail && avail > 0) inner.style.transform = 'scaleX(' + (avail / inner.scrollWidth) + ')';
                }
            });
        }
        setInterval(autoScaleTeamNames, 1000);

        // --- VONG 1: DONG HO DEM NGUOC ---
        let round1TimerInterval = null;
        let round1TimeSeconds = 0;

        function updateRound1TimerDisplay() {
            let m = Math.floor(round1TimeSeconds / 60);
            let s = round1TimeSeconds % 60;
            document.getElementById('round1-timer-text').innerText = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        }

        socket.on('timer-config-updated', (config) => {
            const cont = document.getElementById('round1-timer-container');
            const text = document.getElementById('round1-timer-text');
            cont.style.top = 'auto'; cont.style.bottom = 'auto'; cont.style.left = 'auto'; cont.style.right = 'auto'; cont.style.transform = 'none';
            let mg = '50px';
            switch (config.position) {
                case 'top-left':    cont.style.top = mg; cont.style.left = mg; break;
                case 'top-center':  cont.style.top = mg; cont.style.left = '50%'; cont.style.transform = 'translateX(-50%)'; break;
                case 'top-right':   cont.style.top = mg; cont.style.right = mg; break;
                case 'bottom-left': cont.style.bottom = mg; cont.style.left = mg; break;
                case 'bottom-center': cont.style.bottom = mg; cont.style.left = '50%'; cont.style.transform = 'translateX(-50%)'; break;
                case 'bottom-right': cont.style.bottom = mg; cont.style.right = mg; break;
            }
            text.style.fontSize = config.fontSize + 'px'; text.style.color = config.fontColor;
            if (config.strokeWidth) text.style.webkitTextStroke = config.strokeWidth + 'px ' + config.strokeColor;
            text.style.fontFamily = config.fontFamily || '';
            text.style.fontWeight = config.isBold ? 'bold' : 'normal';
            text.style.fontStyle = config.isItalic ? 'italic' : 'normal';
            text.style.textDecoration = config.isUnderline ? 'underline' : 'none';
        });

        socket.on('timer-action', (action) => {
            const cont = document.getElementById('round1-timer-container');
            if (action.type === 'SET_TIME') {
                round1TimeSeconds = action.seconds; updateRound1TimerDisplay(); cont.style.display = 'block';
            } else if (action.type === 'PLAY') {
                cont.style.display = 'block';
                if (!round1TimerInterval) {
                    round1TimerInterval = setInterval(() => {
                        if (round1TimeSeconds > 0) { round1TimeSeconds--; updateRound1TimerDisplay(); }
                        else { clearInterval(round1TimerInterval); round1TimerInterval = null; }
                    }, 1000);
                }
            } else if (action.type === 'PAUSE') {
                if (round1TimerInterval) { clearInterval(round1TimerInterval); round1TimerInterval = null; }
            } else if (action.type === 'RESET') {
                if (round1TimerInterval) { clearInterval(round1TimerInterval); round1TimerInterval = null; }
                cont.style.display = 'none';
            }
        });
    