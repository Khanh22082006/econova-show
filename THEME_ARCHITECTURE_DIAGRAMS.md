# Econova Show - Theme Management Architecture Diagrams

## Diagram 1: Overall Theme System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ECONOVA SHOW SCREEN                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            <div id="main-container">                    │  │
│  │                                                          │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌──────────────────┐   │  │
│  │  │ DEFAULT     │  │ ASCEND   │  │ V3 WRAPPER       │   │  │
│  │  │ THEME       │  │ 2026     │  │ (nested)         │   │  │
│  │  │ ELEMENTS    │  │ ELEMENTS │  │ ┌──────────────┐ │   │  │
│  │  │             │  │          │  │ │ v3MasterCont│ │   │  │
│  │  │ • defaultQB │  │ • ascend │  │ │ • shape-cont│ │   │  │
│  │  │ • defaultQA │  │ • ascendQ│  │ │ • anim-grid │ │   │  │
│  │  │ • defaultSc │  │ • ascendS│  │ │ • anim-quest│ │   │  │
│  │  │ • timerDef  │  │ • timerA │  │ │ • svg shapes│ │   │  │
│  │  │ • qGrid     │  │ • timerA │  │ │              │ │   │  │
│  │  │             │  │ • ascendF│  │ └──────────────┘ │   │  │
│  │  │ Display:    │  │          │  │                  │   │  │
│  │  │ display:flex│  │ Display: │  │ Display: none    │   │  │
│  │  │ OR none     │  │ display: │  │ (default)        │   │  │
│  │  │             │  │ flex/none│  │                  │   │  │
│  │  └─────────────┘  └──────────┘  └──────────────────┘   │  │
│  │                                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

CSS CLASS: <body class="default | ascend_2026 | v3 main-screen">
           └─ Determines which theme-specific CSS rules apply
```

---

## Diagram 2: Theme State Machine

```
                              THEME SELECTION
                                    ↓
                ┌───────────────────┼───────────────────┐
                ↓                   ↓                   ↓
            DEFAULT            ASCEND_2026              V3
        (body.default)      (body.ascend_2026)      (body.v3)
                │                   │                   │
                │ UPDATE STATE      │ UPDATE STATE      │ UPDATE STATE
                ↓                   ↓                   ↓
            
        ┌─────────────────────────────────────────────┐
        │       applyVisibility(state)                │
        │       Checks: hasPackage?                   │
        │               hasQuestion?                  │
        │               hasIdle?                      │
        └─────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
    
    DEFAULT THEME        ASCEND THEME          V3 THEME
    ─────────────        ────────────          ────────
    
    IF hasPackage:       IF hasPackage:        IF hasPackage:
    ├─ Show qGrid        ├─ Show qGrid         ├─ Show v3Master
    ├─ Hide QBox         ├─ Show ascendFrame   ├─ Show v3Wrapper
    └─ Hide Score        ├─ Hide ascendQBox    └─ Trigger grid anim
                         └─ Hide ascendQArea
    
    IF hasQuestion:      IF hasQuestion:       IF hasQuestion:
    ├─ Hide qGrid        ├─ Hide qGrid         ├─ Show v3Master
    ├─ Show QBox         ├─ Show ascendQBox    ├─ Show v3Wrapper
    ├─ Show QArea        ├─ Show ascendQArea   └─ Trigger Q anim
    └─ Show Scoreboard   ├─ Show ascendFrame
                         └─ Show Scoreboard
    
    IF idle:             IF idle:              IF idle:
    ├─ Hide qGrid        ├─ Hide qGrid         ├─ Hide v3Master ⚠️
    ├─ Hide QBox         ├─ Hide ascendQBox    ├─ Hide v3Wrapper ⚠️
    └─ Show Scoreboard   ├─ Show ascendFrame   └─ Nothing shown! ⚠️
                         └─ Show Scoreboard
```

---

## Diagram 3: HTML Element Hierarchy by Theme

### DEFAULT Theme Structure
```
<body class="default main-screen">
    <div id="main-container">
        ├─ <div class="bg-grid default-only"></div>           [Background grid]
        │
        ├─ <div id="defaultQuestionArea" class="question-area default-only">
        │   ├─ <div id="defaultPackagePointsContainer"></div>
        │   └─ <div id="defaultQBox" class="question-box">
        │       ├─ <div id="defaultQPoints" class="q-meta"></div>
        │       ├─ <div id="defaultHopeStarBadge" class="hope-star-badge"></div>
        │       ├─ <div id="defaultQText" class="question-text"></div>
        │       └─ <div id="timerContainerDefault" class="timer-olympia-style">
        │           └─ <div id="timerBarDefault" class="timer-red-fill"></div>
        │               └─ <div id="timerIndicatorDefault" class="timer-circle"></div>
        │
        ├─ <div id="qGrid" style="display: none">            [Shared by all themes]
        │   ├─ <div class="grid-col">
        │   │   ├─ <div class="grid-header">10 ĐIỂM</div>
        │   │   └─ <div id="grid10" class="grid-cells"></div>
        │   │       └─ <div class="q-cell">1</div> ... <div class="q-cell">12</div>
        │   ├─ <div class="grid-col">
        │   │   ├─ <div class="grid-header">20 ĐIỂM</div>
        │   │   └─ <div id="grid20" class="grid-cells"></div>
        │   └─ <div class="grid-col">
        │       ├─ <div class="grid-header">40 ĐIỂM</div>
        │       └─ <div id="grid40" class="grid-cells"></div>
        │
        └─ <div id="defaultScoreboard" class="scoreboard-area default-only">
            ├─ <div class="team-card">
            │   ├─ <div class="team-name">Team 1</div>
            │   ├─ <div class="team-school">School A</div>
            │   └─ <div class="team-score">100</div>
            └─ ... [repeat for each team]
```

### ASCEND_2026 Theme Structure
```
<body class="ascend_2026 main-screen">
    <div id="main-container">
        ├─ <div id="ascendFrame" class="ascend-frame" style="display: flex">
        │   ├─ <div class="ascend-top-bar ascend-only">
        │   │   ├─ <div id="ascendPtsBox" class="ascend-pts-box">40 ĐIỂM</div>
        │   │   └─ <div id="ascendScoreboard" class="ascend-scoreboard">
        │   │       └─ <div class="team-card">
        │   │           ├─ <div class="team-name">
        │   │           │   └─ <span class="name-inner">Team 1</span>
        │   │           └─ <div class="team-score">100</div>
        │   │
        │   ├─ <div id="ascendQuestionArea" class="question-area ascend-only">
        │   │   ├─ <div id="ascendPackagePointsContainer"></div>
        │   │   └─ <div id="ascendQBox" class="question-box">
        │   │       ├─ <div id="ascendQPoints" class="q-meta"></div>
        │   │       ├─ <div id="ascendHopeStarBadge"></div>
        │   │       └─ <div id="ascendQText" class="question-text"></div>
        │   │
        │   └─ <div id="timerContainerAscend" class="ascend-only">
        │       └─ <div id="timerBarAscend"></div>
        │
        ├─ <div id="qGrid" style="display: none">        [Shared - shown when package selected]
        │   └─ [Same structure as DEFAULT]
        │
        └─ [rest same as DEFAULT]
```

### V3 Theme Structure
```
<body class="v3 main-screen">
    <div id="main-container">
        ├─ [DEFAULT elements hidden via .default-only CSS]
        │
        ├─ <div id="v3-wrapper" style="display: none" z-index: 5000>
        │   └─ <div id="v3MasterContainer" class="v3-new-root screen-mode">
        │       └─ <div class="shape-container anim-container">
        │           ├─ [Decorative shapes: cyan-color, navy-color layers]
        │           │
        │           ├─ <div class="anim-grid-group" opacity: 0>  [Hidden until triggered]
        │           │   ├─ <div class="shape-layer grid-bg"></div>
        │           │   ├─ <div class="shape-layer a-grid-content"></div>
        │           │   └─ <svg class="svg-strokes s-g-svg">
        │           │       └─ [Grid border paths]
        │           │
        │           └─ <div class="anim-question-group" opacity: 0> [Hidden until triggered]
        │               ├─ <div class="o-bg a-q-bg">
        │               │   ├─ <div class="ov-left-content">
        │               │   │   ├─ <div class="ov-top-bar o-top-bar">
        │               │   │   │   └─ [Team tabs - player-poly]
        │               │   │   ├─ <div class="ov-question-wrapper">
        │               │   │   │   └─ <div id="qTextV3"></div>
        │               │   │   └─ <div id="timerContainerV3">
        │               │   │       └─ <div id="timerBarV3"></div>
        │               │   │
        │               │   └─ <div class="ov-score-panel">
        │               │       ├─ <div id="v3ActiveScore"></div>
        │               │       └─ <div id="v3PointsArea"></div>
        │               │
        │               └─ <svg class="svg-strokes s-o-svg">
        │                   └─ [Question overlay border paths]
        │
        ├─ <div id="qGrid" style="display: none">  [Shared - V3 uses anim-grid-group instead]
        │
        └─ [DEFAULT scoreboards hidden]
```

---

## Diagram 4: Visibility State Transitions

```
SOCKET EVENT: updateState(state)
                    │
                    ↓
        Extract theme from state
                    │
        ┌───────────┼───────────┐
        ↓           ↓           ↓
    DEFAULT    ASCEND_2026      V3

PHASE DETECTION:
    - hasPackage = !!state.lockedPackage || !!state.pendingPackage
    - hasQuestion = !!state.currentQuestion?.active
    - hasIdle = !hasPackage && !hasQuestion

                    │
        ┌───────────┼───────────┐
        ↓           ↓           ↓
    PACKAGE     QUESTION      IDLE

VISIBILITY RULES:

┌─────────────────────────────────────────────────────────┐
│ DEFAULT + PACKAGE                                       │
│ ┌────────────────────────────────────────────────────┐ │
│ │ defaultQBox:      display: none  ✓                │ │
│ │ defaultQArea:     display: none  ✓                │ │
│ │ defaultScoreboard: display: none  ✓               │ │
│ │ qGrid:            display: flex  ✓               │ │
│ │ ascendFrame:      display: none  ✓               │ │
│ │ v3Wrapper:        display: none  ✓               │ │
│ └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ DEFAULT + QUESTION                                      │
│ ┌────────────────────────────────────────────────────┐ │
│ │ defaultQBox:      display: flex  ✓                │ │
│ │ defaultQArea:     display: flex  ✓                │ │
│ │ defaultScoreboard: display: flex  ✓               │ │
│ │ qGrid:            display: none  ✓               │ │
│ │ ascendFrame:      display: none  ✓               │ │
│ │ v3Wrapper:        display: none  ✓               │ │
│ └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ DEFAULT + IDLE                                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │ defaultQBox:      display: none  ✓                │ │
│ │ defaultQArea:     display: none  ✓                │ │
│ │ defaultScoreboard: display: flex  ✓               │ │
│ │ qGrid:            display: none  ✓               │ │
│ │ ascendFrame:      display: none  ✓               │ │
│ │ v3Wrapper:        display: none  ✓               │ │
│ └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ ASCEND + PACKAGE                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ ascendFrame:      display: flex  ✓                │ │
│ │ ascendQBox:       display: none  ✓                │ │
│ │ ascendQArea:      display: none  ✓                │ │
│ │ qGrid:            display: flex  ✓                │ │
│ │ defaultQBox:      display: none  ✓                │ │
│ │ v3Wrapper:        display: none  ✓                │ │
│ └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ ASCEND + QUESTION                                       │
│ ┌────────────────────────────────────────────────────┐ │
│ │ ascendFrame:      display: flex  ✓                │ │
│ │ ascendQBox:       display: flex  ✓                │ │
│ │ ascendQArea:      display: flex  ✓                │ │
│ │ qGrid:            display: none  ✓                │ │
│ │ defaultQBox:      display: none  ✓                │ │
│ │ v3Wrapper:        display: none  ✓                │ │
│ └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ V3 + PACKAGE                                            │
│ ┌────────────────────────────────────────────────────┐ │
│ │ v3Wrapper:        display: block  ✓               │ │
│ │ v3MasterContainer: display: block  ✓              │ │
│ │ anim-grid-group:  opacity: 1  ✓                  │ │
│ │ qGrid:            display: none  ✓               │ │
│ │ ascendFrame:      display: none  ✓               │ │
│ │ defaultQBox:      display: none  ✓               │ │
│ └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ V3 + QUESTION                                           │
│ ┌────────────────────────────────────────────────────┐ │
│ │ v3Wrapper:         display: block  ✓              │ │
│ │ v3MasterContainer:  display: block  ✓             │ │
│ │ anim-question-group: opacity: 1  ✓               │ │
│ │ qGrid:             display: none  ✓              │ │
│ │ ascendFrame:       display: none  ✓              │ │
│ │ defaultQBox:       display: none  ✓              │ │
│ └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ V3 + IDLE                    ⚠️ ISSUE!                │
│ ┌────────────────────────────────────────────────────┐ │
│ │ v3Wrapper:        display: none  ⚠️  NO SCOREBOARD!│ │
│ │ v3MasterContainer: display: none  ⚠️              │ │
│ │ qGrid:            display: none  ⚠️              │ │
│ │ ascendFrame:      display: none  ⚠️              │ │
│ │ defaultQBox:      display: none  ⚠️              │ │
│ │ defaultScoreboard: display: none  ⚠️  (hidden)    │ │
│ │                                                      │
│ │ RESULT: BLANK SCREEN ❌                            │ │
│ └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Diagram 5: CSS Class System vs JavaScript System Conflict

```
                    DUAL VISIBILITY CONTROL
                            │
                ┌───────────┴───────────┐
                ↓                       ↓
            CSS CLASSES         JAVASCRIPT
            ───────────         ──────────
            (Static)            (Dynamic)
                │                       │
    body.default {                      │
        color: white;                   │
    }                                   │
                                        │
    .default-only {                     │
        display: none !important;       │
    }                                   │
                                        │
    body.default .ascend-only {         │
        display: none !important;       │
    }                                   │
                                        │
    body.ascend_2026 .question-box {    │
        background: transparent;        │
        border: none;                   │
    }                                   │
                    │                   │
                    └───────┬───────────┘
                            ↓
            [USER SCRIPT RUNS]
            ascendFrame.style.display = 'flex'
            defaultQBox.style.display = 'flex'
            qGrid.style.display = 'flex'
                            │
                            ↓
            CASCADE CONFLICT:
            
            CSS says: .default-only { display: none !important; }
            JS says:  qGrid.style.display = 'flex';
            
            WINNER: !important wins ✓
            But unclear and fragile!
```

---

## Diagram 6: Timer Implementation Conflict

```
                THREE TIMER SYSTEMS
                        │
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
    
    SYSTEM 1       SYSTEM 2          SYSTEM 3
    (shared.js)    (app.js)           (screen.html)
    ──────────     ────────           ────────────
    
    Function:      Function:          Socket handler:
    startThemeTimer() startThemeTimer() socket.on(
        │              │                   'startCountdown'
        │              │               )
        ├─ Gets IDs:   ├─ Calls        ├─ Gets elements:
        │  from map    │  shared.js    │  timerContainerDefault
        │              │  version      │  timerContainerAscend
        ├─ Uses        └─ Duplicates   └─ Starts interval
        │  setInterval│  interval      
        └─ Updates    
           width%     
    
    
    RESULT: Multiple intervals running!
            Multiple DOM updates!
            Race conditions possible!
            Unclear which code is executing!
```

---

## Diagram 7: Element Naming Inconsistency

```
Similar Elements, Different Naming:

QUESTION TEXT
├─ Default:    defaultQText
├─ Ascend:     ascendQText
├─ V3:         qTextV3 ← Different pattern!

POINTS DISPLAY
├─ Default:    defaultQPoints
├─ Ascend:     ascendQPoints
├─ V3:         v3ActiveScore ← Different meaning!

QUESTION BOX
├─ Default:    defaultQBox
├─ Ascend:     ascendQBox
├─ V3:         (nested in anim-question-group) ← No dedicated element!

QUESTION AREA
├─ Default:    defaultQuestionArea
├─ Ascend:     ascendQuestionArea
├─ V3:         (combined in v3MasterContainer) ← Different structure!

TIMER CONTAINER
├─ Default:    timerContainerDefault
├─ Ascend:     timerContainerAscend
├─ V3:         timerContainerV3 ← Pattern matches, but structure differs

CONSEQUENCE:
────────────
Cannot write generic function like:
    
    function hideQBox(theme) {
        const qBox = document.getElementById(${theme}QBox);
        if (qBox) qBox.style.display = 'none';
    }
    
    // Fails for V3! qBox doesn't exist with that ID.

Must write theme-specific logic everywhere:
    
    if (theme === 'default') {
        document.getElementById('defaultQBox').style.display = 'none';
    } else if (theme === 'ascend_2026') {
        document.getElementById('ascendQBox').style.display = 'none';
    } else if (theme === 'v3') {
        // V3 doesn't have separate qBox element
        document.querySelector('#v3MasterContainer .anim-question-group').style.opacity = '0';
    }
```

---

## Diagram 8: Recommended Unified Architecture

```
                    UNIFIED THEME CONTROLLER
                              │
                ┌─────────────┴──────────────┐
                ↓                            ↓
            
        ┌───────────────────┐      ┌────────────────────┐
        │   THEME CLASS     │      │   THEME DATA       │
        │   CONFIGURATION   │      │   REGISTRY         │
        ├───────────────────┤      ├────────────────────┤
        │ const themes = {  │      │ Elements per theme:│
        │   default: {      │      │ - defaultQBox      │
        │     elements: {   │      │ - ascendQBox       │
        │       qBox: 'def' │      │ - v3MasterCont    │
        │       qArea: ...  │      │ - ...              │
        │       timer: ...  │      │                    │
        │     },            │      │ Selectors:         │
        │     css: 'default'│      │ - grid: #qGrid     │
        │   },              │      │ - scoreboard: ...  │
        │   ascend_2026: {  │      └────────────────────┘
        │     ...           │
        │   },              │
        │   v3: {           │
        │     ...           │
        │   }               │
        │ }                 │
        └───────────────────┘
                    │
                    ↓
        ┌────────────────────────────────┐
        │  THEME CONTROLLER CLASS        │
        ├────────────────────────────────┤
        │ class ThemeController {        │
        │   setTheme(name)               │
        │   setPhase(phase)              │
        │   showElements(ids)            │
        │   hideElements(ids)            │
        │   renderContent()              │
        │   startTimer()                 │
        │   stopTimer()                  │
        │ }                              │
        └────────────────────────────────┘
                    │
                    ↓
        ┌────────────────────────────────┐
        │  SINGLE SOURCE OF TRUTH       │
        │  for theme behavior           │
        │                                │
        │ - Cleaner code                 │
        │ - Easier maintenance           │
        │ - Consistent behavior          │
        │ - Easy to add new themes       │
        │ - No race conditions           │
        └────────────────────────────────┘
```

---

## Summary: Current Issues in Visual Form

```
╔════════════════════════════════════════════════════════════════╗
║  ISSUE #1: V3 IDLE STATE MISSING                             ║
║  ────────────────────────────────────────                     ║
║  When V3 active and no question/package:                       ║
║                                                                ║
║  ┌─────────────────────────────────────────────┐              ║
║  │ Expected:  Show V3 Scoreboard or fallback   │              ║
║  │ Actual:    Screen completely blank ❌      │              ║
║  │ Impact:    User confusion                   │              ║
║  └─────────────────────────────────────────────┘              ║
╚════════════════════════════════════════════════════════════════╝

╔════════════════════════════════════════════════════════════════╗
║  ISSUE #2: TIMER DUPLICATION                                 ║
║  ──────────────────────────────                               ║
║  Three timer implementations:                                  ║
║                                                                ║
║  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           ║
║  │  shared.js  │  │   app.js    │  │ screen.html │           ║
║  │             │  │             │  │             │           ║
║  │setThemeTimer│  │startThemeTim│  │socket.on    │           ║
║  │             │  │             │  │startCountdo │           ║
║  └─────────────┘  └─────────────┘  └─────────────┘           ║
║       ↓                 ↓                  ↓                   ║
║   RACE CONDITIONS! Unclear execution order.                    ║
╚════════════════════════════════════════════════════════════════╝

╔════════════════════════════════════════════════════════════════╗
║  ISSUE #3: DUAL VISIBILITY CONTROL                            ║
║  ──────────────────────────────────                            ║
║  CSS + JavaScript conflict:                                    ║
║                                                                ║
║  CSS:  body.default .ascend-only { display: none !important } ║
║  JS:   ascendFrame.style.display = 'flex'                     ║
║  CSS WINS (due to !important) - but code is fragile!          ║
╚════════════════════════════════════════════════════════════════╝

╔════════════════════════════════════════════════════════════════╗
║  ISSUE #4: INCONSISTENT ELEMENT NAMING                        ║
║  ────────────────────────────────────────                      ║
║  Makes generic functions impossible:                          ║
║                                                                ║
║  theme: 'default'    → defaultQText                           ║
║  theme: 'ascend'     → ascendQText                            ║
║  theme: 'v3'         → qTextV3 ← Different!                  ║
║                                                                ║
║  Result: Hardcoded theme-specific code everywhere            ║
╚════════════════════════════════════════════════════════════════╝

╔════════════════════════════════════════════════════════════════╗
║  ISSUE #5: V3 MISSING SCOREBOARD IN IDLE                      ║
║  ─────────────────────────────────────────                     ║
║  Can't show V3-themed scoreboard when no question active:      ║
║                                                                ║
║  Default + Idle → Show defaultScoreboard ✓                     ║
║  Ascend + Idle  → Show ascendScoreboard (in ascendFrame) ✓    ║
║  V3 + Idle      → Show ??? ← No V3 Scoreboard element!       ║
╚════════════════════════════════════════════════════════════════╝
```

