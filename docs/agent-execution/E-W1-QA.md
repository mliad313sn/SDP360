# E-W1-QA — bundle evidence (plan E, wave 1: quality & architecture)

Branch `goal/w1-qa`, base `0839f51`. Goals E-A03, E-A04, E-A05, E-A06, E-Q01, E-Q04, E-Q05, E-Q08 (prompts in
`docs/audits/2026-11-05-expert-audit/CROSSCHECK-3-FAQB.md`). No migration, no `report_config` switch, no
change to `server.js` / `reports-db.js` / `public/reports.html`, no response or formula changed. Nothing here
approves, signs or accepts anything.

| Goal | Audit action | Verdict | What was built | Test proof |
|---|---|---|---|---|
| E-A03 | A-03 (tests + doc), X-Q-05 | **FIXED** (tests + doc) | `tests/api-contract-ext.test.js`: hand-written schemas for `/ext/v1/{metrics,sites,metrics/:key/values}` + OData `Sites` (null only where unmeasured, paging fields) and 401/403/404/400/429 error shapes. `tools/test/error-shape-scan.js` + `tests/error-shape.test.js`: ratchet on hand-written `res.status(4xx\|5xx).json(` (**485**, may only go down), every body has `error` (one named exception, `routes/trackers.js` `{errors:[]}`), no 5xx echoes `e.message`. `docs/api/CONTRACTS.md` (proposal: versioning `/ext/v2`, error shape, deprecation). | contract 6/6, error-shape 3/3 |
| E-A04 | A-04 (baseline part) | **FIXED** (report-only) | `tools/test/perf-baseline.js` (p50/p95 per page and journey from the e2e artefacts, Budget = `UNKNOWN — to be approved`), `run-e2e.js --baseline`, CI prints the table (`continue-on-error`). One local run: 22 journeys × 2, green → `docs/agent-execution/PERF-BASELINE.md`. | perf-baseline 4/4 |
| E-A05 | A-05 (prep) | **FIXED** (prep) | `tools/pg/explain-hot.js`: refuses any database not named `sdp_test_*`, seeds 100k tickets / 100k system_log / 20k outbox rows, EXPLAIN (ANALYZE, BUFFERS) on 7 hot readers → `docs/agent-execution/EXPLAIN-SYNTHETIC.md`; proposals only in `docs/ai-decisions/ADR-E-A05-index-proposals.md` (no index created). | explain-hot 3/3; report produced locally (PG 16) |
| E-A06 | A-06 (tests) | **FIXED** (tests) | `tests/exec-scorecard-registry-parity.test.js`: closure % and first-reply SLA % equal; named divergences D-RES (resolution SLA 67 vs 80: cancelled / no-SLA denominator + rounding), D-AVG (hours vs floor days), D-REOPEN (no registry metric); empty month null both sides; inline `executive.html` formulas pinned to their source text. Row added to `docs/ux/EXEC-PAGES-MATRIX.md`. | parity 4/4 |
| E-Q01 | Q-01 (1 of 11), X-Q-04 | **FIXED** (CI config; first CI run is the proof) | `ci.yml` + `release.yml`: `actions/setup-python` (SHA of v5.6.0, verified with `git ls-remote`), Python 3.12, `pip install -r tools/exec-pptx/requirements.txt` (exact pins = what ran here) before `npm test`; every existing step kept. Python skip reason `max` 1 → 0 (entry kept). | ci-config 10/10, exec-pptx-python 2/2 (ran, not skipped) |
| E-Q04 | Q-04 (prep) | **FIXED** (prep) | `tools/test/load.js` (Node `http`, sessions × scenarios, p50/p95/p99, error rate, 5xx, RSS from `/proc` with `--pid`), localhost-only guard + `--target-confirm`. `docs/ops/LOAD-TEST.md` with one local 5 × 120 s observation (25 028 requests, 0 errors). | load-harness 4/4 |
| E-Q05 | Q-05 (prep), X-Q-02 | **FIXED** (prep) | `docs/agent-execution/DEPS-TRIAGE.md` (one row per open Dependabot bump: from→to, notes, suites, journeys, rollback, verdict). `tests/dependency-sources.test.js`: non-registry lockfile entries need integrity + reason + owner (today `xlsx` from cdn.sheetjs.com). No lockfile change. | dependency-sources 2/2 |
| E-Q08 | Q-08 (agent part) | **FIXED** (agent part) | `tools/release/delivery-metrics.js` (goals named by merges, reverts, fix lead time, skipped per run, e2e journeys, ledger statuses; release failure rate / rollbacks / escaped bugs **UNKNOWN — needs deployment records** without a deploy log) → `docs/agent-execution/DELIVERY-QUALITY.md` (Oct–Nov 2026). | delivery-metrics 4/4 (fixture git repo) |

## Deviations from the goal text

- **E-A03**: the prompt's ratchet value (389) did not match the code — the scanner counts **485** calls in
  `server.js` + `routes/` + `services/` (comments excluded). 485 is the recorded ratchet.
- **E-A03**: the contract test checks `/ext/v1/metrics/:key/values`, not `/ext/v1/values` (also unchanged, same
  value shape).
- **E-Q01**: the deck renderer needs brand images (`public/brand/exec-pptx/*.jpg|png`) that are **not in the
  repository** (prod only), so with Python present the renderer test failed. The test now stages `render.py` next
  to synthetic placeholder images when the real ones are absent: it proves the deck is built, not the branding.
  `tests/test-runner-guard.test.js` required `max > 0` for every skip reason; relaxed to `max >= 0`. A dev box
  without Python now fails the guarded `npm test` unless it installs the requirements (that is what `max 0` means).
- **E-Q01**: the licence inventory covers npm only, so nothing was regenerated.
- **E-A05**: run on PostgreSQL 16 (the sandbox cluster), not 17.
- **E-Q04**: the local run booted the server in the harness process (e2e recipe), so the RSS figure includes the
  harness; the doc says so.
- **E-Q08**: `GOAL_TRACKER.csv` carries no dates, so lead time comes from git (first commit naming a goal id).
  On this history no "fix" commit names a goal id → n = 0, shown as `—`.

## Tests run (PostgreSQL, sandbox)

20 files together — the 9 new/changed files above + `ext-api.smoke`, `sla-definition-parity`, `uat-itsm-figures`,
`dashboard-shared-sla-rates`, `flag-register`, `server-size-budget`, `authz-route-matrix`, `readme-truth`,
`await-precedence`: **79 pass / 0 fail / 0 skipped**; then `evidence-baseline` + `test-runner-guard`: 15/15 (after
regenerating `docs/ops/METRIC-WIDGET-MAP.md`). Browser journeys: `run-e2e.js --runs=2 --baseline` green (22 × 2).
`npx eslint` clean on every touched JS file. `tests/.suite-manifest.json` updated (total 4150).

## Left for a person

- First CI run on GitHub: confirms `setup-python` + the pinned packages on `ubuntu-24.04` (not runnable here).
- Real brand images for the renderer test, if branding should be proved in CI (licence/IP owner).
- Budgets / SLOs for the performance baseline and the load harness (product owner / SRE) — all `UNKNOWN`.
- DBA: run `tools/pg/explain-hot.js` (or the same queries) on a restored copy with production volumes; decide the
  ADR-E-A05 proposals.
- Staging host and window for a load / soak run (`--target-confirm`).
- Take or refuse each Dependabot row in DEPS-TRIAGE.md; the dependency owner re-reviews `xlsx` at each release.
- Deployment records (dates, outcomes, escaped bugs) so DELIVERY-QUALITY can stop printing UNKNOWN.
- The external API consumers' owner adopts (or not) the versioning / deprecation proposal in CONTRACTS.md.
