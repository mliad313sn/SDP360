# P11 seat data-kpi — ROUND 2 findings

**AI review — not an independent human review.** Seat: data-kpi (PostgreSQL migrations, KPI formulas, null vs 0,
figure parity, source reconciliation, lineage). Reviewer did not write this code. Round-1 file
(`/home/user/qual/out/data-kpi.md`, SHA 7eee895) left unchanged.

- Frozen SHA: `b2e85cd08860a57526442797ac711e2fc9defc3a` (clone `/home/user/qual/data-kpi`; `docs/agent-execution/`
  narratives removed by the coordinator, gate dossiers only; narratives not read).
- Test cluster: **PostgreSQL 16.15**, max_connections 400 — NOT PostgreSQL 17. PG17 target **not verified** by this seat.
- No product code modified. Throwaway artefacts in the session scratchpad
  `/tmp/claude-0/-home-user/29383f9d-be53-578b-8518-d98e0b66dcb7/scratchpad/r2/`. Throwaway DBs `r2_conc_dk`,
  `r2_rec_dk` created and dropped; the rehearsal dropped its own.
- Code delta in this seat's area since 7eee895 (`git diff --stat 7eee8955..b2e85cd0`): only
  `tools/exec-pptx/{render.py,kpi_fmt.py}`, `public/executive-report.html` (4 lines), `tools/agent/flag-register.js`,
  `tools/pg/README.md`, two `docs/kpi` lines. `db/`, `services/reportPayload.js`, `tools/kpi/*` are **unchanged**.

## 1. Round-1 findings — re-verification

| R1 ID | Sev R1 | Status at b2e85cd | Evidence |
|---|---|---|---|
| F-01 Group IT deck prints CSAT 0 % / "80.0pp below target" / "AVG SURVEY SCORE 0.0 %" / "Last known CSAT was 0 %" when unmeasured | P1 | **FIXED** | Re-ran the round-1 repro unchanged: `python3 rt/tools/exec-pptx/render.py < scratchpad/csatnull.json` with the new render.py/kpi_fmt.py → exit 0; slide 7 now reads `CSAT (% SATISFIED) \| — \| Target ≥ 80% · not measured this month`, `AVG SURVEY SCORE \| —`, commentary `No CSAT figure this month`. No "0%", no verdict. Fix = commit 57c7afe (`kpi_fmt.SURVEY_KPIS` joined to `_null_set` before defaults; tiles/commentary branch on `is_null`). New test `tests/exec-pptx-csat-null.test.js` 5/5 pass (incl. measured 0 % still prints 0 % + verdict). Server path checked: `services/reportPayload.js:1129-1141` `_take` skips a browser null, server never computes CSAT → null survives to render.py. Browser sources (`routes/survey.js:286,296`, `executive-report.html:3459,4025`) return null when n=0, so the `?? null` change does not turn "no responses" into a measured 0. |
| F-02 server fallback `_tracker()` turns no-data into 0/red | P2 | **NOT FIXED** (untouched) | `services/reportPayload.js:643` `avg_score = … \|\| 0`, `:989-991` fallback still used when the browser sends no tracker block. |
| F-03 migrator re-executes any applied file whose bytes change; unguarded data UPDATEs | P2 | **NOT FIXED** | `db/migrate.js:105` unchanged ("re-applied (scripts are idempotent)"); `039_native_ppm.sql:15`, `066_site_time_zone.sql:6` still unguarded; no checksum-freeze test. |
| F-04 reconcile-source guesses ambiguous dd/mm dates; UTC vs local month | P2 | **NOT FIXED** | `node -e "…monthOf('01/10/2026')"` → `2026-10`; `10/01/2026` → `2026-01`. |
| F-05 unknown→0 ratchet / dossier evidence not re-runnable from a clean tree; sweep scope excludes browser JS + Python | P2 | **NOT FIXED** | Same 2 failures (see E3); baseline still `docs/agent-execution/P08-unknown-sweep.json` (`tools/kpi/unknown-sweep.js:19`). Note: F-01 (in render.py) was outside this sweep — the class of defect is still undetectable by the ratchet. |
| F-06 evidence on PG16 / 1 000 rows | P3 | **NOT FIXED** (environment) | `select version()` = 16.15. |
| F-07 browser `csat.csatPct \|\| null` drops a measured 0 | P3 | **FIXED** | `executive-report.html:7612-7615` now `?? null`; pinned by test 5 of `exec-pptx-csat-null`. |
| F-08 `fcr_rate` 0 default / KEEP_SERVER masking | P3 (committee) | unchanged, committee choice | not re-assessed. |

## 2. Evidence re-run at b2e85cd (command · result)

Prefix: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" PG_TESTS_REQUIRED=1 node --test --test-force-exit`, `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`.

| # | Evidence | Command | Result | Status |
|---|---|---|---|---|
| E1 | Migration tests + new CSAT test | `<prefix> tests/pg-migrate*.test.js tests/pg-finance-migrations-rollback.test.js tests/exec-pptx-csat-null.test.js` | 12/12 pass, 0 skipped | **VERIFIED (PG16)** |
| E2 | `db/migrate.js` on a fresh DB | rehearsal steps 1-2 | applied=102, then applied=0 already=102 changed=0 | **VERIFIED (PG16)** |
| E3 | figure-parity + KPI suites (17 files) | `<prefix> tests/figure-parity-*.test.js tests/kpi-*.test.js tests/dashboard-figure-parity.test.js` | 78 tests: 76 pass, **2 fail** (#38 ENOENT `docs/agent-execution/P08-kpi-dossiers.md`; #76 unknown-sweep baseline absent) | **PARTIAL** — same as round 1 (F-05) |
| E4 | `node tools/kpi/unknown-sweep.js --check` | as written | exit 1, 434 hits, 80 UNJUSTIFIED (baseline missing in clean tree) | **NOT VERIFIED** |
| E5 | `node tools/agent/metric-map.js --check` | as written | "metric-widget map up to date", exit 0 | **VERIFIED** |
| E6 | Restore rehearsal | `node tools/pg/restore-rehearsal.js --rows 1000 --out scratchpad/r2/reh` | exit 0; all checks PASS (migrate, idempotent re-run, ISO window, accents, UTC clock, audit chain + append-only trigger, 218 tables / 1 186 rows equal, ticket md5 equal, chain heads equal, broken dump refused, target unchanged) | **VERIFIED (PG16, 1 000 rows)** — no RPO/RTO claim at prod volume |
| E7 | `node tools/agent/metric-lineage.js --check` (extra) | as written | "metric lineage up to date", exit 0 | **VERIFIED** |
| E8 | Round-1 F-01 repro (extra) | see §1 | fixed | **VERIFIED** |

Counts: **verified 6** (E1, E2, E5, E6, E7, E8), **partial 1** (E3 76/78), **not verified 1** (E4; plus the two E3 sub-tests).

## 3. New break attempts (claim · attack · outcome)

**B1 — Migrations. Claim:** "a fresh database reaches the current schema in one call; one transaction per file".
Attack: two `node db/migrate.js` processes started 0.3 s apart on a fresh throwaway DB (`r2_conc_dk`); `db/migrate.js`
has no advisory lock.
Outcome: run 1 applied=102 exit 0; run 2 **failed cleanly** (`duplicate key … pg_type_typname_nsp_index`, exit 1);
journal 102 rows / 102 distinct ids; schema complete. Because each file and its journal row share one transaction,
the journal PK makes a racing replay roll back. **Claim holds.** Residual: no lock → the loser fails with an opaque
error (e.g. boot `migrateAtBoot` racing the installer). → F-12 (P3).

**B2 — KPI null vs 0 (shared RAG engine). Claim:** `kpiRag.rag()` returns `NA` for "not measured".
Attack: `rag(v, policy)` for every policy with v ∈ {null, undefined, NaN, '', 0, 'abc', '—'}.
Outcome: null/undefined/NaN → `NA` ✔; but `''`, `'abc'`, `'—'` → **RED** for all 7 policies
(`public/lib/kpiRag.js:102-105` only tests null/undefined/NaN, then compares a string). Also `aggregate([])` returns
**0** unless the caller passes `emptyAs` (`:55`); `services/trackerDefinitions.js:129,152` call it without `emptyAs`, so
a business-tracker item with no input scores 0 → RED/AMBER (flagged only by the additive `measured` flag, A-11). The
latter is the documented legacy tracker semantic ("no entry = nothing done") — a business policy, not decided here.
No live caller found passing a string to `rag()` (callers null-guard or `Number()` first). **Claim holds for numeric
input only.** → F-11 (P3 hardening).

**B3 — Figure parity (CSAT across surfaces). Claim:** unmeasured CSAT shows the same on all surfaces.
Attack: compare the scorecard tile (`executive-report.html:3989`, `d.csatPct != null ? … : '—'`) with the deck after
the fix (B-repro §1).
Outcome: both show "—". **Claim holds.** Residual inconsistency: a *measured* 0 % with `csat_total_responses > 0` and no
bucket counts prints "0%" on the tile but the donut fallback (`render.py:531-536`, guard `pct > 0`) prints "No CSAT
data captured this month". → F-13 (P3).

**B4 — Source reconciliation. Claim:** "an export row whose key cannot be read is COUNTED as unreadable, never dropped";
verdict RECONCILED only when everything matches.
Attack: export file with a header of the wrong columns and no data rows (`Wrong,Columns`), against a throwaway DB whose
`request_records` is empty: `PG_URL=…/r2_rec_dk node tools/kpi/reconcile-source.js --source=sdp_requests --export=empty.csv`.
Outcome: **`"verdict": "RECONCILED"`, exit 0**, groups 0, source_rows 0. The missing-column check is skipped when the
export has no rows (`reconcile-source.js:113`, `rows.length && …`), and `compare()` returns RECONCILED for an empty
comparison (`[].every(...) === true`, `:85`). A run that compared nothing is reported as a successful reconciliation —
the null-vs-0 rule inverted on an evidence tool used for the data-owner gate (G-15). Also `SET TRANSACTION READ ONLY`
(`:117`) runs outside a transaction, so read-only is not actually enforced (the tool only SELECTs). → **F-10 (P2)**.

**B5 — Lineage. Claim:** metric lineage / metric map up to date. Attack: re-run the checks at the new SHA.
Outcome: both exit 0. Not broken (no deeper mutation attack attempted this round — not verified beyond the check).

## 4. Findings at b2e85cd

| ID | Sev | Title | Where | Reproduction | Regression test to add | Rollback risk | Recommendation |
|---|---|---|---|---|---|---|---|
| F-02 | P2 | (carried) server fallback tracker block → 0/red | `services/reportPayload.js:521-650, 989-991` | round 1 A5 | `_tracker()` empty month → null points, no avg 0 | Low | return null / reuse engine scorers |
| F-03 | P2 | (carried) applied migration re-executes on any byte change; 039/066 unguarded backfills | `db/migrate.js:105`; `039_native_ppm.sql:15`; `066_site_time_zone.sql:6` | round 1 A1 | committed checksum manifest of applied files | Medium (silent data rewrite at upgrade) | freeze applied files; run-once guards |
| F-04 | P2 | (carried) ambiguous dd/mm guessed; UTC vs local month | `tools/kpi/reconcile-source.js:17-24` | `monthOf('01/10/2026')` → 2026-10 | `monthOf` ambiguous → null unless `--date-order` | None | refuse ambiguity |
| F-05 | P2 | (carried) ratchet/dossier baselines not reproducible from a clean tree; sweep blind to `render.py` / `public/` | `tools/kpi/unknown-sweep.js:19`, `tests/kpi-dossiers.test.js:10` | clean clone → E3 #38/#76, E4 exit 1 | re-home baseline under `docs/kpi/`; add render.py to a sweep | None | re-home + widen scope |
| **F-10** | **P2 (new)** | reconcile-source reports **RECONCILED / exit 0** for an empty comparison and skips the column check when the export has no rows | `tools/kpi/reconcile-source.js:85, 113` | B4 | `compare([],[])` verdict ≠ RECONCILED (e.g. `NOTHING COMPARED`, exit ≠ 0); header-only export with wrong columns → exit 2 | None (read-only tool) | Require ≥1 source row and ≥1 group; check columns from the header, not `rows[0]`; wrap the SELECT in `BEGIN READ ONLY` |
| F-06 | P3 | (carried) PG16 / 1 000 rows only | env | `select version()` | PG17 CI run log, ≥100k rows | — | before G-11 |
| F-11 | P3 (new) | `kpiRag.rag()` colours a non-numeric/empty value RED; `aggregate([])` defaults to 0 | `public/lib/kpiRag.js:55, 102-105`; `services/trackerDefinitions.js:129,152` | B2 | `rag('')` / `rag('—')` → NA | Low | treat non-finite as NA; tracker empty-item semantic → KPI Committee (G-12) |
| F-12 | P3 (new) | migrator has no advisory lock; concurrent runs fail with an opaque catalog error | `db/migrate.js` (no `pg_advisory_lock`) | B1 | two concurrent `migrate()` → second waits or fails with a clear message | Low | `pg_advisory_xact_lock` around the run |
| F-13 | P3 (new) | measured 0 % CSAT with responses but no bucket counts: tile 0 %, donut "No CSAT data" | `tools/exec-pptx/render.py:531-536` | fixture `csat_pct:0, csat_total_responses:12`, counts 0 | donut shows 0 satisfied / N dissatisfied | Low | guard on `total > 0` and not-null pct, not `pct > 0` |
| F-08 | P3 | (carried, committee) `fcr_rate` / KEEP_SERVER policy | `services/reportPayload.js` | — | — | — | KPI Committee |

**P0: 0. P1: 0** (round-1 P1 F-01 FIXED). P2: 5 (4 carried, 1 new F-10). P3: 5.

## 5. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L09 KPI trust (display-only explanations) | **CONDITIONAL** | Parity/KPI suites 76/78, the 2 failures are evidence-location (F-05), not formula. Condition: F-05 re-homed and re-run green; committee switches stay dark until G-12. |
| L05 Time, money and benefits | **NO-GO for pilot** (technically CONDITIONAL) | Finance gate G14 empty; migration rollbacks green on PG16 only. |
| L13 Operations resilience (restore drill) | **CONDITIONAL** | Rehearsal all-PASS on PG16 at 1 000 rows; condition: PG17, prod-like volume, blob copy, RPO/RTO set by CAB+SRE (G-11 empty). F-03 should be closed before the first production upgrade. |
| Group IT deck (exec pipeline, not a lot) | **CONDITIONAL** (was NO-GO in round 1) | F-01 fixed and pinned by test; remaining F-02 (server fallback tracker) and F-13 are P2/P3. Still no official figure before G-12. |
| Source reconciliation evidence for G-15 | **CONDITIONAL** | F-10 + F-04 must be fixed before a reconciliation sheet is accepted as data-owner evidence. |
| Committee-policy switches (`kpi_policy_enforced`, `sla_headline_definition`, `metric_programme_readers`, `site_codes_from_registry`, `asset_cost_outlier_exclude`) | **Keep dark** | Need adopted D-01/02/03. |

## 6. Human gates still empty in this area (RELEASE-GATES.md, all cells empty at b2e85cd)

- Backup / restore RPO-RTO (G-11) — CAB + SRE
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee
- Data owner — anonymised fixtures (G-15), 2026 history D-10 — Data owners
- Finance — budgets and benefits (G14) — Finance
- CAB — PostgreSQL-only cutover PO-08 / D-11
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05)
- Capacity — load / soak result accepted (E-B05) — SRE + DBA

No gate filled, no decision taken by this seat. AI review — not an independent human review.
