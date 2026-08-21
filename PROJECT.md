# Project: V3 Graphics Overhaul

## Architecture
- Target directory: `src/public`
- Files involved: `overlay.html`, `screen.html`, `v3_anim.css`
- Method: Restructure the DOM inside `#qBox` in `overlay.html` and `screen.html` to separate the question text and the Econova V3 points panel. Update styling in `v3_anim.css` to display a slanted large team score trapezoid and 3 slanted package point boxes nested in a slanted wrapper beneath the score, avoiding clipping, layout breakage, or overflow. Verify via a Puppeteer script that captures `screenshot_v3.png` in mode 2.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Explore & Design | Analyze source and layout, design DOM/CSS modifications | none | DONE |
| 2 | Implementation | Implement DOM & CSS changes in overlay.html, screen.html, v3_anim.css | M1 | DONE |
| 3 | Review & Challenge | Validate layout, correct syntax/styles, test under mode 2 state | M2 | DONE |
| 4 | Visual Verification | Run Puppeteer script to capture and verify screenshot_v3.png | M3 | DONE |

## Code Layout
- `src/public/overlay.html`
- `src/public/screen.html`
- `src/public/v3_anim.css`
