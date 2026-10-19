# Persist the deck builder's monthly analysis server-side — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** The Group IT deck builder's monthly analysis — the Analyze/commentary fields and the Operations Summary — currently lives ONLY in the author's browser `localStorage`. Move it to the server so it survives a cache clear or a change of machine, is visible to colleagues, and can later be read by a server-side sender.

**Branch:** `feat/exec-editorial-server` (from `main`).

## Verified substrate (checked directly — do not re-derive)
Two **separate** browser stores with **different grains** — this drives the schema:
- **Commentary** — `setCommentary(id, text)` (`public/executive-report.html:~4430`) writes each field into `localStorage` under `_commentaryStorageKey()` = `exec_pptx_commentary_<yr>_<mo>_<site>_<grp>` (`:4453`), i.e. keyed by **month + site filter + group preset**. `restoreCommentaryFromStorage()` (`:4466`) rehydrates the 10 fields `f-exec, f-helpdesk, f-sla, f-change, f-incidents, f-csat, f-progress, f-issues, f-nextperiod, f-actions`. Note `getCommentary(id)` (`:4487`) treats the `empty` CSS class as literally empty — the visible text is placeholder instructions, never user content. Preserve that.
- **Operations Summary** — `_opsSummaryCollect/_opsSummaryApply/_opsSummaryLoad/_opsSummarySave` (`:6963-7005`) round-trip `{owner_name, owner_title, financial_year, headcount, goal, rag{…}, progress, issues, activities, kpis}` under `_opsSummaryKey()` = `opsSummary_<yr>_<mo>` — keyed by **month only**. Loaded on `DOMContentLoaded`, saved by a 💾 Save button (`:917`).
- **The precedent to mirror**: `reports-db.js` `getExecEditorial(period)` (`:648`) / `_getExecEditorialPg` (`:655`) / `setExecEditorial(period, {highlights, focus}, user)` (`:668`) / `_setExecEditorialPg` (`:683`) over the `exec_view_editorial` table, plus its `GET/PUT /api/exec/editorial` routes (`server.js:~1052`).
- The deck builder's own server action `POST /api/reports/exec-pptx` is gated `requireReportSession, requireAdmin` (`server.js:6547`) — use the SAME gate so anyone who can build the deck can save its analysis.

---

## Task 0 — The store (one table, two scopes)

**Files:** Modify `reports-db.js`; Test `tests/exec-report-editorial.test.js`.

The two blocks have genuinely different keys, so a single table carries a **scope** discriminator rather than duplicating the month-level block per filter combination:
```sql
CREATE TABLE IF NOT EXISTS exec_report_editorial (
  period      TEXT NOT NULL,          -- 'YYYY-MM'
  scope       TEXT NOT NULL,          -- 'ops'  |  'commentary:<site>:<grp>'
  payload_json TEXT,
  updated_at  TIMESTAMP,
  updated_by  TEXT,
  PRIMARY KEY (period, scope)
);
```

- [ ] **Step 1 — failing test.** Copy a reports-db test harness (throwaway sqlite via `SDP_DATA_DIR`). Assert:
  - `getExecReportEditorial('2026-07','ops')` on an empty DB → `null` (NOT a throw, NOT `{}`).
  - `setExecReportEditorial('2026-07','ops',{goal:'x',progress:'a\nb'},'admin')` then get → the SAME object back (round-trip through JSON).
  - A second `set` for the same (period, scope) **overwrites** (upsert, one row).
  - Two different scopes for the same period coexist independently: `'ops'` and `'commentary:MANA:Operations'`.
  - Two different periods coexist.
  - A payload with accents/newlines/quotes round-trips byte-identically.
  - Garbage stored payload → the getter returns `null` rather than throwing (defensive JSON.parse).
  Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement** in `reports-db.js`, mirroring `getExecEditorial`/`setExecEditorial` line-for-line (same `_initSchema` placement for the CREATE, same dual-backend split, same `updated_at`/`updated_by` handling, sqlite `INSERT … ON CONFLICT(period,scope) DO UPDATE` / the pg equivalent used by `_setExecEditorialPg`). Export `getExecReportEditorial, setExecReportEditorial`. **Add the CREATE to the pg schema file too if that is where `exec_view_editorial` is defined** — check and follow whatever that table does.
- [ ] **Step 4** PASS + `node --test --test-force-exit tests/exec-*.test.js tests/await-precedence.test.js` green. **Step 5 — commit:** `feat(exec): server store for the deck builder's monthly analysis`.

## Task 1 — Routes

**Files:** Modify `server.js`; Test `tests/exec-report-editorial-routes.smoke.test.js`.

- [ ] **Step 1 — failing smoke.** `GET /api/reports/exec-editorial?period=2026-07&scope=ops` (admin session) → 200 `{payload:null}` when absent; `PUT` the same URL with body `{payload:{goal:'x'}}` → 200 `{ok:true}`; `GET` again → the payload. Missing/blank `period` or `scope` → **400**. No session → 401/403. A non-admin session → 403. Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement** `GET` + `PUT /api/reports/exec-editorial` (`requireReportSession, requireAdmin` — same as `/api/reports/exec-pptx`), validating `period` matches `^\d{4}-\d{2}$` and `scope` is non-empty and ≤120 chars (it is a composite key, not user prose). The global `express.json()` supplies the PUT body. **Step 4** PASS + syntax + await-precedence 5/5. **Step 5 — commit:** `feat(exec): GET/PUT /api/reports/exec-editorial`.

## Task 2 — Wire the deck builder to the server (with migration + fallback)

**Files:** Modify `public/executive-report.html`. Browser-verify.

**The contract: the server is the source of truth; `localStorage` degrades to a cache + offline fallback, and existing local content is migrated once.**

- [ ] **Step 1 — Operations Summary.**
  - `_opsSummaryLoad()` → `async`: GET the server for `scope:'ops'`. If it returns a payload → apply it (and mirror it into localStorage as a cache). If the server has **nothing** but localStorage does → apply the local copy AND **PUT it once** (silent one-time migration, so nobody loses what they already typed). If the server is unreachable → fall back to localStorage and show nothing alarming.
  - `_opsSummarySave()` → PUT to the server; keep writing localStorage too. Report the REAL outcome in `#actionStatus` — on failure say it did NOT save to the server (never claim a save that failed).
- [ ] **Step 2 — Commentary.** `setCommentary()` keeps its immediate localStorage write (fast, offline-safe) but additionally schedules a **debounced** (~1.5 s) PUT of the whole field blob for the current `scope = 'commentary:<site>:<grp>'` — a single Analyze run fills ~6 fields and must not fire 6 requests. `restoreCommentaryFromStorage()` → `async` server-first with the same migrate-once + fallback logic, preserving the existing rule that a field is only filled when it still has the `empty` class (never clobber freshly-typed text).
  - Derive the scope string from the SAME inputs `_commentaryStorageKey()` uses (`yr`, `mo`, site, group) so the two stay aligned; if the key is empty (no month yet) → skip persistence entirely, as today.
- [ ] **Step 3 — VERIFY IN BROWSER (mandatory).** `preview_start`, admin PG session, **restart (stop+start — `executive-report.html` is `_htmlCache`'d)**, open the deck builder:
  - Type an Operations Summary, click 💾 Save → confirm a PUT fired and the row exists server-side.
  - **Hard-reload with localStorage CLEARED for that key** → the values come back **from the server** (this is the whole point — prove it, don't assume).
  - Fill a commentary field (Analyze Quick or manual edit) → after the debounce a PUT fires; clear localStorage, reload → the text returns from the server.
  - Change the month → the other month's analysis is independent (no bleed).
  - Migration: put a value in localStorage only, with the server empty → on load it is applied AND pushed to the server (verify the row appears).
  - Zero console errors. Screenshot.
- [ ] **Step 4 — commit:** `feat(exec): deck builder analysis persists server-side (migrating from localStorage)`.

## Task 3 — Regression + CLAUDE.md + finish
- [ ] `tests/exec-*.test.js` + `report-*` + `await-precedence` green.
- [ ] CLAUDE.md: Current-State entry + pitfall rows — (a) the deck builder's analysis is now server-side in `exec_report_editorial`, keyed `(period, scope)` where the commentary scope carries the site+group filter because the browser keyed it that way and collapsing the grains would let one filter's text overwrite another's; (b) `localStorage` is now a cache/fallback and is migrated once — do not re-introduce it as the source of truth; (c) `getCommentary` treats the `empty` class as empty (the visible text is placeholder instructions) — persisting the placeholder would leak meta-instructions onto the exported slide.
- [ ] Commit, merge to `main`, rebuild the deploy ZIP.

## Done criteria
- [ ] Analysis survives a cleared cache and appears on another machine/user.
- [ ] Existing localStorage content is migrated once, never lost.
- [ ] One Analyze run fires ONE debounced save, not one per field.
- [ ] A failed save is reported as failed.
- [ ] Suites green; browser-verified; merged + packaged.
