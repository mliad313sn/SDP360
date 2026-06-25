# Chunk 4D-2a — request monthly KPIs + assembler → PostgreSQL (design spec)

**Date:** 2026-06-25
**Status:** approved (pending spec-review + user review)
**Branch:** `feat/pg-reports-agg-request` (off `main`)
**Depends on:** Chunks 4A/4B/4C/4D-1 — all merged. 4D-1 landed the hot tables (`request_records`,
`change_records`, `cab_approvals`, `survey_*`, `sync_metadata`) + writers, so test data is
seeded via the merged `upsert*Batch` writers. Reuse `services/pgDb.js`.

---

## Goal

Fork the **request/helpdesk monthly-KPI aggregate readers + the monthly assembler** of reports.db
to PostgreSQL behind `REPORTS_BACKEND=postgres`. This is the first of four 4D-2 sub-chunks (the
KPI-aggregate / denominator-doctrine half of the hot path). Default backend stays `sqlite`;
no-op dispatch so prod is unchanged.

4D-2 split (each its own spec→plan→TDD→merge): **4D-2a (this)** request monthly KPIs + assembler;
4D-2b request SLA/ageing/trend breakdowns; 4D-2c change/CAB; 4D-2d survey. The
`REPORTS_BACKEND=postgres` prod flip needs ALL of 4A–4D-2d done + a full KPI reconciliation.

## Scope — functions forked (~10, all read-only)

`getRequestMetrics`, `getCalendarMonthlyHelpdesk`, `getCalendarMonthlyTop10`,
`getHelpdesk6MonthHistory`, `_aggregateHelpdesk6MoFromRaw`, `getMonthlyHelpdeskHistory`,
`getMonthlyData` (assembler), `getRequestFilterOptions`, `getMajorIncidentsHistory`,
`getActiveMajorIncidentsForSite`.

**No schema, no copy script** — 4D-1 owns the tables + `copy-reports-hot.js`. 4D-2a is pure
read-fork + tests.

**Out of scope:** 4D-2b (`getAgeing{Summary,ByGroup,BySite}DB`, `getSlaTrendDB`,
`getSlaByCategoryDB`, `getFirstResponseTrendDB`, `getGroupRequestsDB`, `getIncidentVsSrDB`);
4D-2c (change/CAB); 4D-2d (survey). server.js `_rawCache` rebuild + `/api/data/*` + `/api/sync/*`
route `await` wiring → coordinated pass.

## Dialect rules (the reconciliation contract — applies across all of 4D-2)

The risk in 4D-2 is preserving KPI math byte-for-byte. Canonical rewrites:

- **date extraction:** `date(created_time) >= ?` → `created_time::date >= ?::date`
  (created_time is TEXT 'YYYY-MM-DD HH:MM:SS'; the bound is 'YYYY-MM-DD'). `date(x) <= ?` likewise.
- **duration math:** sqlite `(julianday(a) - julianday(b)) * 24` = HOURS →
  `EXTRACT(EPOCH FROM (a::timestamptz - b::timestamptz)) / 3600`; `(julianday(a)-julianday(b))`
  = DAYS → `/ 86400`.
- **month bucket / filter:** `strftime('%Y-%m', created_time)` → `to_char(created_time::timestamptz,'YYYY-MM')`
  — BOTH as a `GROUP BY` bucket (getRequestMetrics) AND as an equality filter
  `strftime('%Y-%m', created_time) = ?` (`_aggregateHelpdesk6MoFromRaw`).
- **datetime():** `datetime(created_time)` (e.g. in an ORDER BY) → `created_time::timestamptz`;
  `datetime('now')` → `now()`.
- **now/date:** `date('now')` → `current_date`; `date('now','-N months')` → `current_date - interval 'N months'`.
- **2-arg ROUND in SQL:** `ROUND(<expr>, n)` → keep the `, n`. In pg the 2-arg ROUND needs a
  `numeric` first arg; the in-scope cases already resolve to numeric natively (decimal literal
  `100.0` is `numeric`; `AVG(bigint)` is `numeric`), so `ROUND(100.0*x/y, 1)` and
  `ROUND(AVG(time_elapsed_ms)/3600000.0, 2)` work as-is. Add `::numeric` only if a case is
  double-precision-typed. Percentages rounded in JS (`Math.round`/`.toFixed`) stay pure JS.
- **raw TEXT comparisons left UNCHANGED:** a bare `created_time >= ?` where the bound is an ISO
  string (e.g. `getMajorIncidentsHistory`'s `cutoff.toISOString()`) is a lexical string compare on
  a TEXT column in BOTH engines — do NOT add a `::date`/`::timestamptz` cast (it would change semantics).
- **case-insensitive / null:** `LOWER(col) = 'false'`, `COALESCE(a,b)`, `IN (?,?,…)` → unchanged.
- **aggregates:** `COUNT(*)` / `AVG(...)` / `SUM(...)` return JS numbers via the adapter's
  NUMERIC/BIGINT type-parsers — no `::int` casts needed.
- **denominators (DOCTRINE — must NOT regress to `/total`):** Resolution SLA % = closed-and-not-overdue
  / closed (`pending_status=0`); FRT % = responded-and-not-violated / responded (`responded_time`
  set); close % = closed / total. These are already correct in the sqlite source; the pg fork
  copies the exact WHERE/denominator.

## Per-function notes

- **`getCalendarMonthlyHelpdesk`** — the denominator core. Splits `sites.zoho_group` (comma list)
  → `IN (?,…)`; `from`/`to` computed in JS (unchanged). All COUNT/AVG queries get the date +
  julianday rewrites above. Returns the same `{inbound, closed, close_pct, sla_res_pct,
  sla_reply_pct, avg_tta_h, avg_first_reply_h, avg_resolution_d, source, from, to}` shape (the
  `Math.round`/null-guard JS is reused verbatim).
- **`getMonthlyData`** (assembler) — pg branch `await`s the forked `getCalendarMonthlyHelpdesk`,
  `getCalendarMonthlyTop10`, `getHelpdesk6MonthHistory` and the weeks→`getReport` path (4C, already
  forked). The `pastMonths`/`prevD` JS date arithmetic is pure, reused.
- **`_aggregateHelpdesk6MoFromRaw`** — aggregates a single month from raw `request_records`; its
  one SQL filter is `strftime('%Y-%m', created_time) = ?` → `to_char(created_time::timestamptz,'YYYY-MM') = ?`
  (equality form). pg branch awaits the queries; JS rollup reused.
- **`getHelpdesk6MonthHistory`** — 6-month rolling window. Calls `getCalendarMonthlyHelpdesk` per
  month; **also has a weekly-fallback branch** (fires when `cal.inbound===0`) that queries
  `weeks`/`weekly_reports`/`helpdesk_data` directly (`substr(start_date,1,7)=?` — dialect-safe) and
  parses `chart_data` JSON. The pg fork MUST `await` BOTH paths (the calendar call AND the fallback
  `db.prepare(...).all()/.get()` queries); the JS rollup is reused.
- **`getMonthlyHelpdeskHistory(monthsBack=12)`** — NOT strftime/grouped: it loops month-by-month
  in JS and runs `date(created_time) >= ? AND date(created_time) <= ?` per iteration. Rewrite = the
  `created_time::date` cast on each per-month COUNT; the JS month loop is pure, reused.
- **`getMajorIncidentsHistory(monthsBack=12)`** — its only SQL is `WHERE LOWER(...) LIKE '%major%'
  AND created_time >= ?` where the bound is `cutoff.toISOString()`. This is a raw TEXT lexical
  comparison — **leave it UNCHANGED** (no `date()`/`strftime`/cast). Then JS-over-rows: parse
  `udf_json`, run the priority-fallback chain (Priority→priority→Severity→…→impact-derived), keep
  the canonical `P-Label`. All reused on awaited rows.
- **`getActiveMajorIncidentsForSite`** — open major incidents for a site's groups. WHERE has NO
  date/now expression (`pending_status=1`, `LIKE '%major%'`, `tech_group IN (…)`). The one dialect
  hazard is **`datetime(created_time) ASC` in the ORDER BY** → `created_time::timestamptz ASC`.
- **`getRequestFilterOptions`** — DISTINCT option lists (statuses/sites/categories/groups/types/
  modes/impacts) for the filter UI; simple DISTINCT + ORDER, awaited.
- **`getRequestMetrics`** — the big multi-query KPI bundle (open/closed/backlog/within-SLA/FRT/
  avg-hours + by-status/site/category/tech/group breakdowns + 12-mo monthly trend). Every query
  gets the dialect rewrites; denominators preserved; the assembled return object is identical.

## Sync-dispatch invariant

Every forked fn returns synchronously on sqlite; only the pg branch is async. First statement
`if (REPORTS_BACKEND === 'postgres') return _fnPg(...)`. Verified with a sqlite synchronous-return
smoke (`getRequestMetrics({})`/`getMonthlyData(...)` not instanceof Promise).

## Testing (TDD)

`tests/pg-reports-aggregates.test.js` (NEW, shared across 4D-2a–d; 4D-2a adds the request
increments). Header = REPORTS_BACKEND=postgres + SDP_DATA_DIR + dummy DASH creds; `boot()`
provisions + `initPgReports` + creates a site via `createSite` (4B) and seeds `sites.zoho_group`
so `getCalendarMonthlyHelpdesk` resolves. Seed hot rows via `upsertRequestBatch` (4D-1).
**Hand-computed assertions that exercise the denominators + duration math:**

1. **calendar monthly** — seed 5 request rows in the month (3 `pending_status=0`, of those 2
   `overdue_status=0`; 4 with `responded_time` set, 3 of those `first_response_overdue='false'`).
   Assert `inbound===5`, `closed===3`, `close_pct===60`, `sla_res_pct===round(2/3*100)===67`,
   `sla_reply_pct===round(3/4*100)===75`. Seed `assigned_time`/`responded_time`/`resolved_time`
   2h/1h/1day after `created_time` → assert `avg_tta_h===2`, `avg_first_reply_h===1`,
   `avg_resolution_d===1` (the EXTRACT-EPOCH rewrite).
2. **getRequestMetrics** — totals + a couple breakdowns + one monthly-trend `sla_ok_pct` (closed-only).
3. **6-month history + getMonthlyData assembler** — window length + shape; assembler returns
   `calendar_hd`/`history6m`/`reports` without throwing.
4. **getMajorIncidentsHistory** — seed a major-incident row with `udf_json` priority → assert
   P-Label + the udf parse.
5. **getRequestFilterOptions** — DISTINCT lists include seeded values.

sqlite path regression: existing sqlite aggregate tests stay green; add the synchronous-return smoke.

## Success criteria

- `tests/pg-reports-aggregates.test.js` (4D-2a increments) green against local PG.
- `node --check` clean; modules load.
- sqlite default-backend behaviour unaffected (synchronous returns).
- Nothing deployed; `REPORTS_BACKEND` defaults to `sqlite`.
