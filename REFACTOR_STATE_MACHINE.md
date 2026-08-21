# STATE MACHINE REFACTORING - Detailed Analysis & Proposed Solution

**Date:** 2026-06-24  
**Focus:** Derive strict `mState` from backend `state` properties; implement tab-aware rendering

---

## 1. CURRENT STATE MACHINE ANALYSIS

### 1.1 What Exists Today

**screen.html (lines 962-1611):**
```javascript
socket.on('updateState', (state) => {
    // No mState variable defined
    // Logic scattered:
    // - Line 1027: state.activeRound check
    // - Line 1031: state.activeRound === 1 check
    // - Line 1437: showGrid = Boolean(state.isGridVisibleOnOverlay || state.lockedPackage || state.pendingPackage)
    // - Line 1438: showQuestion = Boolean(q && q.active)
    // - Line 1434-1544: applyVisibility() uses showGrid/showQuestion directly
```

**overlay.html (lines 789-1145):**
```javascript
socket.on('updateState', (state) => {
    // Line 843: state.activeRound === 1 → hide everything
    // Line 1070: showGrid = Boolean(state.isGridVisibleOnOverlay || state.lockedPackage || state.pendingPackage)
    // Line 1071: showQuestion = Boolean(q && q.active)
    // Line 1068-1135: applyVisibility() (different from screen.html version)
```

**Problems Identified:**

| Problem | Location | Impact |
|---------|----------|--------|
| No state machine (`mState`) variable | Both files | Makes it unclear what state UI is in |
| Logic scattered across event handler | Lines ~1012-1044 (screen), ~839-860 (overlay) | Hard to track state transitions |
| No `activeTab` tracking | N/A | Can't distinguish between Round 1, Round 2, etc. |
| `activeRound` != `activeTab` (tab awareness) | Screen.html line 1031 | Only handles "Round 1" special case, not general tab switching |
| Initial state unclear on page load | Both files | If no updateState fires, UI is blank |
| No explicit "blackout" (idle) state | N/A | Confusion about when to hide all graphics |
| Redundant logic between files | screen.html vs overlay.html | Different applyVisibility() implementations |

---

## 2. PROPOSED STATE MACHINE (mState)

### 2.1 State Definition (Strict Priority)

```javascript
/**
 * mState values:
 *   0 = IDLE/HIDDEN (Blackout)
 *        - No graphics visible
 *        - Show only scoreboard (screen.html) or nothing (overlay.html)
 *
 *   1 = GRID_ACTIVE (Package/Question Selection)
 *        - Show grid of questions
 *        - Hide question box
 *
 *   2 = QUESTION_ACTIVE (Question Being Answered)
 *        - Show question box
 *        - Hide grid
 */
```

### 2.2 mState Calculation Rules (Strict Priority Order)

```
Function: calculateMState(state, isOverlayApp) {

  // FIRST: Check if system is completely reset/empty
  if (!state.teams || state.teams.length === 0) {
    return mState = 0;  // IDLE (no teams)
  }

  // SECOND: Check if server explicitly commands hide
  if (state.hideAllGraphics === true) {
    return mState = 0;  // IDLE (server command)
  }

  // THIRD: Check if QUESTION is currently active
  const hasActiveQuestion = Boolean(state.currentQuestion && state.currentQuestion.active);
  if (hasActiveQuestion) {
    return mState = 2;  // QUESTION_ACTIVE
  }

  // FOURTH: Check if package exists (grid phase)
  const hasPackage = Boolean(state.lockedPackage || state.pendingPackage);
  if (hasPackage) {
    // Special case: Mode 2/3 - package might be finished
    if (state.lockedPackage && state.lockedPackage.questions) {
      const isFinished = state.lockedPackage.currentIndex >= state.lockedPackage.questions.length;
      if (isFinished) {
        return mState = 0;  // IDLE (package finished)
      }
    }
    return mState = 1;  // GRID_ACTIVE
  }

  // FIFTH: Default to IDLE
  return mState = 0;  // IDLE (no package, no question)
}
```

### 2.3 Mode 1 Exception (Only applies when question resolved in Mode 1)

```javascript
// After resolving a question, if Mode 1:
if (state.currentRound === 1 && state.currentQuestion && !state.currentQuestion.active) {
    // Question just finished, but package not complete
    
    if (window.location.pathname.includes('overlay')) {
        // OVERLAY: Hide unless isGridVisibleOnOverlay
        mState = state.isGridVisibleOnOverlay ? 1 : 0;
    } else {
        // SCREEN: Always show grid
        mState = 1;
    }
}
```

---

## 3. TAB-AWARE RENDERING (NEW)

### 3.1 Tab Tracking

**Assumption:** Backend sends `state.activeTab` indicating which tab is currently active.

```javascript
// Example values:
// - state.activeTab = 'Round 1'
// - state.activeTab = 'Round 2'
// - state.activeTab = 'Admin'
// - state.activeTab = null (no tab active)
```

### 3.2 Tab-Aware State Machine

```javascript
Function: calculateMStateWithTabAwareness(state, isOverlayApp) {

  // NEW: If tab is not active, force IDLE
  const isTabActive = Boolean(state.activeTab);
  if (!isTabActive) {
    return mState = 0;  // IDLE (no active tab)
  }

  // NEW: Verify this display matches the active tab
  const isScreenDisplay = !isOverlayApp;
  const isOverlayDisplay = isOverlayApp;
  
  // If tab changed, ensure graphics are cleared
  if (window.lastActiveTab && window.lastActiveTab !== state.activeTab) {
    console.log(`[TAB SWITCH] ${window.lastActiveTab} → ${state.activeTab}`);
    clearAllGraphicsForTheme(currentTheme);  // Full cleanup
  }
  window.lastActiveTab = state.activeTab;

  // THEN: Apply standard mState calculation
  return calculateMState(state, isOverlayApp);
}
```

### 3.3 Special Case: Round 1 vs Round 2+

**Current behavior (screen.html line 1031):**
```javascript
if (state.activeRound === 1) {
    // Special handling for Round 1
}
```

**New behavior:**
```javascript
// Map activeTab to activeRound
const roundNumber = state.activeTab === 'Round 1' ? 1 : (state.activeTab === 'Round 2' ? 2 : null);

if (roundNumber === 1) {
    // Round 1: Show round-specific graphics (timer, etc.)
    // Hide question grid/box initially
    mState = 0;  // Default IDLE for Round 1
} else if (roundNumber === 2) {
    // Round 2+: Show normal graphics based on mState
    // Use standard mState calculation
}
```

---

## 4. CURRENT CODE ISSUES & FIXES

### Issue #1: Screen.html Default Idle State Bug (Line 1338-1347)

**Current Code:**
```javascript
if (theme === 'default') {
    defQArea.style.display = 'flex';   // ← Shows empty container
    defQBox.style.display = 'none';    // ← Hides content
    // Result: Empty space visible in idle state ❌
}
```

**Root Cause:** When `mState = 0` (idle), code still sets `defQArea` to flex.

**Fix Required:**
```javascript
if (mState === 0) {
    // IDLE: Hide all question areas
    defQArea.style.display = 'none';
    defQBox.style.display = 'none';
} else if (mState === 1) {
    // GRID: Show grid, hide question
    defQArea.style.display = 'flex';
    defQBox.style.display = 'none';
    qGrid.style.display = 'flex';
} else if (mState === 2) {
    // QUESTION: Show question, hide grid
    defQArea.style.display = 'flex';
    defQBox.style.display = 'flex';
    qGrid.style.display = 'none';
}
```

### Issue #2: Ascend 2026 Theme Overlap (Line 1475-1485)

**Current Code:**
```javascript
if (theme === 'ascend_2026') {
    ascendFrame.style.display = 'flex';
    defQArea.style.display = 'none';  // ← Tries to hide default
    ascendQArea.style.display = 'flex';
    if (showGrid) {
        qGridNode.style.display = 'flex';  // ← Grid + Question compete
        ascendQArea.style.display = 'none';  // ← Unclear priority
        return;
    }
    if (showQuestion) {
        ascendQBox.style.display = 'flex';  // ← Question shown
        ascendQArea.style.display = 'flex';
        return;
    }
}
```

**Root Cause:** Grid and Question visibility set inconsistently; CSS !important rules conflict.

**Fix Required:**
```javascript
if (mState === 0) {
    // ASCEND IDLE: Hide all graphics
    ascendFrame.style.display = 'none';
    ascendQArea.style.display = 'none';
    ascendQBox.style.display = 'none';
    qGrid.style.display = 'none';
} else if (mState === 1) {
    // ASCEND GRID: Show frame + grid only
    ascendFrame.style.display = 'flex';
    ascendQArea.style.display = 'none';  // ← Critical: hide question area
    ascendQBox.style.display = 'none';   // ← Critical: hide question box
    qGrid.style.display = 'flex';        // ← Show grid
} else if (mState === 2) {
    // ASCEND QUESTION: Show frame + question only
    ascendFrame.style.display = 'flex';
    ascendQArea.style.display = 'flex';  // ← Show question area
    ascendQBox.style.display = 'flex';   // ← Show question box
    qGrid.style.display = 'none';        // ← Hide grid
}
```

### Issue #3: V3 Theme Blackout Not Working (Line 1448-1462)

**Current Code:**
```javascript
if (theme === 'v3') {
    if (v3Wrapper) {
        v3Wrapper.style.display = 'block';   // ← Always shown?
        v3Wrapper.style.opacity = '1';       // ← Always opaque?
    }
    if (showGrid || showQuestion) {
        renderV3(state);
    } else {
        renderV3(state);  // ← Same code both branches!
    }
}
```

**Root Cause:** V3 wrapper always visible; renderV3 called regardless of state.

**Fix Required:**
```javascript
if (mState === 0) {
    // V3 IDLE: Blackout
    if (v3Wrapper) {
        v3Wrapper.style.display = 'none';
        v3Wrapper.style.opacity = '0';
        v3Wrapper.style.visibility = 'hidden';
    }
    if (v3Master) v3Master.style.display = 'none';
} else {
    // V3 GRID or QUESTION: Show and render
    if (v3Wrapper) {
        v3Wrapper.style.display = 'block';
        v3Wrapper.style.opacity = '1';
        v3Wrapper.style.visibility = 'visible';
    }
    if (v3Master) v3Master.style.display = 'block';
    
    if (typeof renderV3 === 'function') {
        renderV3(state);
    }
}
```

### Issue #4: Overlay.html Round 1 Logic (Line 843-844)

**Current Code:**
```javascript
if (state.activeRound === 1) {
    mainContainer.style.visibility = 'hidden';
    mainContainer.style.opacity = '0';
}
```

**Problem:** Hides ALL graphics during Round 1, but should respect `state.isGridVisibleOnOverlay`.

**Fix Required:**
```javascript
if (state.activeRound === 1) {
    // Round 1: Overlay stays hidden by default
    if (state.isGridVisibleOnOverlay) {
        // Unless server explicitly commands grid visibility
        mState = 1;  // Show grid
    } else {
        mState = 0;  // Hide all (default for Round 1 overlay)
    }
} else {
    // Round 2+: Use normal mState calculation
    mState = calculateMState(state, isOverlayApp);
}
```

---

## 5. IMPLEMENTATION ROADMAP

### Phase 1: Add mState Variable

**Both files (screen.html ~line 962, overlay.html ~line 789):**
```javascript
socket.on('updateState', (state) => {
    // ADD: mState calculation function at top of handler
    let mState = 0;  // Default idle
    
    // ADD: Calculate mState based on strict rules
    // (See section 2.2 above)
    
    // THEN: Use mState in applyVisibility()
    // (Replace showGrid/showQuestion logic)
});
```

### Phase 2: Extract calculateMState Function

```javascript
// Add as helper function OUTSIDE socket handler
function calculateMState(state, isOverlayApp = false) {
    // Implement strict priority rules (section 2.2)
    // Return mState value: 0, 1, or 2
}

function calculateMStateWithTabAwareness(state, isOverlayApp = false) {
    // Wrap calculateMState with tab tracking (section 3.2)
}
```

### Phase 3: Update applyVisibility()

**Both files:**
```javascript
function applyVisibility(state, mState) {
    // Input: mState (0, 1, or 2)
    // No more showGrid/showQuestion boolean logic
    // Direct: if (mState === 0) { ... } else if (mState === 1) { ... } ...
}
```

### Phase 4: Add clearAllGraphicsForTheme()

**Both files:**
```javascript
function clearAllGraphicsForTheme(theme) {
    // When tab switches, completely unmount old theme graphics
    // Set all display: none, opacity: 0, visibility: hidden
    // Prevent stale elements from appearing
}
```

### Phase 5: Test All State Transitions

```
Test Cases:
1. Initial load → No state → mState = 0 (idle) ✓
2. Package selected → mState = 1 (grid) ✓
3. Question becomes active → mState = 2 (question) ✓
4. Question resolved → mState = 1 (grid again) ✓
5. Package finished → mState = 0 (idle) ✓
6. Tab switched → mState = 0 (idle) + clearGraphics() ✓
7. Round 1 special case → mState = 0 by default ✓
8. isGridVisibleOnOverlay override → mState respected ✓
```

---

## 6. CRITICAL WARNINGS

### ⚠️ CSS !important Still a Problem

**Files affected:** screen.html lines 111, 184-186

```css
body.default .ascend-only { display: none !important; }
body.ascend_2026 .default-only { display: none !important; }
```

**Issue:** These rules override JavaScript `display` assignments.

**Action Required:** Either:
1. Remove `!important` from CSS (prefer)
2. Use `element.style.setProperty('display', 'flex', 'important')` in JS

### ⚠️ renderV3 Race Condition

**File:** screen.html line 1308

```javascript
if (typeof renderV3 === 'function') renderV3(state);
```

**Issue:** renderV3 defined in DOMContentLoaded scope; may not exist when called.

**Action Required:** Ensure renderV3 attached to window object.

### ⚠️ Missing activeTab in State

**Current:** State has `activeRound` but not `activeTab`

**Action Required:** Backend must add `state.activeTab` to distinguish between different tabs.

---

## 7. SUMMARY TABLE: What Should Change

| Component | Current | Should Be | Priority |
|-----------|---------|-----------|----------|
| **mState variable** | Not defined | `let mState = 0;` in handler | CRITICAL |
| **applyVisibility logic** | Boolean showGrid/showQuestion | if (mState === 0/1/2) | CRITICAL |
| **V3 blackout** | Always rendered | Hide when mState = 0 | HIGH |
| **Ascend grid/question conflict** | Both can show | Only one at a time (mState dependent) | HIGH |
| **Tab awareness** | None | Use state.activeTab for clearing | MEDIUM |
| **Default idle state** | Shows empty area | Shows nothing or scoreboard only | HIGH |
| **Overlay Round 1 logic** | Fixed "hidden" | Respect isGridVisibleOnOverlay | MEDIUM |
| **CSS !important** | Blocks JS | Should be removable (or use !important in JS) | MEDIUM |
| **renderV3 scope** | Local to DOMContentLoaded | Attach to window | MEDIUM |

---

**Next Steps:**
1. Implement Phase 1: Add mState variable
2. Implement Phase 2: Extract calculateMState function
3. Update both applyVisibility functions
4. Test all state transitions
5. Fix CSS conflicts as needed
