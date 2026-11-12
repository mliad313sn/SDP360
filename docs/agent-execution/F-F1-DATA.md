# F-F1-DATA — Plan F, data bundle (F-DATA-04, 05, 06, 07, 08, 11, 12)

Branch `goal/f1-data` (from `722818b`, the expert-committee plan F commit). Not rebased. No migration used.
`reports-db.js` and `server.js` not touched. Nothing is approved by this work: no owner, threshold, decision,
certification or KPI selection was written; every switch ships at today's behaviour and has a PILOT-PROFILE row;
`docs/ops/FLAG-REGISTER.md` regenerated.

## Verdict table

| Goal | Finding | Verdict | What changed | Proof |
|---|---|---|---|---|
| F-DATA-04 (`eb76952`) | N3, N4 | FIXED (defect, ON) | `services/reportAnalysis.js`: a trailing partial period is not a trend point (3 complete points needed); figures carry partial, n, low_sample, target, freshness; a low-sample row is never named best/worst. `services/reportGenerator.js`: the dashboard's stale rule (`degradeStale`) runs before analysis; source states stored in `analysis.sources`. `services/reportPack.js`: HTML/CSV/XLSX/PPTX print them (`n` follows `ui_kpi_sample_size`) | report-analysis / report-generator / report-pack tests (focused run green at commit) |
| F-DATA-05 (`2a8df91`) | N5, C16 | FIXED (defect, ON) | new `services/dashboardCsv.js` used by `/api/dashboards/:key/data.csv`: freshness read from the sources (`NO_SYNC_JOB` for typed modules, never a literal `FRESH`), five columns appended (partial, n, target, low_sample, error), per-site window filled, a failed widget is a row. `/api/metrics/:key` returns `freshness` + `partial` and withdraws the colour on a stale source | new `tests/figure-parity-five-surfaces.test.js` (viewer · CSV · metric API · ext API · report pack, both F-DATA-11 keys) + `dashboards-routes.smoke` (CSV header) |
| F-DATA-06 (`a376abc`) | N6 / DV-08 | FIXED (defect, ON) | `services/reportPayload.js` `helpdeskBaseline`: null rates/durations stay null, a delta needs both sides. `tools/exec-pptx/render.py` / `kpi_fmt.py`: keys in `_null_kpis` print "—", no target tick, no "100 % violations" | exec-payload-null test + `report-figures-parity` |
| F-DATA-07 (`51ac943`) | C05, C18, N8, N9, N10 | PARTIAL | `data_state` on every resolved figure; default `owner_role` null ("to be named"); fleet comparator `{n, of}`; definition drawer behind `ui_kpi_definition_drawer` ('0'); lineage prints the denominator and `reader_not_wired` | metrics-registry, metric-lineage, ui-policy tests. **Not done**: SLA denominators need `reports-db.getCalendarMonthlyHelpdesk` to return `sla_res_den` / `sla_reply_den` (file not owned this wave) → the SLA tiles still say "base not measured" |
| F-DATA-08 (`85d3fd3`) | C04 | FIXED (defect, ON) | `assets.hygiene_site`: an unreadable label makes total and completeness null with `partial_source {read, unread}`; per-kind counts kept; the flag reaches tile, CSV, report figure | metrics-registry + dashboard CSV tests |
| F-DATA-11 (`10a31ea`) | C15 / E08 | PREPARED (selection = human) | `docs/kpi/DECISION-KPIS-PROPOSAL.md`: two candidates (`helpdesk.resolution_sla_pct`, `inspection.overdue_actions`) with decision supported, formula, window, denominator, freshness job, parity test, open divergences; committee table empty. Draft `decision-kpis` definition created only when `dashboard_decision_kpis_seed`='1' (default '0') | `tests/kpi-docs-links.test.js` (+2: says it decides nothing, cites both keys, table empty; draft never in the shipped seeds) + five-surface harness carries both keys |
| F-DATA-12 (`fe780e0`) | C06, C19, N12 | FIXED (structure; decisions = human) | optional widget fields `question`, `decision`, `audience_role` (validator: text, capped, refused when empty, ignored when absent); composer widget list shows "decision: not stated". `tools/agent/widget-catalogue.js` → `docs/ops/WIDGET-CATALOGUE.md` (`--check`): 48 widgets with metric, persona, sync job + freshness limit, owner role, threshold source, action link, viewer states, question, decision (all "not stated"). The 1.11 `kpi-dictionary.html` / `publication.html` listed as "retire or redirect — decision pending" (absent at head, no redirect route) | `tests/widget-catalogue.test.js` (4: `--check` passes and detects a stale file, one row per shipped widget, nothing invented) + `tests/dashboard-widgets.test.js` (+1) |

Also in `fe780e0`: `tests/csv-guard-coverage.test.js` lists `routes/governancePpm.js` → `services/ppmRaci.js` as a
delegate (the RACI CSV builder already applies the inline formula guard to every cell). The route came from E-P06 at
head; the test failed before this entry and passes after.

## Test proof

- Focused runs on PostgreSQL at each commit of F-DATA-04…08 were green (last runs 93/93 and 14/14).
- After the disk-full stop (see Deviations), the shell lost the PostgreSQL test credentials. The suites that need no
  database were re-run on the final tree: 14 files, **99 pass / 0 fail / 0 skipped** — `widget-catalogue`,
  `dashboard-widgets`, `kpi-docs-links`, `flag-register`, `metric-lineage`, `csv-guard-coverage`, `error-shape`,
  `server-size-budget`, `authz-route-matrix`, `agent-inventory`, `await-precedence`, `ui-design-ratchet`,
  `i18n-coverage`, `readme-truth`.
- Generators `--check` clean: `flag-register`, `metric-map`, `metric-lineage`, `ui-inventory`, `inventory`,
  `traceability`, `widget-catalogue`.
- **Not re-run after F-DATA-11/12** (need PostgreSQL): `figure-parity-five-surfaces`, `dashboards-routes.smoke`,
  `report-config`. F-DATA-11 changed `routes/dashboards.js` `seedAtBoot` (draft seed only behind the switch);
  F-DATA-12 does not touch any DB path. These three must run in the merge's full PG suite.
- `tests/.suite-manifest.json`: kpi-docs-links 5→7, dashboard-widgets 10→11, widget-catalogue 4 (new).

## Deviations

- Disk-full episode (machine `/` at 0 MB from leftover test databases): work stopped once; after space returned
  every uncommitted file was checked (non-empty, `node --check` clean) before committing.
- F-DATA-07 partial (SLA denominators, see table); `metric_registry` has no `field` column and no migration was
  assigned → a DB-added row reports `reader_not_wired` instead of a silent null.
- F-DATA-05 edited `routes/metrics.js` (response lines only); F1-SYNC edits the same file (`readerDeps`) — merge note.
- F-DATA-06: `fcr_rate` left under `exec_payload_zero_policy` (A-17); `FORMULA-REFERENCE.md` DV-08 row edited by hand.
- Tests changed because behaviour changed: `dashboards-routes.smoke` (CSV header), `metrics-registry` (owner_role),
  `ui-policy` + `ui-policy-me.smoke` (new key), `csv-guard-coverage` (two delegate entries).
- Commit footers use the session attribution line.

## For a person

- KPI committee: choose the two decision KPIs, their decision, thresholds and minimum sample; turn on
  `dashboard_decision_kpis_seed` if the draft dashboard is wanted.
- Product owner / committee: write `question` / `decision` / `audience_role` per widget; retire or redirect the
  1.11 bookmarks.
- Release manager: release window for the deck null → "—" change (reporting freeze).
- IT management: metric owners (shown as "to be named"); turning on `ui_kpi_definition_drawer`.
