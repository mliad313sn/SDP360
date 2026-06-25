# Chunk 4D-2a — request monthly KPIs + assembler → PostgreSQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork the request/helpdesk monthly-KPI aggregate readers + the monthly assembler of reports.db to PostgreSQL behind `REPORTS_BACKEND=postgres`, preserving the denominator doctrine byte-for-byte.

**Architecture:** Pure async read-forks dispatched on `REPORTS_BACKEND==='postgres'` (sqlite path returns synchronously). No schema, no copy script (4D-1 landed those). One new shared test file. The risk is SQL-dialect/KPI-math reconciliation — the spec's dialect contract is the law.

**Tech Stack:** Node, better-sqlite3 (sqlite path), `pg` via `services/pgDb.js` (async), `node:test`, local PostgreSQL 17.

**Spec:** `docs/superpowers/specs/2026-06-25-pg-reports-agg-request-design.md`
**Branch:** `feat/pg-reports-agg-request` (created, spec committed)
**Test cmd (all tasks):**
```
PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node --test --test-force-exit tests/pg-reports-aggregates.test.js
```

---

## Dialect contract (from the spec — apply to EVERY query)
- `date(created_time) >= ?` → `created_time::date >= ?::date` (TEXT col; bound 'YYYY-MM-DD').
- `(julianday(a)-julianday(b))*24` (hours) → `EXTRACT(EPOCH FROM (a::timestamptz - b::timestamptz))/3600`; bare (days) → `/86400`. `(JULIANDAY(a)-JULIANDAY(b)) <= 7` → `EXTRACT(EPOCH FROM (a::timestamptz - b::timestamptz))/86400 <= 7`.
- `strftime('%Y-%m', created_time)` → `to_char(created_time::timestamptz,'YYYY-MM')` (GROUP and equality `= ?`).
- `datetime(created_time)` (ORDER BY) → `created_time::timestamptz`.
- `ROUND(<expr>, n)` in SQL → keep `, n` (resolves to numeric natively; no cast needed).
- **raw TEXT compare unchanged:** `created_time >= ?` with an ISO-string bound → leave as-is, NO cast.
- `LOWER`/`COALESCE`/`TRIM`/`NULLIF`/`IN (?,…)` → unchanged. COUNT/SUM/AVG → JS numbers via type-parsers.
- **denominators (DOCTRINE):** closed-only (`pending_status=0`), responded-only (`responded_time` set), executed-only — never `/total`. Copy the exact WHERE.
- **Sync-dispatch:** sqlite path returns synchronously; only the pg branch is async. First line `if (REPORTS_BACKEND === 'postgres') return _fnPg(...)`.

---

## Task 1: harness + getCalendarMonthlyHelpdesk + getCalendarMonthlyTop10

**Files:** Create `tests/pg-reports-aggregates.test.js`; Modify `reports-db.js`.

- [ ] **Step 1: Write harness + failing test.** Header like `tests/pg-reports-hot.test.js` (REPORTS_BACKEND=postgres + SDP_DATA_DIR + dummy DASH). `boot()` provisions + `initPgReports` + `createSite({name:'Hounde', zoho_group:'Hounde IT Agents'})` (4B) so `sites.zoho_group` resolves. Reuse the `_req(o)` null-template builder from `pg-reports-hot.test.js` (copy it in). Seed 5 request rows for site group 'Hounde IT Agents' in 2026-05 via `upsertRequestBatch`:
  - 3 with `pending_status:0` (closed); of those 2 `overdue_status:0`, 1 `overdue_status:1`.
  - 4 with `responded_time` set; of those 3 `first_response_overdue:'false'`, 1 `'true'`.
  - 1 with `assigned_time` = created+2h, `responded_time` = created+1h, `resolved_time` = created+1day (for timing averages).

```js
test('agg pg: getCalendarMonthlyHelpdesk denominators + duration', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const G='Hounde IT Agents', C='2026-05-10 09:00:00';
    await rdb.upsertRequestBatch([
      _req({request_id:'A',tech_group:G,created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false',assigned_time:'2026-05-10 11:00:00',resolved_time:'2026-05-11 09:00:00'}),
      _req({request_id:'B',tech_group:G,created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}),
      _req({request_id:'D',tech_group:G,created_time:C,pending_status:0,overdue_status:1,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}),
      _req({request_id:'E',tech_group:G,created_time:C,pending_status:1,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'true'}),
      _req({request_id:'F',tech_group:G,created_time:C,pending_status:1,overdue_status:0}),
    ]);
    const cal = await rdb.getCalendarMonthlyHelpdesk(siteId, 2026, 5);
    assert.equal(cal.inbound, 5); assert.equal(cal.closed, 3); assert.equal(cal.close_pct, 60);
    assert.equal(cal.sla_res_pct, 67, 'closed-only: round(2/3*100)');   // 2 of 3 closed within SLA
    assert.equal(cal.sla_reply_pct, 75, 'responded-only: round(3/4*100)'); // 3 of 4 responded on time
    assert.equal(cal.avg_tta_h, 2);          // assigned 2h after created (1 row)
    assert.equal(cal.avg_first_reply_h, 1);  // responded 1h after created
    assert.equal(cal.avg_resolution_d, 1);   // resolved 1 day after created
    // top10: 1 category with a violation (request_id D)
    const top = await rdb.getCalendarMonthlyTop10(siteId, 2026, 5);
    assert.ok(Array.isArray(top) && top.length >= 1 && top[0].violations >= 1);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `_getCalendarMonthlyHelpdeskPg` + `_getCalendarMonthlyTop10Pg` + dispatch. Faithfully port `reports-db.js:1900` and `:1969`. The `siteRow`/`groups`/`from`/`to`/`inClause` JS is identical; queries become `await H.prepare(...).all/get(...)`. Apply dialect: every `date(created_time)>=? AND date(created_time)<=?` → `created_time::date>=?::date AND created_time::date<=?::date`; the 3 `AVG((julianday(x)-julianday(created_time))*24)`/bare → `AVG(EXTRACT(EPOCH FROM (x::timestamptz - created_time::timestamptz))/3600)` (hours) and the resolution one `/86400` (days, no `*24`). The `Math.round`/null-guard return JS is reused verbatim. Top10: same date rewrite; `COALESCE(NULLIF(TRIM(category),''),'Uncategorised')`, `SUM(CASE…)`, `HAVING violations>0` unchanged.

> NOTE pg `AVG(EXTRACT(EPOCH…)/N)` returns numeric → `Math.round` works. `cal.avg_resolution_d` for the single 1-day row = round(1.0) = 1.

- [ ] **Step 4: Run** → PASS. - [ ] **Step 5: Commit** `git add tests/pg-reports-aggregates.test.js reports-db.js && git commit -m "feat(pg-reports-agg-request): calendar monthly helpdesk + top10 forks (TDD; denominator + EXTRACT-EPOCH duration)"`

---

## Task 2: 6-month history (+ raw helper + weekly fallback) + getMonthlyHelpdeskHistory

**Files:** Modify `reports-db.js`; Test: append.

- [ ] **Step 1: Write failing test** — (a) `getHelpdesk6MonthHistory(siteId, 2026, 5)` (no groups → calendar path) returns 6 entries, the May entry matching the calendar (`inbound:5, closed:3, res_sla_pct:67`). (b) `getHelpdesk6MonthHistory(siteId, 2026, 5, ['Hounde IT Agents'])` (groups → raw path via `_aggregateHelpdesk6MoFromRaw`) returns 6 entries, May `inbound:5`. (c) `getMonthlyHelpdeskHistory(12)` returns 12 rows; the row for the seeded month has `Requests:5`, `Closed Requests Count:3`.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `_aggregateHelpdesk6MoFromRawPg` (port `:3099`: the single aggregate query — `strftime('%Y-%m',created_time)=?` → `to_char(created_time::timestamptz,'YYYY-MM')=?`; the `siteClause`/`groupWhere` + JS rollup reused), `_getHelpdesk6MonthHistoryPg` (port `:3149`: the JS month-loop is pure; `await` the `getCalendarMonthlyHelpdesk` calls; **also `await` the weekly-fallback** `db.prepare` queries on weeks/weekly_reports/helpdesk_data — `substr(start_date,1,7)=?` is dialect-safe; the `chart_data` JSON.parse + rollup reused; `_siteIdToName` gets a pg fork or inline `await pgHandle().prepare('SELECT name FROM sites WHERE id=?').get(...)`), `_getMonthlyHelpdeskHistoryPg` (port `:2036`: JS month-loop pure; per-month COUNTs get `created_time::date>=?::date AND <=?::date`; the `Math.round(... *1000)/10` JS reused). Add dispatch lines to all three + `_siteIdToName` if forked.

> `_aggregateHelpdesk6MoFromRaw` and `_siteIdToName` are internal helpers (not exported) — fork them the same way; `getHelpdesk6MonthHistory`'s pg branch calls the pg helpers directly (or the dispatching ones — both work).

- [ ] **Step 4: Run** → PASS. - [ ] **Step 5: Commit** `git commit -am "feat(pg-reports-agg-request): 6-month history (raw + weekly fallback) + monthly history forks (TDD)"`

---

## Task 3: getMonthlyData assembler

**Files:** Modify `reports-db.js`; Test: append.

- [ ] **Step 1: Write failing test** — seed (Task 1's request rows are enough for calendar_hd). `const md = await rdb.getMonthlyData(siteId, 2026, 5)`. Assert `md.calendar_hd.inbound===5`, `Array.isArray(md.history6m)`, `md.history6m.length===6`, `Array.isArray(md.reports)`, `Array.isArray(md.weeks)`, and `md.monthly_top10` is an array. (No weekly_reports seeded → reports/weeks empty arrays, fine.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `_getMonthlyDataPg` (port `:1844`): the two inline weeks queries (`substr(w.start_date,1,7)=?` — dialect-safe) become `await pgHandle().prepare(...).all(...)`; `reports`/`pmReports` use `await Promise.all(weeks.filter(w=>w.report_id).map(w => getReport(w.report_id)))` (getReport is 4C-forked → Promise); the `pastMonths`/`prevD` JS date math is pure; the return object awaits the 4 forked calls (`getCalendarMonthlyHelpdesk` ×2, `getCalendarMonthlyTop10`, `getHelpdesk6MonthHistory`). Add dispatch line.

- [ ] **Step 4: Run** → PASS. - [ ] **Step 5: Commit** `git commit -am "feat(pg-reports-agg-request): getMonthlyData assembler fork (awaits calendar/6mo/getReport) (TDD)"`

---

## Task 4: getRequestMetrics + getRequestFilterOptions

**Files:** Modify `reports-db.js`; Test: append.

- [ ] **Step 1: Write failing test** — using Task 1's 5 seeded rows (site='Hounde' on the rows? Task 1 set tech_group but maybe not `site`; for getRequestMetrics the filter is `site=?` on the `site` column — seed rows with `site:'Hounde'` OR call `getRequestMetrics({})` with no site filter). Assert `m.total===5`, `m.closed_count===3`, `m.open_count===2`, `m.sla_ok_pct===67` (closed-only round(2/3*100) → 66.7 → check `+(2/3*100).toFixed(1)===66.7`), `m.first_resp_violated_pct===25` (1 of 4 responded violated → 25.0), `m.reopen_pct` (0), `m.monthly` array has the seeded month with `sla_ok_pct`. `getRequestFilterOptions()` → `statuses`/`types` include seeded values.

> Recompute the exact expected: closed=3, withinSlaClosed=2 → slaOkPct = +(2/3*100).toFixed(1) = 66.7. firstRespViolatedResp=1, respondedCount=4 → 25.0. Assert those exact numbers.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `_getRequestMetricsPg` (port `:4113`): the `where`/`addIn`/`p` builder is identical (positional `?` → `$N` via `_translate`); every sub-query `await H.prepare(\`...${where}...\`).get/all(...p)`. Dialect: `(JULIANDAY(resolved_time)-JULIANDAY(created_time)) <= 7` → `EXTRACT(EPOCH FROM (resolved_time::timestamptz - created_time::timestamptz))/86400 <= 7`; `ROUND(AVG(time_elapsed_ms)/3600000.0, 2)` keep as-is (numeric); monthly `strftime('%Y-%m',created_time)` → `to_char(...,'YYYY-MM')` (GROUP), `ROUND(100.0*.../...,1)` keep. The `+(x/y*100).toFixed(1)` JS reused. `is_escalated=1 OR is_escalated='true' OR is_escalated='1'` unchanged. Return object identical. `_getRequestFilterOptionsPg` (port `:4660`): the `distinct(col)` helper → `await pgHandle().prepare(...).all()`; assemble the same object (async). Add dispatch lines.

> getRequestMetrics queries 18+ times in one call — all awaited sequentially inside the async fn (fine; this is not a hot loop). Keep the `${where}` interpolation + `...p` positional binding.

- [ ] **Step 4: Run** → PASS. - [ ] **Step 5: Commit** `git commit -am "feat(pg-reports-agg-request): getRequestMetrics + getRequestFilterOptions forks (TDD; closed/responded denominators)"`

---

## Task 5: getMajorIncidentsHistory + getActiveMajorIncidentsForSite

**Files:** Modify `reports-db.js`; Test: append.

- [ ] **Step 1: Write failing test** — seed a major-incident row via `upsertRequestBatch([_req({request_id:'MI1', request_type:'Major Incident', tech_group:'Hounde IT Agents', site:'Hounde', pending_status:1, created_time:'2026-05-15 09:00:00'})])`, then set its udf via `upsertRequestUdfBatch([{request_id:'MI1', udf_json:JSON.stringify({'UDF:Priority':'High','UDF:Root Cause Analysis :':'rca text here that is long enough'})}])`. Assert `getMajorIncidentsHistory(12)` includes a row with `'Request ID'==='MI1'` and the udf parsed. Assert `getActiveMajorIncidentsForSite(['Hounde IT Agents'])` returns ≥1 row (pending_status=1 major) with `request_id==='MI1'`.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `_getMajorIncidentsHistoryPg` (port `:2887`): `WHERE LOWER(COALESCE(request_type,'')) LIKE '%major%' AND created_time >= ?` — **leave `created_time >= ?` UNCHANGED** (raw TEXT, ISO bound); `await H.prepare(...).all(cutoffISO)`; the entire `rows.map(...)` (isoToZohoStr, JS Date Time-to-Resolve, udf parse, priority fallback, P-Label) is pure JS reused. `_getActiveMajorIncidentsForSitePg` (port `:4587`): WHERE unchanged; **ORDER BY `datetime(created_time) ASC` → `created_time::timestamptz ASC`**; the `rows.map` (udf parse, completeness/pirStatus heuristics) reused. Add dispatch lines.

- [ ] **Step 4: Run** → PASS. - [ ] **Step 5: Commit** `git commit -am "feat(pg-reports-agg-request): major-incident history + active forks (TDD; raw-TEXT compare unchanged, datetime() ORDER BY)"`

---

## Task 6: Full-suite green + regression + README

**Files:** Modify `tools/pg/README.md`.

- [ ] **Step 1:** Full 4D-2a suite green (test cmd above).
- [ ] **Step 2: Regression** — all reports.db pg suites still pass + default sqlite synchronous-return smoke:
```
PG_ADMIN_URL='…' node --test --test-force-exit tests/pg-reports-hot.test.js tests/pg-reports-reports.test.js tests/pg-reports-config.test.js tests/pg-reports-auth.test.js
SDP_DATA_DIR=$(mktemp -d) DASH_USER=x DASH_PASS=y node -e "const r=require('./reports-db.js'); console.log('isPromise=', r.getRequestMetrics({}) instanceof Promise, r.getMonthlyData(1,2026,5) instanceof Promise); process.exit(0)"
```
Expected: `isPromise= false false`.
- [ ] **Step 3: `node --check reports-db.js`.**
- [ ] **Step 4:** Append a 4D-2a section to `tools/pg/README.md` (functions forked, the dialect contract, the raw-TEXT-compare-unchanged + datetime()-ORDER-BY gotchas, deferred 4D-2b/c/d + the prod-flip precondition).
- [ ] **Step 5: Commit** `git commit -am "docs(pg-reports-agg-request): README 4D-2a + final suite green"`

---

## Out of scope (do NOT do here)

- 4D-2b: `getAgeing{Summary,ByGroup,BySite}DB`, `getSlaTrendDB`, `getSlaByCategoryDB`, `getFirstResponseTrendDB`, `getGroupRequestsDB`, `getIncidentVsSrDB`.
- 4D-2c: change/CAB aggregates. 4D-2d: survey aggregates.
- server.js `_rawCache` rebuild + `/api/data/*` + `/api/sync/*` route `await` wiring — coordinated pass.
- Merging `feat/pg-reports-agg-request` to main — after the chunk completes.
- The `REPORTS_BACKEND=postgres` prod flip — needs all of 4D-2 + KPI reconciliation.
