# Chunk 4D-2b — request SLA / ageing / trend breakdowns → PostgreSQL (design spec)

**Date:** 2026-06-26
**Status:** approved (pending spec-review + user review)
**Branch:** `feat/pg-reports-agg-sla` (off `main`)
**Depends on:** Chunks 4A/4B/4C/4D-1/4D-2a — all merged. 4D-1 landed `request_records` +
`change_records` + the `upsert*Batch` writers; 4D-2a landed the request monthly-KPI readers and
established the dialect-reconciliation contract this chunk reuses. Reuse `services/pgDb.js`.

---

## Goal

Fork the **request SLA / ageing / trend breakdown readers** of reports.db to PostgreSQL behind
`REPORTS_BACKEND=postgres`. This is the second of four 4D-2 sub-chunks. Default backend stays
`sqlite`; no-op dispatch so prod is unchanged.

4D-2 split (each its own spec→plan→TDD→merge): 4D-2a request monthly KPIs + assembler (DONE);
**4D-2b (this)** request SLA/ageing/trend; 4D-2c change/CAB; 4D-2d survey. The
`REPORTS_BACKEND=postgres` prod flip needs ALL of 4A–4D-2d done + a full KPI reconciliation.

## Scope — 8 functions forked (all read-only, request_records-sourced)

`getAgeingBySiteDB`, `getAgeingByGroupDB`, `getAgeingSummaryDB`, `getSlaTrendDB`,
`getSlaByCategoryDB`, `getFirstResponseTrendDB`, `getGroupRequestsDB`, `getIncidentVsSrDB`.

All eight read ONLY `request_records` (no joins, no other table). **No schema, no copy script** —
4D-1 owns the table + `copy-reports-hot.js`. 4D-2b is pure read-fork + tests.

**Out of scope:** 4D-2c (change/CAB: `getChangeMetrics`, `getChangeRecordsHistory`,
`getOpenChangesForSite`, `getEmergencyChangesDB`, `getCABMetrics`, `getCabApprovalsDB`,
`getCabRecommendationsDB`); 4D-2d (survey: `getSurveyMetrics`, `getCustomerVoiceDB`,
`getCustomerVoiceByDimensionDB`). server.js `/api/data/*` + `_rawCache` route `await` wiring →
coordinated pass. (`getEmergencyChangesDB` reads `change_records`, so it belongs to 4D-2c, NOT here.)

## Dialect rules (reuse the 4D-2a reconciliation contract)

Same canonical rewrites as 4D-2a, plus three divergences this chunk hits that 4D-2a did not:

- **duration math (DAYS, ageing):** sqlite `CAST((julianday('now') - julianday(created_time)) AS
  INTEGER)` → `TRUNC(EXTRACT(EPOCH FROM (now() - created_time::timestamptz)) / 86400)::integer`.
  **`TRUNC` not `CAST(... AS integer)`** — sqlite `CAST(real AS INTEGER)` TRUNCATES toward zero,
  but Postgres `CAST(double AS integer)` ROUNDS half-to-even. For an age sitting on a bucket
  boundary (e.g. 30.6 days) sqlite→30 / pg-CAST→31, shifting the ticket between the `d0` and `d31`
  buckets. `TRUNC(...)::integer` reproduces sqlite's truncation. (All ages are positive — created
  in the past — so TRUNC≡FLOOR here.) `julianday('now')` → `now()`.
- **duration math (HOURS / DAYS, AVG trends):** `(julianday(a) - julianday(b)) * 24` (HOURS) →
  `EXTRACT(EPOCH FROM (a::timestamptz - b::timestamptz)) / 3600`; `(julianday(a) - julianday(b))`
  (DAYS) → `/ 86400`. These feed `AVG(...)` (no CAST) so they stay floating — no TRUNC.
- **month bucket:** `strftime('%Y-%m', created_time)` → `to_char(created_time::timestamptz,'YYYY-MM')`.
- **HAVING on an output alias (NEW divergence):** sqlite allows `HAVING total > 0` /
  `HAVING total >= 5` where `total` is a `COUNT(*) AS total` output alias. **Postgres does NOT
  allow output-column aliases in HAVING** → rewrite to repeat the aggregate: `HAVING COUNT(*) > 0`
  / `HAVING COUNT(*) >= 5`. (Affects `getAgeingBySiteDB`, `getAgeingByGroupDB`, `getSlaByCategoryDB`.)
- **ORDER BY on an alias EXPRESSION (NEW divergence):** sqlite allows
  `ORDER BY (d0_30 + d31_45 + d46_60 + d_over_60) DESC` (an arithmetic expression over four output
  aliases). **Postgres allows a *bare* output alias in ORDER BY but NOT an expression built from
  aliases** → repeat the four `SUM(CASE …)` expressions in the ORDER BY, or add a
  `(… ) AS _ord` column and `ORDER BY _ord DESC`. (Affects `getAgeingSummaryDB` only.)
- **GROUP BY on a simple alias is SAFE in pg** — UNLIKE 4D-2a's `getCalendarMonthlyTop10`
  (`COALESCE(NULLIF(category,'')) AS category` shadowed the real `category` column → needed
  `GROUP BY 1`). Here the grouping aliases are `yyyymm`, `grp`, `cat`, `site` — none shadow a
  transformed input column (`cat` ≠ `category`; `grp` ≠ `tech_group`; `site` is the raw column),
  so `GROUP BY yyyymm` / `grp` / `cat` / `site` work as-is. **Do not gratuitously switch them to
  ordinals** — keep them readable; only `getCalendarMonthlyTop10`-style shadowing forces `GROUP BY 1`.
- **`datetime('now', '-12 months')` (getSlaByCategoryDB):** sqlite returns a `'YYYY-MM-DD HH:MM:SS'`
  string compared lexically against the TEXT `created_time`. PG has no `datetime()`. Rewrite to a
  typed compare: `created_time::timestamptz >= now() - interval '12 months'` (semantically
  identical for well-formed timestamps, avoids any string-format mismatch). Consistent with the
  4D-2a contract entry `date('now','-N months')` → `current_date - interval 'N months'`.
- **raw ISO-string cutoff bounds left UNCHANGED:** the trend fns (`getSlaTrendDB`,
  `getFirstResponseTrendDB`, `getGroupRequestsDB`, `getIncidentVsSrDB`) bind
  `cutoff.toISOString()` against `created_time >= ?`. This is a lexical TEXT compare in BOTH
  engines — **do NOT add a cast** (same rule as `getMajorIncidentsHistory` in 4D-2a).
- **numeric division / ROUND:** `SUM(...) * 100.0 / NULLIF(COUNT(*),0)`, `* 1000 / 10`, `Math.round`
  in JS — all resolve to numeric natively / stay pure JS. No casts.
- **denominators (DOCTRINE):** `getSlaTrendDB` / `getSlaByCategoryDB` keep the closed-only
  (`pending_status=0`) and responded-only (`responded_time` set) denominators verbatim — the pg
  fork copies the exact WHERE/denominator, never `/total`.

## Per-function notes

- **`getAgeingBySiteDB`** — open tickets (`pending_status=1`) bucketed by age (≤30 / 31–45 / 46–60 /
  >60) per `site`. Rewrites: julianday-days → `TRUNC(EXTRACT(EPOCH …)/86400)::integer`; `julianday('now')`
  → `now()`; `HAVING total > 0` → `HAVING COUNT(*) > 0`. The site-noise filter
  (`LOWER(TRIM(site)) NOT IN ('-no value-', …)`, `TRIM(site) != ''`) is dialect-safe, unchanged.
  `GROUP BY site` (raw column) + `ORDER BY total DESC` (bare alias) both fine in pg. JS `.map` reused.
- **`getAgeingByGroupDB`** — same shape grouped on `tech_group AS grp`, plus per-group FRT SLA %
  (`SUM(frt_ok)*100.0/NULLIF(COUNT(*),0)`). `frt_ok` derives from `first_response_overdue` via a
  `LOWER(TRIM(COALESCE(...,''))) IN ('true','yes','1')` CASE — dialect-safe. Rewrites: julianday-days
  TRUNC + `now()`; `HAVING total > 0` → `HAVING COUNT(*) > 0`. `GROUP BY grp` / `ORDER BY total DESC`
  fine. JS `.map` (with `Math.round(sla_pct*10)/10` null-guard) reused.
- **`getAgeingSummaryDB`** — pivoted open-ticket ageing by `tech_group AS grp`, no HAVING. The ONE
  hazard is `ORDER BY (d0_30 + d31_45 + d46_60 + d_over_60) DESC` (expression over aliases) → repeat
  the four `SUM(CASE …)` in the ORDER BY (or add `(…) AS _ord` + `ORDER BY _ord DESC`). julianday-days
  TRUNC + `now()`. The JS pivot-emit (one row per non-zero (Group, Tier)) is pure, reused.
- **`getSlaTrendDB`** — monthly SLA-violation% + FRT-violation% trend. `strftime` → `to_char`;
  `created_time >= ?` (ISO bound) UNCHANGED; `GROUP BY yyyymm` (safe); closed-only / responded-only
  denominators preserved; the per-row division + `Math.round(…*1000)/10` happen in the JS `.map`.
- **`getSlaByCategoryDB`** — top-20 categories by violation volume, closed-only violation %.
  `datetime('now','-12 months')` → `created_time::timestamptz >= now() - interval '12 months'`;
  `HAVING total >= 5` → `HAVING COUNT(*) >= 5`; `GROUP BY cat` (alias ≠ column, safe);
  `ORDER BY violated_closed DESC, total DESC` (bare aliases, fine). **Return shape quirk preserved:**
  `'% of SLA Violated'` is a STRING with a `%` suffix (`pct + '%'`) — the consumer calls
  `.replace('%','')`, so the pg fork must emit the same string, NOT a number.
- **`getFirstResponseTrendDB`** — monthly avg FRT (hours) + avg RT (days). `strftime` → `to_char`;
  julianday-hours `*24` → `EXTRACT(EPOCH …)/3600`; julianday-days → `/86400`; the 365-day RT cap
  (`(julianday(resolved)-julianday(created)) <= 365`) → `EXTRACT(EPOCH …)/86400 <= 365`;
  `created_time >= ?` (ISO bound) UNCHANGED; `GROUP BY yyyymm` (safe). JS `.map` (month label +
  `Math.round(…*10)/10`) reused.
- **`getGroupRequestsDB`** — count per `tech_group` over N months. `created_time >= ?` (ISO bound)
  UNCHANGED; `GROUP BY grp` (safe); `ORDER BY cnt DESC` (bare alias). JS `.map` reused.
- **`getIncidentVsSrDB`** — monthly incident vs service-request counts (`service_request = 0/1`,
  INTEGER col). `strftime` → `to_char`; `created_time >= ?` (ISO bound) UNCHANGED; `GROUP BY yyyymm`
  (safe). JS `.map` reused.

## Sync-dispatch invariant

Every forked fn returns synchronously on sqlite; only the pg branch is async. First statement
`if (REPORTS_BACKEND === 'postgres') return _fnPg(...)`. Verified with a sqlite synchronous-return
smoke (each of the 8 fns not `instanceof Promise`). Where a `.map` transform is non-trivial and
shared, extract a module-level helper (as done for major-incident rows in 4D-2a); where the `.map`
is short and engine-agnostic, inline it in both branches.

## Testing (TDD)

Extend `tests/pg-reports-aggregates.test.js` (the shared 4D-2 suite). Reuse the existing `boot()` +
`_req()` null-template builder + `upsertRequestBatch`. **Hand-computed assertions that exercise the
new divergences:**

1. **ageing buckets + truncation boundary** — seed open (`pending_status=1`) rows with known
   `created_time` offsets from "now" landing in each bucket (e.g. ~10d, ~40d, ~50d, ~80d) for one
   site + one group. Assert `getAgeingBySiteDB()` / `getAgeingByGroupDB()` bucket counts (`d0/d31/
   d46/d60`, `t0_30/…`). Include one row whose age is just over a boundary to lock the **TRUNC**
   semantics (assert it lands in the lower bucket, matching sqlite truncation). Assert
   `getAgeingByGroupDB().slaPct` from seeded `first_response_overdue` values. Assert the noise-site
   filter drops a `'-No Value-'` site row.
2. **getAgeingSummaryDB ORDER BY** — seed two groups with different total open counts; assert the
   pivot emits rows for both and the higher-total group sorts first (locks the repeated-SUM ORDER BY).
3. **getSlaTrendDB + getSlaByCategoryDB denominators** — seed a month with closed+overdue,
   closed+ok, responded+frt-violated rows; assert `'% of SLA Violated'` (closed-only) and
   `'% of First Responses SLA Violated'` (responded-only). Assert `getSlaByCategoryDB` emits the
   `pct + '%'` STRING shape, applies the `total >= 5` HAVING (a 4-ticket category is dropped), and
   the `datetime('now','-12 months')` window includes a recent row.
4. **trends + group counts** — `getFirstResponseTrendDB` (avg FRT hours / RT days for a known
   offset), `getGroupRequestsDB` (per-group count), `getIncidentVsSrDB` (incident vs SR split) over
   a seeded month.

sqlite path regression: existing sqlite + pg aggregate tests stay green; extend the
synchronous-return smoke to cover the 8 new fns.

## Success criteria

- `tests/pg-reports-aggregates.test.js` (4D-2b increments) green against local PG.
- `node --check` clean; modules load.
- sqlite default-backend behaviour unaffected (synchronous returns; existing decks/pages unchanged).
- Full reports.db pg regression stays green (4A 8 · 4B 6 · 4C 6 · 4D-1 4 · 4D-2a 6 · 4D-2b new).
- Nothing deployed; `REPORTS_BACKEND` defaults to `sqlite`.
