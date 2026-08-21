# Complete List: updateState Emissions & Triggers

## Overview
This document maps ALL locations where `updateState` is emitted or broadcasted to clients in the Econova Show application, along with what triggers each emission.

---

## SERVER-SIDE ARCHITECTURE

### Anti-Cheat Override Layer (Lines 35-73)
**File:** `server.js`  
**Purpose:** Custom io.emit wrapper that scrubs sensitive data before broadcasting based on client type

```javascript
// Lines 35-73: Overrides io.emit to send different payloads:
- isFullStateClient (Admin, screen, overlay, scoreboard) → Full gameState
- isMcClient → MC payload (answers removed for locked questions)
- Others (Contestants) → Safe state (all answers removed)
```

---

## DIRECT io.emit('updateState', gameState) EMISSIONS

| # | Line | Trigger | Handler | Purpose |
|---|------|---------|---------|---------|
| 1 | 365 | External gameState.json file change | `chokidar.watch()` | File watcher detects external state changes (e.g., from tests) |
| 2 | 503 | New client connects | `io.on('connection')` | Send initial state to newly connected client |
| 3 | 509 | Client requests state | `socket.on('get-state')` | Client calls `socket.emit('get-state')` |
| 4 | 519 | Admin opens/closes room | `socket.on('toggleRoom')` | Sets `isRoomOpen`, `roomPIN` |
| 5 | 550 | Admin updates team names | `socket.on('setTeamNames')` | Sets `teams[].name`, `teams[].school` |
| 6 | 560 | Admin toggles hope star | `socket.on('toggleHopeStar')` | Sets `currentQuestion.isHopeStar` |
| 7 | 571 | Admin forces team turn | `socket.on('forceTurn')` | Sets `forcedTeamId`, reorders `turnOrder` |
| 8 | 401 | Admin updates score | `updateTeamScore()` function | Updates team score and scoreLog |
| 9 | 603 | Admin sets single question | `socket.on('setQuestion')` | Sets `currentQuestion.active=true` (Mode 1) |
| 10a | 655 | Admin locks package (Mode 2/3) | `socket.on('lockPackage')` | Sets `lockedPackage`, `currentQuestion` |
| 10b | 676 | Admin locks package (duplicate emit) | `socket.on('lockPackage')` | Same handler, called twice |
| 11a | 695 | Admin cancels package | `socket.on('nextQuestionInPackage')` | `data.cancel=true` clears locked package |
| 11b | 703 | Admin reveals hidden question | `socket.on('nextQuestionInPackage')` | `data.revealOnly=true` |
| 11c | 718 | Admin moves to next question | `socket.on('nextQuestionInPackage')` | Increments `currentIndex` |
| 11d | 731 | End of package reached | `socket.on('nextQuestionInPackage')` | Clears `lockedPackage` |
| 12 | 743 | Admin syncs pending package | `socket.on('syncPendingPackage')` | Sets `pendingPackage` |
| 13 | 749 | Admin selects question bank | `socket.on('setActiveBankSlot')` | Sets `activeBankSlot` |
| 14 | 762 | Admin marks main team correct | `socket.on('correctMainTeam')` | Updates score, resets hope star |
| 15 | 810 | Admin opens buzzer (5s) | `socket.on('startBuzzer')` | Opens buzzer after main team wrong |
| 16 | 839 | Admin marks buzzed team correct | `socket.on('correctBuzzedTeam')` | Updates buzzed team + score |
| 17 | 876 | Admin marks buzzed team wrong | `socket.on('wrongBuzzedTeam')` | Penalizes buzzed team -50% points |
| 18 | 912 | Admin closes question | `socket.on('closeQuestion')` | Closes Q, increments turnStats |
| 19 | 928 | Admin edits active question | `socket.on('editCurrentQuestion')` | Updates Q text/answer mid-play |
| 20 | 935 | Admin undoes score change | `socket.on('undoScore')` | Reverts score via scoreLog |
| 21 | 945 | Admin updates team avatar settings | `socket.on('updateTeamAvatarSettings')` | Sets avatarSize, avatarOverlap, etc. |
| 22 | 954 | Admin updates all avatar settings | `socket.on('updateAllAvatarSettings')` | Applies to all teams |
| 23 | 975 | Admin finishes team's turn | `socket.on('finishTurn')` | Removes team from turnOrder |
| 24 | 1004 | Admin finishes specific team's turn | `socket.on('finishTurnForTeam')` | Removes specific team |
| 25 | 1024 | Admin updates settings | `socket.on('updateSettings')` | Updates theme, brightness, scale, etc. |
| 26 | 1057 | Admin manually sorts turn order | `socket.on('forceUpdateTurnOrder')` | Re-sorts by score |
| 27 | 1071 | Admin changes round | `socket.on('change-round')` | Resets turnStats, regenerates turnOrder |
| 28 | 1318 | Admin resets entire game | `socket.on('resetGame')` | Clears scores, questions, state |
| 29 | 1356 | Admin changes team count | `socket.on('changeTeamCount')` | Resizes teams array, resets game |
| 30 | 1373 | Contestant claims team | `socket.on('claimTeam')` | Sets `claimedTeams[teamId]` |
| 31a | 1417 | Contestant buzzes (no delay) | `socket.on('buzz')` | Immediate buzzer with no delay |
| 31b | 1441 | Contestant buzzes (after delay) | `socket.on('buzz')` - setTimeout callback | After `buzzerDelayMs` timeout |
| 31c | 1445 | Contestant buzzes (other buzzes tracked) | `socket.on('buzz')` | Updates `buzzTimes` for display |
| 32 | 1451 | Client disconnects | `socket.on('disconnect')` | Removes claimed team |
| 33 | 1481 | Anti-cheat violation reported | `socket.on('antiCheatViolation')` | Updates violations, bans if threshold |
| 34 | 1501 | Admin unbans team | `socket.on('unbanTeam')` | Removes from `bannedTeams` |
| 35a | 1519 | Admin shows grid on overlay | `socket.on('showOverlayGrid')` | Sets `isGridVisibleOnOverlay=true` |
| 35b | 1523 | Admin hides grid on overlay | `socket.on('hideOverlayGrid')` | Sets `isGridVisibleOnOverlay=false` |
| 36 | 1538 | Admin toggles overall scoreboard | `socket.on('toggleOverallScoreboard')` | Sets `showOverallScoreboard` |
| 37 | 1551 | Admin uploads scoreboard background | `socket.on('updateScoreboardBg')` | Saves image, sets path in state |
| 38 | 1565 | Admin uploads team avatar | `socket.on('updateTeamAvatar')` | Saves avatar, updates timestamp |
| 39 | 1576 | Admin sets question counts | `socket.on('setQuestionCount')` | Sets {10: X, 20: Y, 40: Z} |

**Total: 39 unique socket.on handlers that emit updateState**

---

## CLIENT-SIDE LISTENERS

### screen.html
- **File Path:** `public/screen.html`
- **Line:** 968
- **Handler:** `socket.on('updateState', (state) => { ... })`
- **Response:**
  - Validates state
  - Calls `applyVisibility()` to show/hide elements based on theme
  - Calls `updateState(state)` to process new game state
  - Updates display elements with new values

### overlay.html  
- **File Path:** `public/overlay.html`
- **Line:** 819
- **Handler:** `socket.on('updateState', (state) => { ... })`
- **Response:**
  - Similar to screen.html
  - Handles overlay-specific rendering

---

## ADMIN SETTINGS CHANGES (From admin.html)

These are triggered via socket.on('updateSettings') handler:

```javascript
// Socket listener in server.js Line 1014
socket.on('updateSettings', (newSettings) => {
    gameState.settings = { ...gameState.settings, ...newSettings };
    // Handles theme, brightness, scale, avatar settings, turnOrderRule, etc.
    io.emit('updateState', gameState);
});
```

**Admin.html likely emits with fields like:**
- `theme`: 'default', 'ascend_2026', 'v3'
- `brightness`: 0-200
- `scale`: 50-200
- `avatarSize`: number
- `avatarOverlap`: number
- `teamCount`: 2-6
- `questionsPerTeam`: number
- `questionSelectionMode`: 1-3
- `mode2Rows`: number
- `turnOrderRule`: 'mode_asc' | 'mode_desc' | 'mode_order'

---

## PATTERNS & CATEGORIES

### Admin Panel Interactions (Lines ~520-1100)
- Team management (names, avatars, counts)
- Question management (set, lock, next, close, edit)
- Score management (correct/wrong, undo, manual update)
- Settings changes (theme, display settings)
- Turn management (force, finish, reorder)
- Buzzer control (start, correct, wrong)
- Grid/Overlay display (show/hide)

### Contestant Interactions (Lines ~1370-1450)
- Team claim
- Buzzer press
- Disconnect

### System Events (Lines ~365-525)
- File watcher changes
- New connections
- State requests
- Room open/close

### Media Updates (Lines ~1530-1580)
- Avatar uploads
- Background uploads
- Question count changes

---

## WHAT DOES NOT EMIT updateState

These use separate event emissions:
- **Videos:** `playVideo`, `closeVideo`, `videoSync`, `videoPlayState`
- **Audio:** `playSound` (separate event)
- **Timer:** `timer-config-updated`, `timer-action`, `startCountdown`
- **PPT:** `ppt-status`, `ppt-thumbnails-ready`
- **Misc:** `runV3Anim`, `toggleQRCode`, `serverIPs`

---

## File Locations Summary

**Server Emissions:** 
- `server.js` Lines 35-1576 (39 different handlers)

**Client Listeners:**
- `public/screen.html` Line 968
- `public/overlay.html` Line 819

**Admin Interface:**
- `public/admin.html` (sends updateSettings via socket.emit)

---

## HTTP Endpoints vs WebSocket

### No HTTP POST/PUT Endpoints for updateState
The application uses **socket.io exclusively** for state updates. No REST endpoints trigger `updateState` directly.

However, these REST endpoints modify files that may trigger file watcher:
- `POST /api/questions/:setId` - Saves question set (doesn't trigger updateState)
- File system watchers watch:
  - `gameState.json` → Triggers updateState if changed

---

## State Update Flow Diagram

```
User Action (Admin/Contestant)
    ↓
socket.emit('event', data) from client
    ↓
server.js socket.on('event') handler
    ↓
Modify gameState object
    ↓
io.emit('updateState', gameState)
    ↓
Anti-cheat override layer (scrubs data)
    ↓
socket.emit('updateState', scrubbed_data) to each connected client
    ↓
Client receives in:
  - screen.html line 968
  - overlay.html line 819
    ↓
applyVisibility() renders changes
```

---

## Key Findings for Theme/Display Issues

The `updateState` event is responsible for:
1. **Sending current game state** to all clients
2. **Triggering visibility updates** via `applyVisibility()` in screen.html
3. **Applying theme-specific CSS** based on `settings.theme`
4. **Updating all UI elements** (scores, names, questions, grid)

**Theme 1 (DEFAULT), Theme 2 (ASCEND_2026), Theme 3 (V3) visibility issues** are controlled by `applyVisibility()` logic in screen.html which runs **AFTER** updateState is received, not by updateState emission itself.

---

## Frequency Analysis

**High Frequency Emissions (triggered constantly during gameplay):**
- Buzzer events (Line 1417, 1441, 1445)
- Question state changes (Lines 603, 655, 695, 703, 718, 731)
- Score updates (Lines 762, 839, 876, 935)

**Medium Frequency Emissions (during setup/admin changes):**
- Settings updates (Line 1024)
- Team management (Lines 550, 945, 954)
- Turn management (Lines 975, 1004, 1057)

**Low Frequency Emissions (one-time events):**
- Room open/close (Line 519)
- Game reset (Line 1318)
- Round changes (Line 1071)
- Team count changes (Line 1356)

