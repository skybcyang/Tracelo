# Tracelo compact mockup review

Production follow-up: the accepted information/color direction is implemented in 0.5.0. See [implementation specification and native Obsidian evidence](../compact-ui.md). The historical notes below describe the independent prototype; production retains dense grid packing, 260px minimum readable card width and a stacked mobile timeline.

Date: 2026-09-27

## Scope

Independent design exploration, not a plugin implementation or a pixel-identical clone. Preserve the existing cool gray/white/blue language and the 148px card grid with 12px gaps. Intentional changes: quieter properties, stable footer alignment, three-column desktop groups, two-column cards within desktop quadrants, contextual creation tiles, and a timeline separating deadlines from progress.

Source visual: `../optional-task-details.html`, captured in `reference.png`.
Implementation: `index.html`, captured in `expanded.png`, `quadrants.png`, and `mobile.png`.
Preview: http://127.0.0.1:8766/compact-review/

## Evidence and comparison

- Desktop captures: 1440 × 1000 CSS pixels and image pixels, 1:1 density. Source and implementation were opened together for comparison, with the payment task expanded and checklist at 2/4 in both. Whole-board sample data differs and is explicitly identified in the comparison UI; no pixel-level equivalence or measured space-saving percentage is claimed.
- The readable payment-card region supplies the focused comparison: same title, progress sentence and checklist. The optimized design removes repeated group labels, reduces property treatment, and uses a quieter selected border. The card remains 468px (three grid rows), with measured content approximately 452px. This design improves hierarchy rather than claiming the four-item expanded card is a row shorter.
- Desktop collapsed cards measured 148px, with 146px inner content minimum. Whole-document horizontal overflow was false.
- Narrow capture: 390 × 844 CSS/image pixels, 1:1 density. Full text wraps without horizontal overflow. Increased touch spacing takes the four-item expanded card to 628px (four rows), because content is approximately 485px. This is content-driven rounding, not a forced four-row minimum. The desktop timeline is omitted at this breakpoint.

## Findings and iteration history

1. Initial desktop groups used two columns even at 1440px, giving individual cards unnecessary width. Changed to three columns at 1280px and above. Subsequent desktop capture verifies the denser board.
2. Collapsed metadata originally followed content, giving adjacent card timestamps different baselines. Added a flex column and bottom-aligned metadata for collapsed cards; expanded metadata remains in natural document flow. The revised captures show consistent card footers.
3. Initial desktop quadrants had one card per row, placing lower quadrants far below the fold. Changed to two card columns per quadrant at 1280px and above. `quadrants.png` shows all four regions and their creation tiles at 1440 × 1000.

## Required visual surfaces

- Typography: retains system Chinese-capable font stack, 15px task titles, 12px descriptions, subdued metadata. No clamping or clipped lines in inspected states. Compact metadata remains a desktop-density choice to review with the user.
- Spacing/layout: integer rows retained, minimum span derived from natural content; consistent 12px card gaps. Grid uses normal row flow instead of dense backfilling.
- Color: white cards, pale gray board, blue focus/selection, muted red overdue state and restrained quadrant dots. Status always includes text as well as color.
- Assets: reuses icon paths from the existing prototype; no remote image or font dependencies.
- Copy: optional fields explicitly labeled; sample-only persistence and folder behavior explained; baseline labeled as the original design, not the current shipped plugin.

## Interaction checks

Verified in the in-app browser:

- Original-design/optimized switch loads the original prototype.
- Group/quadrant switch.
- Clicking card body expands it and selects the corresponding timeline.
- Checklist change from 2/4 to 3/4.
- Progress submission updates latest progress and timeline, then collapses the card.
- Quadrant creation tile opens with the correct quadrant.
- Creating a task without a deadline/checklist produces neither optional property.
- Task menu creates a folder indicator with explicit simulated feedback.
- Browser error log was empty during the tested optimized flows.

No plugin test suite was run because no plugin code changed. Prototype data is held only in memory. Folder operations do not access the filesystem. Full task editing, drag-and-drop, persistence, and mobile timeline navigation are outside this mockup's scope.

final result: passed

Next review: user judgment of density and the payment-card expanded state. This pass approves the scoped desktop mockup, not production behavior or complete accessibility conformance.

## Color information iteration

User requested more semantic color and less repeated text. Updated only this independent mockup:

- Quadrant headings use low-saturation red, blue, amber and gray accents with pale backgrounds and retained text names.
- Quadrant cards omit repeated importance/urgency labels. Group cards retain one small tinted priority badge.
- Checklist summaries use a proportional progress ring and fraction, with accessible labels and tooltips; completed checklists turn green.
- Future dates stay neutral, today's deadlines use amber, and overdue dates use pale red with explicit overdue text. Timeline uses the same urgency distinction.
- Removed repeated “更新” and normal-date “截止” from card text while retaining accessible labels.

Verification: in-app browser at 1440 × 1000, six collapsed cards all measured 148px with inner content 146px and no document horizontal overflow. An initial 2px increase from chip padding crossed the integer-row threshold; reduced badge/date vertical padding and remeasured all six cards. `color-quadrants.png` is the post-fix visual evidence. No priority labels remain within quadrant cards. Checkbox changes from 2/4 to 4/4 produced a full ring (100/100) and computed green color rgb(50, 121, 94). At this narrower quadrant card width the expanded four-item content measured 472px, naturally requiring four rows; this is not a new minimum-height rule. Browser error log was empty. Viewport override was reset and demo data restored after checking.

final result: passed
