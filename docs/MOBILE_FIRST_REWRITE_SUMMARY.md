# P0 Mobile Rewrite Summary

Real-device Android audit shows the current mobile layout is not usable enough for field work. The next implementation must prioritize a mobile-specific Canvas-first workspace rather than shrinking the desktop editor.

Primary changes:

- one-row mobile header
- large visible Canvas by default
- compact category asset browser
- three-detent sheets
- selection context bar
- properties only on demand
- compact precision controls
- finger-offset ghost placement
- robust pinch/pan/drag arbitration
- dynamic viewport and Android browser chrome handling
- focus-safe validation and measurement

See `MOBILE_FIRST_REWRITE_ADDENDUM.md` for full acceptance criteria.