# Theme Management System - Quick Reference & Action Items

## Quick Element Reference by Theme

### ✓ DEFAULT Theme Elements
```
Display Container:    defaultQuestionArea
Question Box:         defaultQBox (display: flex/none)
Question Text:        defaultQText (innerHTML: question)
Points Display:       defaultQPoints (textContent: "40 ĐIỂM")
Scoreboard:           defaultScoreboard (display: flex/none)
Grid Container:       qGrid (shared - display: flex/none)
Timer Container:      timerContainerDefault (display: flex/none)
Timer Bar:            timerBarDefault (width: 0-100%)
Timer Indicator:      timerIndicatorDefault (left: 0-100%)
Hope Star:            defaultHopeStarBadge (display: flex/none)
Package Container:    defaultPackagePointsContainer
```

### ✓ ASCEND_2026 Theme Elements
```
Display Container:    ascendFrame (display: flex/none)
Question Box:         ascendQBox (display: flex/none)
Question Text:        ascendQText (innerHTML: question)
Points Display:       ascendQPoints (textContent: "40 ĐIỂM")
Points Box (top-left):ascendPtsBox (textContent: "40 ĐIỂM", bg: color)
Scoreboard:           ascendScoreboard (inside ascendFrame)
Grid Container:       qGrid (shared - display: flex/none)
Timer Container:      timerContainerAscend (display: flex/none)
Timer Bar:            timerBarAscend (width: 0-100%)
Hope Star:            ascendHopeStarBadge (display: flex/none)
Package Container:    ascendPackagePointsContainer
Question Area:        ascendQuestionArea (display: flex/none)
```

### ✓ V3 Theme Elements
```
Main Wrapper:         v3-wrapper (display: none/block)
Master Container:     v3MasterContainer (display: none/block)
Question Text:        qTextV3 (innerHTML: question)
Active Score:         v3ActiveScore (textContent: score)
Points Area:          v3PointsArea (innerHTML: points)
Timer Container:      timerContainerV3 (display: flex/none)
Timer Bar:            timerBarV3 (width: 0-100%)
Timer Handle:         timerHandleV3 (animation visual)
Grid Animation:       anim-grid-group (opacity: 0/1)
Question Animation:   anim-question-group (opacity: 0/1)
Scoreboard:           qBoxScoreboard (used for both ascend and v3)
```

---

## State Diagram: When to Show What

```
┌─ Has Package? ─────────────────────────────────────────────┐
│  (state.lockedPackage || state.pendingPackage)             │
│                                                             │
│  DEFAULT:   Show qGrid                                     │
│  ASCEND:    Show qGrid + ascendFrame                       │
│  V3:        Show v3-wrapper + trigger anim-grid-group      │
└─────────────────────────────────────────────────────────────┘

┌─ Has Question (Active)? ────────────────────────────────────┐
│  (state.currentQuestion?.active)                            │
│                                                             │
│  DEFAULT:   Show defaultQBox + defaultQArea + scoreboard   │
│  ASCEND:    Show ascendQBox + ascendQArea + ascendFrame    │
│  V3:        Show v3-wrapper + trigger anim-question-group  │
└─────────────────────────────────────────────────────────────┘

┌─ No Package, No Question (IDLE)? ──────────────────────────┐
│  (neither above)                                            │
│                                                             │
│  DEFAULT:   Show defaultScoreboard ✓                        │
│  ASCEND:    Show ascendFrame (with scoreboard) ✓            │
│  V3:        Show ??? ⚠️ BUG - Nothing shown!               │
└─────────────────────────────────────────────────────────────┘
```

---

## File Locations for Quick Edits

### screen.html
| Line Range | Purpose | Issue |
|-----------|---------|-------|
| 50-400 | CSS styling for all themes | Works as designed |
| 600-800 | HTML markup for default/ascend | Working |
| 770-1800 | V3 HTML structure | Working but missing scoreboard option |
| 1390-1700 | updateState socket handler | Has the MAIN LOGIC - check this for visibility control |
| 1440-1500 | applyVisibility() function | **CRITICAL: V3 idle state missing here** |
| 1900-2000 | V3 rendering functions | Working but incomplete |

### shared.js
| Line Range | Purpose | Issue |
|-----------|---------|-------|
| 1-30 | setThemeClass() | Working |
| 30-80 | hideAllThemeElements() | Works but could be consolidated |
| 100-150 | startThemeTimer() | **DUPLICATE of app.js version** |

### app.js
| Line Range | Purpose | Issue |
|-----------|---------|-------|
| 1-30 | State variables & socket setup | Working |
| 30-70 | showThemeGraphics() | Duplicate logic - shows all qGrid regardless of theme |
| 70-100 | applyThemeState() | **DUPLICATE of screen.html logic** |

---

## Critical Bugs to Fix (Priority Order)

### 🔴 CRITICAL - Issue #1: V3 Idle State (AFFECTS USER EXPERIENCE)

**Location:** screen.html, line ~1440, function `applyVisibility()`

**Current Code:**
```javascript
if (theme === 'v3') {
    // ... show grid/question logic
    if (typeof renderV3 === 'function') renderV3(state);
    return; // ← Returns without handling IDLE state
}
```

**Problem:** When V3 active and no package/question, nothing displays.

**Fix:**
```javascript
if (theme === 'v3') {
    if (ascendFrame) ascendFrame.style.display = 'none';
    if (defScoreboard) defScoreboard.style.display = 'none';
    if (defQArea) defQArea.style.display = 'none';
    if (ascendQArea) ascendQArea.style.display = 'none';
    if (defQBox) defQBox.style.display = 'none';
    if (ascendQBox) ascendQBox.style.display = 'none';
    if (qGridNode) qGridNode.style.display = 'none';
    
    if (v3Wrapper) {
        v3Wrapper.style.display = 'block';
        v3Wrapper.style.visibility = 'visible';
        v3Wrapper.style.opacity = '1';
    }
    if (v3Master) v3Master.style.display = 'block';
    
    // NEW: Handle idle state for V3
    if (!showGrid && !showQuestion) {
        // Show V3 scoreboard or fallback
        if (typeof renderV3Idle === 'function') {
            renderV3Idle(state);
        }
    } else if (showGrid) {
        if (typeof renderV3 === 'function') renderV3(state);
    } else {
        if (typeof renderV3 === 'function') renderV3(state);
    }
    return;
}
```

**Effort:** 15 minutes

---

### 🔴 CRITICAL - Issue #2: Duplicate Timer Implementations (CAUSES RACE CONDITIONS)

**Locations:** 
- shared.js lines 50-100
- app.js lines 80-100
- screen.html line ~1100

**Problem:** Three timer functions running simultaneously, unclear which is active.

**Fix Option A: Consolidate to app.js**
```javascript
// DELETE from shared.js:
// - startThemeTimer()
// - stopThemeTimer()

// In app.js, modify applyThemeState():
if (hasPackage) {
    showThemeGraphics(currentTheme);
    // Don't start timer here
    return;
}
```

**Fix Option B: Use only screen.html socket handler**
```javascript
// In screen.html socket.on('startCountdown'):
socket.on('startCountdown', (seconds) => {
    // Already handles all themes
    // Make sure it gets called consistently
});

// Remove duplicate calls from app.js and shared.js
```

**Recommendation:** Use Option B - consolidate all timer logic into screen.html socket handler.

**Effort:** 30 minutes

---

### 🟡 HIGH - Issue #3: Missing Element References

**Locations:** 
- screen.html line ~1635: `hopeStarBadge` ID doesn't exist
- screen.html line ~1070: `qBoxscreen-mode` ID doesn't exist

**Current Code:**
```javascript
const hopeStarBadge = document.getElementById('hopeStarBadge');
if (hopeStarBadge) hopeStarBadge.style.display = 'flex';
// ↑ FAILS - actual IDs are defaultHopeStarBadge and ascendHopeStarBadge

const qBox = document.getElementById('qBoxscreen-mode') || 
             document.getElementById('qBox');
// ↑ FAILS - qBoxscreen-mode doesn't exist, qBox is undefined
```

**Fix:**
```javascript
// For hope star badge
if (currentTheme === 'default') {
    const badge = document.getElementById('defaultHopeStarBadge');
    if (badge) badge.style.display = 'flex';
} else if (currentTheme === 'ascend_2026') {
    const badge = document.getElementById('ascendHopeStarBadge');
    if (badge) badge.style.display = 'flex';
}

// For question box reference - create mapping
const qBoxMap = {
    'default': 'defaultQBox',
    'ascend_2026': 'ascendQBox',
    'v3': 'v3MasterContainer'
};
const qBox = document.getElementById(qBoxMap[currentTheme]);
```

**Effort:** 20 minutes

---

### 🟡 HIGH - Issue #4: Ascend Points Box Dynamic Styling

**Location:** screen.html, line ~1650

**Current Code:**
```javascript
if (ascendPtsBox) {
    if (currentTheme === 'ascend_2026') {
        if (q.active) {
            ascendPtsBox.style.background = 'linear-gradient(135deg, #0abde3, #2e86de)';
            ascendPtsBox.style.color = '#fff';
            ascendPtsBox.textContent = pts ? `${pts} ${textPts}` : '';
        } else if (state.lockedPackage && (state.lockedPackage.mode === 2 || state.lockedPackage.mode === 3)) {
            ascendPtsBox.style.background = 'linear-gradient(135deg, #f5f6fa, #dcdde1)';
            ascendPtsBox.style.color = '#2f3640';
            ascendPtsBox.textContent = pts ? `${pts} ${textPts}` : '';
        } else {
            ascendPtsBox.style.background = 'linear-gradient(135deg, #f5f6fa, #dcdde1)';
            ascendPtsBox.style.color = '#2f3640';
            ascendPtsBox.textContent = '';
        }
    }
}
```

**Problem:** Overrides CSS with inline styles, making CSS maintenance difficult.

**Recommendation:** Move to CSS classes instead of inline styles

**Fix:**
```css
/* In CSS section: */
body.ascend_2026 .ascend-pts-box.active {
    background: linear-gradient(135deg, #0abde3, #2e86de) !important;
    color: #fff !important;
}

body.ascend_2026 .ascend-pts-box.idle {
    background: linear-gradient(135deg, #f5f6fa, #dcdde1) !important;
    color: #2f3640 !important;
}
```

```javascript
// In JavaScript:
if (ascendPtsBox) {
    ascendPtsBox.classList.remove('active', 'idle');
    if (q.active) {
        ascendPtsBox.classList.add('active');
        ascendPtsBox.textContent = pts ? `${pts} ${textPts}` : '';
    } else if (state.lockedPackage && (state.lockedPackage.mode === 2 || state.lockedPackage.mode === 3)) {
        ascendPtsBox.classList.add('idle');
        ascendPtsBox.textContent = pts ? `${pts} ${textPts}` : '';
    } else {
        ascendPtsBox.classList.add('idle');
        ascendPtsBox.textContent = '';
    }
}
```

**Effort:** 30 minutes

---

### 🟡 HIGH - Issue #5: Dual Visibility Control Systems

**Problem:** CSS and JavaScript both controlling visibility, hard to maintain.

**Current State:**
- CSS: `body.default .ascend-only { display: none !important; }`
- JS: `ascendFrame.style.display = 'flex'`

**Recommendation:** Consolidate to CSS-only approach using body classes

**Implementation Strategy:**
1. Keep all theme CSS rules in style section
2. Use body class only for theme identification
3. Remove all `element.style.display` direct manipulation
4. Use CSS state classes instead

**Example:**
```css
/* Instead of JS setting display */
/* Use CSS classes */

body.default .ascend-frame {
    display: none;
}

body.ascend_2026 .ascend-frame {
    display: flex;
}

body.default .default-qbox {
    display: flex;
}

body.ascend_2026 .default-qbox {
    display: none;
}
```

```javascript
// Then JavaScript only sets these classes on elements:
element.classList.add('show'); // Uses CSS to set display
// Instead of:
element.style.display = 'flex'; // Direct manipulation
```

**Effort:** 2-3 hours (requires refactoring all visibility logic)

**Recommended:** Do this as part of full system refactor

---

## Testing Checklist

After implementing fixes, verify each scenario:

### Default Theme Tests
- [ ] Package shown → qGrid visible, scoreboard hidden
- [ ] Question shown → QBox visible, qGrid hidden, scoreboard visible
- [ ] Idle state → Only scoreboard visible
- [ ] Theme switch to default works from other themes

### Ascend_2026 Theme Tests
- [ ] Package shown → qGrid visible, frame visible, QBox hidden
- [ ] Question shown → QBox visible, QArea visible, frame visible, qGrid hidden
- [ ] Idle state → Frame visible with scoreboard only
- [ ] Points box changes color when question active
- [ ] Points box shows correct points
- [ ] Theme switch to ascend_2026 works

### V3 Theme Tests
- [ ] Package shown → v3-wrapper visible, anim-grid-group animated in
- [ ] Question shown → v3-wrapper visible, anim-question-group animated in
- [ ] **⚠️ BUG**: Idle state → ✗ Currently blank (should fix)
- [ ] Timer starts/stops correctly
- [ ] Scoreboard accessible (if possible)
- [ ] Theme switch to v3 works

### Timer Tests
- [ ] startCountdown fires timer for all themes
- [ ] Timer completes and resets
- [ ] stopCountdown stops timer
- [ ] No duplicate timer intervals running

### Cross-Theme Tests
- [ ] Switch default → ascend → v3 → default (verify visibility)
- [ ] Package visible during theme switch
- [ ] Question visible during theme switch
- [ ] No console errors during transitions

---

## Code Quality Improvements (Lower Priority)

### Suggestion #1: Create Theme Configuration Object
```javascript
const THEMES = {
    default: {
        name: 'Default',
        cssClass: 'default',
        elements: {
            qBox: 'defaultQBox',
            qArea: 'defaultQuestionArea',
            qText: 'defaultQText',
            scoreboard: 'defaultScoreboard',
            timer: 'timerContainerDefault'
        }
    },
    ascend_2026: {
        name: 'Ascend 2026',
        cssClass: 'ascend_2026',
        elements: {
            qBox: 'ascendQBox',
            qArea: 'ascendQuestionArea',
            qText: 'ascendQText',
            scoreboard: 'ascendScoreboard',
            timer: 'timerContainerAscend'
        }
    },
    v3: {
        name: 'V3 Econova',
        cssClass: 'v3',
        elements: {
            wrapper: 'v3-wrapper',
            master: 'v3MasterContainer',
            qText: 'qTextV3',
            timer: 'timerContainerV3'
        }
    }
};
```

### Suggestion #2: Create Generic Visibility Controller
```javascript
class ThemeVisibilityController {
    constructor(themeConfig) {
        this.config = themeConfig;
        this.currentTheme = 'default';
        this.currentPhase = 'idle';
    }

    setTheme(themeName) {
        this.currentTheme = themeName;
        document.body.className = themeName + ' main-screen';
    }

    show(elementIds) {
        elementIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
    }

    hide(elementIds) {
        elementIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    apply(state) {
        const hasPackage = state.lockedPackage || state.pendingPackage;
        const hasQuestion = state.currentQuestion?.active;

        if (hasPackage) {
            this.applyPhase('grid', state);
        } else if (hasQuestion) {
            this.applyPhase('question', state);
        } else {
            this.applyPhase('idle', state);
        }
    }

    applyPhase(phase, state) {
        this.hideAll();
        // Theme-specific logic
        if (this.currentTheme === 'default') {
            this.applyDefaultPhase(phase);
        } else if (this.currentTheme === 'ascend_2026') {
            this.applyAscendPhase(phase);
        } else if (this.currentTheme === 'v3') {
            this.applyV3Phase(phase);
        }
    }

    hideAll() {
        // Hide everything
    }
}
```

---

## Implementation Timeline

### Week 1 (Critical Fixes)
- **Day 1-2:** Fix V3 idle state (Issue #1)
- **Day 3:** Consolidate timer implementations (Issue #2)  
- **Day 4:** Fix element references (Issue #3)
- **Day 5:** Testing

### Week 2 (Quality Improvements)
- **Day 1-3:** Refactor to CSS-only visibility (Issue #5)
- **Day 4:** Ascend points box styling (Issue #4)
- **Day 5:** Create ThemeVisibilityController class

### Week 3 (Testing & Documentation)
- **Day 1-2:** Comprehensive testing across all themes
- **Day 3:** Update documentation
- **Day 4-5:** Performance testing & optimization

---

## Questions to Ask Before Refactoring

1. **Is V3 theme complete and ready?** 
   - If not, focus only on critical bugs
   
2. **Are other themes (default, ascend) production-ready?**
   - If yes, refactor with caution to avoid regression
   
3. **How much time is available?**
   - Quick fixes: 2-3 hours (Priority 1-3)
   - Full refactor: 4-6 hours (Priority 1-5)
   - Complete rewrite with ThemeController: 8-10 hours
   
4. **What's the most urgent issue?**
   - User-facing: V3 idle state (Issue #1)
   - Technical debt: Timer duplication (Issue #2)
   - Both impact production quality

5. **Should this include V3 scoreboard option?**
   - Would require new V3 scoreboard HTML/CSS
   - Estimated +2-3 hours

---

## References in Code

### Where themes are switched
- **app.js** line 58: `applyThemeState()` sets currentTheme
- **shared.js** line 3: `setThemeClass()` applies to document.body
- **screen.html** line ~1395: Socket handler sets theme from state.settings.theme

### Where visibility is controlled
- **screen.html** line ~1440: `applyVisibility()` main visibility logic
- **screen.html** line ~1100: Timer start/stop listeners
- **shared.js** line ~45: `hideAllThemeElements()` clear function

### Where content is rendered
- **screen.html** line ~1410: Grid cells rendered
- **screen.html** line ~1500: Scoreboards rendered
- **screen.html** line ~1650: Question text and points rendered
- **screen.html** line ~2000: V3-specific rendering functions

