# P11 seat data-kpi — ROUND 8 (re-check) findings

**AI review — not an independent human review.** Seat: data-kpi (PostgreSQL migrations, KPI formulas, null vs 0,
figure parity, source reconciliation, lineage, restore). The reviewer did not write this code. Earlier round files
(`data-kpi.md`, `r2`–`r7-data-kpi.md`) were read and left unchanged.

- Frozen SHA: `7afb9536ae3e38273aeff47307a78c49637dbd94` (`git rev-parse HEAD` in `/home/user/qual/data-kpi`). Fixes 30–33
  reviewed via `git log 7ea49070..7afb9536`. `docs/agent-execution/` narratives not read (deleted in the clone); only
  `gate-dossiers/` read.
- Test cluster: **PostgreSQL 16.15** (was down; `service postgresql start`). **PG17 target still not verified.**
- No product code modified. Throwaway artefacts: `/tmp/claude-0/p11attack-r8/` (`kidforge8.js`, `kidforge8b.js`,
  `snap8.js`, `e1.out`, `e3.out`, `sweep.out`, `reh.out`, `reh/`). R7 repros in `/tmp/claude-0/p11attack-r7/` re-run in place.
- `SDP_TEST_RUN_ID=datakpir8` on every test run. DBs created by this seat: `r8_dk`, `r8_dk_rest` (both dropped;
  `r8_dk_snap` created and dropped inside `snap8.js`). `pg_database` shows no `r8_dk%` / `%datakpir8%` leftover.
  `drop-test-dbs.js` not run.

## 1. Round-7 findings re-verified at 7afb9536

| R7 id | Sev | Status | Evidence |
|---|---|---|---|
| **F-29** project RAG risk input inherent-only, unscored → 0 | P2 | **FIXED** | `projectKpis.riskScore` now delegates to `riskExposure.projectScore` (residual first). Re-ran r7 repro: `riskScore([P3×I3, residual P1×I1])` → **1** (r7: 9); `riskScore([P null, I3])` → **null** (r7: 0); `[]` → null. RAG bands now derived from the one mapping (`RAG_THRESHOLDS`: red > 8, amber > 5 from `SCORE_MIN`), no second literal. `node /tmp/claude-0/p11attack-r7/risk7.js`: residual-low case `riskScore 1`. Residuals → R8-1, R8-2 (P3). |
| F-30 card active vs high; strict `'open'` filters | P3 | **FIXED (named surfaces), residual** | `risk7.js`: `issue_only_high` → `active_risks 1 high_risks 1` (r7: 0 · 1); `risk_status_Open_upper` → top_risks 1, riskScore 9. `top_risks`, `riskScore`, `raid.review_overdue` use `RE.isOpen`. One strict filter remains: `raid.exposureTotals` (`services/ppm/raid.js:72`) → R8-3. |
| F-31 Vue Groupe cap only from open band; 1-ticket base green | P3 | **FIXED** | `node /tmp/claude-0/p11attack-r7/fleet7.js`: B (20/20 closed missed) → cell red, `cap red`, **overall red** (r7: green); C (1 closed) → `na`, `insufficient:true, min_closed:5` (r7: green 0/1); A still red; D `na`; E green. `min_closed: 5` marked PROPOSED in `kpiRag.js:56`; `routes/siteAwareness.js` forwards `cap` / `insufficient`. |
| F-32 anchors after restore with other / no key | P3 | **FIXED (verdicts + docs); rehearsal residual** | Re-built r7 scenario on fresh `r8_dk` (117 migrations incl. 137/138): seed 20 rows + 12 signed anchors with key k1, `pg_dump -Fc` → `pg_restore` into `r8_dk_rest`, `anchor7.js` verify: same key → `ok`; **no key → `unverifiable`** "signed anchors are present but SDP_CONFIG_KEY is not set" (r7: ok); **other key → `unverifiable` "key rotated … not forged"** (r7: broken/forged). `DB_RECOVERY.md:54-56` now describes it. `tools/pg/restore-rehearsal.js` still has 0 anchor steps (grep) → carried in R8-4. |
| F-25 detector residual (split literal, `RESTART`) | P3 | NOT FIXED (residual) | `ddl7.js`: `alter_seq_restart`, `alter_table_identity_restart` → `rerunOnChange true`. No current file affected. |
| F-11 `kpiRag.rag('')`/`('—')` → RED | P3 | NOT FIXED | `rag('', 'tracker-activity')` → `RED`, `'—'` → `RED`, null → `NA`. |
| F-12 migrator advisory lock | P3 | NOT FIXED | `grep -c advisory db/migrate.js` → 0. |
| F-13 render.py CSAT donut `pct > 0` | P3 | NOT FIXED | `tools/exec-pptx/render.py:535-537` unchanged. |
| F-15 Group IT deck outside metric map/lineage | P3 | NOT FIXED | 0 `docs/ops/METRIC-*.md` mention `reportPayload`/`render.py`. |
| F-06 PG16 / small volume | P3 | NOT FIXED (env) | Rehearsal on 16.15, 1 237 rows. |
| F-08 fcr / KEEP_SERVER | P3 (committee) | unchanged | Not re-assessed. |

Round-7 P2: **F-29 FIXED.** Round-7 P3s: F-31, F-32 fixed; F-30 fixed with one residual; F-25/11/12/13/15/06/08 carried.

## 2. Evidence re-run at 7afb9536 (command · result)

Prefix: `SDP_TEST_RUN_ID=datakpir8 PG_TESTS_REQUIRED=1 PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit`.

| # | Evidence | Command | Result | Status |
|---|---|---|---|---|
| E1 | Migration + rollback + truncation + CSAT-null + audit-chain (+ r6/r7 audit fix tests) | `<prefix> tests/pg-migrate*.test.js tests/pg-finance-migrations-rollback.test.js tests/zoho-sync-truncation-*.test.js tests/zoho-sync-survey-truncation.test.js tests/exec-pptx-csat-null.test.js tests/ppm-rollback-scripts.test.js tests/audit-chain.test.js tests/audit-chain-r6.test.js tests/p11-r7-audit-ops.test.js` | **67/67 pass**, 0 skipped, 0 fail (129 s) | **VERIFIED (PG16)** |
| E2 | `db/migrate.js` on a fresh DB | `CREATE DATABASE r8_dk`; `PG_URL=…/r8_dk node db/migrate.js` ×2 | 1st `applied=117 already=0 changed=0`; 2nd `applied=0 already=117`; `schema_migrations` = 117 = forward files on disk | **VERIFIED (PG16)** |
| E3 | figure-parity + KPI suites (+ r5/r6/r7 data fix tests, r7 PPM smoke) | `<prefix> tests/figure-parity-*.test.js tests/kpi-*.test.js tests/dashboard-figure-parity.test.js tests/site-awareness-sla-parity.test.js tests/report-payload-tracker-null.test.js tests/reporting-week-dst.test.js tests/p11-r5-data-fixes.test.js tests/p11-r6-data-fixes.test.js tests/p11-r7-data-fixes.test.js tests/p11-r7-ppm.smoke.test.js tests/adoption-lotb-home.test.js` | **147/147 pass**, 0 skipped (59 s) | **VERIFIED** |
| E4 | `node tools/kpi/unknown-sweep.js --check` | as written | exit 0, **unjustified 0** (caveat unchanged: `count_field` rule auto-justifies by field name) | **VERIFIED** |
| E5 | `node tools/agent/metric-map.js --check` | as written | "metric-widget map up to date", exit 0 | **VERIFIED** |
| E6 | Restore rehearsal | `node tools/pg/restore-rehearsal.js --rows 1000 --out /tmp/claude-0/p11attack-r8/reh` | exit 0 (38 s), **all 12 checks PASS**: migrate 117 + idempotent, ISO window, accents, UTC, chain verifies, append-only, **229 tables / 1 237 rows** equal, ticket md5, chain heads equal, broken dump refused, target unchanged | **VERIFIED (PG16, 1 000 rows)**. No RPO/RTO claim. No anchor step (R8-4). |
| E7 | `node tools/agent/metric-lineage.js --check` (extra) | as written | up to date, exit 0 | **VERIFIED** |
| E8 | R7 repros + new attacks (extra) | §1, §3 | reproduced | **VERIFIED** |

Counts: **verified 8 of 8.** Not verified: 0. Still not verified as a claim: PG17, production volume, RPO/RTO.

## 3. New break attempts (one per capability, preferring code changed by fixes 30–33)

**B1 — Migrations (137/138 new).** Claim: fresh DB applies all, second run applies nothing. E2: 117/0 — holds.
Detector residual unchanged (F-25).

**B2 — Restore / dump snapshot (fix 33 O-7).** Claim: the drill compares the restored copy with counts taken in the
dump's own snapshot. Attack `snap8.js`: `backup.openDumpSnapshot` on `r8_dk` (counts governance_policy_history = 20),
INSERT one row after the snapshot (live = 21), `pg_dump -Fc --snapshot=<id>`, restore into a fresh DB → **20**.
Outcome: **holds** (dump and sidecar agree; a naive live count would have reported a false mismatch).
Observation (ops seat, pre-existing): `tools/pg/dump-db.js` keeps a 300 s `spawnSync` timeout while `backup.js` allows
30 min — a production-volume dump over 5 min would fail; not exercised (no production volume).

**B3 — Figure parity / Vue Groupe cap (fix 30 F-31, live path).** Claim: "the cell's own red/amber caps the site
overall, whichever band produced it". `fleet7.js` A–E (§1) → holds. Extra: 4 closed all missed, 0 open overdue → `na`
(below `min_closed` 5, value "4/4" shown with `insufficient`). That is the PROPOSED trade-off, disclosed; G06 owns it.

**B4 — Lineage / one risk rule (fix 30 F-29/F-30).** Claim (`riskExposure.projectScore` comment): "null when an
unknown-score entry sits beside known entries that are not high / critical (it could be worse) … a known high /
critical is never hidden by an unknown sibling". Attack:
`projectScore([{open, P2×I3}, {open, P null, I3}])` → **6 → amber**, with no partial marker. The unknown sibling could
be 9 (critical → red); the RAG risk component reads a confident amber. Assumption-only register → **0 (green)**; a
register of only soft-deleted rows passed in → 0. Outcome: claim holds for its literal wording (a known high is not
hidden) but the component can understate (amber where red is possible) without saying so → **R8-1 (P3)**; empty-vs-0
edge → **R8-2 (P3)**. Behind `ppm_project_rag_enabled` (default off).

**B5 — Case-insensitive open filters (fix 30 F-30).** Claim: open filters case-insensitive everywhere. Attack:
`raid.exposureTotals([view(status 'Open', 1000 USD × 50 %), view(status 'open', same)])` →
`[{"currency":"USD","exposure_amount":500,"entries":1}]` — the legacy `'Open'` row is counted as an active risk on the
card but dropped from the money exposure total. Writers normalise to `open|closed`, so legacy/imported rows only →
**R8-3 (P3)**.

**B6 — Audit anchors with key id (fix 33 F-32/O-8, restore capability).** Attack `kidforge8.js` on `r8_dk` (key k1,
current kid valid anchors present): INSERT an anchor row with the same head/last_id, a garbage `sig`, and an invented
`kid = deadbeefdeadbeef`. `verify` → `unverifiable` "key rotated … **not forged**"; `nightly()` then auto-resumes:
events `audit_chain_key_rotated`, `audit_chain_anchor`; next `verify` → **ok**. A forged anchor is therefore reported
as a key rotation and silently healed after one nightly run (risk-1 event only), although the current key never
changed and valid current-kid rows precede the "foreign" row (a pattern a real rotation does not produce).
Counter-check `kidforge8b.js`: a foreign-kid anchor with a **wrong head** → `broken` ("anchored row #20 no longer …"),
so content still constrains the chain. Outcome: **no history can be hidden** (valid anchors remain, content constrains),
but forgery attempts are downgraded to "rotation" and auto-accepted → **R8-4 (P3, shared with audit seat)**.

## 4. Findings at 7afb9536

| ID | Sev | Title | Where | Reproduction | Regression test to add | Rollback risk | Recommendation |
|---|---|---|---|---|---|---|---|
| R8-1 | P3 (new) | Project RAG risk component reads a known amber (score 6) when an unscored open sibling could be critical; no partial flag (unlike `rollup()`'s `level_at_least`/`partial`) | `services/ppm/riskExposure.js:53-62` (`projectScore`) | `node -e "RE=require('./services/ppm/riskExposure');console.log(RE.projectScore([{kind:'risk',status:'open',probability:2,impact:3},{kind:'risk',status:'open',probability:null,impact:3}]))"` → 6 | unknown sibling + known high → score kept but `partial:true` surfaced in the RAG risk component (or null below critical) | None (default-off switch) | Return/propagate a `partial` marker like `rollup()`; PMO decides (G-PMO). |
| R8-2 | P3 (new) | `projectScore` returns 0 (green) when the passed list holds only assumptions (or rows the caller did not filter for `deleted_at`), but null for an empty list | `riskExposure.js:55` (`(risks||[]).length ? 0 : null`) | `projectScore([{kind:'assumption',status:'open',probability:3,impact:3}])` → 0 | 0 only when at least one in-scope (risk/issue, not deleted) row exists and none is open | None | Count in-scope, non-deleted rows for the 0 branch. |
| R8-3 | P3 (residual of F-30) | `raid.exposureTotals` still filters `status !== 'open'` strictly: legacy `'Open'` rows counted on the card but dropped from money exposure | `services/ppm/raid.js:72` | B5 snippet → 500 instead of 1000 | legacy `'Open'` row included in the total | None | Use `riskExposure.isOpen(it)`. |
| R8-4 | P3 (new, shared with audit) | Anchor with an invented kid is classified "key rotated, not forged" and auto-resumed by the nightly job even though the current kid is unchanged and already present before it; restore rehearsal still has no anchor step | `services/auditChain.js` (`chooseAnchor`, `nightly` resume), `tools/pg/restore-rehearsal.js` | `SDP_CONFIG_KEY=k1… node /tmp/claude-0/p11attack-r8/kidforge8.js <migrated db with k1 anchors>` | foreign-kid row AFTER valid current-kid rows → "unverifiable (unexpected foreign kid)" requiring an operator acknowledgment, no auto-resume; rehearsal records + verifies an anchor across the restore | Low | Auto-resume only when NO current-kid row exists before the foreign rows (the restore/rotation shape); otherwise alert. Add the anchor step to the rehearsal. |
| F-25 | P3 (residual) | `RESTART` / split literal re-run on change | `db/migrate.js` | `ddl7.js` | — | — | optional |
| F-11, F-12, F-13, F-15, F-06, F-08 | P3 | carried, unchanged | see r4–r7 | — | — | — | — |

**P0: 0. P1: 0. P2: 0.** P3: 11 (R8-1, R8-2, R8-3, R8-4 new; F-25 residual; 6 carried).
Fixed this round: **F-29 (P2), F-31, F-32 (verdicts/docs), F-30 (named surfaces).** No regression found in the parity,
KPI, migration or restore evidence introduced by fixes 30–33.

## 5. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L09 KPI trust (display-only) | **GO PILOT (technically)**, committee switches stay dark | Parity/KPI 147/147; sweep/map/lineage exit 0; Vue Groupe cap from either band + min closed base fixed (F-31). Bands/min_closed PROPOSED → G06. No figure official before G06. |
| L05 Time, money and benefits | **NO-GO for pilot** (technically CONDITIONAL) | Finance gate G14 empty; PG16 only; R8-3 money total residual on legacy rows. |
| L13 Operations resilience (restore, sync drift) | **CONDITIONAL** | Rehearsal 12/12 PASS (PG16, 1 000 rows, 117 migrations, 229 tables); dump snapshot counts proven (B2); anchor verdicts after restore now honest. Needs PG17, production volume, RPO/RTO (G05); R8-4 anchor step and auto-resume rule. |
| L14 Portfolio Lots 1–5 | **GO PILOT (technically)** with `ppm_project_rag_enabled` decision left to PMO | F-29 fixed: project RAG risk input residual-first, unscored = UNKNOWN; one rule across card/register/gate/deck/RAG. R8-1/R8-2/R8-3 cosmetic P3. PROPOSED risk mapping/bands need PMO. |
| L15 Adoption Lot B | **GO PILOT (technically)** | Inherits the fixed Vue Groupe cell. |
| L16 Portfolio Lot 6 | **CONDITIONAL → close to GO PILOT** | Thresholds/weights PROPOSED (PMO); not re-attacked this round beyond risk input. |
| Group IT deck (not a lot) | **CONDITIONAL** | F-13, F-15 open; no official figure before G06. |
| Source reconciliation evidence | **GO for use as evidence tooling** (tool only) | Unchanged; needs data owner export + sign-off (G12). |
| Committee-policy switches | **Keep dark** | Need adopted D-01/02/03. |

"GO PILOT (technically)" means no blocking technical defect found by this seat; it is not an approval and does not
replace the empty human gates below.

## 6. Human gates still empty in this area

Checked in `docs/agent-execution/gate-dossiers/en/G0x-*.md` at 7afb9536: each reads "Decision cell in RELEASE-GATES.md |
empty — this gate is **NO-GO** until the approver fills it".

- G03 CAB — dependency upgrade and PostgreSQL-only cutover (PG17)
- G05 Backup and restore RPO/RTO — CAB + SRE
- G06 KPI definitions, thresholds and score (D-01/02/03; `helpdesk_sla_definition`; `helpdesk-fleet-sla` bands, cap and `min_closed` 5) — KPI Committee
- G09 Dashboard and tracker reviewers
- G12 Data owner — anonymised data and 2026 history
- G14 Finance — budgets and benefits
- G19 QA — CI green on the target SHA, skipped tests reviewed
- G20 Capacity — load / soak

PMO decisions pending (not filled): PROPOSED risk level mapping and the derived project RAG risk bands, residual-first
rule for the project RAG, `ppm_project_rag_enabled`, DQ set, capacity thresholds, effort weights, `ppm_rag_thresholds`.

No gate filled and no decision taken by this seat. AI review — not an independent human review.
