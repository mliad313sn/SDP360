# P11 seat data-kpi — Data / KPI qualification findings

**AI review — not an independent human review.** Seat: data-kpi (PostgreSQL migrations, KPI formulas, null vs 0,
figure parity, source reconciliation, lineage). Reviewer did not write this code.

- Frozen SHA: `7eee8955568c0bcab2a6329f838ee432ffca9fd1` (clone `/home/user/qual/data-kpi`, `docs/agent-execution/`
  narratives removed by the coordinator; gate dossiers kept; narratives not read).
- Test cluster: **PostgreSQL 16.15** (Ubuntu) on localhost — NOT PostgreSQL 17. Every DB result below is PG16; the
  PG17 target is **not verified** by this seat.
- No product code modified. Throwaway artefacts only under the session scratchpad
  (`/tmp/claude-0/-home-user/29383f9d-be53-578b-8518-d98e0b66dcb7/scratchpad/`). Throwaway databases created and dropped.

## 1. Evidence re-run (command · result · SHA 7eee895)

Test command prefix used: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" PG_TESTS_REQUIRED=1 node --test --test-force-exit`, `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`.

| # | Evidence | Command | Result | Status |
|---|---|---|---|---|
| E1 | Migration tests (fresh DB, idempotence, 1.11 upgrade, failing-script naming, 094/095/096 rollback) | `<prefix> tests/pg-migrate.test.js tests/pg-migrate-from-111.test.js tests/pg-migrate-096-rollback.test.js tests/pg-finance-migrations-rollback.test.js` | 7/7 pass, 0 skipped | **VERIFIED (PG16)** |
| E2 | `db/migrate.js` on a fresh DB (via the rehearsal) | rehearsal step 1-2 | applied=102 then applied=0 already=102 changed=0 | **VERIFIED (PG16)** |
| E3 | Figure-parity + KPI suites | `<prefix> tests/figure-parity-*.test.js tests/kpi-*.test.js tests/dashboard-figure-parity.test.js` | 78 tests: 76 pass, **2 fail**, 0 skipped | **PARTIAL** — see E3a/E3b |
| E3a | `kpi-dossiers.test.js` "P08-kpi-dossiers.md is up to date" | (same run) | ENOENT `docs/agent-execution/P08-kpi-dossiers.md` | **NOT VERIFIED** — artefact lives in the removed narrative folder |
| E3b | `kpi-unknown-sweep.test.js` "no unjustified unknown→0" | (same run) | fails: 81 lines unjustified because the baseline `docs/agent-execution/P08-unknown-sweep.json` is absent | **NOT VERIFIED** (see F-05) |
| E4 | `node tools/kpi/unknown-sweep.js --check` | as written | **exit 1**, 436 hits, 81 UNJUSTIFIED (baseline file missing in clean clone) | **NOT VERIFIED** in the intended configuration; reproduced the failure in a clean tree |
| E5 | `node tools/agent/metric-map.js --check` | as written | "metric-widget map up to date", exit 0 | **VERIFIED** |
| E6 | Restore rehearsal | `node tools/pg/restore-rehearsal.js --rows 1000 --out <scratch>/reh` | exit 0; 12/12 checks PASS (migrate, idempotent re-run, ISO window, accents, audit hash chain + append-only trigger, 218 tables row counts equal, ticket md5 equal, chain heads equal, broken dump refused, target unchanged). backup 1.0 s, restore 4.1 s, 72 KB encrypted | **VERIFIED (PG16, 1 000 synthetic rows)** — says nothing about RPO/RTO at prod volume |
| E7 (extra) | `node tools/agent/metric-lineage.js --check` | as written | "metric lineage up to date", exit 0 | **VERIFIED** |

Counts: **verified 5** (E1, E2, E5, E6, E7), **partial 1** (E3: 76/78), **not verified 3** (E3a, E3b, E4 — all because
their ratchet/baseline lives in `docs/agent-execution/`).

## 2. Break attempts (claim · attack · outcome)

**A1 — Claim:** "a second migration run applies nothing (idempotent)" / scripts are safe to replay (`db/migrate.js` header: "edited after being applied — reported, re-applied (scripts are idempotent)").
Attack: throwaway DB, migration root with one file `CREATE TABLE IF NOT EXISTS t(a int); INSERT INTO t VALUES (1);`, migrate; then add only a trailing SQL comment; migrate again.
Outcome: run 2 returns `changed:["reports/001_x.sql"]` and **re-executes the file**; `t` holds 2 rows. **Claim broken in general**: idempotence is a convention, not enforced. Shipped scripts audited: no bare `INSERT` without `ON CONFLICT/NOT EXISTS`; `041` guards its UPDATEs inside a run-once `DO` block; but **`039_native_ppm.sql:15` (`UPDATE portfolio_projects SET stage = … WHERE stage='proposal' AND status <> 'planned'`) and `066_site_time_zone.sql:6` are unguarded**. A cosmetic edit to 039 at a future release would re-run the backfill and overwrite a stage a PMO deliberately set back to `proposal` on an active project. No test freezes the checksum of an applied file. → **F-03 (P2)**.

**A2 — Claim:** reconcile-source `monthOf` "refuses the rest (never guessed)" (test 59) and the repo rule "a `jj/mm/aaaa` date with both parts ≤ 12 is undecidable — refuse, never guess".
Attack: `node -e "require('./tools/kpi/reconcile-source.js').monthOf('01/10/2026')"`.
Outcome: `01/10/2026 → 2026-10`, `10/01/2026 → 2026-01` — ambiguous dates are **guessed day-first** (comment: "the Zoho EU export"). Also SQL groups `substr(created_time,1,7)` (UTC) while the export shows local display time (London is BST half the year), so month-edge tickets can produce phantom differences. Read-only operator tool, not a live screen. → **F-04 (P2)**.

**A3 — Claim:** "null = not measured, never 0 %" on the Group IT deck (F-DATA-06, `kpi_fmt.py`).
Attack: fixture `tools/exec-pptx/fixtures/kpis-may-qa.json` with `csat_pct, csat_avg_score, nps_proxy, csat_* = null`, `csat_total_responses = 0` (exactly what `public/executive-report.html:7677` sends for a month without survey responses); `render.py` run from a scratch copy (dummy brand images, because `public/brand/exec-pptx/*.jpg` is gitignored).
Outcome — slide 7 text: **"CSAT (% SATISFIED) | 0% | Target ≥ 80% ⚠ 80.0pp below target"**, **"AVG SURVEY SCORE | 0.0%"**, commentary **"Last known CSAT was 0%"**. CSAT is in neither `VERDICT_KPIS` nor `NULLABLE_KPIS` (`tools/exec-pptx/kpi_fmt.py:13,24`), so `_DEFAULTS` (`render.py:126-128`) turns null into 0 and lines `render.py:1412-1418`, `1448-1450`, `1521-1530` print it with an amber verdict, regardless of `exec_payload_zero_policy`. **Claim broken.** → **F-01 (P1, P0 candidate)**.

**A4 — Claim:** figure parity "every published KPI shows the same value and colour on all surfaces". Attack: read scope. Outcome: the five surfaces are dashboard viewer / CSV / report run / pack; the Group IT deck is explicitly a separate pipeline (`tests/figure-parity-five-surfaces.test.js:12`), and the unknown-sweep scope excludes `public/**` and Python (`tools/kpi/unknown-sweep.js` header). A3's defect sits exactly in that blind spot. Claim holds **for its stated scope only**. → feeds F-01/F-05.

**A5 — Claim (code reading, not executed):** the deck tracker block is faithful to the tracker engine. `services/reportPayload.js:521-650` `_tracker()` (fallback when the browser sends no `tracker` block, line 991) scores a month with no input as `0 → red`, uses its own `_ragOf` (not the pro-rated engine), sets `out.trends.fleet[i] = 0` when no site has a score (line 634-638) and `avg_score = … || 0` (line 643). Its own comment at line 989-990 says it is crude ("all-red"). → **F-02 (P2)**, not reproduced by execution.

## 3. Findings

| ID | Sev | Title | Where | Reproduction | Regression test to add | Rollback risk | Recommendation |
|---|---|---|---|---|---|---|---|
| F-01 | **P1** (P0 candidate under the brief's literal definition: wrong number shown as truth on a live export path) | Group IT deck prints CSAT "0 %", "80.0pp below target", "AVG SURVEY SCORE 0.0 %" and "Last known CSAT was 0 %" when CSAT is not measured | `tools/exec-pptx/render.py:126-128, 1412-1418, 1448-1450, 1521-1530`; `tools/exec-pptx/kpi_fmt.py:13,24`; browser `public/executive-report.html:7677` sends null correctly | A3 above (fixture kpis-may-qa + nulls → slide 7 text) | python/node test: CSAT keys null → slide 7 shows "—", no target tick, no "Last known CSAT" sentence; and `csat_pct = 0` with responses > 0 still prints 0 % | Low (render-only; additive null list) | Add `csat_pct`, `csat_avg_score`, `nps_proxy` to the null rule; extend the sweep or a parity test to `render.py`. Downgraded from P0 only because the same slide also states "0 responses"; a human reviewer should rule. |
| F-02 | P2 | Server fallback tracker block diverges from the engine and turns "no data" into 0 / red | `services/reportPayload.js:534-555, 634-644, 989-991` | POST exec-pptx payload without `tracker` → slides 10/11 from `_tracker()` | unit test on `_tracker()` with an empty month: trend point null, no avg_score 0 | Low | Either make the fallback return `null`/no tracker slides, or call the engine scorers (`tracker-pptx.js` exports) |
| F-03 | P2 | Migrator re-executes any applied script whose bytes change; idempotence not enforced; `039`/`066` carry unguarded data UPDATEs | `db/migrate.js:107-111`; `db/postgres/reports/039_native_ppm.sql:15`, `066_site_time_zone.sql:6` | A1 above | test: checksum of every applied migration file frozen against a committed manifest (edit = new file), and/or `changed` aborts unless `--allow-changed` | Medium — replay can silently rewrite user data in prod at an upgrade | Freeze applied files (manifest test); wrap data backfills in run-once guards like `041` |
| F-04 | P2 | Source reconciliation guesses ambiguous `dd/mm` dates and compares UTC SQL months with local-time export months | `tools/kpi/reconcile-source.js:17-24, SOURCES.sql` | A2 above | test `monthOf('01/10/2026') === null` (or require `--date-order`), and a month-edge BST fixture | None (read-only tool) | Refuse ambiguous dates unless the operator states the order; document timezone of the export |
| F-05 | P2 | Unknown→0 ratchet and dossier evidence cannot be re-run from a clean tree; sweep scope excludes browser JS and Python where F-01 lives | `tools/kpi/unknown-sweep.js` (BASELINE under `docs/agent-execution/`), `tests/kpi-dossiers.test.js:9-10` | clean clone → E3a/E3b/E4 fail | move the baseline/dossier out of the narrative folder (e.g. `docs/kpi/`), add `render.py` + `public/lib` composers to a sweep | None | Re-home evidence; widen scope |
| F-06 | P3 | Restore rehearsal / migration evidence run on PostgreSQL 16, target is 17; volume 1 000 rows | env | `select version()` | CI job on PG17 service (`.github/workflows/ci.yml` claims PG17) — confirm with its run log | — | Re-run E1/E6 on PG17 at ≥100 000 rows before G-11 |
| F-07 | P3 | Inverse null bug in the browser deck payload: `csat_pct: csat.csatPct \|\| null` turns a measured 0 % into "not measured" | `public/executive-report.html:7612` | read | assert 0 survives | Low | `?? null` |
| F-08 | P3 (known, committee) | `fcr_rate` default 0 under `exec_payload_zero_policy = keep_server`; KEEP_SERVER rule masks a browser 0 for CSAT counts | `services/reportPayload.js:116, 1128-1131` | read | — | — | Committee choice (FLAG-REGISTER `exec_payload_zero_policy`, KPI committee); not decided here |

**P0: 0 confirmed** (F-01 is a P0 candidate for human ruling). **P1: 1** (F-01).

## 4. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Area link | Recommendation | Why |
|---|---|---|---|
| L09 KPI trust (display-only explanations) | KPI definitions/drawer, sample size | **CONDITIONAL** | Display-only and parity tests green for the dashboard pipeline; condition: F-05 evidence re-homed and re-run; `ui_kpi_sample_size`/`value_scoreboard_enabled` wait for committee adoption (G-12 empty) |
| L05 Time, money and benefits | finance figures, actuals import, certification | **NO-GO for pilot** until G14 Finance row and named verifier exist; technically CONDITIONAL (migrations 094/095 rollback verified on PG16) | Human gate empty; money must not be certified without a named verifier |
| L13 Operations resilience (restore drill) | backup / restore | **CONDITIONAL** | Rehearsal 12/12 on PG16 at 1 000 rows; condition: PG17 + realistic volume + blob copy (`restore_drill_full` prerequisite), RPO/RTO set by CAB+SRE (G-11 empty) |
| Group IT deck (not a lot; exec pipeline) | CSAT/tracker figures | **NO-GO as an official figure** until F-01 fixed | wrong number with verdict on unmeasured CSAT |
| Committee-policy switches (`kpi_policy_enforced`, `sla_headline_definition`, `metric_programme_readers`, `site_codes_from_registry`, `asset_cost_outlier_exclude`) | KPI definitions | **Keep dark** | not activation lots; need adopted D-01/02/03 decisions |

## 5. Human gates still empty in this area (RELEASE-GATES.md, all cells empty at SHA 7eee895)

- Backup / restore RPO-RTO (G-11) — CAB + SRE
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee
- Data owner — anonymised fixtures (G-15), 2026 history D-10 — Data owners
- Finance — budgets and benefits (G14) — Finance
- CAB — PostgreSQL-only cutover PO-08 (row shared with D-11)
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05)
- Capacity — load / soak result accepted (E-B05) — SRE + DBA

No gate was filled, no decision taken by this seat.
