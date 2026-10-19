# Per-Site Actions Register Hub (SP1a) — Implementation Plan

**Goal:** A per-site page aggregating still-open actions from Meetings /
Inspections / Report follow-ups, grouped by theme, with age/overdue, closeable
inline (meetings/inspection) or via deep-link (report).

**Architecture:** A pure normalizer `services/siteActionsRegister.js` +
`GET /api/reports/site-actions` route that composes three EXISTING dual-backend
readers + a new `public/site-actions.html` page. No schema change; no touch to
the report save path. Spec: `docs/superpowers/specs/2026-07-27-site-actions-register-design.md`.

**Tech Stack:** Node/Express, better-sqlite3/pg dual-backend (composed, not
forked), vanilla JS page mirroring `inspection-actions.html`, `node --test`.

---

### Task 1: Pure normalizer `services/siteActionsRegister.js`

**Files:** Create `services/siteActionsRegister.js`; Test `tests/site-actions-register.test.js`.

`buildSiteActions({ meetings, inspection, report, asOf })` → `{ groups: {
meetings, inspection, report }, totals }`. Each group `{ items:[row], count,
oldest_days }`. Row shape per spec (source, title, owner, due_date, status,
age_days, overdue, origin_label, action_id, close). Terminal filters: meetings
`resolved|cancelled|closed`, inspection `Closed|Cancelled`, report `closed`
(case-insensitive). `overdue` = due_date `< asOf` AND not terminal. `age_days` =
whole days `asOf - created_at` for meetings/inspection; `null` for report.
`close` = `{kind:'inline'}` (meetings/inspection, carries action_id) or
`{kind:'link', url:'reports.html?report=<report_id>'}` (report).

- [ ] Write failing test: seed 2 meetings (1 open + 1 closed), 2 inspection
  (1 Open overdue + 1 Closed), 1 report `{report_id, week_label, actions:[open,
  in_progress, closed]}`; assert closed excluded, counts per group, overdue flag,
  age_days null for report + numeric for others, close.kind per source,
  origin_label present.
- [ ] Run `node --test tests/site-actions-register.test.js` → FAIL.
- [ ] Implement `buildSiteActions` (pure, no DB, no Date.now — `asOf` passed in).
- [ ] Run test → PASS.
- [ ] Commit.

### Task 2: Route `GET /api/reports/site-actions`

**Files:** Modify `server.js` (new route near other `/api/reports/*`); Test `tests/site-actions-routes.smoke.test.js`.

Route (`requireReportSession`): read `?site=CODE`; resolve `site_id` via
`rdb.getSiteIdByModuleCode('meetings', code)`; fetch `meetingsDb.listActions({site:code})`,
`inspectionDb.listActions({site:code})`, and the latest report's actions
(`rdb.listReports(site_id)` ordered → `[0]`, then `rdb.getReport(id)` →
`{report_id:id, week_label, actions}`); call `buildSiteActions({...,asOf:today})`;
return JSON. Unknown/absent site → empty groups (not 500). All reader calls
`await`ed (dual-backend). Register the path ABOVE `app.get('/api/reports/:id')`
(the documented `:id` shadowing trap).

- [ ] Write smoke test: boot app, GET with a seeded site → 200 + `{groups:{meetings,inspection,report}}`; GET unknown site → 200 empty groups.
- [ ] Run → FAIL.
- [ ] Implement route.
- [ ] Run → PASS. Run `node --test tests/await-precedence.test.js` → 5/5.
- [ ] Commit.

### Task 3: `?report=<id>` deep-link in `reports.html`

**Files:** Modify `public/reports.html`.

In the boot routine, after auth, if `new URLSearchParams(location.search).get('report')`
is a positive int, `await openReportById(id)` **then** `showSection(3)` (Action
Items). Additive branch; must not disturb the `#admin` hash routing or the
autosave/save paths.

- [ ] Add the deep-link branch.
- [ ] Syntax-check inline JS (`new Function` over the script block) → 0 errors.
- [ ] Commit.

### Task 4: Page `public/site-actions.html` + nav + wiring

**Files:** Create `public/site-actions.html`; Modify `public/_shell.js` (nav +
ICON_LIB key if needed); Modify `server.js` (`_htmlCache` boot-load list + a
`sendHtmlPage` route).

Mirror `inspection-actions.html`: shell, site filter (default own site for
non-admins), three theme sections each with count + oldest badge, rows with
age/overdue badges, inline `<select>` status for meetings/inspection posting to
their existing `/update` APIs (disable + reason when RBAC forbids; revert on
403), a "↗ open report" link for report rows using `close.url`. Deep-linkable
`?site=CODE`. Auth header pattern copied from the sibling register (`X-Report-Token`
+ `X-Dash-Key`). Add an Insights nav entry (id `site-actions`) with an existing
`ICON_LIB` key. Register in `_htmlCache` + `sendHtmlPage` route (injectApiKey per
sibling).

- [ ] Create the page (structure/JS mirrored from `inspection-actions.html`).
- [ ] Add nav entry + confirm the icon key exists in `ICON_LIB`.
- [ ] Register page in `server.js` (`_htmlCache` + route).
- [ ] Syntax-check inline JS → 0 errors.
- [ ] Commit.

### Task 5: Browser verify + regression + docs + finish

**Files:** Modify `CLAUDE.md` (Current state + a pitfall row if warranted).

- [ ] Browser: three groups render on a real site; inline-close a meetings action
  persists across reload; report row link opens the right week on the Action
  Items tab; a no-meetings-code site shows empty groups; zero console errors.
- [ ] Run touched + neighbouring suites (site-actions, meetings-actions,
  inspection-actions, await-precedence) → green.
- [ ] Update `CLAUDE.md`; commit; merge to `main`; build ZIP.
