# AI Agent Execution Prompt — Mobile-first Rewrite

Implement the mobile-first workspace rewrite for `aa0968111723-prog/planform-iso`.

Read current `main`, `docs/FIELD_PRECISION_MOBILE_VALIDATION_PLAN.md`, and `docs/MOBILE_FIRST_REWRITE_ADDENDUM.md` first. The real-device Android screenshots show that the current mobile UI is structurally unusable: too many topbar rows, oversized sheets, automatic full Inspector, oversized nudge controls, and insufficient Canvas space.

Treat mobile as P0. Do not just tweak CSS. Keep desktop/tablet workspace behavior intact while creating a mobile-specific app shell and composition.

Required outcomes:

- single-row mobile header
- Canvas-first default state
- 3-detent bottom sheets
- category-based compact asset library
- selection context bar instead of automatic full Inspector
- mobile-specific properties sheet
- compact nudge mini-sheet
- finger-offset placement ghost
- robust touch/pointer state machine
- no object drag during pinch/two-finger pan
- small-object pick proxies
- safe focus area when sheets are open
- Android dynamic viewport / safe-area handling
- validation and measure flows that keep Canvas visible

Run viewport smoke tests at 360×800, 390×844, 412×915, 480×960, 768×1024 portrait, and 1024×768 landscape.

Do not add new assets, AI, auth, backend, cloud sync, collaboration, stage, audio equipment, incense, or lighting systems.

Before completion run lint, typecheck, tests, production build, and browser/mobile viewport smoke tests. Do not merge the PR automatically.