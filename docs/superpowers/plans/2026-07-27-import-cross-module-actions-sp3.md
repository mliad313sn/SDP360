# SP3 — Import Meetings/Inspection Actions into the Report (as references) — Plan

**Goal:** The report editor's "Import" flow gains Meetings + Inspection tabs — the
coordinator ticks open actions from those modules to pull into the report's
Actions & Follow-ups section as **references** (source/origin_id), so the report
narrative includes them without the hub/email double-counting.

**Architecture:** `saveActionItems` writes source/origin_id **on INSERT only**
(client-set from the picker); UPDATE still never touches them (SP1b merge stays
durable). A read endpoint lists the site's importable open actions. reports.html's
carry-over modal gets Meetings/Inspection checkbox tabs. Builds on SP1b's columns.

---

### Task 1: source/origin_id written on INSERT + client round-trip

**Files:** `reports-db.js` (`saveActionItems` INSERT), `public/reports.html` (`addActionRow`/`collectActions`); Test extend `tests/action-items-upsert.test.js`.

- [ ] Test: save a NEW row `{task, department, status, source:'meetings', origin_id:9}` (no uid) → stored row has `source='meetings'`, `origin_id=9`; then re-save it (by its uid) editing the task → source/origin_id UNCHANGED (UPDATE never writes them). A native new row (no source) → source null.
- [ ] Run → FAIL.
- [ ] `saveActionItems` (both forks): INSERT adds `source`/`origin_id` columns from `a.source||null`/`a.origin_id||null`; UPDATE unchanged. `addActionRow`: stash `tr.dataset.source`/`tr.dataset.originId`. `collectActions`: return `source`/`origin_id`. (validateActionItems already passes them via `{...a}`.)
- [ ] Run → PASS. Golden PPTX + goldens (report-template-primitives) + await → green (source is internal; goldens unaffected). Commit.

### Task 2: `GET /api/reports/:id/importable-actions` + smoke

**Files:** `server.js` (route), `reports-db.js` (a tiny `getSiteMeetingsCode(site_id)` helper if needed, or resolve via listSiteModuleCodes); Test `tests/importable-actions.smoke.test.js`.

- [ ] Test: seed a report + a meetings action + an inspection action for its site; `GET /api/reports/:id/importable-actions` → `{ meetings:[{origin_id,title,owner,due_date,origin_label}], inspection:[...] }`, non-closed only; unknown/closed excluded.
- [ ] Run → FAIL.
- [ ] Route (`requireReportSession`): getReport(id)→site_id; resolve the meetings-namespace CODE (listSiteModuleCodes('meetings').find site_id); `meetingsDb.listActions({site:code})` + `inspectionDb.listActions({site:code})`, filter non-terminal in JS, map to `{origin_id: a.id, title, owner, due_date, origin_label}`. Registered ABOVE `/api/reports/:id`.
- [ ] Run → PASS. Commit.

### Task 3: reports.html import UI (Meetings/Inspection checkbox tabs)

**Files:** `public/reports.html`.

- [ ] The carry-over modal gains a source switch: **Previous week** (existing) · **Meetings** · **Inspections**. Meetings/Inspections fetch `/importable-actions`, render a checkbox list (title · owner · due · origin_label). "Import selected" appends each ticked action via `addActionRow({ task:title, owner, due_date, status:'open', source, origin_id, uid:'' })` (empty department → user assigns before save) + a note. Referenced rows show a small "↳ from Meetings/Inspection" tag in the editor.
- [ ] Syntax-check inline JS → 0 errors. Commit.

### Task 4: regression + browser + docs + finish

**Files:** `CLAUDE.md`.

- [ ] `node --test` new + upsert + site-actions suites + `pptx-monthly-golden` + report-template goldens + `await-precedence` → green.
- [ ] Browser: import a meetings action → it appears in the report Actions section (with a "from Meetings" tag), assign a department, save → persists; the hub folds it out of the Report group (shows only under Meetings); the SP2 email counts it once (under Meetings, not report).
- [ ] Update `CLAUDE.md`; commit; merge to `main`; build ZIP.
