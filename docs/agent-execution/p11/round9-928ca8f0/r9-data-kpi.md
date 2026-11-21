# P11 seat data-kpi — ROUND 9 (re-check) findings

**AI review — not an independent human review.** Seat: data-kpi (PostgreSQL migrations, KPI formulas, null vs 0,
figure parity, source reconciliation, lineage, restore). The reviewer did not write this code. Earlier round files
(`data-kpi.md`, `r2`–`r8-data-kpi.md`) were read and left unchanged.

- Frozen SHA: `928ca8f03c0680acfb2b3eb0c871ba286934c8dd` (`git rev-parse HEAD` in `/home/user/qual/data-kpi`). Fixes
  34–36 + the soft-delete version reader reviewed via `git log` / `git diff 7afb9536..928ca8f0`. `docs/agent-execution/`
  narratives not read (deleted in the clone); only `gate-dossiers/` read.
- Test cluster: **PostgreSQL 16.15** (was down at start; `service postgresql start`). **PG17 target still not verified.**
- No product code modified. Throwaway artefacts: `/tmp/claude-0/p11attack-r9/` (`kidmeta9.js`, `dc/`, `e1.out`,
  `e3.out`, `sweep.out`, `reh.out`, `reh/`). R7/R8 repros re-run in place from `/tmp/claude-0/p11attack-r7/` and
  `/tmp/claude-0/p11attack-r8/`. (Other files in `p11attack-r9/` — `cnt*`, `e2e`, `uxf`, `gd.txt`, `m0.json`,
  `tests` — are not this seat's.)
- `SDP_TEST_RUN_ID=datakpir9` on every test run. DB created by this seat: `r9_dk` (dropped). `pg_database` shows no
  `%r9_dk%` / `%datakpir9%` leftover. `drop-test-dbs.js` not run.

## 1. Round-8 findings re-verified at 928ca8f0

| R8 id | Sev | Status | Evidence |
|---|---|---|---|
| **R8-1** project RAG risk reads amber 6 beside an unscored sibling, no partial flag | P3 | **PARTIAL** | `riskExposure.projectScoreDetail([P2×I3 open, Pnull×I3 open])` → `{"score":6,"partial":true,"unknown":1}`; `computeRag({…risk_score:6, risk_score_partial:true})` → component `{"rag":"amber","partial":true}`. Below high + unknown → `score null, partial true`; critical + unknown → 9, not partial (correct: cannot be exceeded). **But the project card drops it**: `projectKpis.projectSummary` exposes `rag: rag ? rag.rag : null` (string only, `services/ppm/projectKpis.js:106`) and `public/lib/ppmGovernanceW3.js:51` renders `RAGL(c.rag)` → "AMBER" with no partial marker. `grep -rn risk_score public` → 0 hits. The flag reaches the API component, not the screen → R9-1. |
| **R8-2** `projectScore` 0 for assumptions-only / deleted-only list | P3 | **FIXED** | assumptions-only → `null`; deleted-only → `null`; empty → `null`; one closed in-scope risk → `0`. |
| **R8-3** `raid.exposureTotals` strict `'open'` | P3 | **FIXED** | `exposureTotals([view 'Open', view 'open'])` → `[{"currency":"USD","exposure_amount":1000,"entries":2}]` (r8: 500 / 1). Now uses `riskExposure.isOpen`. |
| **R8-4** forged anchor with invented kid read as rotation and auto-resumed | P3 | **FIXED as reproduced; bypass found** | Fresh `r9_dk` (118 migrations), 20 ledger rows + 12 anchors signed with k1 (`audit_chain_meta` gets `kid:02ecf59c37046e07`). `kidforge8.js` → verify `unverifiable` "unknown key id … the job does NOT resume; investigate (possible forged anchor)"; `nightly()` throws, event `audit_chain_unverifiable`, verify after → still `unverifiable` (r8: healed to ok). `kidforge8b.js` (foreign kid + wrong head) → `broken`. **Bypass**: one extra `INSERT INTO audit_chain_meta (k,v) VALUES ('kid:deadbeefdeadbeef', …)` — a grant the app role keeps even after hardening (`tools/pg/harden-audit-grants.sql:113` `GRANT SELECT, INSERT ON audit_chain_meta`) — and the same forged anchor is again "key rotated … not forged", `nightly()` resumes (`audit_chain_key_rotated`, `audit_chain_anchor` with `from_kids:["deadbeefdeadbeef"]`), verify → **ok** (`kidmeta9.js`). → R9-2. Restore rehearsal still has 0 anchor steps (`grep -c anchor tools/pg/restore-rehearsal.js` → 0). |
| F-25 detector residual (`RESTART`) | P3 | NOT FIXED (residual) | `ddl7.js`: `alter_seq_restart`, `alter_table_identity_restart` → `rerunOnChange true`. New 139 classified `destr false writes false rerun true` (idempotent ALTER … DROP DEFAULT — harmless). |
| F-11 `kpiRag.rag('')`/`('—')` → RED | P3 | NOT FIXED | `RED RED NA`. |
| F-12 migrator advisory lock | P3 | NOT FIXED | `grep -c advisory db/migrate.js` → 0. |
| F-13 render.py CSAT donut `pct > 0` | P3 | NOT FIXED | `tools/exec-pptx/render.py` ~535-537 unchanged. |
| F-15 Group IT deck outside metric map/lineage | P3 | NOT FIXED | 0 `docs/ops/METRIC-*.md` mention `reportPayload`/`render.py`. |
| F-06 PG16 / small volume | P3 | NOT FIXED (env) | Rehearsal on 16.15, 1 238 rows. |
| F-08 fcr / KEEP_SERVER | P3 (committee) | unchanged | Not re-assessed. |

Round-8 summary: R8-2, R8-3 **FIXED**; R8-1 **PARTIAL** (API yes, screen no); R8-4 **FIXED for the round-8 repro,
bypassable** with an app-role-permitted meta insert; carried P3s unchanged.

## 2. Evidence re-run at 928ca8f0 (command · result)

Prefix: `SDP_TEST_RUN_ID=datakpir9 PG_TESTS_REQUIRED=1 PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit`.

| # | Evidence | Command | Result | Status |
|---|---|---|---|---|
| E1 | Migrations + rollback + truncation + CSAT-null + audit chain + r7/r8 audit-ops + restore-drill | `<prefix> tests/pg-migrate*.test.js tests/pg-finance-migrations-rollback.test.js tests/zoho-sync-truncation-*.test.js tests/zoho-sync-survey-truncation.test.js tests/exec-pptx-csat-null.test.js tests/ppm-rollback-scripts.test.js tests/audit-chain.test.js tests/audit-chain-r6.test.js tests/p11-r7-audit-ops.test.js tests/p11-r8-audit-ops.test.js tests/restore-drill.test.js` | **81/81 pass**, 0 skipped, 0 fail (3 min 18 s) | **VERIFIED (PG16)** |
| E2 | `db/migrate.js` on a fresh DB | `CREATE DATABASE r9_dk`; `PG_URL=…/r9_dk node db/migrate.js` ×2 | 1st `applied=118 already=0 changed=0`; 2nd `applied=0 already=118`; `schema_migrations` 118 = 118 forward files; `portfolio_risks.probability/impact` default empty, nullable (139 applied) | **VERIFIED (PG16)** |
| E3 | figure-parity + KPI suites (+ r5–r8 data/PPM fix tests) | `<prefix> tests/figure-parity-*.test.js tests/kpi-*.test.js tests/dashboard-figure-parity.test.js tests/site-awareness-sla-parity.test.js tests/report-payload-tracker-null.test.js tests/reporting-week-dst.test.js tests/p11-r5-data-fixes.test.js tests/p11-r6-data-fixes.test.js tests/p11-r7-data-fixes.test.js tests/p11-r7-ppm.smoke.test.js tests/p11-r8-data-ppm.test.js tests/p11-r8-data-ppm.smoke.test.js tests/adoption-lotb-home.test.js` | **158/158 pass**, 0 skipped (3 min 3 s) | **VERIFIED** |
| E4 | `node tools/kpi/unknown-sweep.js --check` | as written | exit 0, **unjustified 0** (caveat unchanged: `count_field` rule auto-justifies by field name) | **VERIFIED** |
| E5 | `node tools/agent/metric-map.js --check` | as written | "metric-widget map up to date", exit 0 | **VERIFIED** |
| E6 | Restore rehearsal | `node tools/pg/restore-rehearsal.js --rows 1000 --out /tmp/claude-0/p11attack-r9/reh` | exit 0 (31 s), **12/12 PASS**: migrate 118 + idempotent, ISO window, accents, UTC, chain verifies, append-only, **229 tables / 1 238 rows** equal, ticket md5, chain heads equal, broken dump refused, target unchanged | **VERIFIED (PG16, 1 000 rows)**. No RPO/RTO claim; no anchor step. |
| E7 | `node tools/agent/metric-lineage.js --check` (extra) | as written | up to date, exit 0 | **VERIFIED** |
| E8 | R7/R8 repros + new attacks (extra) | §1, §3 | reproduced | **VERIFIED** |

Counts: **verified 8 of 8.** Not verified: 0. Still not verified as a claim: PG17, production volume, RPO/RTO.

## 3. New break attempts (one per capability, preferring code changed by fixes 34–36)

**B1 — Migrations (139 new).** Claim: 139 drops the 2×2 defaults, additive, idempotent, rollback manual. E2 holds
(118/0; defaults gone, columns nullable — no `NOT NULL` from 018, so NULL inserts succeed). Rollback file restores
`DEFAULT 2` and documents the journal delete; after a DB-only rollback the RAID writer still writes NULL explicitly
(code passes `n.row.probability`), so rollback does not re-introduce the 2×2 through that path — safer, not a defect.
Observation: existing 2×2 rows stay indistinguishable from real scores; correctly handed to the PMO/data owner, not
silently converted. **Holds.**

**B2 — Restore / counts binding (fix 36 O-13).** Claim: the drill uses a counts file only when it belongs to this dump
(name, sha256, size). Attack (`dc/`, `backup.dumpCountsFor`): bound file → accepted; dump content swapped (same size)
→ ignored "another sha256"; **sha fields stripped → accepted `unbound:true`**; **name AND sha stripped → still accepted
`unbound:true`** (`if (j.dump && j.dump !== name)` skips the check when `dump` is absent) while the drill note says
"only its dump name was checked". Every writer since fix 36 records the sha, so only a hand-edited / legacy file
reaches this path, and a note is printed → **R9-3 (P3)**. `prune()` removes counts sidecars with their dump; offsite
copy carries it (holds).

**B3 — Figure parity / Vue Groupe `min_closed` (fix 35).** Claim: the visible rule quotes the same minimum the cell
uses. `routes/siteAwareness.js:525` and `services/siteHelpdeskSla.js:51` both read
`kpiRag.POLICIES['helpdesk-fleet-sla'].min_closed` (5, PROPOSED). E3 parity suites 158/158. **Holds** (theoretical
divergence only if the policy value were invalid: cell falls back to 1, route returns null and the text is omitted).

**B4 — Lineage / one risk rule (fix 34 R8-1/R8-2).** Claim: a known high beside an unscored sibling is "partial
(at least)". Holds in `projectScoreDetail` and in the RAG component, but the summary card and project page show
"AMBER" alone (see §1 R8-1) → **R9-1 (P3)**. Default-off switch `ppm_project_rag_enabled`.

**B5 — Exposure totals (fix 34 R8-3).** Attack: mixed-case statuses → now totalled (1000/2). Side note (pre-existing,
business question, not new): `exposureTotals` does not apply `inScope`, so an open **assumption** carrying an amount
is summed into the money exposure while it is excluded from the risk score. Raised for the PMO; not classified.

**B6 — Audit anchors with key id (fix 36 R8-4/O-11).** See §1: round-8 forgery now refused; adding the kid to
`audit_chain_meta` (app role keeps INSERT after hardening) restores the auto-heal → **R9-2 (P3, shared with audit)**.
Content still constrains the chain (`kidforge8b` → broken), so no ledger history can be hidden; events are logged.

## 4. Findings at 928ca8f0

| ID | Sev | Title | Where | Reproduction | Regression test to add | Rollback risk | Recommendation |
|---|---|---|---|---|---|---|---|
| R9-1 | P3 (residual of R8-1) | `risk.partial` computed but not shown: project card/page reads "AMBER" without "at least / partial" | `services/ppm/projectKpis.js:106` (`rag: rag.rag`), `public/lib/ppmGovernanceW3.js:51` | `node -e "const RE=require('./services/ppm/riskExposure');console.log(RE.projectScoreDetail([{kind:'risk',status:'open',probability:2,impact:3},{kind:'risk',status:'open',probability:null,impact:3}]))"` → partial true; summary card carries only the string | summary payload carries `rag_partial` and the page renders a marker | None (switch default off) | Pass `rag.components.risk.partial` into `cards` and render it. |
| R9-2 | P3 (bypass of R8-4 fix; shared with audit seat) | Unknown-kid gate trusts `audit_chain_meta`, which the app role may INSERT even when hardened: forged anchor + meta row → "rotation", nightly resumes, verify ok | `services/auditChain.js` `anchorHistory` (knownKids), `tools/pg/harden-audit-grants.sql:113` | On a migrated DB with k1 anchors: `node /tmp/claude-0/p11attack-r8/kidforge8.js <url>` then `SDP_CONFIG_KEY=<k1> node /tmp/claude-0/p11attack-r9/kidmeta9.js <url>` | meta `kid:` row inserted outside the job → still "unknown key id", no resume | Low | Authenticate the kid record (e.g. HMAC of `kid:<kid>` under that key, or under the current key at rotation time), or restrict meta INSERT to the audit owner; or refuse resume when valid current-kid anchors precede the foreign row. Add an anchor step to the rehearsal. |
| R9-3 | P3 (new, fix 36) | Counts file with no `dump` name and no sha accepted as "unbound"; note claims the name was checked | `services/backup.js` `dumpCountsFor` | `dc/` script: `{counts:{…}}` only → `unbound:true, problem:null` | nameless counts file → ignored (or note says "nothing checked") | None | Require `dump` to equal the file name when no sha is present. |
| F-25 | P3 (residual) | `RESTART` / split literal re-run on change | `db/migrate.js` | `ddl7.js` | — | — | optional |
| F-11, F-12, F-13, F-15, F-06, F-08 | P3 | carried, unchanged | see r4–r8 | — | — | — | — |

**P0: 0. P1: 0. P2: 0.** P3: 10 (R9-1, R9-2, R9-3; F-25 residual; 6 carried).
Fixed this round: **R8-2, R8-3** (FIXED), **R8-4** (repro fixed, bypass R9-2), **R8-1** (API fixed, UI residual R9-1).
No regression found in the parity, KPI, migration or restore evidence introduced by fixes 34–36.

## 5. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L09 KPI trust (display-only) | **GO PILOT (technically)**, committee switches stay dark | Parity/KPI 158/158; sweep/map/lineage exit 0; `min_closed` now one source. Bands/min_closed PROPOSED → G06. No figure official before G06. |
| L05 Time, money and benefits | **NO-GO for pilot** (technically CONDITIONAL) | Finance gate G14 empty; PG16 only. R8-3 money residual fixed; assumption-amount scope question for PMO. |
| L13 Operations resilience (restore, sync drift) | **CONDITIONAL** | Rehearsal 12/12 PASS (PG16, 1 000 rows, 118 migrations, 229 tables); counts bound to dump by sha (R9-3 cosmetic). Needs PG17, production volume, RPO/RTO (G05); R9-2 anchor resume rule; no anchor step in rehearsal. |
| L14 Portfolio Lots 1–5 | **GO PILOT (technically)** with `ppm_project_rag_enabled` left to PMO | Unscored = NULL end-to-end (migration 139, writer, readers); one risk rule; R9-1 cosmetic while the switch is off. PROPOSED mapping/bands need PMO. |
| L15 Adoption Lot B | **GO PILOT (technically)** | Inherits the Vue Groupe cell; min_closed text from policy. |
| L16 Portfolio Lot 6 | **CONDITIONAL → close to GO PILOT** | Thresholds/weights PROPOSED (PMO); not re-attacked beyond risk input. |
| Group IT deck (not a lot) | **CONDITIONAL** | F-13, F-15 open; no official figure before G06. |
| Source reconciliation evidence | **GO for use as evidence tooling** (tool only) | Unchanged; needs data owner export + sign-off (G12). |
| Committee-policy switches | **Keep dark** | Need adopted D-01/02/03. |

"GO PILOT (technically)" means no blocking technical defect found by this seat; it is not an approval and does not
replace the empty human gates below.

## 6. Human gates still empty in this area

Checked in `docs/agent-execution/gate-dossiers/en/G0x-*.md` / `G1x-*.md` / `G2x-*.md` at 928ca8f0: each reads
"Decision cell in RELEASE-GATES.md | empty — this gate is **NO-GO** until the approver fills it".

- G03 CAB — dependency upgrade and PostgreSQL-only cutover (PG17)
- G05 Backup and restore RPO/RTO — CAB + SRE
- G06 KPI definitions, thresholds and score (D-01/02/03; `helpdesk-fleet-sla` bands, cap, `min_closed` 5) — KPI Committee
- G09 Dashboard and tracker reviewers
- G12 Data owner — anonymised data and 2026 history (incl. what to do with legacy 2×2 risk rows)
- G14 Finance — budgets and benefits
- G19 QA — CI green on the target SHA, skipped tests reviewed
- G20 Capacity — load / soak

PMO decisions pending (not filled): PROPOSED risk level mapping and derived project RAG bands, "partial" rule for a
known high beside an unscored sibling, `ppm_project_rag_enabled`, legacy 2×2 rows, assumption amounts in exposure
totals, DQ set, capacity thresholds, effort weights, `ppm_rag_thresholds`.

No gate filled and no decision taken by this seat. AI review — not an independent human review.
