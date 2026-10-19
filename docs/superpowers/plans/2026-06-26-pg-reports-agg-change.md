# Chunk 4D-2c — change / CAB breakdowns → PostgreSQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork 7 read-only change-records + CAB aggregate/list readers in `reports-db.js` to PostgreSQL behind `REPORTS_BACKEND=postgres`, preserving KPI math byte-for-byte; default backend stays sqlite (synchronous returns), prod untouched.

**Architecture:** Each fn gets `if (REPORTS_BACKEND === 'postgres') return _fnPg(...)` as its first line; the sqlite body stays synchronous; a new `async _fnPg` queries `pgHandle()` with the dialect-reconciled SQL and reuses the existing JS `.map` transform (extracted to a shared helper where non-trivial). Tests accrete into the shared `tests/pg-reports-aggregates.test.js`.

**Tech Stack:** Node.js, `services/pgDb.js` async adapter, local PostgreSQL 17 (`PG_ADMIN_URL`), `node:test`, better-sqlite3 (sqlite default).

**Spec:** `docs/superpowers/specs/2026-06-26-pg-reports-agg-change-design.md` (reviewed ✅).

**Dialect cheat-sheet (from the reviewed spec):**
- `change_records.emergency` is INTEGER → `emergency=1 OR emergency='true' OR emergency='1'` becomes `emergency::text IN ('1','true')` (PG errors on `integer = 'true'`).
- `ROUND(AVG(<double>), 1)` needs `::numeric` — the EXTRACT-EPOCH path: `ROUND(AVG(EXTRACT(EPOCH FROM (NULLIF(a,'')::timestamptz - NULLIF(b,'')::timestamptz)) / 86400)::numeric, 1)`. `ROUND(AVG(turnaround_minutes),1)` stays as-is (INTEGER → AVG = numeric).
- `scheduled_start <= datetime('now')` → `NULLIF(scheduled_start,'')::timestamptz <= now()`.
- raw ISO cutoff bounds (`created_time >= ?`, `recommendation_requested >= ?`) → UNCHANGED (lexical TEXT).
- `||` concat, `NULLS LAST`, `LEFT JOIN`, `IN(…)`, `GROUP BY <real col>`, bare-alias `ORDER BY count DESC` → all unchanged.
- pg forks query `pgHandle()`, NEVER `db`. Object-arg fns destructure identically in both branches.
- getEmergencyChangesDB reads non-existent cols `r.change_status` + `r.planned_start_time` → `'Status'`/`'Planned Start Time'` are undefined/null in both engines. Preserve; **don't assert on `'Status'`**.

**Test builders to add** (copy verbatim from `tests/pg-reports-hot.test.js:24-31`):
```js
const _chg = o => ({ change_id:null, display_id:null, subject:null, status:null, stage:null,
  stage_status:null, risk:null, change_type:null, emergency:0, category:null, sub_category:null,
  requester:null, requester_id:null, owner_id:null, manager:null, site_id:null, group_id:null,
  group_name:null, scheduled_start:null, scheduled_end:null, completed_time:null, created_time:null,
  closure_code:null, udf_json:null, ...o });
const _cab = o => ({ approval_id:null, change_id:null, approver_name:null, approval_status:null,
  approval_stage:null, approval_level:null, approval_level_status:null, recommendation_requested:null,
  action_taken_on:null, turnaround_minutes:null, rule_type:null, comments:null, ...o });
```
Place these near the existing `_req` template at the top of `tests/pg-reports-aggregates.test.js`.

---

### Task 1: Metric bundles — getChangeMetrics · getCABMetrics

**Files:**
- Modify: `reports-db.js` (`getChangeMetrics` ~4372, `getCABMetrics` ~4447)
- Test: `tests/pg-reports-aggregates.test.js` (add `_chg`/`_cab` builders + one test)

- [ ] **Step 1: Add the builders** (above) near `_req`. Then write the failing test:

```js
test('agg pg: getChangeMetrics + getCABMetrics (emergency::text, NULLIF ts, ROUND ::numeric, DISTINCT)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.upsertChangeBatch([
      // 2 Completed (scheduled→completed 2d and 4d apart) → avg_completion_days = 3.0
      _chg({change_id:'CH1',status:'Completed',stage:'Close',emergency:1,scheduled_start:'2026-05-10 09:00:00',completed_time:'2026-05-12 09:00:00',created_time:'2026-05-10 09:00:00'}),
      _chg({change_id:'CH2',status:'Completed',stage:'Close',scheduled_start:'2026-05-10 09:00:00',completed_time:'2026-05-14 09:00:00',created_time:'2026-05-10 09:00:00'}),
      _chg({change_id:'CH3',status:'Cancelled',stage:'Close',created_time:'2026-05-10 09:00:00'}),
      _chg({change_id:'CH4',status:'Rejected',created_time:'2026-05-10 09:00:00'}),
      _chg({change_id:'CH5',status:'Failed',created_time:'2026-05-10 09:00:00'}),
      _chg({change_id:'CH6',status:'Backout',stage:'Close',created_time:'2026-05-10 09:00:00'}),
      // in-progress: scheduled_start in past + stage/status not Close-Completed/Cancelled
      _chg({change_id:'CH7',status:'In Progress',stage:'Implementation',scheduled_start:'2026-05-10 09:00:00',created_time:'2026-05-10 09:00:00'}),
    ]);
    const cm = await rdb.getChangeMetrics({});
    assert.equal(cm.total, 7);
    assert.equal(cm.completed_count, 2);
    assert.equal(cm.cancelled_count, 1);
    assert.equal(cm.rejected_count, 1);
    assert.equal(cm.failed_count, 2, 'Failed + (Close,Backout)');
    assert.equal(cm.executed_count, 4, 'completed + failed');
    assert.equal(cm.change_success_rate, 50, 'round(2/4*100,1)');
    assert.equal(cm.emergency_count, 1, 'emergency::text IN (1,true)');
    assert.equal(cm.in_progress_count, 1, 'NULLIF(scheduled_start)::timestamptz <= now()');
    assert.equal(cm.avg_completion_days, 3, 'EXTRACT-EPOCH/86400 ROUND ::numeric → (2+4)/2');

    await rdb.upsertCABBatch([
      _cab({approval_id:'A1',change_id:'C1',approval_status:'Approved',turnaround_minutes:30,recommendation_requested:'2026-06-01 09:00:00'}),
      _cab({approval_id:'A2',change_id:'C1',approval_status:'Approved',turnaround_minutes:50,recommendation_requested:'2026-06-01 09:00:00'}),
      _cab({approval_id:'A3',change_id:'C2',approval_status:'Rejected',recommendation_requested:'2026-06-01 09:00:00'}),
    ]);
    const cab = await rdb.getCABMetrics({});
    assert.equal(cab.total_approvals, 3);
    assert.equal(cab.approved_count, 2);
    assert.equal(cab.distinct_changes, 2, 'C1, C2');
    assert.equal(cab.changes_with_approval, 1, 'only C1 fully Approved');
    assert.equal(cab.cab_compliance_pct, 50, 'round(1/2*100,1)');
    assert.equal(cab.avg_turnaround_minutes, 40, 'AVG(30,50) numeric, no cast');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run red** — `PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node --test --test-force-exit --test-name-pattern="getChangeMetrics" tests/pg-reports-aggregates.test.js` → FAILS.

- [ ] **Step 3: Implement both forks.** Add the dispatch line + an `async _fnPg` that awaits each `.get`/`.all` against `pgHandle()`, applying the cheat-sheet rewrites. The JS assembly (toFixed math, return object) is reused — factor it into a shared `_assembleChangeMetrics(...)`/`_assembleCABMetrics(...)` helper that takes the already-resolved query results, OR keep the per-branch assembly inline (the values are small). Key pg-branch SQL changes:
  - emergency: `... AND emergency::text IN ('1','true')`
  - inProgress: `... AND NULLIF(scheduled_start,'')::timestamptz <= now() AND (stage || ' - ' || status) NOT IN ('Close - Completed','Close - Cancelled')`
  - avg: `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (NULLIF(completed_time,'')::timestamptz - NULLIF(scheduled_start,'')::timestamptz)) / 86400)::numeric, 1) AS avg_days FROM change_records ${where} AND status='Completed' AND completed_time IS NOT NULL AND scheduled_start IS NOT NULL`
  - getCABMetrics: only the `since` bound (unchanged) + awaits; `ROUND(AVG(turnaround_minutes),1)` stays as-is.

- [ ] **Step 4: Run green** — same command → PASSES.

- [ ] **Step 5: Commit**

```bash
git add reports-db.js tests/pg-reports-aggregates.test.js
git commit -m "feat(pg-reports-agg-change): getChangeMetrics + getCABMetrics forks (TDD; emergency::text, NULLIF ts<=now(), ROUND(AVG(EXTRACT-EPOCH))::numeric, COUNT DISTINCT)"
```

---

### Task 2: List/history fns — getEmergencyChangesDB · getCabApprovalsDB · getCabRecommendationsDB · getChangeRecordsHistory · getOpenChangesForSite

**Files:**
- Modify: `reports-db.js` (getEmergencyChangesDB ~2841, getCabApprovalsDB ~3017, getCabRecommendationsDB ~3080, getChangeRecordsHistory ~3374, getOpenChangesForSite ~5087)
- Test: `tests/pg-reports-aggregates.test.js` (one test)

- [ ] **Step 1: Write the failing test.** Reuse the boot site (`zoho_group='Hounde IT Agents'`) so getChangeRecordsHistory derives `Site='Hounde'` from a change whose `group_name='Hounde IT Agents'`.

```js
test('agg pg: change list/history + cab join + open changes', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const G = 'Hounde IT Agents';
    await rdb.upsertChangeBatch([
      // emergency + open + history subject; group_name matches boot site's zoho_group
      _chg({change_id:'C1',display_id:'CRQ-1',subject:'Net upgrade',change_type:'Emergency Change',
            status:'Completed',stage:'Implementation',group_name:G,created_time:'2026-06-10 09:00:00',
            udf_json:JSON.stringify({'UDF:Reason':'urgent'})}),
      // non-emergency, closed → absent from emergency list AND open-changes
      _chg({change_id:'C2',display_id:'CRQ-2',subject:'Routine patch',change_type:'Normal',
            status:'Completed',stage:'Close',group_name:G,created_time:'2026-06-11 09:00:00'}),
    ]);
    await rdb.upsertCABBatch([
      _cab({approval_id:'A1',change_id:'C1',approver_name:'Alice',approval_status:'Approved',
            turnaround_minutes:30,recommendation_requested:'2026-06-12 09:00:00'}),
      // no turnaround → present in approvals, ABSENT from recommendations
      _cab({approval_id:'A2',change_id:'C1',approver_name:'Bob',approval_status:'Pending',
            recommendation_requested:'2026-06-12 09:00:00'}),
    ]);

    const emg = await rdb.getEmergencyChangesDB();
    const e1 = emg.find(r => r['Change ID'] === 'C1');
    assert.ok(e1, 'emergency change present'); assert.match(e1['Change Type'], /emergency/i);
    assert.ok(!emg.find(r => r['Change ID'] === 'C2'), 'non-emergency absent');

    const apps = await rdb.getCabApprovalsDB();
    const a1 = apps.find(r => r['Change ID'] === 'C1');
    assert.ok(a1, 'cab approval row'); assert.equal(a1['Subject'], 'Net upgrade'); // LEFT JOIN
    assert.equal(a1['Change Approver'], 'Alice');
    assert.equal(a1['Site'], '', "c.site dropped (non-existent col) → '' both engines");

    const recs = await rdb.getCabRecommendationsDB();
    assert.ok(recs.find(r => r['Change Approver'] === 'Alice'), 'turnaround-set row present');
    assert.ok(!recs.find(r => r['Change Approver'] === 'Bob'), 'no-turnaround row absent');

    const open = await rdb.getOpenChangesForSite([G]);
    assert.ok(open.find(r => r.display_id === 'CRQ-1'), 'open (stage!=Close) present');
    assert.ok(!open.find(r => r.display_id === 'CRQ-2'), 'closed absent');

    const hist = await rdb.getChangeRecordsHistory();
    const h1 = hist.find(r => r['Change ID'] === 'C1');
    assert.ok(h1, 'history row'); assert.equal(h1['Site'], 'Hounde', 'derived from group→site map');
    assert.equal(h1['UDF:Reason'], 'urgent', 'udf_json unpacked');
    // NOTE: do NOT assert on getEmergencyChangesDB "Status" — r.change_status is a non-existent col.
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run red** — FAILS.

- [ ] **Step 3: Implement the 5 forks.** Each adds a dispatch line + `async _fnPg` using `pgHandle()`:
  - **getEmergencyChangesDB** — raw ISO bound UNCHANGED, query identical; await + reuse the JS map (extract `_mapEmergencyChanges`). Leave the `r.change_status`/`r.planned_start_time` non-existent-column reads alone (`SELECT *`, harmless undefined/null).
  - **getCabApprovalsDB / getCabRecommendationsDB** — **BUNDLED CORRECTIVE FIX: drop `c.site AS site` from BOTH the sqlite body AND the pg fork** of both functions. These throw `no such column: c.site` today (verified — `change_records` has `site_id` not `site`), so there is no output to preserve; dropping the column makes them work identically in both engines, with the JS map's `'Site': r.site || ''` yielding `''`. Otherwise raw ISO bound UNCHANGED, `LEFT JOIN`/`NULLS LAST` valid; await + reuse the JS map (extract `_mapCabApprovals`/`_mapCabRecommendations`).
  - **getChangeRecordsHistory** — await BOTH the `sites` lookup and the `change_records` query; reuse `_mapChangeRecordsHistory(rows, groupToSite)` shared helper (build `groupToSite` in JS from the awaited sites rows).
  - **getOpenChangesForSite** — keep the empty-`groups` guard (`return []`) before the query in both branches; await the single query; return raw rows (no map).

- [ ] **Step 4: Run green** — PASSES.

- [ ] **Step 5: Commit** — `feat(pg-reports-agg-change): emergency/cab-approvals/recommendations/change-history/open-changes forks (TDD; raw-ISO cutoff unchanged, LEFT JOIN, two-query history awaited)`

---

### Task 3: Suite green + regression + sqlite sync smoke + README + finish-branch

**Files:**
- Modify: `tools/pg/README.md` (add 4D-2c section)

- [ ] **Step 1: Full 4D-2 suite green** — `PG_ADMIN_URL=… node --test --test-force-exit tests/pg-reports-aggregates.test.js` → all pass (4D-2a 6 + 4D-2b 3 + 4D-2c 2 = 11).
- [ ] **Step 2: Full reports.db pg regression** — auth/config/reports/hot/aggregates → 8+6+6+4+11 green.
- [ ] **Step 3: sqlite synchronous-return smoke** — extend the throwaway smoke to assert the 7 new fns (`getEmergencyChangesDB()`, `getCabApprovalsDB()`, `getCabRecommendationsDB()`, `getChangeRecordsHistory()`, `getChangeMetrics({})`, `getCABMetrics({})`, `getOpenChangesForSite(['x'])`) are NOT `instanceof Promise` under sqlite.
- [ ] **Step 4: `node --check reports-db.js`** clean.
- [ ] **Step 5: README** — add `## reports.db — Sub-chunk 4D-2c` to `tools/pg/README.md`: the 7 fns, the three new hazards (emergency `::text`, ROUND(AVG(double))`::numeric` vs AVG(integer) no-cast, `NULLIF(scheduled_start,'')::timestamptz <= now()`), two-query getChangeRecordsHistory, LEFT JOIN cab fns, raw-ISO cutoffs unchanged. Update the DEFERRED list to drop 4D-2c → point at 4D-2d only.
- [ ] **Step 6: Commit + finish-branch:**

```bash
git add tools/pg/README.md && git commit -m "feat(pg-reports-agg-change): suite green + sqlite sync smoke + README 4D-2c section"
git checkout main && git merge --no-ff feat/pg-reports-agg-change -m "merge: pg reports.db change/CAB readers (Chunk 4D-2c) behind REPORTS_BACKEND"
```

- [ ] **Step 7: Post-merge sanity** — on main, `node --check reports-db.js` + re-run `tests/pg-reports-aggregates.test.js` (11 green). Update the migration memory (`project_pg_migration_chunk1_done.md` + index) to mark 4D-2c merged; remaining = 4D-2d + 4D-wiring + 4B-RR.

---

## Remember
- pg forks query `pgHandle()`, NEVER `db`.
- Keep the sqlite body untouched and synchronous; only the pg branch is async.
- Reuse the JS `.map`/assembly — extract a shared helper only where non-trivial.
- Don't "fix" the latent `r.change_status` / `r.planned_start_time` non-existent-column reads in getEmergencyChangesDB (separate task); don't assert on its `'Status'`.
- DRY, YAGNI, TDD, frequent commits.
