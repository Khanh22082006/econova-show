# Econova Show - Theme Management System Analysis

## Executive Summary
The Econova Show application manages **3 themes**: `default`, `ascend_2026`, and `v3`. Theme visibility is controlled through a combination of JavaScript state management and CSS class-based styling. Each theme has its own set of HTML elements that are shown/hidden based on socket events and state changes.

---

## 1. State Management Overview

### app.js - Current Theme State Management

```javascript
let currentTheme = 'default';
let packageTimeout = null;
```

**Current Flow:**
1. Socket receives `updateState` event
2. Theme is extracted: `state.settings.theme` (or defaults to 'default')
3. `setThemeClass(currentTheme)` sets `document.body.className`
4. Logic determines if showing **graphics** (grid) or **question box**
5. Appropriate elements are shown/hidden

---

## 2. HTML Element Inventory by Theme

### 2.1 DEFAULT Theme Elements

| Element ID | Purpose | Current Display | Location |
|------------|---------|-----------------|----------|
| `defaultQBox` | Question container | display: none (default) | #defaultQuestionArea |
| `defaultQArea` | Question area wrapper | display: none (default) | #main-container |
| `defaultQText` | Question text content | N/A | inside defaultQBox |
| `defaultQPoints` | Points label (e.g., "40 ĐIỂM") | N/A | inside defaultQBox |
| `defaultScoreboard` | Team scoreboard | display: none (default) | #main-container |
| `timerContainerDefault` | Timer container (Olympia style) | display: none (default) | inside defaultQBox |
| `timerBarDefault` | Timer progress bar | width: 0% | inside timerContainerDefault |
| `timerIndicatorDefault` | Timer circle handle | left: 0% | inside timerBarDefault |
| `defaultPackagePointsContainer` | Package points grid | display: none (default) | inside defaultQuestionArea |
| `defaultHopeStarBadge` | Star badge animation | display: none (default) | inside defaultQBox |
| `bg-grid` | Grid background animation | display: block | inside #main-container |

**CSS Classes Applied:**
- `body.default` - Sets background with gradients
- `.default-only` - CSS rule `display: none !important` on ascend_2026/v3
- `question-area.default-only` - Hidden on other themes

---

### 2.2 ASCEND_2026 Theme Elements

| Element ID | Purpose | Current Display | Location |
|------------|---------|-----------------|----------|
| `ascendFrame` | Main container | display: none (default) | #main-container |
| `ascendQBox` | Question container | display: none (default) | inside ascendQuestionArea |
| `ascendQArea` | Question area wrapper | display: none (default) | inside ascendFrame |
| `ascendQText` | Question text content | N/A | inside ascendQBox |
| `ascendQPoints` | Points label | N/A | inside ascendQBox |
| `ascendScoreboard` | Team scoreboard | display: flex (part of ascendFrame) | inside ascend-top-bar |
| `ascendPtsBox` | Points box (top-left, color: gray/blue) | display: flex | inside ascend-top-bar |
| `timerContainerAscend` | Timer container (trapezoid style) | display: none (default) | bottom of ascendFrame |
| `timerBarAscend` | Timer progress bar (red) | width: 0% | inside timerContainerAscend |
| `ascendPackagePointsContainer` | Package points | display: none (default) | inside ascendQuestionArea |
| `ascendHopeStarBadge` | Star badge animation | display: none (default) | inside ascendQBox |

**CSS Classes Applied:**
- `body.ascend_2026` - Sets background image (B1.png)
- `.ascend-only` - Hidden on default/v3
- `.ascend-frame` - Bordered rounded box with backdrop-filter

---

### 2.3 V3 Theme Elements

| Element ID | Purpose | Current Display | Location |
|------------|---------|-----------------|----------|
| `v3-wrapper` | Main outer wrapper | display: none (default) | Root level |
| `v3MasterContainer` | Inner container | display: none (default) | inside v3-wrapper |
| `qTextV3` | Question text | N/A | inside anim-question-group |
| `timerContainerV3` | Timer (V3 style) | display: flex (default hidden via JS) | inside anim-question-group |
| `timerBarV3` | Timer progress bar | width: 0% (default) | inside timerContainerV3 |
| `timerHandleV3` | Timer handle animation | N/A | inside timerBarV3 |
| `v3ActiveScore` | Active team score | font-size: 130px | inside anim-question-group |
| `v3PointsArea` | Points/package display | display: flex (default) | inside anim-question-group |

**CSS Classes Applied:**
- `body.v3` - (Planned, not fully implemented yet)
- `.v3-new-root` - Container-specific styling
- `#v3MasterContainer.screen-mode` - Screen-specific styling

**V3-Specific Containers:**
- `.anim-container` - Main animation container
- `.anim-grid-group` - Grid display group
- `.anim-question-group` - Question display group
- `.shape-container` - Shapes for zigzag arrows

---

## 3. Event Flow: updateState

### 3.1 Complete Flow Diagram

```
SOCKET.ON('updateState', state)
    ↓
[screen.html - socket listener]
    ↓
1. Extract theme: currentTheme = state.settings.theme || 'default'
    ↓
2. Set CSS class: document.body.className = currentTheme + ' main-screen'
    ↓
3. Render scoreboard (all themes):
   - defaultScoreboard.innerHTML
   - ascendScoreboard.innerHTML
   - qBoxScoreboard.innerHTML (for V3)
    ↓
4. Call applyVisibility(state) with theme-specific logic:
    ├─ IF theme === 'v3':
    │  ├─ Hide: v3Wrapper, ascendFrame, defaultScoreboard, defaultQArea, ascendQArea
    │  ├─ Show: v3Wrapper (display: block), v3MasterContainer (display: block)
    │  └─ Call renderV3(state) if defined
    │
    ├─ ELSE IF theme === 'ascend_2026':
    │  ├─ Hide: v3Wrapper, ascendFrame (initially)
    │  ├─ Check showGrid flag:
    │  │  └─ IF showGrid: Show qGrid, hide ascendQArea
    │  └─ Check showQuestion flag:
    │     └─ IF showQuestion: Show ascendQBox, ascendQArea, hide qGrid
    │
    └─ ELSE (default):
       ├─ Hide: v3Wrapper, ascendFrame, ascendQArea, ascendQBox
       ├─ Check showGrid flag:
       │  └─ IF showGrid: Show qGrid
       └─ Check showQuestion flag:
          └─ IF showQuestion: Show defaultQBox, defaultQArea, scoreboard
```

### 3.2 Visibility Logic (from applyVisibility function)

**Key Decision Points:**

```javascript
const showGrid = Boolean(state.isGridVisibleOnOverlay || state.lockedPackage || state.pendingPackage);
const showQuestion = Boolean(state.currentQuestion && state.currentQuestion.active);
```

**State Conditions:**
- **Package Phase** (showGrid = true): Display question grid
- **Question Phase** (showQuestion = true): Display active question
- **Idle Phase** (both false): Hide everything, show scoreboard only

---

## 4. Visibility Control Matrix

### 4.1 HTML Display States by Theme & Phase

#### DEFAULT Theme

| Phase | qGrid | defaultQBox | defaultQArea | defaultScoreboard | ascendFrame | v3Wrapper | Status |
|-------|-------|-------------|--------------|-------------------|-------------|-----------|--------|
| Package | flex | none | none | none | none | none | ✓ Shows grid |
| Question | none | flex | flex | flex | none | none | ✓ Shows Q+score |
| Idle | none | none | none | flex | none | none | ✓ Shows score only |

#### ASCEND_2026 Theme

| Phase | qGrid | ascendQBox | ascendQArea | ascendFrame | ascendScoreboard | v3Wrapper | Status |
|-------|-------|-----------|------------|------------|------------------|-----------|--------|
| Package | flex | none | none | flex | flex (in frame) | none | ✓ Shows grid |
| Question | none | flex | flex | flex | flex (in frame) | none | ✓ Shows Q+score |
| Idle | none | none | none | flex | flex (in frame) | none | ✓ Shows score |

#### V3 Theme

| Phase | v3MasterContainer | v3-wrapper | qTextV3 | v3ActiveScore | Ascend/Default | Status |
|-------|------------------|-----------|---------|--------------|----------------|--------|
| Package | block | block | (grid content) | N/A | none | ✓ Shows grid |
| Question | block | block | (question text) | (score) | none | ✓ Shows Q+score |
| Idle | none | none | N/A | N/A | none | ⚠ Issue: Nothing shown |

---

## 5. Issues & Conflicts Identified

### 5.1 CRITICAL ISSUES

#### Issue #1: V3 Idle State Not Handled
**Problem:** When V3 theme is active and no package/question, nothing is displayed.

```javascript
// applyVisibility doesn't handle V3 idle state
if (theme === 'v3') {
    // ... shows grid/question logic
    return; // No fallback to scoreboard!
}
```

**Impact:** Screen goes blank when switching away from V3.

**Fix Needed:** Add V3 scoreboard display or fallback to default scoreboard.

---

#### Issue #2: Timer Element Duplication
**Problem:** Multiple timer implementations exist:

1. **screen.html inline timer logic** (socket.on('startCountdown'))
2. **shared.js timer functions** (startThemeTimer, stopThemeTimer)
3. **app.js timer calls** (startThemeTimer, stopThemeTimer)

```javascript
// Three different implementations fighting for control:
// 1. Direct DOM manipulation in socket listener
// 2. Shared.js wrapper functions
// 3. app.js theme-specific wrappers
```

**Impact:** Unclear which code is actually executing. Potential race conditions.

**Recommendation:** Consolidate to single timer implementation.

---

#### Issue #3: Dual Visibility Control Systems
**Problem:** Visibility is controlled by BOTH:

1. **CSS Classes** (body.default, body.ascend_2026, .default-only, .ascend-only)
2. **JavaScript Display Properties** (element.style.display)

```css
/* CSS declares default state */
body.default .ascend-only { display: none !important; }

/* Then JavaScript overrides */
ascendFrame.style.display = 'flex';
```

**Impact:** CSS rules can be overridden unpredictably. Maintenance confusion.

**Recommendation:** Choose ONE system - prefer CSS for state, JS only for animations.

---

#### Issue #4: Missing V3 CSS Initialization
**Problem:** V3 theme lacks CSS class in body tag when theme is v3.

```javascript
// In shared.js
function setThemeClass(theme) {
    document.body.className = theme; // ✓ Sets to 'v3'
}

// But app.js adds:
document.body.className = currentTheme + ' main-screen'; // ✓ Overrides
```

**Current:** `body.v3.main-screen`
**CSS has:** `body.v3 .default-only { display: none !important; }`

**Impact:** May work, but CSS targeting could be inconsistent.

---

### 5.2 STRUCTURAL ISSUES

#### Issue #5: V3 Element Structure Mismatch
**Problem:** V3 uses different container structure:

```html
<!-- V3 wraps everything in nested divs -->
<div id="v3-wrapper">
    <div id="v3MasterContainer" class="v3-new-root screen-mode">
        <div class="shape-container anim-container">
            <!-- Grid/Question groups hidden via CSS -->
            <div class="anim-grid-group"> <!-- opacity: 0 -->
            <div class="anim-question-group"> <!-- opacity: 0 -->
```

vs

```html
<!-- Default/Ascend use flat structure -->
<div id="qGrid">
<div id="defaultQBox">
<div id="ascendFrame">
```

**Impact:** Can't reuse visibility logic across themes.

---

#### Issue #6: Inconsistent Element IDs
**Problem:** Similar elements have different naming conventions:

| Element Type | Default | Ascend | V3 |
|--------------|---------|--------|-----|
| Question Box | `defaultQBox` | `ascendQBox` | *(nested in anim-question-group)* |
| Question Area | `defaultQuestionArea` | `ascendQuestionArea` | *(no separate area)* |
| Question Text | `defaultQText` | `ascendQText` | `qTextV3` |
| Points Box | `defaultQPoints` | `ascendQPoints` | `v3ActiveScore` |
| Timer Container | `timerContainerDefault` | `timerContainerAscend` | `timerContainerV3` |
| Timer Bar | `timerBarDefault` | `timerBarAscend` | `timerBarV3` |

**Impact:** Makes generic functions impossible. Code is theme-specific and non-reusable.

---

### 5.3 LOGIC ISSUES

#### Issue #7: Incomplete Package Points Rendering
**Problem:** Package points containers exist but not consistently populated:

```javascript
// defaultPackagePointsContainer - rendered via:
let html = state.lockedPackage ? state.lockedPackage.questions : [];
// But then never appended!

// ascendPackagePointsContainer - similar issue
```

**Impact:** Package points may not display correctly.

---

#### Issue #8: Hope Star Badge Visibility
**Problem:** Star badge logic checks `activeRound` but may not trigger:

```javascript
if (state.activeRound !== window.lastActiveRound) {
    const hopeStarBadge = document.getElementById('hopeStarBadge');
    if (hopeStarBadge) hopeStarBadge.style.display = 'flex';
}
```

**Issue:** `hopeStarBadge` ID doesn't exist. Actual IDs are:
- `defaultHopeStarBadge`
- `ascendHopeStarBadge`

**Impact:** Star badge never displays.

---

## 6. Complete Element Existence Check

### 6.1 Elements That DO Exist in HTML

✓ `defaultQBox`
✓ `defaultQArea`
✓ `defaultQText`
✓ `defaultQPoints`
✓ `defaultScoreboard`
✓ `timerContainerDefault`
✓ `timerBarDefault`
✓ `timerIndicatorDefault`
✓ `ascendFrame`
✓ `ascendQBox`
✓ `ascendQArea`
✓ `ascendQText`
✓ `ascendQPoints`
✓ `ascendScoreboard`
✓ `ascendPtsBox`
✓ `timerContainerAscend`
✓ `timerBarAscend`
✓ `v3-wrapper`
✓ `v3MasterContainer`
✓ `qTextV3`
✓ `timerContainerV3`
✓ `timerBarV3`
✓ `v3ActiveScore`
✓ `qGrid`
✓ `qBoxScoreboard`

### 6.2 Elements That Are REFERENCED but Don't Exist

✗ `hopeStarBadge` - Referenced in screen.html (line ~1635)
  - **Actual elements:** `defaultHopeStarBadge`, `ascendHopeStarBadge`
  - **Location:** Inside defaultQBox and ascendQBox

✗ `qBoxscreen-mode` - Referenced in screen.html but never defined
  - **Likely intent:** Generic question box reference
  - **Actual elements:** `defaultQBox`, `ascendQBox`

### 6.3 Elements with Display Override Conflicts

⚠ `ascendPtsBox` - Has background set dynamically but may conflict with CSS:

```javascript
// Dynamic JS sets:
ascendPtsBox.style.background = 'linear-gradient(135deg, #f5f6fa, #dcdde1)';

// But CSS already defines:
body.ascend_2026 .ascend-pts-box {
    background: linear-gradient(135deg, #f5f6fa, #dcdde1);
}
```

---

## 7. Current vs Intended Theme Flow Comparison

### 7.1 Diagram: How Themes SHOULD Work

```
USER SELECTS THEME: 'default' / 'ascend_2026' / 'v3'
    ↓
┌────────────────────────────────────────────────────────────┐
│  SOCKET.updateState(state)                                 │
│  - Theme: state.settings.theme                             │
│  - Package: state.lockedPackage / state.pendingPackage      │
│  - Question: state.currentQuestion                         │
└────────────────────────────────────────────────────────────┘
    ↓
┌─── SET THEME CLASS ───────────────────────────────────────┐
│  document.body.className = theme + ' main-screen'         │
│  - CSS rules activate for this theme                       │
│  - All theme-specific elements inherit visibility state    │
└───────────────────────────────────────────────────────────┘
    ↓
┌─── CHECK STATE ────────────────────────────────────────────┐
│  hasPackage = !!state.lockedPackage/pendingPackage         │
│  hasQuestion = !!state.currentQuestion?.active            │
│  hasIdle = !(hasPackage || hasQuestion)                   │
└───────────────────────────────────────────────────────────┘
    ↓
         ┌────────┴────────┬─────────┬───────────┐
         ↓                 ↓         ↓           ↓
    [PACKAGE]         [QUESTION]  [IDLE]   [BY THEME]
         ↓                 ↓         ↓           ↓
    ┌────────────┐   ┌──────────┐ ┌─────┐
    │ Show Grid  │   │Show Ques.│ │Hide │    
    │Hide Q.Box  │   │Show Score│ │All  │    
    └────────────┘   │Hide Grid │ └─────┘
                     └──────────┘
         ↓                 ↓         ↓
    ┌─────────────────────────────────────┐
    │ RENDER THEME ELEMENTS               │
    │ - Set CSS display properties        │
    │ - Populate content (scores, Q text) │
    │ - Start animations if needed        │
    └─────────────────────────────────────┘
```

### 7.2 Diagram: How Themes CURRENTLY Work (Problematic)

```
USER SELECTS THEME
    ↓
TWO COMPETING SYSTEMS:
    ├─ CSS CLASS SYSTEM
    │  └─ body.theme + .theme-only CSS rules
    │     └─ Sets visibility via `display: none !important`
    │
    └─ JAVASCRIPT SYSTEM
       └─ Direct element.style.display manipulation
          └─ Can override CSS rules

    ↓
RESULT: Unpredictable behavior when both systems conflict
```

---

## 8. Recommended Architecture Fix

### 8.1 Unified Visibility Controller

```javascript
class ThemeController {
    constructor() {
        this.currentTheme = 'default';
        this.currentPhase = 'idle'; // 'grid', 'question', 'idle'
    }

    setTheme(theme) {
        this.currentTheme = theme;
        document.body.className = theme + ' main-screen';
    }

    setPhase(phase) {
        this.currentPhase = phase;
        this.render();
    }

    render() {
        // Clear all visibility
        this.hideAll();
        
        // Apply phase-based visibility based on theme
        if (this.currentPhase === 'grid') {
            this.showGrid();
        } else if (this.currentPhase === 'question') {
            this.showQuestion();
        } else {
            this.showIdle();
        }
    }

    showGrid() {
        // Theme-specific grid display
        if (this.currentTheme === 'v3') {
            document.getElementById('v3-wrapper').style.display = 'block';
            // Show anim-grid-group
        } else {
            document.getElementById('qGrid').style.display = 'flex';
        }
    }

    showQuestion() {
        // Theme-specific question display
        switch (this.currentTheme) {
            case 'default':
                this.show(['defaultQBox', 'defaultQArea', 'defaultScoreboard']);
                break;
            case 'ascend_2026':
                this.show(['ascendQBox', 'ascendQArea', 'ascendFrame']);
                break;
            case 'v3':
                this.show(['v3MasterContainer', 'v3-wrapper']);
                break;
        }
    }

    showIdle() {
        // All themes show scoreboard
        if (this.currentTheme === 'v3') {
            // Show V3 scoreboard placeholder
            this.show(['v3-wrapper']);
        } else if (this.currentTheme === 'ascend_2026') {
            this.show(['ascendFrame']);
        } else {
            this.show(['defaultScoreboard']);
        }
    }

    show(ids) {
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
    }

    hideAll() {
        // Hide ALL theme elements
        const allIds = [
            // Default
            'defaultQBox', 'defaultQArea', 'defaultScoreboard',
            // Ascend
            'ascendFrame', 'ascendQBox', 'ascendQArea',
            // V3
            'v3-wrapper', 'v3MasterContainer',
            // Common
            'qGrid'
        ];
        allIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }
}

const themeController = new ThemeController();

// Usage:
socket.on('updateState', (state) => {
    themeController.setTheme(state.settings.theme);
    
    if (state.lockedPackage || state.pendingPackage) {
        themeController.setPhase('grid');
    } else if (state.currentQuestion?.active) {
        themeController.setPhase('question');
    } else {
        themeController.setPhase('idle');
    }
});
```

---

## 9. Element Display State Summary

### Current Display Values (from CSS + JS)

| Theme | defaultQBox | ascendQBox | v3Master | qGrid | defaultScore | ascendFrame |
|-------|-------------|-----------|----------|-------|--------------|-------------|
| default (package) | none | none | none | **flex** | none | none |
| default (question) | **flex** | none | none | none | **flex** | none |
| default (idle) | none | none | none | none | **flex** | none |
| ascend (package) | none | none | none | **flex** | none | **flex** |
| ascend (question) | none | **flex** | none | none | none | **flex** |
| ascend (idle) | none | none | none | none | none | **flex** |
| v3 (package) | none | none | **block** | none | none | none |
| v3 (question) | none | none | **block** | none | none | none |
| v3 (idle) | none | none | **none** ⚠ | none | none | none |

**Legend:** ✓ Correct behavior | ⚠ Issue detected

---

## 10. Socket Event Lifecycle

### Complete Event Chain

```
USER ACTION (e.g., "Select question")
    ↓
SERVER PROCESSES (marks package locked, current question set, etc.)
    ↓
SERVER EMITS socket.emit('updateState', newState)
    ↓
CLIENT RECEIVES socket.on('updateState', state)
    ↓
[screen.html line ~1395]
console.log('[DEBUG] updateState triggered, theme =', state.settings?.theme)
    ↓
1. Font setup (if globalFontEnabled)
    ├─ Create/update <style id="dynamic-font-styles-global">
    └─ Set CSS variables
    ↓
2. Render scoreboards
    ├─ document.getElementById('defaultScoreboard').innerHTML = html
    ├─ document.getElementById('ascendScoreboard').innerHTML = html
    └─ document.getElementById('qBoxScoreboard').innerHTML = html
    ↓
3. Build grid cells
    ├─ For each points value (10, 20, 40)
    │  └─ Build q-cell elements based on mode and state
    └─ Set animation delays per cell
    ↓
4. Update question text/points
    ├─ defaultQPoints.textContent = "40 ĐIỂM"
    ├─ ascendQPoints.textContent = "40 ĐIỂM"
    ├─ ascendPtsBox.textContent = "40 ĐIỂM"
    └─ ascendPtsBox.style.background = colors
    ↓
5. Call applyVisibility(state)
    ├─ theme = currentTheme (from state.settings)
    ├─ showGrid = !!state.lockedPackage || !!state.pendingPackage
    ├─ showQuestion = !!state.currentQuestion?.active
    └─ [SHOW/HIDE LOGIC]
         ├─ If v3: show v3 elements
         ├─ If ascend_2026: show ascend elements based on phase
         └─ If default: show default elements based on phase
    ↓
DISPLAY UPDATES ON SCREEN
```

---

## 11. Key Files & Line References

| File | Lines | Purpose |
|------|-------|---------|
| **screen.html** | 1-600 | CSS styling for all themes |
| **screen.html** | 600-900 | HTML structure: scoreboards, timers |
| **screen.html** | 900-1100 | Grid & question box markup |
| **screen.html** | 1100-1600 | Socket listener setup & font logic |
| **screen.html** | 1390-1700 | `updateState` event handler (main logic) |
| **screen.html** | 1770-1950 | V3 theme HTML & script |
| **screen.html** | 2000+ | V3 rendering functions |
| **shared.js** | 1-30 | `setThemeClass()`, `hideAllThemeElements()` |
| **shared.js** | 30-100 | Timer control functions |
| **app.js** | 1-50 | Theme state variables & socket client |
| **app.js** | 50-100 | `showThemeGraphics()`, `showThemeQuestionBox()` |

---

## 12. Critical Path to Fix

### Priority 1: Fix V3 Idle State
**File:** screen.html, function `applyVisibility()`
**Add:** Fallback for V3 idle state to show scoreboard

### Priority 2: Consolidate Timer Control  
**Files:** shared.js, app.js, screen.html
**Action:** Remove duplicate timer implementations, keep one

### Priority 3: Fix Element References
**Files:** screen.html, app.js
**Changes:** 
- Replace `hopeStarBadge` → `defaultHopeStarBadge` / `ascendHopeStarBadge`
- Replace `qBoxscreen-mode` → generic element selection

### Priority 4: Standardize Visibility System
**Action:** Choose CSS-only or JS-only approach, not both

---

## Conclusion

The theme management system has **8 identified issues** across visibility control, element referencing, and state management. The most critical is **V3 idle state handling** and **timer duplication**. A refactored `ThemeController` class would resolve most structural issues and make future theme additions simpler.

**Estimated Effort:** 
- Quick fixes (Priority 3-4): 1-2 hours
- Full refactor (Recommended): 4-6 hours
- Testing: 2-3 hours
