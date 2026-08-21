# STATE MACHINE BUGS - Line-by-Line Analysis

**Focus:** Exact issues in current implementation with proposed fixes

---

## BUG #1: Default Theme Idle State Shows Empty Space

**File:** screen.html  
**Lines:** 1338-1347  
**Severity:** MEDIUM (Visual glitch, not functional error)

### Current Code:
```javascript
// Line 1338-1347: DEFAULT theme idle state
if (defQArea) defQArea.style.display = 'flex';
if (defQBox) defQBox.style.display = 'none';
if (qGridNode) qGridNode.style.display = 'none';
```

### Problem:
When idle (no package, no question):
- `defQArea` (question-area container) set to `display: flex` ← **WRONG**
- `defQBox` (question-box content) set to `display: none` ← **CORRECT**
- Result: Empty flex container visible as white space ❌

### What Should Happen:
```
mState = 0 (IDLE):
  - defQArea should be `display: none` (hide container)
  - defQBox should be `display: none` (hide content)
  - Show only scoreboard
  
mState = 1 (GRID):
  - defQArea should be `display: flex` (show container)
  - defQBox should be `display: none` (hide content)
  - qGrid should be `display: flex` (show grid)
  
mState = 2 (QUESTION):
  - defQArea should be `display: flex` (show container)
  - defQBox should be `display: flex` (show content)
  - qGrid should be `display: none` (hide grid)
```

### Proposed Fix:
Replace lines 1338-1347 with mState-based logic:
```javascript
if (theme === 'default') {
    if (mState === 0) {
        // IDLE: Hide all question graphics
        if (defQArea) defQArea.style.display = 'none';
        if (defQBox) defQBox.style.display = 'none';
        if (qGridNode) qGridNode.style.display = 'none';
        if (defScoreboard) defScoreboard.style.display = 'flex';
    } else if (mState === 1) {
        // GRID: Show grid, hide question
        if (defQArea) defQArea.style.display = 'flex';
        if (defQBox) defQBox.style.display = 'none';
        if (qGridNode) qGridNode.style.display = 'flex';
        if (defScoreboard) defScoreboard.style.display = 'none';
    } else if (mState === 2) {
        // QUESTION: Show question, hide grid
        if (defQArea) defQArea.style.display = 'flex';
        if (defQBox) defQBox.style.display = 'flex';
        if (qGridNode) qGridNode.style.display = 'none';
        if (defScoreboard) defScoreboard.style.display = 'none';
    }
}
```

---

## BUG #2: Ascend 2026 Theme Grid/Question Overlap

**File:** screen.html  
**Lines:** 1475-1510  
**Severity:** HIGH (Graphics overlap, visual confusion)

### Current Code:
```javascript
// Line 1475-1510: ASCEND theme logic
if (theme === 'ascend_2026') {
    if (v3Wrapper) v3Wrapper.style.display = 'none';
    if (v3Master) v3Master.style.display = 'none';
    if (ascendFrame) ascendFrame.style.display = 'flex';
    if (defScoreboard) defScoreboard.style.display = 'none';
    if (defQArea) defQArea.style.display = 'none';
    if (defQBox) defQBox.style.display = 'none';
    if (ascendQArea) ascendQArea.style.display = 'flex';  // ← ALWAYS flex!
    if (qGridNode) qGridNode.style.display = 'none';
    if (ascendQBox) ascendQBox.style.display = 'none';

    if (showGrid) {
        if (qGridNode) qGridNode.style.display = 'flex';
        if (ascendQArea) ascendQArea.style.display = 'none';  // ← Changes to none
        return;
    }

    if (showQuestion) {
        if (ascendQBox) ascendQBox.style.display = 'flex';
        if (ascendQArea) ascendQArea.style.display = 'flex';
        return;
    }

    if (ascendQArea) ascendQArea.style.display = 'none';  // ← Changes to none
    if (ascendQBox) ascendQBox.style.display = 'none';
    return;
}
```

### Problems:

1. **Contradictory assignments:**
   - Line 1483: `ascendQArea` set to `'flex'`
   - Line 1486: `ascendQArea` set to `'none'` if showGrid
   - Line 1510: `ascendQArea` set to `'none'` again in final state

2. **Grid + Question can both be visible:**
   - Line 1486: `qGridNode` set to `'flex'`
   - Line 1487: `ascendQArea` set to `'none'` ← But what if question was already showing?
   - Not clearing `ascendQBox` in grid phase

3. **CSS !important still blocks:**
   - CSS rule (line 184): `body.ascend_2026 .default-only { display: none !important; }`
   - `defScoreboard` has class `.default-only`
   - Line 1482: `defScoreboard.style.display = 'none'` is redundant, CSS already hides it
   - But trying to show it (if needed) would fail due to `!important`

4. **Unclear priority in idle state:**
   - Lines 1509-1511: Both `ascendQArea` and `ascendQBox` set to `'none'`
   - But `ascendFrame` still visible
   - Should frame be hidden too?

### What Should Happen:

**mState = 0 (IDLE):**
```
Hide everything:
- ascendFrame: display: none (or show, depending on design)
- ascendQArea: display: none
- ascendQBox: display: none
- qGrid: display: none
```

**mState = 1 (GRID):**
```
Show grid only:
- ascendFrame: display: flex
- ascendQArea: display: none ← CRITICAL: Must hide
- ascendQBox: display: none ← CRITICAL: Must hide
- qGrid: display: flex ← Show grid
```

**mState = 2 (QUESTION):**
```
Show question only:
- ascendFrame: display: flex
- ascendQArea: display: flex ← CRITICAL: Must show
- ascendQBox: display: flex ← CRITICAL: Must show
- qGrid: display: none ← CRITICAL: Must hide
```

### Proposed Fix:

```javascript
if (theme === 'ascend_2026') {
    // Always hide non-ascend themes
    if (v3Wrapper) v3Wrapper.style.display = 'none';
    if (v3Master) v3Master.style.display = 'none';
    if (defScoreboard) defScoreboard.style.display = 'none';
    if (defQArea) defQArea.style.display = 'none';
    if (defQBox) defQBox.style.display = 'none';
    
    if (mState === 0) {
        // IDLE: Hide all Ascend graphics
        if (ascendFrame) ascendFrame.style.display = 'none';
        if (ascendQArea) ascendQArea.style.display = 'none';
        if (ascendQBox) ascendQBox.style.display = 'none';
        if (qGridNode) qGridNode.style.display = 'none';
    } else if (mState === 1) {
        // GRID: Show frame + grid only
        if (ascendFrame) ascendFrame.style.display = 'flex';
        if (ascendQArea) ascendQArea.style.display = 'none';  // ← MUST be none
        if (ascendQBox) ascendQBox.style.display = 'none';    // ← MUST be none
        if (qGridNode) qGridNode.style.display = 'flex';
    } else if (mState === 2) {
        // QUESTION: Show frame + question only
        if (ascendFrame) ascendFrame.style.display = 'flex';
        if (ascendQArea) ascendQArea.style.display = 'flex';  // ← MUST be flex
        if (ascendQBox) ascendQBox.style.display = 'flex';    // ← MUST be flex
        if (qGridNode) qGridNode.style.display = 'none';      // ← MUST be none
    }
}
```

---

## BUG #3: V3 Theme Always Visible (Blackout Broken)

**File:** screen.html  
**Lines:** 1448-1474  
**Severity:** HIGH (V3 graphics always visible even during idle)

### Current Code:
```javascript
// Line 1448-1474: V3 theme logic
if (theme === 'v3') {
    // Hide all other themes
    if (ascendFrame) ascendFrame.style.display = 'none';
    if (defScoreboard) defScoreboard.style.display = 'none';
    if (defQArea) defQArea.style.display = 'none';
    if (ascendQArea) ascendQArea.style.display = 'none';
    if (defQBox) defQBox.style.display = 'none';
    if (ascendQBox) ascendQBox.style.display = 'none';
    if (qGridNode) qGridNode.style.display = 'none';
    
    // Show V3 wrapper ← ALWAYS shown!
    if (v3Wrapper) {
        v3Wrapper.style.display = 'block';      // ← Sets to block unconditionally
        v3Wrapper.style.visibility = 'visible'; // ← Sets to visible unconditionally
        v3Wrapper.style.opacity = '1';          // ← Sets to 1 unconditionally
    }
    if (v3Master) v3Master.style.display = 'block';  // ← Sets to block unconditionally
    
    // Handle V3 phases
    if (showGrid || showQuestion) {
        if (typeof renderV3 === 'function') renderV3(state);
    } else {
        // Idle state - show V3 scoreboard ← SAME CODE!
        if (typeof renderV3 === 'function') renderV3(state);
    }
    return;  // ← Returns without checking if should be visible
}
```

### Problems:

1. **V3 wrapper ALWAYS visible:**
   - Lines 1452-1457 set v3Wrapper to `display: block`, `visibility: visible`, `opacity: 1`
   - No condition to hide it
   - Result: V3 graphics always on screen, even when should be hidden

2. **renderV3 called regardless of state:**
   - Line 1468: `if (showGrid || showQuestion) { renderV3(state); }`
   - Line 1471: `else { renderV3(state); }` ← SAME CODE!
   - `renderV3(state)` is called in BOTH branches
   - This defeats the purpose of checking state

3. **No mState concept:**
   - Code uses `showGrid` and `showQuestion` booleans
   - Should use explicit mState values for clarity

4. **Race condition with renderV3:**
   - renderV3 may not be defined if called before v3-script DOMContentLoaded
   - But code proceeds anyway without error handling

### What Should Happen:

**mState = 0 (IDLE):**
```
Hide V3 completely:
- v3Wrapper: display: none, opacity: 0, visibility: hidden
- v3Master: display: none
- Do NOT call renderV3()
```

**mState = 1 (GRID):**
```
Show V3 grid:
- v3Wrapper: display: block, opacity: 1, visibility: visible
- v3Master: display: block
- Call renderV3(state) to render grid
```

**mState = 2 (QUESTION):**
```
Show V3 question:
- v3Wrapper: display: block, opacity: 1, visibility: visible
- v3Master: display: block
- Call renderV3(state) to render question
```

### Proposed Fix:

```javascript
if (theme === 'v3') {
    // Always hide non-V3 themes
    if (ascendFrame) ascendFrame.style.display = 'none';
    if (defScoreboard) defScoreboard.style.display = 'none';
    if (defQArea) defQArea.style.display = 'none';
    if (ascendQArea) ascendQArea.style.display = 'none';
    if (defQBox) defQBox.style.display = 'none';
    if (ascendQBox) ascendQBox.style.display = 'none';
    if (qGridNode) qGridNode.style.display = 'none';
    
    if (mState === 0) {
        // IDLE: Hide V3 wrapper completely
        if (v3Wrapper) {
            v3Wrapper.style.display = 'none';
            v3Wrapper.style.visibility = 'hidden';
            v3Wrapper.style.opacity = '0';
        }
        if (v3Master) v3Master.style.display = 'none';
    } else {
        // GRID or QUESTION: Show V3 wrapper and render
        if (v3Wrapper) {
            v3Wrapper.style.display = 'block';
            v3Wrapper.style.visibility = 'visible';
            v3Wrapper.style.opacity = '1';
        }
        if (v3Master) v3Master.style.display = 'block';
        
        // Call renderV3 to handle grid/question rendering
        if (typeof renderV3 === 'function') {
            renderV3(state);
        } else {
            console.warn('[V3] renderV3 not defined yet');
        }
    }
    return;
}
```

---

## BUG #4: Overlay.html Round 1 Logic Too Aggressive

**File:** overlay.html  
**Lines:** 843-850  
**Severity:** MEDIUM (Overlay hidden during Round 1, but should respect isGridVisibleOnOverlay)

### Current Code:
```javascript
// Line 843-850: Round 1 handling
const mainContainer = document.getElementById('main-container');
if (mainContainer) {
    mainContainer.style.visibility = state.activeRound === 1 ? 'hidden' : 'visible';
    mainContainer.style.opacity = state.activeRound === 1 ? '0' : '1';
}
const round1Timer = document.getElementById('round1-timer-container');
if (round1Timer) {
    round1Timer.style.opacity = state.activeRound === 1 ? '1' : '0';
    round1Timer.style.visibility = state.activeRound === 1 ? 'visible' : 'hidden';
}
```

### Problems:

1. **Ignores isGridVisibleOnOverlay:**
   - When `state.activeRound === 1`, mainContainer is ALWAYS hidden
   - But if `state.isGridVisibleOnOverlay === true`, overlay should show grid
   - Current code doesn't check this flag

2. **Different logic than screen.html:**
   - screen.html (line 1437): `showGrid = Boolean(state.isGridVisibleOnOverlay || state.lockedPackage || state.pendingPackage)`
   - overlay.html: Ignores isGridVisibleOnOverlay during Round 1
   - Inconsistency between files

3. **Violates Mode 1 Exception Rule:**
   - User requirement: "overlay.html MUST go to mState = 0 (Hide all graphics) UNLESS state.isGridVisibleOnOverlay is true"
   - Current code: Always hides during Round 1, regardless of isGridVisibleOnOverlay

### What Should Happen:

**Round 1 (activeRound === 1):**
```
if (state.isGridVisibleOnOverlay) {
    mState = 1 (GRID)  ← Show overlay grid
} else {
    mState = 0 (IDLE)  ← Hide overlay
}
```

**Round 2+ (activeRound !== 1):**
```
Use standard mState calculation based on package/question state
```

### Proposed Fix:

```javascript
// Round 1 special handling
if (state.activeRound === 1) {
    if (state.isGridVisibleOnOverlay) {
        // Round 1 + grid visible: mState = 1 (GRID)
        mState = 1;
    } else {
        // Round 1 + grid hidden: mState = 0 (IDLE)
        mState = 0;
    }
} else {
    // Round 2+: Use standard calculation
    mState = calculateMState(state, true);  // true = isOverlayApp
}

// Apply visibility based on mState
if (mainContainer) {
    if (mState === 0) {
        mainContainer.style.visibility = 'hidden';
        mainContainer.style.opacity = '0';
    } else {
        mainContainer.style.visibility = 'visible';
        mainContainer.style.opacity = '1';
    }
}
```

---

## BUG #5: No Initial State on Page Load

**File:** Both screen.html and overlay.html  
**Lines:** Start of updateState handler  
**Severity:** HIGH (Screen blank until first socket event)

### Current Behavior:
1. Page loads
2. HTML renders but all graphics hidden (display: none)
3. Socket connection established
4. Waiting for first `updateState` event from server
5. **If socket event doesn't arrive**: Screen remains blank
6. **If socket event slow**: User sees blank screen briefly

### Problem:
No initial state set. All visibility logic is in `socket.on('updateState')` handler.

### What Should Happen:
1. Page loads
2. Set default mState = 0 (IDLE) before socket connection
3. Apply default visibility (show scoreboard/background only)
4. Socket connects
5. First updateState event updates mState and visibility
6. No blank screen, graceful degradation if socket fails

### Proposed Solution:

**Add before socket event handler (line ~960 in screen.html):**
```javascript
// Initialize default state
let mState = 0;  // Default: IDLE
let currentTheme = 'default';

// Apply initial visibility
function applyInitialVisibility() {
    // Hide all graphics initially
    document.querySelectorAll('[id*="QBox"], [id*="QArea"], [id*="Frame"], #v3-wrapper')
        .forEach(el => el.style.display = 'none');
    
    // Show scoreboard only
    const scoreboard = document.getElementById('defaultScoreboard');
    if (scoreboard) scoreboard.style.display = 'flex';
}

// Call before socket connection
applyInitialVisibility();
```

---

## BUG #6: applyVisibility() Called at Wrong Times

**File:** screen.html  
**Lines:** 1606, 1602  
**Severity:** MEDIUM (Possible redundant calls or missed calls)

### Current Code:
```javascript
// Line 1606: Inside updateState handler
applyVisibility(state);

// ALSO Line 1602 (earlier in code):
if (window.currentState && window.currentState.currentQuestion && window.currentState.currentQuestion.active)
    applyVisibility(window.currentState);
```

### Problems:

1. **Double calls possible:**
   - applyVisibility might be called twice in one updateState event
   - Can cause unnecessary rendering/animation

2. **Unclear when it's called:**
   - Called inside setTimeout/animation callback (line 1602)
   - Called at end of handler (line 1606)
   - Hard to trace when visibility updates actually happen

3. **No mState parameter:**
   - applyVisibility(state) receives full state object
   - Should receive mState as explicit parameter

### Proposed Fix:

```javascript
socket.on('updateState', (state) => {
    // 1. Calculate mState once at top of handler
    let mState = calculateMState(state, false);  // false = isScreenApp
    
    // 2. Store for later use
    window.currentMState = mState;
    window.currentState = state;
    
    // 3. Apply visibility once at end of handler
    applyVisibility(state, mState);  // Pass mState explicitly
    
    // 4. No intermediate calls needed if mState handles all logic
});
```

---

## BUG #7: CSS !important Blocks JavaScript

**File:** screen.html  
**Lines:** 111, 184-186  
**Severity:** MEDIUM (Prevents dynamic theme switching)

### Current CSS Rules:
```css
/* Line 111 */
body.default .ascend-only { display: none !important; }

/* Lines 184-186 */
body.ascend_2026 .default-only { display: none !important; }
body.v3 .default-only { display: none !important; }
body.v3 .ascend-only { display: none !important; }
```

### Problem:
When JavaScript tries to show an element:
```javascript
defScoreboard.style.display = 'flex';  // But CSS has display: none !important
// Result: CSS wins, element stays hidden
```

### Elements Affected:

| Element | Classes | Affected by |
|---------|---------|-------------|
| defaultScoreboard | `.default-only` | ASCEND, V3 rules |
| defaultQBox | `.default-only` | ASCEND, V3 rules |
| defaultQArea | `.default-only` | ASCEND, V3 rules |
| ascendFrame | `.ascend-only` | DEFAULT, V3 rules |
| ascendQBox | `.ascend-only` | DEFAULT, V3 rules |
| ascendQArea | `.ascend-only` | DEFAULT, V3 rules |

### Options to Fix:

**Option 1: Remove !important from CSS (Prefer)**
```css
body.default .ascend-only { display: none; }  /* No !important */
body.ascend_2026 .default-only { display: none; }  /* No !important */
```
Then JavaScript can override with `display: flex` or `display: block`.

**Option 2: Use !important in JavaScript**
```javascript
element.style.setProperty('display', 'flex', 'important');
```
But this is verbose and fragile.

**Option 3: Use different CSS approach**
```css
/* Instead of display: none !important */
/* Use transform or clip-path to hide */
body.default .ascend-only {
    transform: scale(0);
    visibility: hidden;
    pointer-events: none;
}
```

### Proposed Fix:
**Option 1 (Recommended):** Remove `!important` from CSS rules (lines 111, 184-186).

---

## SUMMARY: Bug Impact Matrix

| Bug # | Title | Impact | File | Lines | mState Fix | Priority |
|-------|-------|--------|------|-------|-----------|----------|
| 1 | Default idle empty space | Visual glitch | screen.html | 1338-1347 | mState === 0 → hide defQArea | HIGH |
| 2 | Ascend grid/question overlap | Graphics confuse | screen.html | 1475-1510 | mState based logic | CRITICAL |
| 3 | V3 always visible | Blackout broken | screen.html | 1448-1474 | mState === 0 → hide v3Wrapper | CRITICAL |
| 4 | Overlay Round 1 too aggressive | Ignores isGridVisibleOnOverlay | overlay.html | 843-850 | Check isGridVisibleOnOverlay | MEDIUM |
| 5 | No initial state | Blank screen on load | Both | ~960 | Initialize mState = 0 | MEDIUM |
| 6 | Multiple applyVisibility calls | Redundant rendering | screen.html | 1602, 1606 | Call once with mState | LOW |
| 7 | CSS !important blocks JS | Dynamic switching fails | screen.html | 111, 184-186 | Remove !important | MEDIUM |

