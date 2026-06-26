# Chunk 4D-wiring-2 — server.js cold-path async wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the cold-path server.js routes (report builder, PPTX, config CRUD, presets) to `await` the now-async forked reports.db fns, replace the report-path raw-`db`-handle sites (reassign-week + refresh-udf) with 2 new forked helpers, and make the 2 helper-ripple functions async — so the report builder + config work when `REPORTS_BACKEND=postgres`. Behaviour-preserving in sqlite (await-on-sync = no-op; `node --check` guards the one real risk: await in a non-async fn).

> **NOT the last raw-`db` sites:** `/api/survey/voice` (server.js ~1874/1895) also reads `rdb.db.prepare(...)` on `survey_results`/`survey_answers` and breaks under pg — but it's a Voice-of-Customer/Phase-5 path outside this chunk's report-builder/config scope. Flagged as a separate follow-up (sibling of 4B-RR). The `REPORTS_BACKEND=postgres` prod flip needs it + 4B-RR + reconciliation.

**Spec:** `docs/superpowers/specs/2026-06-26-pg-reports-wiring2-design.md` (reviewed ✅).

**Verified:** `weekly_reports.updated_at` is TIMESTAMPTZ → `now()` (matching `touchReport`). Pure fns `getWeekRange`/`getISOWeek`/`getPreviousWeek` NOT forked → don't await (the `(`-anchor distinguishes `getPreviousWeek(` from forked `getPreviousWeekOpenActions(`/`getPreviousWeekInfraKpis(`). groupPresets `_h(db)` ignores the passed handle in pg mode → only `await`+`async` needed. risk-register out of scope (4B-RR).

---

### Task 0: Two forked helpers — `reassignReportWeek` + `requestRecordExists` (TDD)

**Files:** Modify `reports-db.js` (near the report-CRUD fns) + export them. Test: `tests/pg-reports-reports.test.js`.

- [ ] **Step 1a: `reassignReportWeek` test** — append to `tests/pg-reports-reports.test.js`. Its `boot()` returns `{ ctx, rdb, siteId }`; `ensureReport(site_id, year, week)` (3 args!) creates the week + returns the full report row (has `.id`); `getReport(id)` returns a row with `.week_id`:
```js
test('reports pg: reassignReportWeek (wiring-2 helper)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const r1 = await rdb.ensureReport(siteId, 2026, 10);   // (site_id, year, week)
    const r2 = await rdb.ensureReport(siteId, 2026, 11);
    const id1 = r1.id, id2 = r2.id;
    const w2id = (await rdb.getReport(id2)).week_id;        // conflict target's week
    const w3id = (await rdb.ensureReport(siteId, 2026, 12)).week_id;  // a free week
    // reassign r1 INTO w2 (occupied by r2) → conflict, NO change
    const dup = await rdb.reassignReportWeek({ reportId: id1, siteId, newWeekId: w2id });
    assert.equal(dup.duplicateReportId, id2, 'conflict returns the occupying report id');
    assert.notEqual((await rdb.getReport(id1)).week_id, w2id, 'r1 week unchanged on conflict');
    // reassign r1 INTO w3 (free) → ok
    const ok = await rdb.reassignReportWeek({ reportId: id1, siteId, newWeekId: w3id });
    assert.equal(ok.duplicateReportId, null, 'free week → reassigned');
    assert.equal((await rdb.getReport(id1)).week_id, w3id, 'week_id updated');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 1b: `requestRecordExists` test** — append to `tests/pg-reports-aggregates.test.js` (it has `_req` + `upsertRequestBatch` + the request seed pattern; the reports suite does NOT):
```js
test('agg pg: requestRecordExists (wiring-2 helper)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.upsertRequestBatch([_req({ request_id:'EX1', created_time:'2026-05-01 09:00:00' })]);
    assert.equal(await rdb.requestRecordExists('EX1'), true);
    assert.equal(await rdb.requestRecordExists('NOPE'), false);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run red** — `PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node --test --test-force-exit --test-name-pattern="wiring-2 helpers" tests/pg-reports-reports.test.js` → FAILS.

- [ ] **Step 3: Implement** in `reports-db.js`:
```js
// Reassign a report to a new week — tx: conflict-check then UPDATE. Returns {duplicateReportId}
// (the occupying report id, or null if reassigned). updated_at is TIMESTAMPTZ → now() in pg.
function reassignReportWeek({ reportId, siteId, newWeekId } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _reassignReportWeekPg({ reportId, siteId, newWeekId });
  return _reassignReportWeekSqlite({ reportId, siteId, newWeekId });
}
const _reassignReportWeekSqlite = db.transaction(({ reportId, siteId, newWeekId }) => {
  const dup = db.prepare('SELECT id FROM weekly_reports WHERE site_id=? AND week_id=? AND id!=?').get(siteId, newWeekId, reportId);
  if (dup) return { duplicateReportId: dup.id };
  db.prepare("UPDATE weekly_reports SET week_id=?, updated_at=datetime('now') WHERE id=?").run(newWeekId, reportId);
  return { duplicateReportId: null };
});
async function _reassignReportWeekPg({ reportId, siteId, newWeekId }) {
  const H = pgHandle();
  return await H.runTransaction(async () => {   // runTransaction is a METHOD on the pg handle (pgDb.js), NOT a bare fn
    const dup = await H.prepare('SELECT id FROM weekly_reports WHERE site_id=? AND week_id=? AND id!=?').get(siteId, newWeekId, reportId);
    if (dup) return { duplicateReportId: dup.id };
    await H.prepare('UPDATE weekly_reports SET week_id=?, updated_at=now() WHERE id=?').run(newWeekId, reportId);
    return { duplicateReportId: null };
  });
}

// Existence check for the refresh-major-incident-udfs diagnostic.
function requestRecordExists(requestId) {
  if (REPORTS_BACKEND === 'postgres') return _requestRecordExistsPg(requestId);
  return !!db.prepare('SELECT 1 FROM request_records WHERE request_id = ? LIMIT 1').get(requestId);
}
async function _requestRecordExistsPg(requestId) {
  return !!(await pgHandle().prepare('SELECT 1 FROM request_records WHERE request_id = ? LIMIT 1').get(requestId));
}
```
Confirm `runTransaction` is the same helper the other `_xPg` tx-forks use (4C pattern); match its import/usage exactly. Export both fns from `module.exports`.

- [ ] **Step 4: Run green** — PASSES.
- [ ] **Step 5: Commit** — `feat(pg-reports-wiring2): reassignReportWeek + requestRecordExists forks (TDD; tx conflict-check, updated_at=now() TIMESTAMPTZ, existence check)`

---

### Task 1: Functional rewires (raw-`db` sites + 2 helper ripples)

**Files:** Modify `server.js`. **IMPORTANT:** do NOT add `await` to any `rdb.<fn>(` forked call here — the Task 2 sweep awaits every `rdb.<forkedFn>(` exactly once (file-wide). Adding it here too → guaranteed `await await`. Task 1 only: (a) replaces raw `db.prepare` with the new helper calls (un-awaited), (b) makes the 2 ripple helpers `async`, (c) adds `await` ONLY to the 2 ripple-helper CALL SITES (`validateActionItems(...)` / `_userMeetingsSite(...)` — these are NOT `rdb.` calls, so the sweep won't touch them).

- [ ] **Step 1: `/api/reports/:id/reassign-week`** (~4772/4783) — replace the two raw `rdb.db.prepare(...)` (dup-check + UPDATE) with the helper (NO await — sweep adds it):
```js
const { duplicateReportId } = rdb.reassignReportWeek({ reportId: id, siteId: existing.site_id, newWeekId });
if (duplicateReportId) {
  const dup = rdb.getReport(duplicateReportId);
  return res.status(409).json({ error: `A ${dup.week_label} report already exists for ${existing.site_name}. Delete it first, then try again.` });
}
const reassigned = rdb.getReport(id);
```
(`reassignReportWeek`/`getReport` get `await` in Task 2; handler made async in Task 2's path loop.)

- [ ] **Step 2: `/api/admin/refresh-major-incident-udfs`** (~2477) — replace the raw `checkStmt` loop (NO await — sweep adds it to `requestRecordExists`; the handler is already async — it does Zoho fetches):
```js
// was: const checkStmt = db.prepare('SELECT 1 FROM request_records WHERE request_id = ? LIMIT 1');
//      ... if (!checkStmt.get(r.request_id)) ...
for (const r of udfRows) {
  if (sampleUnmatchedIds.length >= 5) break;
  if (!rdb.requestRecordExists(r.request_id)) sampleUnmatchedIds.push(r.request_id);
}
```
(Note: `rdb.upsertRequestUdfBatch(udfRows)` at ~2469 is in FNS → the sweep awaits it: `const dbUpdated = cond ? await rdb.upsertRequestUdfBatch(udfRows) : 0;` — fixes the `dbUnmatched=NaN`-under-pg bug. No manual change here.)

- [ ] **Step 3: `validateActionItems`** — make the helper `async` (add the `async` keyword). Do NOT touch its internal `rdb.listDepartments()` (the sweep awaits it). Add `await` to its 2 CALL SITES — `validateActionItems(...)` → `await validateActionItems(...)` at `PUT /api/reports/:id/actions` (~4677) + `POST /api/reports/monthly/:site_id/:year/:month/edits`.

- [ ] **Step 4: `_userMeetingsSite`** (~5679) — make async (add `async`). Do NOT touch its internal `rdb.listSites()` (sweep awaits it). Add `await` to its 3 CALL SITES — `_userMeetingsSite(...)` → `await _userMeetingsSite(...)` at ~5880, ~5932, ~5959 (all already-async meetings routes).

- [ ] **Step 5:** `node --check server.js` clean. (The reassign/refresh handlers + the report routes become async in Task 2's path loop; `validateActionItems` is awaited by its now-async route callers — both `PUT .../actions` + `POST .../edits` are in Task 2's ROUTES list. `_userMeetingsSite`'s meetings-route callers are already async.)

- [ ] **Step 6: Commit** — `feat(pg-reports-wiring2): rewire reassign-week + refresh-udf to forked helpers; validateActionItems + _userMeetingsSite async (ripples)`

---

### Task 2: Mechanical sweep — async handlers + await all cold-path forked calls

**Files:** Modify `server.js`.

- [ ] **Step 1: Make the cold-path handlers `async`** — a path-list loop (excludes `auth/me` + `current-week`, which call no forked fn; PPTX + meetings routes are already async):
```bash
cd <repo>
# "METHOD|PATH" pairs (paths verbatim, including :params)
ROUTES=(
 "get|/api/reports/sites" "put|/api/reports/sites/:id" "post|/api/reports/sites" "delete|/api/reports/sites/:id"
 "get|/api/reports/departments" "post|/api/reports/departments" "put|/api/reports/departments/:id" "delete|/api/reports/departments/:id"
 "get|/api/reports" "post|/api/reports/ensure"
 "get|/api/reports/:id/carry-over-actions" "get|/api/reports/:id/action-weeks" "get|/api/reports/:id/actions-from/:source_report_id"
 "get|/api/reports/:id/light-weeks" "get|/api/reports/:id/lights-from/:source_report_id" "get|/api/reports/:id/carry-over-infra"
 "get|/api/reports/:id/audit" "get|/api/reports/:id" "get|/api/reports/:id/open-changes" "get|/api/sites/:siteId/open-changes"
 "get|/api/reports/:id/active-incidents" "get|/api/sites/:siteId/active-incidents" "delete|/api/reports/:id"
 "put|/api/reports/:id/infra" "put|/api/reports/:id/helpdesk" "put|/api/reports/:id/lights" "put|/api/reports/:id/actions"
 "put|/api/reports/:id/status" "put|/api/reports/:id/reassign-week"
 "get|/api/reports/monthly/:site_id/:year/:month" "get|/api/reports/monthly/:site_id/:year/:month/edits"
 "post|/api/reports/monthly/:site_id/:year/:month/edits" "get|/api/reports/yearly/:site_id/:year"
 "get|/api/reports/objectives/:site_id/:year" "post|/api/reports/objectives/:site_id/:year"
 "get|/api/dashboard/presets" "put|/api/dashboard/presets" "get|/api/dashboard/groups/discovered"
)
for rp in "${ROUTES[@]}"; do m="${rp%%|*}"; p="${rp##*|}";
  sed -i -E "s#(app\.${m}\('${p}',.*)\(req, res\) =>#\1async (req, res) =>#" server.js
done
node --check server.js && echo CHECK_OK
```
> The `:id` path could be a prefix of `:id/audit` etc.; sed matches the literal `'${p}',` (with the closing quote+comma) so `/api/reports/:id'` won't match `/api/reports/:id/audit'`. Verify each became async (next step's grep).

- [ ] **Step 2: `await` all cold-path forked calls** — per-fn sed (the `(`-anchor prevents prefix collisions like `getReport(` vs `getReportAuditLog(`; `getPreviousWeek(` is pure and intentionally absent):
```bash
FNS=(getReport listReports ensureReport ensureWeek updateReportStatus touchReport deleteReport
 saveInfraKpis saveHelpdeskData saveLights saveActionItems getActionsForReport getLightsForReport
 getPreviousWeekOpenActions getPreviousWeekInfraKpis listAllWeeksWithActions listAllWeeksWithLights
 getMonthlyData getMonthlyEdits saveMonthlyEdits getYearlySummary getAnnualObjectives saveAnnualObjectives
 getWeekSummaryData getOpenChangesForSite getActiveMajorIncidentsForSite getReportAuditLog
 listSites updateSite createSite setSiteActive listDepartments createDepartment updateDepartment setDepartmentActive
 logAudit reassignReportWeek requestRecordExists upsertRequestUdfBatch)
for fn in "${FNS[@]}"; do sed -i -E "s#rdb\.${fn}\(#await rdb.${fn}(#g" server.js; done
# groupPresets forked calls
sed -i -E "s#groupPresets\.(getPresets|getPresetsWithDiscovered|setPresets|getDiscovered)\(#await groupPresets.\1(#g" server.js
node --check server.js && echo CHECK_OK
```
> **CRITICAL — these sed patterns assume NONE are already awaited** (reviewer-confirmed for cold path). Guard against double-await + stray-context errors (next step).

- [ ] **Step 3: Verify no double-await + no un-awaited forked calls remain + node --check:**
```bash
grep -n "await await" server.js   # expect NONE — if any, the fn was already awaited; remove the dup
# every forked fn call now awaited (these greps should print nothing):
for fn in "${FNS[@]}"; do grep -nE "[^t] rdb\.${fn}\(|=rdb\.${fn}\(|\(rdb\.${fn}\(" server.js | grep -v await; done
node --check server.js && echo CHECK_OK
```
If `node --check` reports "await is only valid in async functions", that call site is in a handler/helper the loop missed → make that specific fn `async` (or it's a sync helper ripple the spec-review missed → make it async + await its callers). Fix and re-check.

- [ ] **Step 4: Smoke** — `node --test --test-force-exit tests/server-routes-smoke.test.js` → still green (sqlite behaviour preserved). The existing 6 routes must stay 200.

- [ ] **Step 5: Commit** — `feat(pg-reports-wiring2): async + await all cold-path report/config/preset route calls`

---

### Task 3: Smoke extension + regression + README + finish-branch

**Files:** Modify `tests/server-routes-smoke.test.js`, `tools/pg/README.md`.

- [ ] **Step 1: Extend the smoke** — add cold-path routes to the `ROUTES` list: `/api/reports`, `/api/reports/sites`, `/api/reports/departments`, `/api/dashboard/presets?scope=tickets`. Run → all green (seeded admin satisfies `requireReportSession`).
- [ ] **Step 2: Helper TDD + full pg regression** — `tests/pg-reports-reports.test.js` (+1 wiring-2 helpers) + auth/config/hot/aggregates suites all green.
- [ ] **Step 3: sqlite synchronous-return smoke** — assert `reassignReportWeek({})`/`requestRecordExists('x')` NOT `instanceof Promise` on sqlite (throwaway script; `reassignReportWeek` with a bogus id returns `{duplicateReportId:null}` after a no-op update — fine, or wrap in try).
- [ ] **Step 4:** `node --check server.js && node --check reports-db.js` clean; golden-pptx test green (`node --test --test-force-exit --test-name-pattern="" tests/pptx-monthly-golden.test.js` if present — confirms PPTX shape unchanged in sqlite).
- [ ] **Step 5: README** — add `## reports.db — Sub-chunk 4D-wiring-2` to `tools/pg/README.md`: the 2 helpers + the ~38 cold-path route awaits + the 2 helper ripples; note **4D-wiring COMPLETE** (hot + cold); remaining before the prod flip = **4B-RR** + a KPI reconciliation.
- [ ] **Step 6: Commit + finish-branch:**
```bash
git add tools/pg/README.md tests/server-routes-smoke.test.js && git commit -m "feat(pg-reports-wiring2): smoke extension + regression + README (4D-wiring COMPLETE)"
git checkout main && git merge --no-ff feat/pg-reports-wiring-2 -m "merge: server.js cold-path async wiring (Chunk 4D-wiring-2) behind REPORTS_BACKEND — 4D-wiring COMPLETE"
```
- [ ] **Step 7: Post-merge sanity** — on main: `node --check server.js` + smoke green + pg suites green. Update migration memory: 4D-wiring-2 merged → **4D-wiring COMPLETE**; remaining = 4B-RR + KPI reconciliation before the prod flip.

---

## Remember
- pg forks query `pgHandle()`, NEVER `db`. sqlite body stays synchronous; only the pg branch async.
- `node --check` is the hard gate for the await-in-non-async-fn risk — run it after EVERY sed batch.
- Don't await the pure fns (`getWeekRange`/`getISOWeek`/`getPreviousWeek`) — they're absent from the FNS list by design.
- Don't touch risk-register (`rr.*`) — that's 4B-RR.
- DRY, YAGNI, TDD, frequent commits.
