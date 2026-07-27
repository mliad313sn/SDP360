# SP1b-lignée — Cross-Week Lineage Dedup + Carry-Forward uid Fix — Plan

**Goal:** The hub shows every open report follow-up for a site across ALL weeks,
each once (deduped by carry-forward lineage), including orphaned ones never
carried forward — and carry-forward stops colliding uids.

**Architecture:** A `lineage` column records the carry-chain root; carried copies
get a fresh uid + the source's lineage; `saveActionItems` writes lineage on
INSERT and preserves it on UPDATE; a new dual-backend reader returns the
site's open, non-merged report actions deduped by lineage (latest instance);
the hub uses it (each action links to its own report). Spec facts in the
2026-07-27 SP1b spec; this extends it.

**Critical bug fixed:** post-SP1b, `_importFromWeek` reuses the source uid on the
copy → two rows share a uid → `setActionMerge(uid)` (no report_id filter) hits
both. Carried copies must mint a fresh uid.

---

### Task 1: `lineage` column + saveActionItems writes/preserves it

**Files:** `reports-db.js` (ALTER sqlite + pg; `saveActionItems` both forks INSERT `lineage`, UPDATE untouched; `getActionsForReport` SELECT), `db/postgres/reports/003_reports.sql`; Test extend `tests/action-items-upsert.test.js`.

- [ ] Test: saving a row with `lineage:'root-x'` (no uid) → stored lineage='root-x', minted uid; re-saving that row by its uid with a DIFFERENT lineage value → lineage UNCHANGED (immutable, like source).
- [ ] Run → FAIL.
- [ ] Add `lineage TEXT` (sqlite try/catch ALTER + pg CREATE + ALTER IF NOT EXISTS). INSERT includes `lineage` (from `a.lineage||null`); UPDATE does not touch it. Add `lineage` to `getActionsForReport` SELECTs (getReport is SELECT *).
- [ ] Run → PASS. Golden PPTX + await green. Commit.

### Task 2: `getSiteOpenReportActions(site_id)` dedup reader

**Files:** `reports-db.js` (dual-backend + export); Test `tests/site-open-report-actions.test.js`.

- [ ] Test: two reports (W1, W2) for one site; W1 has action A (lineage L), W2 has A' (lineage L, carried) + native B; a closed C in W1; a merged M (source set) in W2. Reader returns: A' (latest of lineage L), B — NOT C (closed), NOT M (merged), NOT A (older duplicate). Each row carries its `report_id` + `week_label`.
- [ ] Run → FAIL.
- [ ] Implement: SELECT non-closed, `source IS NULL` report actions across the site's reports JOINed to weeks (uid, lineage, fields, report_id, week_label, year, week_number); dedup in JS by `lineage||uid`, keep max (year, week_number). Dual-backend, exported.
- [ ] Run → PASS. Commit.

### Task 3: hub broadening + buildSiteActions per-action report + import fix

**Files:** `services/siteActionsRegister.js` (report branch → per-action report_id/week_label), `server.js` (site-actions route uses the reader), `public/reports.html` (`_importFromWeek` fresh uid + lineage + skip merged), Test extend `tests/site-actions-register.test.js`.

- [ ] Test: `buildSiteActions` report actions each carry `report_id` + `week_label`; `close.url` = `reports.html?report=<that row's report_id>`; `origin_label` = that row's `week_label`; merged (source) still folded.
- [ ] Run → FAIL.
- [ ] `buildSiteActions`: report input = array of actions each with `report_id`/`week_label`; build url + origin_label + uid per-action.
- [ ] site-actions route: replace latest-report logic with `getSiteOpenReportActions(site_id)`; pass rows as `report:{actions}`.
- [ ] `reports.html` `_importFromWeek`: map source rows → `{...a, uid:'', lineage: a.lineage||a.uid}` and **skip `a.source`** (merged) rows.
- [ ] Run register unit + syntax-check reports.html. Commit.

### Task 4: regression + browser + docs + finish

**Files:** `CLAUDE.md`.

- [ ] `node --test` new + site-actions suites + `pptx-monthly-golden` + `await-precedence` → green.
- [ ] Browser: an orphaned older open follow-up now appears; a carried action shows once (not per week); importing from a previous week no longer collides uids (merge the copy → the original stays unmerged); merged rows aren't carried forward.
- [ ] Update `CLAUDE.md`; commit; merge to `main`; build ZIP.
