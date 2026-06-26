# Chunk 4D-2b — request SLA / ageing / trend → PostgreSQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork 8 read-only request SLA/ageing/trend aggregate readers in `reports-db.js` to PostgreSQL behind `REPORTS_BACKEND=postgres`, preserving KPI math byte-for-byte; default backend stays sqlite (synchronous returns), prod untouched.

**Architecture:** Each fn gets `if (REPORTS_BACKEND === 'postgres') return _fnPg(...)` as its first line; the sqlite body stays synchronous; a new `async _fnPg` queries `pgHandle()` with the dialect-reconciled SQL and reuses the existing JS `.map`/pivot transform. Tests accrete into the shared `tests/pg-reports-aggregates.test.js`.

**Tech Stack:** Node.js, `services/pgDb.js` async adapter, local PostgreSQL 17 (`PG_ADMIN_URL`), `node:test`, better-sqlite3 (sqlite default).

**Spec:** `docs/superpowers/specs/2026-06-26-pg-reports-agg-sla-design.md` (reviewed ✅).

**Dialect cheat-sheet (from the reviewed spec):**
- ageing days: `CAST((julianday('now') - julianday(created_time)) AS INTEGER)` → `TRUNC(EXTRACT(EPOCH FROM (now() - created_time::timestamptz)) / 86400)::integer` (TRUNC, not CAST — sqlite truncates, pg CAST rounds).
- avg hours: `(julianday(a)-julianday(b))*24` → `EXTRACT(EPOCH FROM (a::timestamptz - b::timestamptz)) / 3600`; avg days → `/ 86400` (no TRUNC — feeds AVG).
- month bucket: `strftime('%Y-%m', x)` → `to_char(x::timestamptz,'YYYY-MM')`.
- `HAVING total > 0` / `>= 5` → `HAVING COUNT(*) > 0` / `>= 5` (pg forbids alias in HAVING).
- `ORDER BY (d0_30 + d31_45 + d46_60 + d_over_60) DESC` → repeat the four `SUM(CASE …)` expressions (pg forbids alias-expression in ORDER BY). Bare-alias ORDER BY (`total`, `yyyymm`, `cnt`, `violated_closed`) stays as-is.
- `datetime('now','-12 months')` → `created_time::timestamptz >= now() - interval '12 months'`.
- raw ISO cutoff `created_time >= ?` (bound = `cutoff.toISOString()`) → UNCHANGED (lexical TEXT).
- `GROUP BY yyyymm|grp|cat|site` → unchanged (no column-name shadowing).
- pg forks query `pgHandle()`, NEVER `db` (db is always sqlite).

---

### Task 1: Ageing forks — getAgeingBySiteDB · getAgeingByGroupDB · getAgeingSummaryDB

**Files:**
- Modify: `reports-db.js` (`getAgeingBySiteDB` ~2276, `getAgeingByGroupDB` ~2321, `getAgeingSummaryDB` ~2705)
- Test: `tests/pg-reports-aggregates.test.js` (append one test)

- [ ] **Step 1: Write the failing test** — append to `tests/pg-reports-aggregates.test.js`:

```js
test('agg pg: ageing buckets (site/group/summary) + TRUNC boundary + noise filter', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const G = 'Hounde IT Agents';
    // helper: an open row created N days ago (TEXT 'YYYY-MM-DD HH:MM:SS', UTC)
    const daysAgo = (n) => {
      const d = new Date(Date.now() - n*86400000);
      return d.toISOString().slice(0,19).replace('T',' ');
    };
    await rdb.upsertRequestBatch([
      // Hounde site/group: one per bucket. 65d → >60; 50d → 46-60; 40d → 31-45; 10d → 0-30
      _req({request_id:'AG1',tech_group:G,site:'Hounde',pending_status:1,created_time:daysAgo(65),first_response_overdue:'false'}),
      _req({request_id:'AG2',tech_group:G,site:'Hounde',pending_status:1,created_time:daysAgo(50),first_response_overdue:'true'}),
      _req({request_id:'AG3',tech_group:G,site:'Hounde',pending_status:1,created_time:daysAgo(40),first_response_overdue:'false'}),
      _req({request_id:'AG4',tech_group:G,site:'Hounde',pending_status:1,created_time:daysAgo(10),first_response_overdue:'false'}),
      // a second group with FEWER open rows, to lock getAgeingSummaryDB ORDER BY (total DESC)
      _req({request_id:'AG5',tech_group:'Mana IT Agents',site:'Mana',pending_status:1,created_time:daysAgo(5),first_response_overdue:'false'}),
      // closed row — must be excluded from all ageing (pending_status=0)
      _req({request_id:'AG6',tech_group:G,site:'Hounde',pending_status:0,created_time:daysAgo(70)}),
      // noise site — must be dropped by getAgeingBySiteDB filter
      _req({request_id:'AG7',tech_group:G,site:'-No Value-',pending_status:1,created_time:daysAgo(20)}),
    ]);

    const bySite = await rdb.getAgeingBySiteDB();
    const hs = bySite.find(r => r.site === 'Hounde');
    assert.ok(hs, 'Hounde site present');
    assert.equal(hs.d0, 1); assert.equal(hs.d31, 1); assert.equal(hs.d46, 1); assert.equal(hs.d60, 1);
    assert.equal(hs.total, 4, 'closed AG6 + noise excluded');
    assert.ok(!bySite.find(r => String(r.site).toLowerCase().includes('no value')), 'noise site dropped');

    const byGrp = await rdb.getAgeingByGroupDB();
    const hg = byGrp.find(r => r.group === G);
    assert.ok(hg, 'Hounde group present');
    // AG7 has tech_group=G and is open → counted by GROUP (group path has NO site-noise
    // filter). 5 open Hounde-group rows: 65d,50d,40d,10d,20d → >60:1, 46-60:1, 31-45:1, 0-30:2.
    assert.equal(hg.total, 5, 'AG6 closed excluded; AG7 counted in group path');
    assert.equal(hg.t0_30, 2);   // 10d + 20d
    assert.equal(hg.t31_45, 1);  // 40d
    assert.equal(hg.t46_60, 1);  // 50d
    assert.equal(hg.tOver60, 1); // 65d
    assert.ok(hg.slaPct >= 0 && hg.slaPct <= 100, 'frt slaPct in range');

    const summ = await rdb.getAgeingSummaryDB();
    const grps = summ.map(r => r['Group']);
    const iH = grps.indexOf(G), iM = grps.indexOf('Mana IT Agents');
    assert.ok(iH >= 0 && iM >= 0, 'both groups present');
    assert.ok(iH < iM, 'higher-total Hounde group sorts before Mana (ORDER BY repeated-SUM)');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run red** — `PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node --test --test-force-exit tests/pg-reports-aggregates.test.js` → the new test FAILS (forks not present; sqlite body hits empty sqlite db → wrong/zero rows or returns sync value the await passes through but data is empty).

- [ ] **Step 3: Implement the 3 ageing forks.** For each: add dispatch line as the first statement and a paired `async _fnPg` using `pgHandle()`. Apply: `julianday('now')` → `now()` in all three; `TRUNC(EXTRACT(EPOCH FROM (now() - created_time::timestamptz)) / 86400)::integer` for `age_days`; `HAVING COUNT(*) > 0` for site + group ONLY — **`getAgeingSummaryDB` has NO HAVING in the sqlite source; do not add one**, only its ORDER BY changes (repeat the four `SUM(CASE …)` expressions). Reuse the existing JS `.map`/pivot by extracting it to a shared module-level helper where non-trivial (group's `slaPct` null-guard + summary's pivot-emit), or inline if short. Example shape:

```js
function getAgeingBySiteDB() {
  if (REPORTS_BACKEND === 'postgres') return _getAgeingBySiteDBPg();
  const rows = db.prepare(`...unchanged sqlite...`).all();
  return _mapAgeingSite(rows);
}
async function _getAgeingBySiteDBPg() {
  const rows = await pgHandle().prepare(`
    SELECT site, SUM(...) AS d0, ..., COUNT(*) AS total
    FROM (
      SELECT site, TRUNC(EXTRACT(EPOCH FROM (now() - created_time::timestamptz))/86400)::integer AS age_days
      FROM request_records
      WHERE pending_status = 1 AND site IS NOT NULL AND TRIM(site) != ''
        AND LOWER(TRIM(site)) NOT IN ('-no value-','-no value','no value','(blank)')
        AND created_time IS NOT NULL
    ) q
    GROUP BY site HAVING COUNT(*) > 0 ORDER BY total DESC
  `).all();
  return _mapAgeingSite(rows);
}
```
(Postgres requires the derived table to be aliased — add `q`.)

- [ ] **Step 4: Run green** — same command; the ageing test PASSES.

- [ ] **Step 5: Commit**

```bash
git add reports-db.js tests/pg-reports-aggregates.test.js
git commit -m "feat(pg-reports-agg-sla): ageing site/group/summary forks (TDD; TRUNC days, HAVING COUNT(*), repeated-SUM ORDER BY)"
```

---

### Task 2: SLA forks — getSlaTrendDB · getSlaByCategoryDB

**Files:**
- Modify: `reports-db.js` (`getSlaTrendDB` ~2540, `getSlaByCategoryDB` ~2592)
- Test: `tests/pg-reports-aggregates.test.js` (append one test)

- [ ] **Step 1: Write the failing test** — seed a single recent month (use a fixed `2026-05-10 09:00:00`-style `created_time` within the trailing-12-month window relative to today) with: closed+overdue, closed+not-overdue, responded+frt-violated rows in a known category, plus a 4-ticket category that must be dropped by `HAVING total >= 5`. Assert:
  - `getSlaTrendDB()` row for that month: `'% of SLA Violated'` = closed-only violation % (`round(violated_closed/closed*1000)/10`), `'% of First Responses SLA Violated'` = responded-only %.
  - `getSlaByCategoryDB()`: the ≥5-ticket category appears with `'% of SLA Violated'` as a STRING ending in `'%'`; the 4-ticket category is absent.

```js
test('agg pg: SLA trend + by-category denominators + string %', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const G = 'Hounde IT Agents', C = '2026-05-10 09:00:00';
    const big = [];
    // category 'Network' — 5 rows: 3 closed (1 overdue), 1 responded+frt-violated, 1 open
    big.push(_req({request_id:'S1',tech_group:G,category:'Network',created_time:C,pending_status:0,overdue_status:1,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}));
    big.push(_req({request_id:'S2',tech_group:G,category:'Network',created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}));
    big.push(_req({request_id:'S3',tech_group:G,category:'Network',created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}));
    big.push(_req({request_id:'S4',tech_group:G,category:'Network',created_time:C,pending_status:1,responded_time:'2026-05-10 10:00:00',first_response_overdue:'true'}));
    big.push(_req({request_id:'S5',tech_group:G,category:'Network',created_time:C,pending_status:1}));
    // small category 'Tiny' — 4 rows (must be dropped by HAVING >= 5)
    for (let i=0;i<4;i++) big.push(_req({request_id:'T'+i,tech_group:G,category:'Tiny',created_time:C,pending_status:0,overdue_status:1}));
    await rdb.upsertRequestBatch(big);

    const trend = await rdb.getSlaTrendDB();
    const may = trend.find(r => r['Created Date'] === 'May 2026');
    assert.ok(may, 'May 2026 trend row');
    // getSlaTrendDB has NO category dimension/HAVING — the whole month aggregates.
    // closed = 3 Network (S1,S2,S3) + 4 Tiny (T0-T3) = 7; violated_closed = S1 + T0-T3 = 5
    //   → round(5/7*1000)/10 = 71.4
    // responded = S1,S2,S3,S4 = 4 (Tiny rows have no responded_time); frt_viol = S4 = 1 → 25.0
    assert.equal(may['% of SLA Violated'], 71.4);
    assert.equal(may['% of First Responses SLA Violated'], 25);

    const byCat = await rdb.getSlaByCategoryDB();
    const net = byCat.find(r => r['Category'] === 'Network');
    assert.ok(net, 'Network category present (>=5)');
    assert.equal(typeof net['% of SLA Violated'], 'string');
    assert.ok(net['% of SLA Violated'].endsWith('%'), 'string with % suffix');
    assert.ok(!byCat.find(r => r['Category'] === 'Tiny'), 'Tiny dropped by HAVING >= 5');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run red** — the SLA test FAILS.
- [ ] **Step 3: Implement** both forks: `strftime`→`to_char` (trend); `datetime('now','-12 months')`→`created_time::timestamptz >= now() - interval '12 months'` + `HAVING COUNT(*) >= 5` (by-category); `created_time >= ?` (ISO bound, trend) UNCHANGED; closed-only/responded-only denominators verbatim; reuse the JS `.map` (preserve the `pct + '%'` string in by-category).
- [ ] **Step 4: Run green** — the SLA test PASSES.
- [ ] **Step 5: Commit** — `feat(pg-reports-agg-sla): SLA trend + by-category forks (TDD; to_char, closed/responded denominators, datetime→interval, HAVING COUNT(*)>=5, pct+'%' string)`

---

### Task 3: Trend/count forks — getFirstResponseTrendDB · getGroupRequestsDB · getIncidentVsSrDB

**Files:**
- Modify: `reports-db.js` (`getFirstResponseTrendDB` ~2370, `getGroupRequestsDB` ~2643, `getIncidentVsSrDB` ~2754)
- Test: `tests/pg-reports-aggregates.test.js` (append one test)

- [ ] **Step 1: Write the failing test** — seed a recent month with: a responded row (responded 1h after created) + resolved row (resolved 1 day after created) for FRT/RT; per-group rows for the count; an incident (`service_request:0`) + an SR (`service_request:1`). Assert `getFirstResponseTrendDB()` `avgFRT`/`avgRT` for the month, `getGroupRequestsDB()` per-group `'Request Count'`, `getIncidentVsSrDB()` `'Incidents'`/`'Service Requests'` split.

```js
test('agg pg: FRT/RT trend + group counts + incident-vs-SR', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const G = 'Hounde IT Agents', C = '2026-05-10 09:00:00';
    await rdb.upsertRequestBatch([
      _req({request_id:'F1',tech_group:G,service_request:0,created_time:C,responded_time:'2026-05-10 10:00:00',resolved_time:'2026-05-11 09:00:00'}),
      _req({request_id:'F2',tech_group:G,service_request:1,created_time:C}),
      _req({request_id:'F3',tech_group:'Mana IT Agents',service_request:1,created_time:C}),
    ]);
    const frt = await rdb.getFirstResponseTrendDB();
    const m = frt.find(r => r.month === 'May 2026');
    assert.ok(m); assert.equal(m.avgFRT, 1, 'responded 1h after created'); assert.equal(m.avgRT, 1, 'resolved 1 day after');
    const gr = await rdb.getGroupRequestsDB();
    const hg = gr.find(r => r['Group'] === G);
    assert.ok(hg && hg['Request Count'] === 2);
    const ivs = await rdb.getIncidentVsSrDB();
    const im = ivs.find(r => r['Created Time'] === 'May 2026');
    assert.ok(im); assert.equal(im['Incidents'], 1); assert.equal(im['Service Requests'], 2);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run red** — FAILS.
- [ ] **Step 3: Implement** all three forks: `strftime`→`to_char` (FRT, incident-vs-SR); avg-hours `*24`→`/3600`, avg-days→`/86400`, 365-cap→`/86400 <= 365` (FRT); `created_time >= ?` (ISO bound) UNCHANGED (all three); `GROUP BY yyyymm|grp` unchanged; reuse JS `.map`.
- [ ] **Step 4: Run green** — PASSES.
- [ ] **Step 5: Commit** — `feat(pg-reports-agg-sla): first-response trend + group counts + incident-vs-SR forks (TDD; to_char, EXTRACT-EPOCH/3600|/86400, raw-ISO cutoff unchanged)`

---

### Task 4: Suite green + regression + sqlite sync smoke + README + finish-branch

**Files:**
- Modify: `tools/pg/README.md` (add 4D-2b section)

- [ ] **Step 1: Full 4D-2 suite green** — `PG_ADMIN_URL=… node --test --test-force-exit tests/pg-reports-aggregates.test.js` → all tests pass (4D-2a 6 + 4D-2b 3 = 9).
- [ ] **Step 2: Full reports.db pg regression** — run pg-reports-auth/config/reports/hot/aggregates suites → 8+6+6+4+9 green.
- [ ] **Step 3: sqlite synchronous-return smoke** — extend the throwaway smoke to assert the 8 new fns (`getAgeingBySiteDB()`, `getAgeingByGroupDB()`, `getAgeingSummaryDB()`, `getSlaTrendDB()`, `getSlaByCategoryDB()`, `getFirstResponseTrendDB()`, `getGroupRequestsDB()`, `getIncidentVsSrDB()`) are NOT `instanceof Promise` under default (sqlite) backend.
- [ ] **Step 4: `node --check reports-db.js`** clean.
- [ ] **Step 5: README** — add a `## reports.db — Sub-chunk 4D-2b` section to `tools/pg/README.md` mirroring the 4D-2a section: list the 8 fns, the two NEW divergences (HAVING alias → COUNT(*), ORDER BY alias-expression → repeated SUM), the TRUNC-vs-CAST rounding note, datetime→interval, and that it shares `tests/pg-reports-aggregates.test.js`. Update the DEFERRED list to drop 4D-2b and point at 4D-2c/d.
- [ ] **Step 6: Commit + finish-branch** — commit the README; then merge to main:

```bash
git add tools/pg/README.md && git commit -m "feat(pg-reports-agg-sla): suite green + sqlite sync smoke + README 4D-2b section"
git checkout main && git merge --no-ff feat/pg-reports-agg-sla -m "merge: pg reports.db request SLA/ageing/trend (Chunk 4D-2b) behind REPORTS_BACKEND"
```

- [ ] **Step 7: Post-merge sanity** — on main, `node --check reports-db.js` + re-run `tests/pg-reports-aggregates.test.js` (9 green). Update the migration memory (`project_pg_migration_chunk1_done.md` + index) to mark 4D-2b merged, remaining = 4D-2c/d + 4D-wiring + 4B-RR.

---

## Remember
- pg forks query `pgHandle()`, NEVER `db`.
- Derived tables (subqueries in FROM) MUST be aliased in Postgres (`) q`).
- Keep the sqlite body untouched and synchronous; only the pg branch is async.
- Reuse the existing JS `.map`/pivot transforms — extract a shared helper only where non-trivial (ageing group slaPct, summary pivot); inline short maps in both branches.
- DRY, YAGNI, TDD, frequent commits.
