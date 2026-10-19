# SP1b — Stable Identity + Cross-Source Merge — Implementation Plan

**Goal:** Give `action_items` a stable `uid` + `source`/`origin_id`, make
`saveActionItems` an upsert-by-uid that never touches the merge columns, and let
a coordinator merge a report follow-up into its Meetings/Inspection twin from the
hub (folding the duplicate away, reversibly).

**Architecture:** Additive schema + boot backfill; upsert rewrite of the hot save
path (server owns `source`/`origin_id`); merge/unmerge readers + routes; the SP1a
hub folds merged rows and gains a merge picker. Spec:
`docs/superpowers/specs/2026-07-27-site-actions-merge-sp1b-design.md`.

**Tech Stack:** Node/Express, better-sqlite3 + pg dual-backend, `crypto.randomUUID`,
`node --test`, vanilla JS page.

---

### Task 1: Schema + boot backfill (`uid`/`source`/`origin_id`)

**Files:** `reports-db.js` (sqlite ALTERs + backfill; pg ALTERs + backfill in `initPgReports`), `db/postgres/reports/003_reports.sql` (CREATE); Test `tests/action-items-schema.test.js`.

- [ ] Test: open a fresh sqlite reports-db, insert an action WITHOUT uid via raw SQL, re-open module → assert the row now has a non-null `uid` (backfill), and that `uid`/`source`/`origin_id` columns exist.
- [ ] Run → FAIL.
- [ ] sqlite: add 3 `try{ALTER…ADD COLUMN}catch{}` after `reports-db.js:346`; add a boot backfill (`SELECT id WHERE uid IS NULL` → `UPDATE SET uid=randomUUID()`). pg: add 3 cols to `003_reports.sql` CREATE + `ADD COLUMN IF NOT EXISTS` + backfill in `initPgReports`.
- [ ] Run → PASS. Commit.

### Task 2: `saveActionItems` upsert-by-uid + readers + validate

**Files:** `reports-db.js` (`saveActionItems` both forks; `getActionsForReport`/`getPreviousWeekOpenActions` SELECTs), `server.js` (`validateActionItems` whitelist `uid`); Test `tests/action-items-upsert.test.js`.

- [ ] Test: save 2 actions (no uid) → both get uids, count 2; read back the uids; manually `UPDATE … SET source='meetings',origin_id=7 WHERE uid=<first>`; re-save the SAME 2 rows (with their uids) → source/origin_id on the first row **preserved**, count still 2, uids unchanged; re-save with the 2nd row dropped → count 1; re-save adding a 3rd (no uid) → count 2, new uid minted; empty save → count 0.
- [ ] Run → FAIL.
- [ ] Rewrite both forks: delete rows whose uid ∉ incoming (guard empty→delete all), then per row UPDATE-by-uid (editable fields only) else INSERT (mint uid); never write source/origin_id. Add `uid,source,origin_id` to the two explicit-column readers. Whitelist `uid` in `validateActionItems`.
- [ ] Run → PASS. `node --test tests/pg-reports-reports.test.js tests/await-precedence.test.js` green. Commit.

### Task 3: merge/unmerge readers + routes

**Files:** `reports-db.js` (`setActionMerge`/`clearActionMerge`, dual-backend), `server.js` (2 routes); Test `tests/site-actions-merge.smoke.test.js`.

- [ ] Test: boot app, seed a report + action (read its uid via getReport); `POST /api/reports/action/:uid/merge {source:'meetings',origin_id:N}` → 200; getReport shows the row's `source='meetings'`; `GET /api/reports/site-actions?site=…` no longer lists it under `report`; `POST …/unmerge` → row back; bad source → 400.
- [ ] Run → FAIL.
- [ ] `setActionMerge(uid,{source,origin_id})` = `UPDATE … SET source=?,origin_id=? WHERE uid=?`; `clearActionMerge(uid)` = set both NULL. Routes `requireReportSession` + editor role (`rdb.userHasRole`), validate `source∈{meetings,inspection}`+`origin_id>0`→400, registered ABOVE `/api/reports/:id`.
- [ ] Run → PASS. Commit.

### Task 4: hub folds merged rows (`buildSiteActions`)

**Files:** `services/siteActionsRegister.js`; Test `tests/site-actions-register.test.js` (extend).

- [ ] Test: a report action with `source:'meetings'` is EXCLUDED from `groups.report`; one with `source:null` is included.
- [ ] Run → FAIL.
- [ ] In the report branch, `.filter(a => !a.source)` before mapping.
- [ ] Run → PASS. Commit.

### Task 5: client `reports.html` uid round-trip

**Files:** `public/reports.html`.

- [ ] `addActionRow(a)` sets `tr.dataset.uid = (a && a.uid) || ''`.
- [ ] `collectActions()` adds `uid: tr.dataset.uid || undefined` per row.
- [ ] Syntax-check inline JS → 0 errors. Commit.

### Task 6: hub merge UI (`site-actions.html`)

**Files:** `public/site-actions.html`.

- [ ] Report rows get a "⇄ same as…" button → a picker (modal) listing the site's Meetings+Inspection items already in the payload, **suggested matches first** (normalized token-overlap score vs the row title, ★-marked) → pick → `POST …/merge` → reload.
- [ ] Success toast offers **Undo** (`POST …/unmerge`) for ~6s.
- [ ] Syntax-check inline JS → 0 errors. Commit.

### Task 7: regression + browser + docs + finish

**Files:** `CLAUDE.md`.

- [ ] `node --test` the touched suites + `pptx-monthly-golden` + `report-template-weekly` + `pg-reports-reports` + `await-precedence` → green, goldens NOT regenerated.
- [ ] Browser: merge a retyped follow-up into its inspection twin → leaves Report group, count drops; Undo restores; a normal report save afterward does NOT resurrect the duplicate.
- [ ] Update `CLAUDE.md`; commit; merge to `main`; build ZIP.
