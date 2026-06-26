# Chunk 4D-wiring-2 — server.js cold-path async wiring → PostgreSQL (design spec)

**Date:** 2026-06-26
**Status:** approved (pending spec-review + user review)
**Branch:** `feat/pg-reports-wiring-2` (off `main`)
**Depends on:** Chunks 4A–4D-2d + 4D-wiring-1 — all merged. The reports.db DB layer is 100% forked;
4D-wiring-1 wired the hot dashboard path. This chunk wires the remaining **cold-path** server.js
routes (report builder, PPTX, config CRUD, presets) + the last raw-`db`-handle code paths.

---

## Goal

Make the **cold-path** server.js routes `await` the now-async forked reports.db functions, and fix
the last code paths that read/write the raw sqlite handle directly, so the report builder, PPTX
generators, site/department config, and dashboard presets work when `REPORTS_BACKEND=postgres`. This
is the **last code chunk** before the prod flip (then only 4B-RR + a KPI reconciliation remain).

**Why safe in sqlite mode:** every forked fn returns synchronously on sqlite; `await` on a non-Promise
is a no-op. Adding `await` (+ `async` to handlers) is behaviour-preserving for the default backend.

## Scope

### 1. Two new forked helpers (the FUNCTIONAL changes — raw-`db` handles)

Three code sites read/write the raw sqlite handle directly (`rdb.db.prepare(...)` / `db.prepare(...)`)
→ break in pg mode. Replace with forked reports-db helpers (standard dispatch; pg fork uses `pgHandle()`).

**1a. `reassignReportWeek({ reportId, siteId, newWeekId })`** — `/api/reports/:id/reassign-week`
(server.js ~4772 + ~4783). Two raw queries: a duplicate check `SELECT wr.id FROM weekly_reports wr
WHERE wr.site_id=? AND wr.week_id=? AND wr.id!=?` and the reassign `UPDATE weekly_reports SET
week_id=?, updated_at=datetime('now') WHERE id=?`. New transactional fork: checks for a conflicting
report; if found, returns `{ duplicateReportId }` WITHOUT updating; else performs the UPDATE and
returns `{ duplicateReportId: null }`. Dialect: `weekly_reports.updated_at` is **TIMESTAMPTZ** (003_reports.sql)
so `datetime('now')` → **`now()`** (NOT `to_char(...)` — matching the existing `touchReport` /
`updateReportStatus` PG forks that write this same column). The route then: if `duplicateReportId`, fetch
`getReport(dupId)` for the 409 message; else `getReport(reportId)` for the response. (tx-convert
pattern from 4C: dispatching fn + `_xSqlite` via `db.transaction` + async `_xPg` via `runTransaction`.)

**1b. `requestRecordExists(requestId)`** — `/api/admin/refresh-major-incident-udfs` (server.js ~2477).
A diagnostic existence check `SELECT 1 FROM request_records WHERE request_id = ? LIMIT 1` run in a
loop to collect up to 5 unmatched sample IDs. New fork returns a boolean (`!!row`). The route awaits
it per-iteration (sequential `for` loop — fine). No dialect rewrite (plain equality + LIMIT).

### 2. Cold-path route awaits (mechanical — async + await)

Add `await` to every forked-fn call in these routes; make the handler `async` where it isn't. All
behaviour-identical in sqlite mode. **Forked fns to await:** `getReport`, `listReports`, `ensureReport`,
`ensureWeek`, `updateReportStatus`, `touchReport`, `deleteReport`, `saveInfraKpis`, `saveHelpdeskData`,
`saveLights`, `saveActionItems`, `getActionsForReport`, `getLightsForReport`, `getPreviousWeekOpenActions`,
`getPreviousWeekInfraKpis`, `listAllWeeksWithActions`, `listAllWeeksWithLights`, `getMonthlyData`,
`getMonthlyEdits`, `saveMonthlyEdits`, `getYearlySummary`, `getAnnualObjectives`, `saveAnnualObjectives`,
`getWeekSummaryData`, `getOpenChangesForSite`, `getActiveMajorIncidentsForSite`, `listSites`, `updateSite`,
`createSite`, `setSiteActive`, `listDepartments`, `createDepartment`, `updateDepartment`,
`setDepartmentActive`, `logAudit`, `getReportAuditLog`. Plus the `groupPresets.*` calls
(`getPresets`/`getPresetsWithDiscovered`/`setPresets`/`getDiscovered` — forked in 4B, return Promises
in pg mode).

Route groups (≈30 routes):
- **Report builder + data** (~21 routes): `GET /api/reports`, `POST /api/reports/ensure`,
  `GET /api/reports/:id` + `/:id/carry-over-actions|action-weeks|actions-from/:src|light-weeks|
  lights-from/:src|carry-over-infra|audit|open-changes|active-incidents`, `GET /api/sites/:siteId/
  open-changes|active-incidents`, `DELETE /api/reports/:id`, `PUT /api/reports/:id/infra|helpdesk|
  lights|actions|status|reassign-week`, `GET /api/reports/monthly/:site_id/:year/:month` + `/edits`,
  `POST .../edits`, `GET /api/reports/yearly/:site_id/:year`, `GET /api/reports/objectives/:site_id/:year`,
  `POST .../objectives`, `POST /api/executive-new-pptx` (~5068 — `listSites` ×2 at ~5076/5085;
  handler already async).
- **PPTX generators** (~6 routes, handlers ALREADY async): `GET /api/reports/:id/pptx` (weekly),
  `/api/reports/monthly/all-sites/:year/:month/pptx`, `/api/reports/monthly/:site_id/:year/:month/pptx`,
  `/api/reports/weekly-summary/:year/:week/pptx`, `.../pptx-v2`, `.../site-template/pptx`.
- **Config CRUD** (8 routes): `GET|PUT|POST|DELETE /api/reports/sites[/:id]`,
  `GET|POST|PUT|DELETE /api/reports/departments[/:id]`.
- **Presets** (3 routes): `GET /api/dashboard/presets`, `PUT /api/dashboard/presets`,
  `GET /api/dashboard/groups/discovered`.

### 3. Ripple: server.js helpers that internally call forked fns

These non-route helpers call a forked reports-db fn synchronously → break in pg mode. Make each
`async` (await the forked call inside) and `await` every caller:

- **`validateActionItems(...)`** — calls `rdb.listDepartments()`. Callers: `PUT /api/reports/:id/actions`
  (~4677) and `POST /api/reports/monthly/:site_id/:year/:month/edits`. Make async; await at both.
- **`_userMeetingsSite(user)`** (server.js ~5679) — calls `rdb.listSites()` then `.find(...)` synchronously
  → in pg mode `.find` on a Promise throws. Make async; `await` at its 3 call sites — all already-async
  meetings routes: `POST /api/meetings/actions/:id/update` (~5880), `POST /api/meetings/save` (~5932),
  `POST /api/meetings/issues/:id/update` (~5959). (Note: `listSites` is a *reports-db* fn, so this
  breaks under `REPORTS_BACKEND=postgres` regardless of `MEETINGS_BACKEND`.) `userHasRole` at ~5681 is
  NOT a ripple — not forked, and `req.reportUser.roles` is preloaded → stays sync.

## Dialect / correctness rules

- The only NEW SQL is `reassignReportWeek` (`datetime('now')` → **`now()`** — `updated_at` is
  TIMESTAMPTZ; the `SELECT`/`UPDATE` are otherwise dialect-safe — `?`→`$N` via the adapter) and
  `requestRecordExists` (plain `SELECT 1 … LIMIT 1`, no rewrite). pg forks use `pgHandle()`.
- **PURE fns — do NOT await:** `getWeekRange`, `getISOWeek`, `getPreviousWeek` are NOT forked (4C:
  "PURE (not forked)"). They appear in the PPTX/report routes; leave them un-awaited. (Awaiting them
  is harmless but unnecessary — flag any that get wrongly awaited.)
- `await` additions are behaviour-preserving on sqlite. No KPI/report math changes.

## Out of scope

- **Risk-register** (`rr.*` / `risk-register-export.js`, 5 call sites ~2598–2660) — NOT forked;
  belongs to **4B-RR** (its own chunk: fork `rr_site_aliases` access + those routes together). Leave
  un-awaited here (`buildRiskRegisterExport` at ~2565 already awaited — it's an inherently-async XLSX
  builder, unrelated).
- The KPI reconciliation (verification step, not code).

## Sync-dispatch invariant

`reassignReportWeek` / `requestRecordExists` return synchronously on sqlite, Promise on pg (first-line
dispatch). Cold-path handlers become `async` + `await`. sqlite synchronous-return smoke covers the 2
new helpers.

## Testing (TDD)

1. **Helper TDD (pg + sqlite):** add `reassignReportWeek` + `requestRecordExists` tests to
   `tests/pg-reports-reports.test.js` (4C suite — has weeks/weekly_reports seeding) or the aggregates
   suite. For `reassignReportWeek`: seed two reports (same site, different weeks); assert reassigning
   one INTO the other's week returns `{ duplicateReportId: <other> }` and does NOT change the week;
   reassigning into a free week returns `{ duplicateReportId: null }` and the `getReport` shows the
   new week + a bumped `updated_at`. For `requestRecordExists`: seed a request; assert `true` for it,
   `false` for an absent id. Plus sqlite synchronous-return assertions (each not `instanceof Promise`).
2. **sqlite route smoke (extend `tests/server-routes-smoke.test.js`):** add a few cold-path
   `/api/reports/*` routes to the smoke ROUTES list — `GET /api/reports`, `GET /api/reports/sites`,
   `GET /api/reports/departments`, `GET /api/dashboard/presets?scope=tickets` — asserting 200 in
   sqlite mode (the seeded admin already has the role). This proves the async conversion didn't break
   the report builder/config paths. (PPTX routes need a full report fixture — skip in the smoke;
   covered by the existing `tests/pptx-monthly-golden` + manual.)
3. **sqlite regression:** existing reports.db pg + DB-layer + golden-pptx suites stay green;
   `node --check server.js` + `node --check reports-db.js` clean.

A full pg-mode server boot is deferred to the final KPI-reconciliation step.

## Success criteria

- `reassignReportWeek` + `requestRecordExists` pg tests green; sqlite synchronous-return holds.
- Extended `tests/server-routes-smoke.test.js` green (hot + cold representative routes, 200 in sqlite).
- The 3 raw-`db` handles replaced by forked helpers; all cold-path routes await their forked calls;
  `validateActionItems` (+ any sibling helper) async; pure fns left un-awaited; `node --check` clean.
- sqlite default-backend behaviour unchanged (report builder + PPTX + config render identically).
- **After this + 4B-RR, the `REPORTS_BACKEND=postgres` prod flip needs only a KPI reconciliation.**
  Nothing deployed; `REPORTS_BACKEND` defaults to `sqlite`.
