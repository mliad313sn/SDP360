# FIX-16 — P11 round-4 data / KPI findings (F-16, F-17, F-02, F-05, F-19, F-20)

**AI evidence — not an independent human review.** Builder: Claude (Opus 5.5), worktree branch `fix/p11-r4-data`.
Source of findings: P11 seat data-kpi, round 4 (`r4-data-kpi.md`, frozen SHA `e43d11d5`). Not fixed here, by
assignment: F-18 (owned by fix 15), F-15, F-11, F-12, F-13, F-06, F-08. No gate is filled, no KPI rule is adopted.

## What changed

| ID | Fix | Test (fails before, passes after) |
|---|---|---|
| F-16 (P2) | `reports-db._computeSiteHelpdesk(rows, opts)` now returns `res_sla_pct` / `res_sla_den` / `res_sla_missed` / `open_overdue` / `res_sla_definition`. Denominator = closed tickets, **cancelled excluded**, carrying an SLA rule (flag set; a due time too under `due_vs_resolved`) — the same base as `getCalendarMonthlyHelpdesk.sla_res_pct` (registry `helpdesk.resolution_sla_pct`). "Missed" = `services/slaDefinition.resOverdueRow` under the configured `helpdesk_sla_definition` (default `flag`). Nothing closed → `null`. `routes/siteAwareness.js` reads the field (no formula; a reader without it → `null`), passes the configured rule. The page tooltip now says "of the tickets created in the week and already closed … cancelled and no-SLA tickets excluded … same rule as the dictionary's Resolution SLA", and a new **Open overdue** column sits beside the rate. | `tests/site-awareness-sla-parity.test.js` (reviewer cases A1 stale flag, A2 cancelled-with-flag, B open-overdue week, all-open → null; parity with `resolutionSla(…, {definition, excludeCancelled:true})` in both modes; **PostgreSQL parity**: window reader over a month == `getCalendarMonthlyHelpdesk` base and %), `tests/site-awareness-routes.smoke.test.js` (route reads the reader field, the configured rule reaches the reader) |
| F-17 (P3) | New registry metric `helpdesk.window_resolution_sla_pct` (reader `helpdesk.window`, field `res_sla_pct`, base `res_sla_den`; the registry reader passes the configured rule too). Triage entry `untriaged`. `docs/ops/METRIC-WIDGET-MAP.md` + `METRIC-LINEAGE.md` regenerated (the site view and its route now appear). New site-view row in `docs/kpi/FORMULA-REFERENCE.md` §1. | `tests/site-awareness-sla-parity.test.js` (no inline formula in the route), `metric-map --check`, `metric-lineage --check`, `tests/kpi-docs-links.test.js` |
| F-02 (P2) | `services/reportPayload._tracker` scores a measured site with the engine twin `tracker-pptx.js` `ss` / `score` (cumulative value vs **pro-rated** target, weighted site score); the month-vs-annual `_ragOf` is gone. Kept: a site with no stored input up to the month is not measured (left out, null). Pillar score = engine pillar score averaged over measured sites. | `tests/report-payload-tracker-null.test.js` (reviewer repro: COUNT, target 12, inputs 1/1/1 → GREEN, site 100 %, matches `ss()`; previous null-rule tests kept, fixture activities given the engine fields) |
| F-05 (P2) | `P08-unknown-sweep.json` and `P08-kpi-dossiers.md` moved (git mv, no copy left) to `docs/kpi/baselines/`; `tools/kpi/unknown-sweep.js`, `tools/kpi/dossiers.js`, `tests/kpi-*.test.js` and the P08 narrative pointers updated. | `tests/kpi-baselines-location.test.js` (location, no duplicate, no KPI/metric test or tool reads `docs/agent-execution/`). **Clean-tree run**: a copy of the tracked tree with `docs/agent-execution/` deleted → `tests/kpi-*`, `figure-parity-*`, `dashboard-figure-parity`, `metric-*`: **95/95 pass**; `unknown-sweep --check` exit 0 (round 4: 79/81 and exit 1). |
| F-19 (P3) | `public/index.html` `isoWk` / `isoWkYr` delegate to `ReportingWeek.weekOf` (UTC calendar-day math); `prevWk` delegates to the new `ReportingWeek.previous(year, week)` which steps into the previous year's last week (W53 included). | `tests/reporting-week-dst.test.js` (TZ=Europe/London, UTC, America/New_York child processes: 0 mismatches on 6-hourly samples 2026–2029, Sunday 5 Apr 2026 = W14; week before 2029-W01 = 2028-W53). Before the fix: London 492 mismatches reproduced, 3 of 4 tests red. |
| F-20 (P3) | `db/migrate.destructiveDdl(sql)` — DROP TABLE / COLUMN / SCHEMA / VIEW / MATERIALIZED VIEW / SEQUENCE / TYPE / DATABASE, `ALTER TABLE … DROP x` (not CONSTRAINT / DEFAULT / NOT NULL / IDENTITY / EXPRESSION / TRIGGER), `ALTER [COLUMN] x [SET DATA] TYPE` — joins the run-once class in `rerunOnChange` (explicit `migrate:rerun-on-change` still overrides). No shipped migration is reclassified. | `tests/pg-migrate-destructive.test.js` (pure cases + **PostgreSQL**: an applied DDL file edited to add `DROP COLUMN` is `changed` + `notReapplied`, the column and its data survive) |

## Regenerated artefacts
`docs/ops/METRIC-WIDGET-MAP.md`, `docs/ops/METRIC-LINEAGE.md`, `docs/ux/METRIC-TRIAGE.json` (one untriaged entry),
`docs/agent-execution/INVENTORY.{json,md}`, `INVENTORY-STRICT.md`, README inventory block, gate dossiers
(`node tools/release/gate-dossiers.js --sha=098d2f1e` — required because cited evidence changed and
`P08-kpi-dossiers.md` left `docs/agent-execution/`), `tests/.suite-manifest.json` (+4 files, +20 tests), evidence
manifest. No route added or changed its gate → authz files untouched.

## Tests run (PostgreSQL 16 test cluster, `_pg-boot`, `PG_TESTS_REQUIRED=1`)
**59 files, 301 tests: 297 pass, 0 fail, 4 skipped** (the 4 are `site-window-readers` cases that need a restored prod snapshot — `SDP_SNAPSHOT=1`). Clean-tree (no `docs/agent-execution/`) KPI/metric/figure-parity run: 95/95. Targeted set: new tests, `kpi-*`, `metric-*`, `site-awareness*`,
`adoption-lota-*`, `report-payload-*`, `tracker*`, `pg-migrate*`, `figure-parity*`, `dashboard-figure-parity`,
`uat-itsm-figures`, `site-window-readers`, `site-report-helpdesk-weekly`, `week-labels`, `gate-dossiers`,
`agent-inventory`/evidence. No full suite was run. PostgreSQL 17 is still not verified.

## Decisions left to humans
- **G06 / KPI committee**: which "missed" rule the server figures follow (`helpdesk_sla_definition`, default `flag`),
  and whether the site view's headline should stay closed-only or include open & breached (`open_overdue` is shown
  beside it, not folded in). The site view now follows the configured server rule; the Helpdesk page keeps its own
  `due_vs_resolved` default (C-30/P8) — the two still differ until the committee chooses.
- **G09**: the tracker treats a stored 0 and a blank cell alike once a site is measured (engine contract); a
  null-preserving input model is a reviewers' decision.
- PMO/owner review of the new untriaged metric `helpdesk.window_resolution_sla_pct`.
