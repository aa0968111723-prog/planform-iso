# Multi-Project Long Task Hardening Audit

**Branch:** `release/planform-1.0-rc`  
**Tip reference:** `60c1037` (+ P1 code at `32f8d90`)  
**As of:** 2026-08-24  
**Lead:** Grok

---

## 1. Context

PR #19 implements the more mature multi-project architecture (4-layer storage/repo/session/migration, `Project.id` in body, centralized keys, quarantine contract, journaled index).  
#18 was merged to main; #20 ported a subset of #19 findings onto the #18 lineage.  
This long task hardens **#19** as the selected production candidate. **Do not merge** until user confirmation.

---

## 2. P1 Status — FIXED

| ID | Issue | Fix | Commit |
|----|--------|-----|--------|
| **P1-A** | `planHasContent` ignored venue-only edits (room/tile/calibration/description/layers/catalog/validation) | Semantic compare vs `createDefaultProject()` | `32f8d90` |
| **P1-B** | `corruptBody` only read backup; quota-failed quarantine left primary unreadable by UI | backup → primary (only if unparseable) → null | `32f8d90` |
| **Test wipe** | `44a4421` replaced suite with `placeholder` | Full suite restored + P1-B cases | `60c1037` |

---

## 3. Data-Loss Audit (code contracts)

| Path | Verdict | Notes |
|------|---------|-------|
| quarantine 4-step | SAFE | Never deletes primary unless backup write succeeded |
| hydrate switch order | SAFE | flush → open → setPersistence → load (clears undo) |
| flushIndex journal merge | SAFE | Disk-first merge; multi-tab additive |
| delete + tombstone (max 10) | SAFE | Bytes captured before remove |
| restoreProject | SAFE | Restores body/backup/layouts then index |
| openProject corrupt | SAFE | Quarantine before markBroken |
| legacyMigration | SAFE | Resumable; exact-body dedupe; never deletes legacy keys |
| writeLayout / readVariants | SAFE | Corrupt layouts quarantined |
| NULL vs UNAVAILABLE | SAFE | Banner when storage blocked |
| store.ts loadProject hasContent | FOLLOW-UP | Still arrays-only for undo checkpoint — share semantic predicate |

---

## 4. Online research supplements (2026-08-24)

### 4.1 Storage quota (MDN + browser practice)

- Web Storage: **~5–10 MiB per origin** (Chrome/Firefox often ~10 MB UTF-16 units; Safari tighter).
- `setItem` throws `QuotaExceededError`; **existing data is left unchanged** on failure — matches our quarantine “leave primary intact”.
- Industry rule: **never delete the only primary copy to free space for a backup**.
- Practical capacity for Planform: E310-weight body ~8–16 KiB → theoretical ~50–100 projects; **document safe comfort zone 10–20** for real devices with other origin data.
- Always `try/catch` every write; surface one clear UI error; do not pretend success.

### 4.2 Multi-tab

- `storage` event fires only on **other** tabs (not the writer).
- No atomic multi-key transactions in localStorage → race on concurrent index writes is real.
- Our **journal + disk-merge `flushIndex`** is the correct pattern (re-read disk before write).
- Same-project concurrent edit: **last-write-wins** is industry-acceptable for single-user local-first; **must be honest in UI/docs** (task §5). Do not invent CRDT/realtime.

### 4.3 pagehide / autosave flush

- Prefer **`pagehide` + `visibilitychange` (hidden)** over `unload` (Chrome Page Lifecycle).
- Emergency save on leave **must be synchronous** → localStorage is appropriate; IndexedDB fire-and-forget on unload is a data-loss window (supports decision to stay on localStorage for project bodies).
- Debounced autosave must **cancel timer and flush** on project switch (our hydrate step 1).

### 4.4 Empty state UX (SaaS first-run patterns)

- First-run: **one primary CTA**, short benefit-oriented copy, optional secondary action.
- Task §11: 「建立第一個活動場佈」+ optional 快速開始 E310; **no auto demo projects**.
- Empty copy strengthened to first-run pattern without adding demo data.
- Corrupt card: keep “下載原始資料 / 移除損壞專案”, never auto-destroy bytes.

### 4.5 Architecture parallels

- Per-project keys (`project:<id>`) + separate index is a known local multi-doc pattern (isolation, corrupt one ≠ corrupt library).
- Index derived from body (cache) matches “body is source of truth”.

---

## 5. Remaining gates (not yet all green)

1. Push P1-A venue-only session regressions if not on remote yet  
2. Share `planHasContent` into `core/model.ts` for `store.ts`  
3. Torture: rapid switch 100×, autosave race, multi-tab, quota matrix, corruption isolation, migration idempotence  
4. Project Home empty-state / card UX polish  
5. E310 3-project workflow verification  
6. Measure 10 / 30 / 50 project Home open + storage bytes  
7. Claude CLI 3-role review  
8. Grok blind test (or honest unavailable)  
9. `npm run lint/typecheck/test/build/test:e2e` + production smoke  
10. Mergeability rebase keeping **#19 system sole**  
11. Update PR #19 body — **no merge**, wait for user  

---

## 6. Architecture decision

**#19 is the selected candidate.**  
Reasons: Project.id in body, centralized keys, 4-layer split, quarantine contract, UNAVAILABLE_PERSISTENCE, journaled index, stronger Claude review history, per-layout→project migration with progress.

#18 remains on main until user decides. Storage key families differ (`project:` vs `projects:`); any switch needs an explicit migration note.

---

## 7. Known limitations (non-blocking)

- Same project open in two tabs: last-write-wins (documented).  
- Tombstone undo window limited (max 10).  
- Thumbnail generation deferred (P2).  
- No cloud sync / login (by design, local-first).
