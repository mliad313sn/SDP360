# P11 seat data-kpi — ROUND 7 (re-check) findings

**AI review — not an independent human review.** Seat: data-kpi (PostgreSQL migrations, KPI formulas, null vs 0,
figure parity, source reconciliation, lineage). The reviewer did not write this code. Earlier round files
(`data-kpi.md`, `r2`–`r6-data-kpi.md`) were read and left unchanged.

- Frozen SHA: `7ea49070d687679109c3c91ef29a8f744835f10c` (`git rev-parse HEAD` in `/home/user/qual/data-kpi`). The
  `docs/agent-execution/` narratives were not read or fetched (they show as deleted in the clone, as intended); only
  `docs/agent-execution/gate-dossiers/` was read.
- Test cluster: **PostgreSQL 16.15** (restarted with `service postgresql start`; it was down at start). **The PostgreSQL 17
  target is still not verified.**
- No product code was modified. Throwaway artefacts: `/tmp/claude-0/p11attack-r7/` (`fleet7.js`, `risk7.js`, `ddl7.js`,
  `anchor7.js`, `e1.out`, `e3.out`, `sweep.out`, `reh.out`, `reh/`). The r6 repros in `/tmp/claude-0/p11attack-r6/`
  (`fleet.js`, `risk6.js`, `ddl6.js`) were re-run in place.
- Run id `SDP_TEST_RUN_ID=datakpir7` on every test run. Throwaway DBs created by this seat: `r7_dk`, `r7_dk_rest` —
  both dropped. `pg_database` shows no `%datakpir7%` leftover. `drop-test-dbs.js` was not run.

## 1. Round-6 findings re-verified at 7ea49070 (fix 25)

| R6 ID | Sev | Status | Evidence (reproduced by this seat) |
|---|---|---|---|
| **F-26** fleet helpdesk cell green on a 1-ticket closed base with 40 open overdue | P2 | **FIXED** | r6 `fleet.js`: cell now `{"rag":"red","value":"0/1","open_overdue":40,"cap":"red"}` (r6: `green 0/1`). `fleet7.js` case A: overall `red` behind four green modules (cap applied by `services/siteAwarenessFleet.rollupRag`). Population ("open band over every ticket created in the window") and PROPOSED policy `helpdesk-fleet-sla` are written in FORMULA-REFERENCE §1 and `kpiRag.js:53`. Residual design gap → F-31 (P3). |
| **F-27** project card and stage-gate count use a second high-risk rule | P2 | **FIXED for the named surfaces, PARTIAL for the claim** (→ F-29) | Code read: `projectKpis.js:85` `filter(RE.isHigh)`, `governanceStore.js` `gateCounts` selects residual columns and filters `riskExposure.isHigh`, `portfolioDeck.js:50` `isHigh`, `raid.js` severity via `riskExposure.level`. `risk7.js`: risk P3×I3 residual P1×I1 → card `high_risks 0`; risk P1×I1 residual P3×I3 → card counts it; open issue P3×I3 → card counts it. (The r6 `risk6.js` "gate" column is a copy of the OLD SQL filter and is now stale; the gate was verified by reading the new `gateCounts`.) But the project **RAG risk component** still uses inherent max P×I with its own bands (F-29). |
| **F-28** generic writer stores any risk status; `isOpen` case-sensitive | P3 | **FIXED** | `governanceStore.js` `upsertPortfolio('risk')`: status trimmed + lower-cased, refused outside `open | closed` (`BAD_STATUS`); kind lower-cased. `riskExposure.isOpen` treats `closed, mitigated, resolved, cancelled, canceled, done, retired` (any case) as not open; `inScope` case-insensitive. Covered by `tests/p11-r6-data-fixes.test.js` (passes in E3). Legacy rows: other surfaces still read `status === 'open'` strictly (F-30). |
| **F-25** destructive-DDL detector gaps | P3 | **FIXED for every r6 variant** (tiny residual) | r6 `ddl6.js`: dollar-quoted EXECUTE (table and column), `concat('DROP',…)`, `DROP FUNCTION … CASCADE`, `DROP EXTENSION … CASCADE`, `ALTER TYPE … DROP ATTRIBUTE` → all `destructive=true, rerunOnChange=false`. New `ddl7.js`: `format('DROP TABLE %I',…)`, `DROP SCHEMA … CASCADE`, `DROP SEQUENCE`, `DROP VIEW … CASCADE`, `ALTER TABLE … DROP CONSTRAINT … CASCADE`, `MERGE … DELETE` → caught. Still re-run on change: `EXECUTE 'DR' || 'OP TABLE x'` (split literal, contrived) and `ALTER SEQUENCE … RESTART` / identity `RESTART WITH 1` (a re-run would collide on ids — loud failure, not silent loss). No current file affected. Benign `ON DELETE CASCADE` FK, `DROP INDEX`, `DROP TRIGGER` correctly not flagged. 132 classifies `writes=true` (word TRUNCATE in a trigger definition) → would not be re-run if edited: harmless false positive. Downgraded to P3-residual. |
| O-1 run id with hyphens ignored | obs | **FIXED** | `SDP_TEST_RUN_ID=data-kpi-r6 node -e …testDbName()` → `sdp_tracker_test_data_kpi_r6_jarg3z` (sanitised, shared with the sweep). |
| O-2 anchor table truncatable / rehearsal never records an anchor | obs | **PARTIAL** | Migration 132: `TRUNCATE audit_chain_anchors` now refused (`sdp_append_only()` raise) on a fresh migrated DB. As the migration itself states, the owner can still `ALTER TABLE … DISABLE TRIGGER` then truncate (reproduced inside a rolled-back transaction) — the hardening script remains the real control (audit seat). `tools/pg/restore-rehearsal.js` still records no anchor (`grep -i anchor` → 0), so the anchor/HMAC path is not exercised by the rehearsal (see B7 / F-32). |
| F-11 `kpiRag.rag('')` / `('—')` → RED | P3 | NOT FIXED | `tracker-activity RED RED NA`. |
| F-12 migrator advisory lock | P3 | NOT FIXED | `grep -c advisory db/migrate.js` → 0. |
| F-13 render.py CSAT donut `pct > 0` | P3 | NOT FIXED | `render.py:535-536` unchanged. |
| F-15 Group IT deck outside metric map / lineage | P3 | NOT FIXED | 0 `docs/ops/METRIC-*.md` files mention `reportPayload` / `render.py`. |
| F-06 PG16 / small volume | P3 | NOT FIXED (env) | Rehearsal on 16.15, 1 234 rows. |
| F-08 fcr / KEEP_SERVER | P3 (committee) | unchanged | Not re-assessed. |

Round-6 P2s: **F-26 fixed; F-27 fixed for its named surfaces, remainder raised as F-29.** Round-6 P3s: F-28 fixed,
F-25 fixed (residual noted), O-1 fixed, O-2 partial; F-11/12/13/15/06/08 carried.

## 2. Evidence re-run at 7ea49070 (command · result)

Prefix: `SDP_TEST_RUN_ID=datakpir7 PG_TESTS_REQUIRED=1 PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit`.

| # | Evidence | Command | Result | Status |
|---|---|---|---|---|
| E1 | Migration + rollback + truncation + CSAT-null + audit-chain tests | `<prefix> tests/pg-migrate*.test.js tests/pg-finance-migrations-rollback.test.js tests/zoho-sync-truncation-*.test.js tests/zoho-sync-survey-truncation.test.js tests/exec-pptx-csat-null.test.js tests/ppm-rollback-scripts.test.js tests/audit-chain.test.js` | **50/50 pass**, 0 skipped, 0 fail (55 s) | **VERIFIED (PG16)** |
| E2 | `db/migrate.js` on a fresh DB | `CREATE DATABASE r7_dk`; `PG_URL=…/r7_dk node db/migrate.js` ×2 | 1st `applied=115 already=0 changed=0`; 2nd `applied=0 already=115`; `schema_migrations` = 115 rows = 115 forward files on disk; `audit_chain_anchors` carries `…_append_only` + `…_no_truncate`; `TRUNCATE audit_chain_anchors` refused | **VERIFIED (PG16)** |
| E3 | figure-parity + KPI suites (+ r5/r6 fix tests) | `<prefix> tests/figure-parity-*.test.js tests/kpi-*.test.js tests/dashboard-figure-parity.test.js tests/site-awareness-sla-parity.test.js tests/report-payload-tracker-null.test.js tests/reporting-week-dst.test.js tests/p11-r5-data-fixes.test.js tests/p11-r6-data-fixes.test.js tests/adoption-lotb-home.test.js` (24 files) | **137/137 pass**, 0 skipped (92 s) | **VERIFIED** |
| E4 | `node tools/kpi/unknown-sweep.js --check` | as written | exit 0, 443 hits, **unjustified 0** (caveat unchanged: the `count_field` rule auto-justifies by field name) | **VERIFIED** |
| E5 | `node tools/agent/metric-map.js --check` | as written | "metric-widget map up to date", exit 0 | **VERIFIED** |
| E6 | Restore rehearsal | `node tools/pg/restore-rehearsal.js --rows 1000 --out /tmp/claude-0/p11attack-r7/reh` | exit 0, **all 12 checks PASS**: migrate 115 + idempotent, ISO window, accents, UTC, chain verifies, append-only, **228 tables / 1 234 rows** equal, ticket md5, chain heads equal, broken dump refused, target unchanged | **VERIFIED (PG16, 1 000 rows)**. No RPO/RTO claim. Anchor path not exercised (F-32). |
| E7 | `node tools/agent/metric-lineage.js --check` (extra) | as written | up to date, exit 0 | **VERIFIED** |
| E8 | R6 repros + new attacks (extra) | §1, §3 | reproduced | **VERIFIED** |

Counts: **verified 8 of 8.** Not verified: 0. Still not verified as a claim: PG17, production volume, RPO/RTO.

## 3. New break attempts (one per capability, on code changed by fixes 25–29)

**B1 — Migrations (detector extended in fix 25; migrations 132/133/135/136).** Claim: destructive DDL is never re-run
on change, including dynamic SQL. Attack `ddl7.js` (16 variants + the four new files). Outcome: **holds** except a
split string literal and sequence/identity `RESTART` (P3 residual in F-25). New migrations: 132/133/136 idempotent
(second run applies nothing), 135 adds `sig` only when the app role owns the table, else a NOTICE — on a hardened DB the
journal marks 135 applied without the column until the DBA reruns the hardening script (documented in the file).

**B2 — Sync integrity.** Covered by E1 (truncation guard + anchor tests). No new attack (operations seat owns fix 27).

**B3 — Figure parity / null vs 0 on the fixed Vue Groupe cell (fix 25 F-26, live path).** Claim (`siteAwarenessFleet.js`
header): "a site drowning in open overdue tickets cannot average back to green behind four green modules". Attack
`fleet7.js` with four green modules:
- A (r6 repro) → cell red, cap red, **overall red** — holds.
- B 20 closed, **all 20 missed SLA**, 0 open overdue → cell **red 20/20**, no cap → **overall green**.
- C 1 closed on time + 99 open within SLA → cell **green 0/1** (no minimum closed base).
- D 0 closed, 2 of 100 open overdue → `na` (no verdict) — correct.
- E 100 closed on time, 4 of 104 open overdue (3.8 %) → green — inside the PROPOSED band.
Outcome: the stated claim holds for open overdue; but a helpdesk cell that is red on its closed band does not cap the
overall, so a site where every closed ticket breached SLA still reads overall green. This asymmetry is new (the cap
exists only for one band) and the C case was the "minimum closed base" option raised in r6. → **F-31 (P3)**, bands
owned by G06.

**B4 — Lineage / one high-risk rule (fix 25 F-27 + guard test).** Claim (`riskExposure.js` header + guard test
"no high-risk threshold outside riskExposure.js"): every surface uses `isHigh` / `level`. Attack `risk7.js` + read of
`services/ppm/projectRag.js` / `w3Context.js`:
- risk P3×I3, residual P1×I1 → project card `high_risks 0`, register not high, **project RAG risk component RED**
  (`riskScore` = 9, `projectRag.js:30` `risk_score red_enter 8 / amber_enter 5`, inherent only, residual ignored).
- risk with `probability: null`, impact 3 → `riskScore` = **0** (`Number(null)*3` is finite) → risk component **green**
  — an unscored risk becomes a measured "no risk" (null-vs-0).
- open issue P3×I3, no risks → card **active_risks 0 · high_risks 1** (`ppmGovernanceW3.js:54`, `projectReport.js:22`
  render "0 · 1": high is not a subset of active, because active counts kind `risk` only and `isHigh` counts risk + issue).
The guard regex only matches `>= 6` patterns, so the `red_enter: 8` / `amber_enter: 5` thresholds escape it.
Outcome: **claim broken** (third surface: project RAG; card internally inconsistent). → **F-29 (P2)**, **F-30 (P3)**.
Behind `ppm_project_rag_enabled` (default off).

**B5 — Input domain after F-28.** Legacy rows with `status 'Open'` (pre-validation): `isHigh` → true, but
`riskScore`, `top_risks` and `raid.review_overdue` use `status === 'open'` strictly → card `high_risks 1`, `top_risks 0`,
RAG risk 0. New writes are normalised, so only legacy/imported rows are affected. → part of **F-30 (P3)**.

**B6 — Restore with HMAC-signed anchors (fix 29, migrations 135/136; restore capability).** Attack `anchor7.js`: on my
own migrated DB, 20 hash-chained rows, `recordAnchors` with `SDP_CONFIG_KEY=k1` (12 signed anchors), `pg_dump -Fc` →
`pg_restore` into a second DB, then `auditChain.verify`:
- same key → `ok`;
- **no key → `ok`** (signed anchors present but signatures not checked — "advisory" per EXPLOITATION.md:102, but the fix
  is advertised as "fails closed");
- **different key → `broken`** on every anchored ledger, message "anchor row(s) #1 not signed by the nightly job (forged
  or altered anchor)" — a legitimate DR restore onto a server with a new key is reported as forgery, and the nightly job
  then fails/alerts. `REPLICA-RESTORE.md:43` already requires the same key (for secrets), but neither it nor
  `DB_RECOVERY.md` mentions the anchor consequence, and the rehearsal never records an anchor, so nothing tests it.
Outcome: restore of data **intact**; audit verdict after a key change is **misleading** (alarm, not data loss). →
**F-32 (P3)**, shared with the audit seat.

## 4. Findings at 7ea49070

| ID | Sev | Title | Where | Reproduction | Regression test to add | Rollback risk | Recommendation |
|---|---|---|---|---|---|---|---|
| **F-29** | **P2 (remainder of F-27)** | Project RAG risk component still uses inherent max P×I with its own thresholds (amber > 5, red > 8), ignores residual, and turns an unscored risk into 0 ("no risk") | `services/ppm/projectKpis.js:53-58` (`riskScore`), `services/ppm/projectRag.js:30`, `services/ppm/w3Context.js:46` | `node /tmp/claude-0/p11attack-r7/risk7.js`; `node -e "K=require('./services/ppm/projectKpis');console.log(K.riskScore([{status:'open',kind:'risk',probability:3,impact:3,residual_probability:1,residual_impact:1}]),K.riskScore([{status:'open',kind:'risk',probability:null,impact:3}]))"` → `9 0` | inherent 9 / residual 1 → risk component not red (or explicitly labelled "inherent"); P null → risk_score null (component null, never green); guard test also scans `red_enter`/`amber_enter` on `risk_score` | Medium: project RAG colours change once residual is used (PROPOSED thresholds, PMO) | Feed the RAG from `riskExposure.effective` (level → score), keep `null` when no open risk has a known score, extend the guard test; PMO records residual vs inherent for the RAG (G-PMO). Default-off switch `ppm_project_rag_enabled`. |
| F-30 | P3 (new) | Project card shows "active risks 0 · high 1" (high counts issues, active does not); `riskScore`, `top_risks`, `raid.review_overdue` still read `status === 'open'` strictly | `services/ppm/projectKpis.js:83,85,105,115`, `services/ppm/raid.js:60` | `risk7.js` cases `issue_only_high`, `risk_status_Open_upper` | high ⊆ active on the card; legacy `'Open'` row treated the same by all four | None | Count active with `RE.isOpen && RE.inScope` (risk + issue) or label the card "risks + issues"; use `RE.isOpen` in the three strict filters. |
| F-31 | P3 (new) | Vue Groupe overall cap exists for the open-overdue band only: a helpdesk cell red on its closed band (20/20 missed) leaves the site overall green; a 1-ticket closed base gives a green cell | `services/siteAwarenessFleet.js` (`rollupRag`), `services/siteHelpdeskSla.js` (`fleetCell`) | `node /tmp/claude-0/p11attack-r7/fleet7.js` cases B, C | B → overall not green (or explicit rule recorded); C → `na`/"partial" below a minimum closed base | None (display) | KPI Committee (G06) decides: cap on any red helpdesk band, and a minimum closed base; until then say it in the tooltip. |
| F-32 | P3 (new, shared with audit) | After a restore onto a server with a different `SDP_CONFIG_KEY`, every anchored ledger verifies `broken` "forged or altered anchor"; with no key it verifies `ok` despite signed anchors; the rehearsal never exercises anchors | `services/auditChain.js` (`chooseAnchor` / `verify`), `tools/pg/restore-rehearsal.js`, `docs/DB_RECOVERY.md` | `node /tmp/claude-0/p11attack-r7/anchor7.js` (seed with key k1, dump/restore, verify with k1 / none / k2) | rehearsal records an anchor and verifies after restore (same key ok; other key → a distinct "key mismatch / unverifiable" status, not "forged") | None | Distinguish "signature does not match this key" (unverifiable, key mismatch) from forgery; say "signed anchors present, no key: unverifiable" instead of `ok`; add the key/anchor step to DB_RECOVERY and the rehearsal. |
| F-25 | P3 (residual) | Detector still re-runs a split-literal `EXECUTE 'DR' || 'OP …'` and sequence/identity `RESTART` on change | `db/migrate.js` (`destructiveDdl`) | `node /tmp/claude-0/p11attack-r7/ddl7.js` | those → `rerunOnChange=false` | None | Optional: treat `RESTART` as destructive; ignore the split-literal case. |
| F-11, F-12, F-13, F-15, F-06, F-08 | P3 | carried, unchanged | see r4–r6 | — | — | — | — |

Observations (not graded): **O-2** remains partial (owner can still disable the TRUNCATE trigger before hardening — by
design, audit seat). Migration 135 can be journalled as applied without its column on a hardened DB (NOTICE only;
documented).

**P0: 0. P1: 0.** P2: **1** (F-29, remainder of F-27, default-off PPM switch). P3: 10 (F-30, F-31, F-32 new; F-25
residual; 6 carried). Fixed this round: **F-26, F-27 (named surfaces), F-28, F-25 (all r6 variants), O-1.**

## 5. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L09 KPI trust (display-only) | **GO PILOT (technically)**, committee switches stay dark | F-26 fixed on the live Vue Groupe path; parity/KPI 137/137, sweep/map/lineage exit 0. F-31 is a band/cap policy question for G06, disclosed in FORMULA-REFERENCE. No figure is official before G06. |
| L05 Time, money and benefits | **NO-GO for pilot** (technically CONDITIONAL) | Finance gate G14 empty; PG16 only. |
| L13 Operations resilience (restore, sync drift) | **CONDITIONAL** | Rehearsal all PASS (PG16, 1 000 rows, 115 migrations, 228 tables). Needs PG17, production volume, RPO/RTO by humans (G05); add the anchor step (F-32) before relying on the audit verdict after a DR restore. |
| L14 Portfolio Lots 1–5 | **CONDITIONAL → close to GO PILOT** | Register/alerts/card/gate/deck share `isHigh`. Keep `ppm_project_rag_enabled` off until **F-29** is fixed or the PMO labels the RAG risk input "inherent"; F-30 cosmetic. PROPOSED DQ / risk mapping rules need PMO approval. |
| L15 Adoption Lot B | **GO PILOT (technically)** | "Worst sites" now inherits the open-overdue cap; coverage shown. F-31 to G06. |
| L16 Portfolio Lot 6 | **CONDITIONAL → close to GO PILOT** | Partial cells and rollups give no verdict; capacity thresholds and effort weights PROPOSED (PMO). |
| Group IT deck (not a lot) | **CONDITIONAL** | F-13, F-15 open; no official figure before G06. |
| Source reconciliation evidence | **GO for use as evidence tooling** (tool only) | Unchanged; a reconciliation sheet needs the data owner's export and sign-off (G12). |
| Committee-policy switches | **Keep dark** | Need adopted D-01/02/03. |

"GO PILOT (technically)" means no blocking technical defect found by this seat; it is not an approval and does not
replace the empty human gates below.

## 6. Human gates still empty in this area

Checked in `docs/agent-execution/gate-dossiers/en/G0x-*.md` at 7ea49070: each says "Decision cell in RELEASE-GATES.md |
empty — this gate is **NO-GO** until the approver fills it".

- G03 CAB — dependency upgrade and PostgreSQL-only cutover (PG17)
- G05 Backup and restore RPO/RTO — CAB + SRE
- G06 KPI definitions, thresholds and score (D-01/02/03; `helpdesk_sla_definition`; `helpdesk-fleet-sla` bands and cap, F-31) — KPI Committee
- G09 Dashboard and tracker reviewers (portfolio dashboard definitions)
- G12 Data owner — anonymised data and 2026 history — Data owners
- G14 Finance — budgets and benefits — Finance
- G19 QA — CI green on the target SHA, skipped tests reviewed
- G20 Capacity — load / soak

PMO decisions on the PROPOSED portfolio rules (DQ set and bands, unfunded / stalled rules, risk level mapping, residual
vs inherent for the **project RAG** (F-29), capacity thresholds, effort weights, `ppm_rag_thresholds`) are pending and not
filled by this seat.

No gate filled and no decision taken by this seat. AI review — not an independent human review.
