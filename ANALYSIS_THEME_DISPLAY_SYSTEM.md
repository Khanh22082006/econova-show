# THOROUGH ANALYSIS: ECONOVA SHOW THEME DISPLAY SYSTEM
**Analysis Date:** 2026-06-24  
**Scope:** Theme initialization, execution flows, element visibility chains, dependencies, and critical gaps

---

## 1. ACTUAL CODE EXECUTION FLOW ANALYSIS

### 1.1 APP INITIALIZATION (On Page Load)

**Entry Point:** [screen.html](screen.html) lines 1-1 → loads scripts in order:
1. `shared.js` (line ~920 in screen.html)
2. `app.js` (line ~921 in screen.html)

**Initial State:** 
- `body` element has NO theme class initially (line 957 in screen.html)
- All theme-specific elements exist in HTML but are hidden via CSS `display: none`
- `currentTheme = 'default'` (set in app.js line 4)
- Socket connection established (line 927 in screen.html)

**First Event Listener Ready:** Socket.on('updateState') listener registered in screen.html around line 995

---

### 1.2 APP OPENS WITH DEFAULT THEME

**Trigger:** Socket emits `updateState` event with `state.settings.theme = 'default'`

**Execution Path:**

```
updateState event fires
  ↓
screen.html line 1032: console.log triggered
  ↓
Line 1037-1047: Font settings applied
  ↓
Line 1049: currentTheme = 'default'
  ↓
Line 1050: document.body.className = 'default main-screen'
  ↓
Line 1051: brightness filter applied
  ↓
Lines 1070-1118: Scoreboard HTML rendered
  ↓
Lines 1120-1280: Grid rendering logic
  ↓
Lines 1282-1347: Question logic and applyVisibility() called
```

**Result:**
- Body class is set to `.default main-screen` (line 1050)
- CSS rule `body.default .ascend-only { display: none !important; }` (line 111) hides ASCEND elements
- `applyVisibility(state)` called (line 1341)

### 1.3 APP OPENS WITH V3 THEME

**Execution Path:**

```
updateState event fires with state.settings.theme = 'v3'
  ↓
Line 1049: currentTheme = 'v3'
  ↓
Line 1050: document.body.className = 'v3 main-screen'
  ↓
Lines 1070-1280: Grid/Question rendering (standard, non-V3 elements)
  ↓
Line 1341: applyVisibility(state) called
  ↓
applyVisibility() at line 1291:
    - Detects theme === 'v3'
    - Hides ascendFrame, defScoreboard, defQArea, etc.
    - Sets v3Wrapper.style.display = 'block' (line 1303)
    - Calls typeof renderV3 === 'function' ? renderV3(state) (line 1308)
```

**CRITICAL GAP #1:** Code checks `if (typeof renderV3 === 'function')` but `renderV3()` is defined INSIDE the DOMContentLoaded event listener in the v3-script block (line ~2000), meaning:
- If updateState fires BEFORE v3-script DOMContentLoaded completes, renderV3 is undefined
- renderV3 call may silently fail if timing is wrong

### 1.4 APP OPENS WITH ASCEND_2026 THEME

**Execution Path:**

```
updateState event fires with state.settings.theme = 'ascend_2026'
  ↓
Line 1049: currentTheme = 'ascend_2026'
  ↓
Line 1050: document.body.className = 'ascend_2026 main-screen'
  ↓
CSS rule body.ascend_2026 .default-only { display: none !important; } (line 184) hides default elements
  ↓
Lines 1070-1280: Grid/Question rendering
  ↓
Line 1341: applyVisibility(state) called
  ↓
applyVisibility() at line 1320:
    - Detects theme === 'ascend_2026'
    - Sets ascendFrame.style.display = 'flex' (line 1325)
    - Hides defaultScoreboard (line 1326)
```

**CRITICAL GAP #2:** `renderAscend()` is referenced in app.js line 24 but **NEVER DEFINED** anywhere in the codebase. This means ASCEND theme has no render function.

---

## 2. ELEMENT VISIBILITY CHAIN ANALYSIS

### 2.1 INITIAL LOAD (Before First updateState)

**State:** No currentQuestion, no lockedPackage, no pendingPackage

| Element | CSS Display | JS Display | Visible? |
|---------|-------------|-----------|----------|
| main-container | Flexbox | (not set) | YES |
| bg-grid | Initially hidden in CSS | (not set) | NO (CSS display: none via grid-drift animation rules) |
| defaultScoreboard | (not set) | (not set) | DEPENDS ON BODY CLASS |
| ascendFrame | (not set) | (not set) | DEPENDS ON BODY CLASS |
| qGrid | display: none (line 1243) | (set to 'none' initially) | NO |
| defaultQuestionArea | style="display: none" (HTML line 860) | (not set) | NO |
| ascendQuestionArea | (not set) | (not set) | DEPENDS ON BODY CLASS |

**Before any applyVisibility() call:**
- Elements are NOT automatically displayed
- Visibility depends entirely on applyVisibility() being called from updateState

**CRITICAL GAP #3:** If socket.io connection fails or updateState is never emitted:
- Screen shows blank/minimal content
- No "idle scoreboard" is displayed
- User sees nothing but the background

---

### 2.2 GRID PHASE (lockedPackage OR pendingPackage exists, no currentQuestion.active)

**Code Path:** updateState → lines 1070-1280 → applyVisibility() called

**For DEFAULT theme:**

```
applyVisibility() execution (line 1291-1347):
  showGrid = Boolean(state.isGridVisibleOnOverlay || state.lockedPackage || state.pendingPackage)
  showQuestion = Boolean(q && q.active)
  
  Line 1318-1342: if (theme === 'default'):
    defScoreboard.style.display = 'flex'  ← SHOWS scoreboard in idle
    defQArea.style.display = 'flex'       ← SHOWS question-area container
    qGridNode.style.display = 'flex'      ← IF showGrid is TRUE, SHOWS grid
    defQBox.style.display = 'none'        ← HIDES question box
```

**Element States:**

| Element | Display Value | Result |
|---------|---------------|--------|
| defaultScoreboard | 'flex' | VISIBLE at bottom |
| qGrid | 'flex' | VISIBLE in center |
| defaultQBox | 'none' | HIDDEN |
| defaultQuestionArea | 'flex' | VISIBLE (but qBox hidden inside) |

**For ASCEND_2026 theme:**

```
applyVisibility() at line 1320-1333:
  if (theme === 'ascend_2026'):
    ascendFrame.style.display = 'flex'    ← SHOWS frame
    defScoreboard.style.display = 'none'  ← HIDES default scoreboard
    defQArea.style.display = 'none'       ← HIDES default question area
    ascendQArea.style.display = 'flex'    ← SHOWS ascend question area
    qGridNode.style.display = 'flex'      ← IF showGrid is TRUE, SHOWS grid
    ascendQBox.style.display = 'none'     ← HIDES question box
```

**For V3 theme:**

```
applyVisibility() at line 1291-1318:
  if (theme === 'v3'):
    Hides ALL default and ascend elements
    Sets v3Wrapper.style.display = 'block'
    Calls renderV3(state) if exists
    renderV3() computed machine state = 1 (grid) or 2 (question)
```

---

### 2.3 QUESTION PHASE (currentQuestion.active = true)

**Code Path:** updateState → Line 1267-1281 checks if question just became active

**Special Animation Sequence (Lines 1267-1281):**

When `q.active && !window.lastActiveState && q.idx !== null && currentTheme !== 'v3'`:
- Sets window.isAnimating = true
- Adds 'selected-anim' class to grid cell for 1000ms (line 1274)
- DELAYS applyVisibility() call until 1000ms timeout (line 1279)

**For DEFAULT theme (After animation delay):**

```
applyVisibility() at line 1282-1347:
  showQuestion = true
  
  Line 1338-1341:
    defQArea.style.display = 'flex'   ← SHOWS question area
    defQBox.style.display = 'flex'    ← SHOWS question box
    qGridNode.style.display = 'none'  ← HIDES grid
```

**For ASCEND_2026 theme:**

```
Line 1333-1335:
  ascendQBox.style.display = 'flex'      ← SHOWS question box
  ascendQArea.style.display = 'flex'     ← SHOWS question area (already was)
  qGridNode.style.display = 'none'       ← HIDES grid
```

**For V3 theme:**

```
renderV3() at line 1308 determines computed machine state:
  - lockedPackage.currentIndex > 0 AND mode 2 or 3 → state = 2 (question)
  - Otherwise → state = 1 (grid)
  
triggerV3Transition(newState) called
  - Triggers SVG animations
  - Changes clip-path and opacity
  - Changes z-index layering
```

---

### 2.4 IDLE PHASE (No package, no question)

**Code Path:** updateState → applyVisibility() with showGrid=false, showQuestion=false

**For DEFAULT theme:**

```
Line 1338-1347:
  defQArea.style.display = 'flex'   ← SHOWS question area container
  defQBox.style.display = 'none'    ← HIDES question box
  defScoreboard should be set earlier
  qGridNode.style.display = 'none'  ← HIDES grid
```

**BUG #1:** In idle state, `defQArea` is set to 'flex' but `defQBox` is 'none'. This means:
- The question-area wrapper is VISIBLE
- But the qBox inside is HIDDEN
- Result: Empty question-area space visible with no content

**For ASCEND_2026 theme:**

```
Line 1337-1338:
  ascendQArea.style.display = 'none'   ← HIDES question area
  ascendQBox.style.display = 'none'    ← HIDES question box
```

**For V3 theme:**

```
renderV3() computes state = 0 (idle)
  - triggerV3Transition(0) called
  - v3Master opacity set to 0
  - v3Master.style.display = 'none'
  - Container scaled to 0.8 and fades out over 850ms
```

---

## 3. CODE DEPENDENCIES & GAPS ANALYSIS

### 3.1 Critical Function Dependencies

**Function:** `applyVisibility(state)` (line 1290)
- **Called by:** updateState event handler (line 1282, 1341)
- **Depends on:**
  - Global variable `currentTheme`
  - DOM elements: qGrid, defScoreboard, ascendFrame, etc.
  - State object: state.currentQuestion, state.lockedPackage, state.pendingPackage

**Function:** `renderV3(state)` (line ~2065 in v3-script)
- **Called by:** applyVisibility() line 1308
- **Dependencies:**
  - DOM elements: v3MasterContainer, v3-wrapper
  - Global: currentV3State, v3Transitioning, v3LockedPackageTime
  - Helper functions: renderV3Grid(), renderV3QBox(), triggerV3Transition()
- **ISSUE:** Defined inside DOMContentLoaded event listener (line ~2000)
  - May not exist if called before DOMContentLoaded fires
  - No fallback or error handling

**Function:** `renderV3Grid(state)` (line ~2080 in v3-script)
- **Called by:** renderV3() or triggerV3Transition()
- **Depends on:**
  - Calculations: genZigzagShape(), toSvgPath(), toPoly()
  - DOM queries: .a-grid-content, .s-g-cells
  - State: state.settings.questionSelectionMode, state.lockedPackage, state.playedQuestions

**Function:** `renderV3QBox(state)` (line ~2164 in v3-script)
- **Called by:** renderV3() or triggerV3Transition()
- **Depends on:**
  - DOM elements: v3MasterContainer, .o-top-bar, v3PointsArea, qTextV3, v3ActiveScore
  - Calculations: polygon clipping paths
  - State: state.teams, state.currentQuestion, state.turnOrder

### 3.2 Missing Function Definitions

**CRITICAL GAP #4:** `renderDefault()` referenced in app.js (line 24) but NEVER DEFINED
- Code structure suggests each theme should have a render function
- app.js line 24: `if (theme === 'default') { ... renderDefault() }` ← doesn't exist
- DEFAULT theme rendering happens ONLY through CSS + applyVisibility()

**CRITICAL GAP #5:** `renderAscend()` referenced in app.js (line 24) but NEVER DEFINED
- ASCEND_2026 rendering happens ONLY through CSS + applyVisibility()
- No custom rendering logic for ASCEND
- All layout changes are CSS-only

### 3.3 Function Call Guarantees

**Will renderV3 be called correctly?**

Timing issue:
```
Page loads:
  ↓
screen.html script loads (lines 925-968)
  ↓
socket.on('updateState') registered (line 995)
  ↓
DOMContentLoaded fires (v3-script line ~2000)
  ↓
renderV3 function defined
  ↓
If socket emits updateState DURING these steps:
  - BEFORE v3-script DOMContentLoaded → renderV3 undefined → applyVisibility() silently fails
  - AFTER DOMContentLoaded → renderV3 available → works
```

**Risk Level:** MEDIUM-HIGH
- Fast socket connections may trigger updateState before v3-script loads
- No error handling or fallback

**Will helper functions work?**

HTML structure check:
```
Required DOM elements for DEFAULT theme:
  ✓ defaultQBox (line 858)
  ✓ defaultQArea (line 855)
  ✓ defaultScoreboard (line 868)
  ✓ timerContainerDefault (line 863)
  ✓ qGrid (line 870)
  ✓ gh10, gh20, gh40 (grid headers)
  ✓ grid10, grid20, grid40 (grid cells)

Required DOM elements for ASCEND theme:
  ✓ ascendQBox (line 843)
  ✓ ascendQArea (line 838)
  ✓ ascendFrame (line 837)
  ✓ ascendScoreboard (line 839)
  ✓ timerContainerAscend (line 847)
  
Required DOM elements for V3 theme:
  ✓ v3-wrapper (line 1352)
  ✓ v3MasterContainer (line 1353)
  ✓ qTextV3 (line 1383)
  ✓ v3PointsArea (line 1381)
  ✓ v3ActiveScore (line 1379)
```

Result: All required elements exist in HTML ✓

---

## 4. CSS vs JAVASCRIPT CONFLICT ANALYSIS

### 4.1 CSS Display Rules (Highest Priority)

**Body class-based rules:**

| Selector | Rule | Priority |
|----------|------|----------|
| `body.default .ascend-only` | `display: none !important;` | HIGHEST |
| `body.ascend_2026 .default-only` | `display: none !important;` | HIGHEST |
| `body.v3 .default-only` | `display: none !important;` | HIGHEST |
| `body.v3 .ascend-only` | `display: none !important;` | HIGHEST |

These rules use `!important`, meaning JavaScript inline styles CANNOT override them.

**Initial HTML inline styles:**

| Element | Inline Style | Effect |
|---------|-------------|--------|
| defaultQuestionArea | `style="display: none"` | Initially hidden |
| ascendQuestionArea | (no style) | CSS determines |
| qGrid | `style="display: none"` | Initially hidden |

### 4.2 JavaScript Display Rules

**Set via:** applyVisibility() function and updateState event handler

**Conflict Examples:**

**Example 1: DEFAULT theme, idle state**
```css
/* CSS rule (line 111) */
body.default .ascend-only { display: none !important; }
/* Sets all .ascend-only elements to hidden with !important */

/* JS tries to override */
ascendFrame.style.display = 'none'; /* Redundant, CSS already hides it */
```

Result: ✓ No conflict (both agree)

**Example 2: ASCEND theme, grid phase**
```css
/* CSS rule (line 184) */
body.ascend_2026 .default-only { display: none !important; }
/* Hides defaultScoreboard, defaultQBox, etc. */

/* JS tries to show */
defScoreboard.style.display = 'flex'; /* Attempted in line 1318 */
```

Result: ✗ **CSS wins due to !important** → element stays hidden despite JS setting display: flex

**CRITICAL BUG #2:** When theme === 'ascend_2026', applyVisibility() line 1318 tries to set:
```javascript
if (defScoreboard) defScoreboard.style.display = 'flex';
```

But CSS rule `body.ascend_2026 .default-only { display: none !important; }` (line 184) wins.

The element `defaultScoreboard` has class `.default-only`, so:
- CSS: `display: none !important;`
- JS: `display: flex;`
- Result: CSS wins, element stays hidden

### 4.3 Timer Elements Conflicts

**timerContainerDefault:**
```css
body.default #timerContainerDefault {
    width: 80%; height: 8px; background: rgba(255,255,255,0.1);
    display: none;  /* Line 127 */
}

body.default #timerContainerDefault.timer-olympia-style {
    display: none;  /* Line 160 */
    width: 100%; position: absolute; top: 100%; left: 0;
    justify-content: center; z-index: 100;
}
```

JS code (line 1048-1054 in startCountdown handler):
```javascript
els.c.style.display = els.c.id === 'timerContainerDefault' ? 'flex' : 'block';
```

Result: ✓ JS can override (no !important in CSS)

---

## 5. TIMER SYSTEM ANALYSIS

### 5.1 Timer Initialization on startCountdown Event

**Event:** `socket.on('startCountdown', (seconds))`  
**Handler Location:** screen.html lines 1048-1081

**Step-by-step execution:**

```
Line 1048: Receives seconds parameter
  ↓
Line 1049-1050: Gets timer elements via getTimerEls()
  - Returns { c: timerContainer, b: timerBar }
  - For ascend_2026: c = timerContainerAscend, b = timerBarAscend
  - For default: c = timerContainerDefault, b = timerBarDefault
  ↓
Line 1051: Sets display based on container ID
  - If ID is timerContainerDefault → 'flex'
  - Otherwise → 'block'
  ↓
Line 1052: Sets bar width to 0%
  ↓
Line 1055: Records startTime = Date.now()
  ↓
Line 1056: Calculates duration = seconds * 1000
  ↓
Line 1059: setInterval every 50ms:
    - Calculate elapsed time
    - Calculate percent = (elapsed / duration) * 100
    - Set bar width = percent + '%'
    - Update indicator position (for default theme)
    ↓
Line 1073: When percent >= 100:
    - Clear interval
    - Hide container
    - Reset width to 0%
```

### 5.2 getTimerEls() Function Logic

**Location:** screen.html lines 1043-1047

```javascript
function getTimerEls() {
    if (currentTheme === 'ascend_2026') {
        return { c: document.getElementById('timerContainerAscend'), 
                 b: document.getElementById('timerBarAscend') };
    } else {
        return { c: document.getElementById('timerContainerDefault'), 
                 b: document.getElementById('timerBarDefault') };
    }
}
```

**Analysis:**
- Only checks for ascend_2026 explicitly
- DEFAULT case handles both 'default' AND 'v3' themes
- V3 theme also uses timerContainerDefault

**CRITICAL GAP #6:** V3 theme has a separate timer!
- V3 has `timerContainerV3` and `timerBarV3` (line 1367)
- getTimerEls() doesn't return V3 timers
- startCountdown handler has special V3 logic (line 1069-1072)

### 5.3 Timer Element References

**Required elements for each theme:**

| Theme | Container ID | Bar ID | Exists? | Handler Works? |
|-------|--------------|--------|---------|---|
| default | timerContainerDefault | timerBarDefault | ✓ Line 863 | ✓ |
| ascend_2026 | timerContainerAscend | timerBarAscend | ✓ Line 847 | ✓ |
| v3 | timerContainerV3 | timerBarV3 | ✓ Line 1367 | SPECIAL CASE |

**V3 Timer Special Handling:**

Lines 1069-1072:
```javascript
if (typeof isEconovaV3 !== 'undefined' && isEconovaV3) {
    const bar = document.getElementById('timerBarV3');
    if (bar) {
        bar.style.transition = 'none'; 
        bar.style.width = '0%'; 
        setTimeout(() => { 
            bar.style.transition = 'width ' + seconds + 's linear'; 
            bar.style.width = '100%'; 
        }, 50);
    }
}
```

This uses CSS transitions instead of JavaScript interval. Different approach than default/ascend.

---

## 6. INITIALIZATION CRITICAL QUESTIONS ANSWERED

### Q1: When app first loads, which elements should be visible initially?

**Answer:** 
- **NOTHING** should be visible until first `updateState` event
- All theme elements start with `display: none` or depend on body class
- No fallback idle state exists in code

**Evidence:**
- Line 857-870: All content areas have `style="display: none"` or no display property
- CSS doesn't set initial visible state
- applyVisibility() is NOT called until updateState event

**Issue:** If socket.io connection fails:
- Screen remains blank except background
- No error message
- User sees nothing

### Q2: Is applyVisibility() being called on first load?

**Answer:** NO

**Evidence:**
- applyVisibility() is ONLY called from updateState event handler (lines 1282, 1341)
- applyVisibility() is NOT called during page load
- If updateState never fires, nothing appears

### Q3: Does initial HTML have display:none or display:flex for theme elements?

**Answer:** MIXED

| Element | Initial Style |
|---------|---------------|
| defaultQuestionArea | `style="display: none"` |
| ascendQuestionArea | No inline style (depends on CSS) |
| qGrid | `style="display: none"` |
| defaultScoreboard | No inline style |
| ascendFrame | No inline style |
| v3-wrapper | `style="display: none"` (line 1352) |

Result: Inconsistent initialization pattern

### Q4: Are render functions (renderV3, renderDefault) actually attached to window?

**Answer:**

| Function | Window Attached? | Accessible? |
|----------|------------------|------------|
| renderV3 | NO | Only in v3-script scope (line ~2065) |
| renderDefault | NOT DEFINED | N/A |
| renderAscend | NOT DEFINED | N/A |
| applyVisibility | NO | Local scope only |
| getTimerEls | YES | Line 1043, global scope |
| stopCountdown | YES | Line 1040, global scope |
| getSocketClient | YES | app.js line 11, might be global |

**CRITICAL GAP #7:** renderV3 is not attached to window. Code tries to call it:
```javascript
if (typeof renderV3 === 'function') renderV3(state);  // Line 1308
```

This checks if renderV3 is defined in current scope. Since renderV3 is inside DOMContentLoaded, it might not be in scope when applyVisibility() is called from updateState event.

**Potential timing issue:**
1. updateState event fires
2. applyVisibility() called from event handler
3. typeof renderV3 === 'function' check happens
4. If v3-script DOMContentLoaded hasn't fired yet, renderV3 is undefined
5. Silently fails with no error

---

## 7. SOCKET EVENT EXECUTION PATHS

### 7.1 updateState Event Handler

**Entry:** socket.on('updateState', (state) => { ...

**Line 1032:** console.log triggers (DEBUG output)

**Lines 1035-1047:** Font handling (not theme-related)

**Line 1049:** `currentTheme = state.settings.theme || 'default'`
- Sets the theme based on incoming state
- Default fallback: 'default'

**Line 1050:** `document.body.className = currentTheme + ' main-screen'`
- This triggers ALL CSS body.theme-name rules
- CSS rules with !important are now active

**Lines 1070-1347:** Entire UI rendering logic
- Scoreboards
- Grids
- Questions
- applyVisibility() at end

### 7.2 startCountdown Event Handler

**Entry:** socket.on('startCountdown', (seconds) => { ...

**Location:** screen.html lines 1048-1081

**Path:**
1. Gets timer elements via getTimerEls()
2. Sets display to visible
3. Starts interval loop updating width every 50ms
4. Uses CSS transitions (for V3 only)

**Timing:**
- Expects to be called when question is active
- Updates timer bar every 50ms
- Completes after seconds * 1000 ms

---

## 8. COMPLETE GAPS & DEFECTS FOUND

### CRITICAL GAPS

| # | Gap | Severity | Impact | Location |
|---|-----|----------|--------|----------|
| 1 | `renderDefault()` function NOT DEFINED | CRITICAL | DEFAULT theme has no custom render function; relies only on CSS + applyVisibility() | app.js line 24 |
| 2 | `renderAscend()` function NOT DEFINED | CRITICAL | ASCEND_2026 theme has no custom render function; relies only on CSS + applyVisibility() | app.js line 24 |
| 3 | `renderV3()` may not be defined when called | HIGH | renderV3 defined inside DOMContentLoaded in v3-script scope; applyVisibility() called from updateState might fire before DOMContentLoaded | screen.html line 1308 vs ~2000 |
| 4 | No initial visibility state on page load | HIGH | No elements visible until updateState fires; if socket fails, user sees blank screen | N/A |
| 5 | V3 timer not handled by getTimerEls() | MEDIUM | V3 uses separate timerContainerV3; getTimerEls() only returns default/ascend; special case code handles V3 | Lines 1043-1047, 1069-1072 |
| 6 | CSS !important conflicts with JS | HIGH | body.theme-name rules use !important; when switching themes, JS display style can't override CSS | Lines 111, 184-186 |
| 7 | renderV3 function not in window scope | MEDIUM | renderV3 is local to v3-script DOMContentLoaded; typeof check on line 1308 may fail if called before DOMContentLoaded | Line ~2065 |
| 8 | No error handling for failed DOM queries | HIGH | All getElementById calls assume elements exist; no null checks before setting properties | Lines 1043-1047, 1049-1081 |

### LOGIC DEFECTS

| # | Defect | Severity | Details | Location |
|---|--------|----------|---------|----------|
| BUG-1 | DEFAULT theme idle state shows empty question-area | MEDIUM | In idle (no package, no question), defQArea set to 'flex' but defQBox set to 'none'; result is visible empty space | Line 1338-1347 |
| BUG-2 | ASCEND theme JS tries to override CSS !important | HIGH | applyVisibility() tries to set defScoreboard.style.display='flex' when theme is ascend_2026, but CSS rule has !important | Line 1318 + Line 184 |
| BUG-3 | Inconsistent initial display styles | MEDIUM | Some elements have inline `display: none`, others don't; inconsistent pattern makes it unclear which CSS rule governs visibility | Lines 857-870 |
| BUG-4 | getTimerEls() doesn't distinguish default vs v3 | MEDIUM | Both themes use getTimerEls(), but V3 should use separate container; workaround exists but creates code duplication | Lines 1043-1047, 1069-1072 |
| BUG-5 | window.isAnimating flag can leave system stuck | MEDIUM | If animation completes but flag not reset, or if exception during animation, flag stays true and applyVisibility() never runs | Line 1267-1281 |
| BUG-6 | No validation of state.currentQuestion.idx | MEDIUM | Code assumes q.idx exists before using it; no bounds checking on grid cell array access | Line 1267, 1273 |

### CODE FLOW ISSUES

| # | Issue | Impact | Location |
|---|-------|--------|----------|
| FLOW-1 | applyVisibility() checks `theme === 'default'`, `theme === 'ascend_2026'`, `theme === 'v3'` but code path for other themes is unclear | If theme is not one of these 3, elements remain invisible | Line 1291-1347 |
| FLOW-2 | socket.on('updateState') handler is very large (300+ lines); multiple concerns mixed | Hard to trace execution; logic scattered across event handler | Lines 995-1350+ |
| FLOW-3 | applyVisibility() called twice in some flows: line 1282 AND line 1341 | Second call may redundantly reset already-set values; could cause flicker | Lines 1267-1281 |
| FLOW-4 | Timeout delay before second applyVisibility() (line 1278) assumes 1000ms is always correct | If animation takes longer or shorter time, visibility update might not happen at right moment | Line 1278 |

### MISSING FEATURES

| # | Missing | Should Have | Location |
|---|---------|-------------|----------|
| MISS-1 | Fallback idle state | When no package/question, should show idle scoreboard; currently shows nothing or undefined state | N/A |
| MISS-2 | Error boundary for socket events | If updateState is malformed, entire event handler fails | N/A |
| MISS-3 | Logging for theme switches | No visibility into theme change failures | N/A |
| MISS-4 | Timeout recovery | If startCountdown is called but timer elements don't exist, no error | N/A |

---

## 9. EXECUTION CHAIN SUMMARY

### When App Opens with DEFAULT Theme

```
Page Load
  ↓ (HTML loads)
Socket.io connection established
  ↓ (wait for server)
Server emits 'updateState' with theme='default'
  ↓ (socket event)
updateState handler fires (line 995)
  ↓
currentTheme = 'default' (line 1049)
  ↓
document.body.className = 'default main-screen' (line 1050)
  ↓ (CSS rules activate: body.default .ascend-only { display: none !important; })
Scoreboard HTML rendered (lines 1070-1118)
  ↓
Grid rendering (lines 1120-1280)
  ↓
applyVisibility(state) called (line 1341)
  ↓
Check showGrid and showQuestion flags
  ↓
Set correct element display properties
  ↓
Idle state: Shows scoreboard + empty question area + hidden grid
OR
Grid state: Shows scoreboard + grid + hidden question
OR
Question state: Shows scoreboard + question box + hidden grid
```

**Result:** ✓ Default theme works if all functions exist

### When App Opens with ASCEND_2026 Theme

```
Page Load
  ↓
Socket.io connected
  ↓
Server emits 'updateState' with theme='ascend_2026'
  ↓
updateState handler fires
  ↓
currentTheme = 'ascend_2026' (line 1049)
  ↓
document.body.className = 'ascend_2026 main-screen' (line 1050)
  ↓ (CSS rule: body.ascend_2026 .default-only { display: none !important; })
Scoreboard rendered to both locations
  ↓
applyVisibility(state) called (line 1341)
  ↓
theme === 'ascend_2026' → line 1320
  ↓
ascendFrame.style.display = 'flex'   ✓ Works
defScoreboard.style.display = 'flex' ✗ FAILS (CSS !important wins)
ascendQArea.style.display = 'flex'   ✓ Works
  ↓
Show ascendFrame with scoreboard inside
  ↓
Grid/Question rendering based on package state
```

**Result:** ✗ Partial failure - defScoreboard can't be shown due to CSS conflict, but ascendScoreboard renders correctly so visible output is correct

### When App Opens with V3 Theme

```
Page Load
  ↓
HTML loads including v3-script block
  ↓ (But renderV3 not yet defined - inside DOMContentLoaded)
Socket.io connected
  ↓
Server emits 'updateState' with theme='v3'
  ↓
updateState handler fires
  ↓
currentTheme = 'v3' (line 1049)
  ↓
POTENTIAL RACE CONDITION:
  - If updateState fires BEFORE v3-script DOMContentLoaded:
    renderV3 is undefined → typeof check fails → nothing happens
  - If updateState fires AFTER v3-script DOMContentLoaded:
    renderV3 exists in scope → works correctly
  ↓
applyVisibility(state) called (line 1341)
  ↓
if (typeof renderV3 === 'function') renderV3(state) (line 1308)
  ↓
renderV3 computes machine state (0, 1, or 2)
  ↓
triggerV3Transition() applies animations
  ↓
SVG clip-paths update, opacity/z-index change
  ↓
Grid or Question visible with animation
```

**Result:** ✗ Race condition possible - V3 may not render on first updateState if timing is wrong

### When Socket Emits startCountdown Event

```
startCountdown(seconds) received
  ↓
getTimerEls() called
  ↓
Based on currentTheme:
  - If 'ascend_2026': return ascend timer elements
  - Otherwise (default or v3): return default timer elements
  ↓
Set display to 'flex' or 'block'
  ↓
Start 50ms interval loop
  ↓
Calculate elapsed time each iteration
  ↓
Update bar width as percentage
  ↓
If V3 theme: SPECIAL CASE (line 1069)
  - Use CSS transition instead of JS interval
  - Set transition: width 2s linear (for 2 second countdown)
  - Set width to 100%
  ↓
When 100% reached: Clear interval, hide container, reset width
  ↓
Timer complete
```

**Result:** ✓ Works, but V3 uses different mechanism (CSS transitions vs JS interval)

---

## 10. FINAL SUMMARY TABLE

### What ACTUALLY HAPPENS vs What SHOULD HAPPEN

| Scenario | Should Happen | Actually Happens | Status |
|----------|---------------|------------------|--------|
| App loads, DEFAULT theme | Scoreboard + idle grid visible | Depends on socket - blank if socket fails | ⚠️ FRAGILE |
| App loads, V3 theme | V3 scoreboard visible with animation | MAY NOT RENDER if updateState fires before DOMContentLoaded | ✗ RACE CONDITION |
| App loads, ASCEND theme | ASCEND scoreboard + top bar visible | Works, but JS tries to override CSS !important unnecessarily | ⚠️ REDUNDANT |
| Grid package selected | Grid displayed, scoreboard hidden | Correct per applyVisibility() | ✓ OK |
| Question activated | Question displayed, grid hidden | Works after 1000ms animation delay | ✓ OK (but fragile) |
| Idle state (no package) | Clean idle scoreboard | Empty question-area visible alongside scoreboard | ✗ BUG |
| Timer starts (DEFAULT) | Timer bar animates for N seconds | Works correctly with JS interval | ✓ OK |
| Timer starts (ASCEND) | Timer bar animates for N seconds | Works correctly | ✓ OK |
| Timer starts (V3) | Timer bar animates with CSS | Works correctly with CSS transition | ✓ OK |
| Theme changes mid-session | New theme applied cleanly | Body class changes, CSS rules take effect, JS overrides applied | ✓ OK (mostly) |

### Functions That Exist vs Referenced

| Function | Exists? | Callable? | Used By | Status |
|----------|---------|-----------|---------|--------|
| renderV3() | ✓ (line ~2065) | CONDITIONAL | applyVisibility() line 1308 | ⚠️ RACE CONDITION |
| renderDefault() | ✗ MISSING | NO | app.js line 24 | ✗ BROKEN |
| renderAscend() | ✗ MISSING | NO | app.js line 24 | ✗ BROKEN |
| applyVisibility() | ✓ (line 1290) | YES (local) | updateState handler | ✓ OK |
| getTimerEls() | ✓ (line 1043) | YES (global) | startCountdown handler | ✓ OK |
| stopCountdown() | ✓ (line 1040) | YES (global) | Various | ✓ OK |
| hideAllThemeElements() | ✓ (shared.js) | YES (global) | Not called from screen.html | ⚠️ UNUSED |

---

## 11. DEPENDENCY MAP

```
updateState event (socket.on)
  ├─ setThemeClass(theme) [from shared.js]
  ├─ Font CSS injection
  ├─ Scoreboard rendering to #defaultScoreboard + #ascendScoreboard
  ├─ Grid rendering to #grid10, #grid20, #grid40
  ├─ Question text rendering
  │   ├─ #defaultQText
  │   ├─ #ascendQText
  │   └─ #qTextV3
  ├─ applyVisibility(state)
  │   ├─ IF theme === 'v3'
  │   │  └─ renderV3(state) [POTENTIAL NULL]
  │   │      ├─ renderV3Grid(state)
  │   │      │  └─ genZigzagShape(), toSvgPath(), toPoly()
  │   │      └─ renderV3QBox(state)
  │   │
  │   ├─ IF theme === 'ascend_2026'
  │   │  └─ Set ascendFrame, ascendQArea, ascendQBox display
  │   │
  │   └─ IF theme === 'default'
  │      └─ Set defaultScoreboard, defaultQArea, defQBox display
  │
  └─ window.lastActiveState, window.currentState updated

startCountdown event (socket.on)
  ├─ getTimerEls() [returns based on currentTheme]
  ├─ Set timer display visible
  ├─ Start 50ms interval
  │  └─ Update timerBar width
  └─ On complete: hide timer, reset width

toggleQRCode event → show/hide QR overlay
serverIPs event → update QR code
playSound event → play audio element
playVideo event → show video overlay
closeVideo event → hide video overlay
runV3Anim event → trigger V3 animation
```

---

## 12. CRITICAL OBSERVATIONS

1. **No renderDefault/renderAscend functions exist**, yet the code is structured as if they should. This suggests incomplete refactoring.

2. **renderV3 is scoped inside DOMContentLoaded**, making it vulnerable to timing issues. Safe approach would attach to window object.

3. **CSS !important rules prevent JavaScript from overriding display values**, creating unnecessary code paths that don't actually work (e.g., applyVisibility trying to set defScoreboard.display when ASCEND theme active).

4. **No fallback if socket.io fails** - if server never sends updateState, screen stays blank.

5. **Timer system has three different implementations** - JavaScript interval for DEFAULT, JavaScript interval for ASCEND, CSS transitions for V3. No unified abstraction.

6. **Grid rendering happens in updateState handler**, not in separate render functions, making it mixed concerns.

7. **No type checking or validation** of state object structure before accessing properties.

8. **Inconsistent initial display styles** - some elements have inline `style="display: none"`, others rely on CSS.

9. **Animation delay (1000ms) is hardcoded** - if this changes in design, code must be found and updated in multiple places.

10. **Window globals used inconsistently** - some functions attached to window, others not, creating unpredictable scope issues.

