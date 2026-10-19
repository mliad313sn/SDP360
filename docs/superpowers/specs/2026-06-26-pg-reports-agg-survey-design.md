# Chunk 4D-2d — survey / Customer-Voice readers → PostgreSQL (design spec)

**Date:** 2026-06-26
**Status:** approved (pending spec-review + user review)
**Branch:** `feat/pg-reports-agg-survey` (off `main`)
**Depends on:** Chunks 4A/4B/4C/4D-1/4D-2a/4D-2b/4D-2c — all merged. 4D-1 landed `survey_results` +
the `upsertSurveyResultBatch` writer; 4D-2a/b/c established the dialect contract this chunk reuses.
Reuse `services/pgDb.js`.

---

## Goal

Fork the **survey / Customer-Voice aggregate readers** of reports.db to PostgreSQL behind
`REPORTS_BACKEND=postgres`. Fourth and **final** 4D-2 sub-chunk — completing the entire KPI-aggregate
half of the hot path. Default backend stays `sqlite`; no-op dispatch so prod is unchanged.

4D-2 split: 4D-2a request monthly KPIs (DONE); 4D-2b request SLA/ageing/trend (DONE); 4D-2c
change/CAB (DONE); **4D-2d (this)** survey. After this lands, the `REPORTS_BACKEND=postgres` prod
flip needs only the **4D-wiring** pass (server.js `_rawCache` + `/api/sync/*` + `/api/data/*` route
awaits) + **4B-RR** (rr_site_aliases) + a full KPI reconciliation.

## Scope — 3 functions forked (all read-only)

`getSurveyMetrics`, `getCustomerVoiceDB`, `getCustomerVoiceByDimensionDB`.

Source: `survey_results` (all 3); `getCustomerVoiceByDimensionDB` additionally LEFT JOINs
`request_records` (for tech/site/group dimensions). **No schema, no copy script** — 4D-1 owns the
tables. 4D-2d is pure read-fork + tests.

**Out of scope (post-4D-2):** the **4D-wiring** coordinated pass (server.js `_rawCache` rebuild +
`/api/sync/*` + `/api/data/*` route `await`); **4B-RR** (`rr_site_aliases`).

## Dialect rules (reuse the 4D-2a/b/c contract)

Same canonical rewrites. The hazards that bite here:

- **month bucket:** `strftime('%Y-%m', <col>)` → `to_char(<col>::timestamptz, 'YYYY-MM')`.
  - `getCustomerVoiceDB` monthlyRows: the bucket col is `COALESCE(survey_sent_on, survey_responded_on)`.
    The query's own `WHERE COALESCE(...) >= ?` (a valid ISO cutoff) guarantees the grouped rows have a
    well-formed coalesced timestamp, so a direct `to_char(COALESCE(...)::timestamptz,'YYYY-MM')` is
    safe — consistent with how 4D-2a/2b cast `created_time::timestamptz` in `to_char` (no NULLIF).
  - `getSurveyMetrics` monthly: the bucket col is `survey_sent_on`, and the monthly query's WHERE is
    only `WHERE 1=1 [AND survey_sent_on>=?]` — when `since` is absent, NULL/'' `survey_sent_on` rows
    are included. sqlite `strftime('%Y-%m', NULL or '')` → NULL (no error, grouped under a NULL
    month); pg `''::timestamptz` ERRORS. **Guard with NULLIF:**
    `to_char(NULLIF(survey_sent_on,'')::timestamptz,'YYYY-MM')` → NULL for ''/NULL, matching sqlite.
- **`ROUND(AVG(<double>), 1)` needs `::numeric`** — `survey_results.overall_score` is `double
  precision`; pg has no `round(double,int)`. `ROUND(AVG(overall_score),1)` →
  `ROUND(AVG(overall_score)::numeric,1)`; `ROUND(AVG(CASE WHEN overall_score IS NOT NULL THEN
  overall_score END),1)` → `ROUND(AVG(CASE …)::numeric,1)` (getSurveyMetrics — both avgScore + the
  monthly avg_score). **`getCustomerVoiceDB` has NO SQL ROUND** — every average is computed in JS via
  `Math.round` over `AVG(overall_score)` raw, so NO cast is needed there (the raw `AVG(double)` value
  flows back as a JS number via the adapter's NUMERIC/float parser).
- **raw ISO cutoff bounds left UNCHANGED** — `COALESCE(survey_sent_on, survey_responded_on) >= ?`
  (getCustomerVoiceDB) and `survey_sent_on >= ?` (getSurveyMetrics `since`) are lexical TEXT compares
  in both engines — no cast (same rule as the request/change cutoffs).
- **`LEFT JOIN`** (getCustomerVoiceByDimensionDB: `survey_results s LEFT JOIN request_records r ON
  r.display_id = s.request_display_id`) — valid as-is in pg.
- **`COALESCE`, `SUM(CASE …)`, `AVG`, `GROUP BY <alias>`, bare-alias `ORDER BY month DESC`,
  `LIMIT`, dynamic `${where}`** — all unchanged. `overall_score` is double, so `overall_score >= 80`
  / `< 70` numeric compares are fine. Aggregates return JS numbers via the adapter's type-parsers.

## Per-function notes

- **`getCustomerVoiceDB(monthsBack=12)`** — THREE queries: `sendCounts` (total_sent + responded over
  `COALESCE(survey_sent_on,survey_responded_on) >= ?`), `tot` (scored totals / CSAT / NPS buckets over
  `WHERE overall_score IS NOT NULL`), `monthlyRows` (per-month sent/responses/avg/buckets, grouped by
  `strftime` → `to_char`). Raw ISO cutoff UNCHANGED (sendCounts + monthlyRows). NO SQL ROUND (all JS
  `Math.round`). pg fork awaits all three; the JS rollup (`byMonth` map + the return assembly with
  responseRate/csatPct/avgScore/nps) is reused via an extracted `_assembleCustomerVoice(sendCounts,
  tot, monthlyRows)`.
- **`getSurveyMetrics({since})`** — dynamic `WHERE 1=1 [AND survey_sent_on>=?]`. Queries: total,
  responded, `ROUND(AVG(overall_score),1)` → `::numeric`, buckets (<60/60–80/≥80 SUM(CASE)), and
  monthly (`strftime`→`to_char` with **NULLIF guard**, `ROUND(AVG(CASE…))` → `::numeric`,
  `GROUP BY month ORDER BY month DESC LIMIT 12`). `since` bound UNCHANGED. pg branch awaits each; the
  `responseRatePct` `.toFixed(1)` + `monthly.reverse()` JS stays pure. Return object identical.
- **`getCustomerVoiceByDimensionDB()`** — TWO queries: the survey⨝request `LEFT JOIN` (no cutoff,
  `WHERE s.overall_score IS NOT NULL`) + a closed-ticket count (`pending_status=0`). **No
  strftime/julianday/datetime/ROUND in SQL** — ALL aggregation (the `_acc` tech/site/group maps,
  `monthLbl` via `new Date()`, `toArr` with `Math.round`/NPS, the return) is engine-agnostic JS.
  pg fork awaits both queries; the entire post-query JS is reused via an extracted
  `_assembleCustomerVoiceByDimension(rows, closedRow)`.

## Sync-dispatch invariant

Every forked fn returns synchronously on sqlite; only the pg branch is async. First statement
`if (REPORTS_BACKEND === 'postgres') return _fnPg(...)`. `getSurveyMetrics` destructures its object
arg identically in both branches. Verified with a sqlite synchronous-return smoke (each of the 3 not
`instanceof Promise`). The three multi-query bodies extract their post-query JS into shared
`_assemble*` helpers so sqlite and pg can't diverge.

## Testing (TDD)

Extend `tests/pg-reports-aggregates.test.js`. Add a `_sres()` survey_results null-template (copy from
`tests/pg-reports-hot.test.js:32`) seeding via the merged `upsertSurveyResultBatch` writer (4D-1);
reuse `_req()` for the dimension join. **Hand-computed assertions exercising the new hazards:**

1. **getSurveyMetrics buckets + ROUND::numeric + monthly** — seed survey_results in a month with
   known `overall_score`s spanning the <60 / 60–80 / ≥80 buckets, some with `survey_responded_on`
   set/unset. Assert `total_sent`, `responded_count`, `response_rate_pct` (`round(resp/total*100,1)`),
   `avg_score` (`ROUND(AVG::numeric,1)` of the seeded scores), `satisfied_count`/`neutral_count`/
   `dissatisfied_count`, and that `monthly_trend` has the month with its `avg_score` (locks the
   `to_char` + NULLIF + `::numeric` monthly path).
2. **getCustomerVoiceDB CSAT/NPS/responseRate + byMonth** — seed scored rows (≥90 promoter, 70–89
   passive, <70 detractor, ≥80 satisfied) + a sent-not-responded row. Assert `totalSent`,
   `totalResponded`, `responseRate`, `csatPct`, `nps`, `promoters`/`passives`/`detractors`, and a
   `byMonth` entry (locks the `to_char` monthly group).
3. **getCustomerVoiceByDimensionDB join + dimensions** — seed a survey row whose `request_display_id`
   matches a seeded `request_records.display_id` (with technician/site/tech_group), plus an unmatched
   survey row. Assert `bySite`/`byGroup`/`byTech` contain the joined dimension with the right
   `responses`/`csatPct`, `totalSurvey`, `totalJoined`/`joinRate`, and `closedCount`.

sqlite path regression: existing sqlite + pg aggregate tests stay green; extend the
synchronous-return smoke to the 3 new fns.

## Success criteria

- `tests/pg-reports-aggregates.test.js` (4D-2d increments) green against local PG.
- `node --check` clean; modules load.
- sqlite default-backend behaviour unaffected (synchronous returns; existing decks/pages unchanged).
- Full reports.db pg regression stays green (4A 8 · 4B 6 · 4C 6 · 4D-1 4 · 4D-2a/b/c/d aggregates suite).
- **4D-2 KPI-aggregate half COMPLETE.** Nothing deployed; `REPORTS_BACKEND` defaults to `sqlite`.
