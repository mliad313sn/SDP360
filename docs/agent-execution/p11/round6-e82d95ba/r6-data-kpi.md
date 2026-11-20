# P11 seat data-kpi — ROUND 6 (confirmation) findings

**AI review — not an independent human review.** Seat: data-kpi (PostgreSQL migrations, KPI formulas, null vs 0,
figure parity, source reconciliation, lineage). The reviewer did not write this code. Earlier round files
(`data-kpi.md`, `r2`–`r5-data-kpi.md`) were read and left unchanged.

- Frozen SHA: `e82d95baf7fa4b554003d32f89e02d634216c1de` (`git rev-parse HEAD` in `/home/user/qual/data-kpi`). The
  `docs/agent-execution/` narratives were not read or fetched (they show as deleted in the clone, as intended).
- Test cluster: **PostgreSQL 16.15**, max_connections 400. **The PostgreSQL 17 target is still not verified.**
- No product code was modified. Throwaway artefacts: `/tmp/claude-0/p11attack-r6/` (`ddl.js`, `ddl6.js`, `drill.js`,
  `drill6.js`, `risk.js`, `risk6.js`, `fleet.js`, `f22.js`, `e1.out`, `e3.out`, `sweep.out`, `sweep.md`, `reh.out`, `reh/`).
  The r4/r5 repros `f02.js` and `wk5.js` were re-run in place.
- Throwaway DB `r6_dk` was created and dropped. The test files' own DBs are provisioned and dropped by `_pg-boot`.
  Note: the required run id `data-kpi-r6` contains hyphens, so `tests/pg-helpers.js:98` (`/^[a-z0-9]{1,16}$/`) silently
  ignores it and the DB names carry no run tag. This seat therefore cannot tell its leftovers (if any) from the other
  seats' and dropped none of the `sdp_tracker_test_*` DBs. `drop-test-dbs.js` was not run. (Observation O-1 below.)

## 1. Round-5 findings re-verified at e82d95ba (fix 19)

| R5 ID | Sev | Status | Evidence (reproduced by this seat) |
|---|---|---|---|
| **F-21** card / report count ≠ drill list | P2 | **FIXED** | `linkPatch` intersects list keys with the active filter; an empty intersection gives `drill: null` (no link) and count 0; counts are computed on `Object.assign(filters, drill)`. My r5 `drill.js` now reports card 0 with no link (the "2 rows" it prints is the script merging a null patch, not a page link). New `drill6.js`: 9 filter states × money on/off, every card and report → **178 links checked, 0 mismatches**. |
| **F-23** three "high risk" definitions (register / alerts / Lot 6) | P2 | **FIXED for the three named surfaces, PARTIAL for the claim** (→ F-27) | `risk.js`: risk P3×I3 residual P1×I1 → register `low`, Lot 6 `low`, register `high_risk` report empty; P/I null → `null` on both. `ppmAlerts.js:163` and `portfolioRegister.js:60` call `riskExposure.isHigh`. The header now claims "the ONE high-risk rule of the portfolio", but two more surfaces keep the inherent rule (F-27). |
| F-22 partial data as a verdict | P3 | **FIXED** | `f22.js`: demand cell with one unknown line → `NA`, `partial`, `unknown_lines 1`; known demand already over capacity → `RED` (certain). Risk rollup with an unknown sibling → `level null`, `level_at_least low`, `partial true`. `worstSites` with 1 green + 10 unmeasured → `measured 1, unmeasured 10`, rendered "no site in red or amber (1 measured · 10 not measured)". DQ card carries `scope` and the page renders the with/without budget-checks note. |
| F-24 site-view tooltip / fleet cell population | P3 | **FIXED as asked, but the fleet-cell change introduced F-26** | Tooltip now says the monthly dictionary figure counts the SDP flag only and the two agree only under that rule. Fleet cell now uses `siteHelpdeskSla.fleetCell` (closed, not cancelled, with an SLA rule) under the configured mode. The monthly reader is still flag-only (that is now disclosed, not hidden). |
| F-25 destructive-DDL detector | P3 | **PARTIAL** | `ddl.js`: single-quoted `EXECUTE 'DROP TABLE x'`, `DROP DOMAIN … CASCADE`, `DROP OWNED BY` → now `rerunOnChange=false`. `ddl6.js` (new): **dollar-quoted** `EXECUTE $q$DROP TABLE legacy_x$q$`, `EXECUTE concat('DROP', ' TABLE x')`, `DROP EXTENSION citext CASCADE` (drops the citext columns), `ALTER TYPE … DROP ATTRIBUTE … CASCADE`, `DROP FUNCTION … CASCADE` (drops generated columns that use it) → still `rerunOnChange=true`. No current file contains one; 131 (new, uses `EXECUTE $f$CREATE OR REPLACE FUNCTION …$f$`) classifies DDL-only and is idempotent. |
| F-11 `kpiRag.rag('')` / `('—')` → RED | P3 | NOT FIXED | Re-ran: `RED RED NA`. |
| F-12 migrator advisory lock | P3 | NOT FIXED | `grep -c advisory db/migrate.js` → 0. |
| F-13 render.py CSAT donut `pct > 0` | P3 | NOT FIXED | `tools/exec-pptx/render.py` still `pct = K.get('csat_pct', 0) or 0` / `if total > 0 and pct > 0`. |
| F-15 Group IT deck outside map / lineage | P3 | NOT FIXED | `reportPayload` / `render.py` appear 0 times in `docs/ops/METRIC-*.md`. |
| F-06 PG16 / small volume | P3 | NOT FIXED (env) | Rehearsal banner: 16.15, 1 230 rows. |
| F-08 fcr / KEEP_SERVER | P3 (committee) | unchanged | Not re-assessed. |
| R4 F-02 / F-19 (regression check) | — | still FIXED | `f02.js`: server fallback = engine (g1, avg 100). `wk5.js`: 0 mismatches, `prevWk(2029,1)` → 2028-W53. |

Round-5 P2s: **2 of 2 fixed** (F-21 fully; F-23 for its three named surfaces). Round-5 P3s: F-22, F-24 fixed; F-25 partial.

## 2. Evidence re-run at e82d95ba (command · result)

Prefix: `SDP_TEST_RUN_ID=data-kpi-r6 PG_TESTS_REQUIRED=1 PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit`.

| # | Evidence | Command | Result | Status |
|---|---|---|---|---|
| E1 | Migration + rollback + truncation + CSAT-null tests | `<prefix> tests/pg-migrate*.test.js tests/pg-finance-migrations-rollback.test.js tests/zoho-sync-truncation-*.test.js tests/zoho-sync-survey-truncation.test.js tests/exec-pptx-csat-null.test.js tests/ppm-rollback-scripts.test.js` | **43/43 pass**, 0 skipped, 0 fail (238 s) | **VERIFIED (PG16)** |
| E2 | `db/migrate.js` on a fresh DB | `PG_URL=…/r6_dk node db/migrate.js` ×2, then `--status` | 1st run `applied=111` (131 included: `audit_chain_anchors` + append-only trigger present); 2nd run `applied=0 already=111 changed=0`; 111 files on disk | **VERIFIED (PG16)** |
| E3 | figure-parity + KPI suites (+ r5 fix tests) | `<prefix> tests/figure-parity-*.test.js tests/kpi-*.test.js tests/dashboard-figure-parity.test.js tests/site-awareness-sla-parity.test.js tests/report-payload-tracker-null.test.js tests/reporting-week-dst.test.js tests/p11-r5-data-fixes.test.js tests/adoption-lotb-home.test.js` | **125/125 pass**, 0 skipped | **VERIFIED** |
| E4 | `node tools/kpi/unknown-sweep.js --check` | as written | **exit 0**, 443 hits (r5: 446), **unjustified 0**. Hits in the server files changed by fixes 19–24 (`siteAwareness`, `portfolioEvidence`, `portfolioRegister`, `resourceDemand`, `portfolioPhase2Store`, `auditChain`, `restoreDrill`, `inspection-db`) read in `--md`: tallies, parameters, row counts. No measure defaulted to 0. Caveat unchanged: the `count_field` rule auto-justifies by field name. | **VERIFIED** |
| E5 | `node tools/agent/metric-map.js --check` | as written | "metric-widget map up to date", exit 0 | **VERIFIED** (the Vue Groupe helpdesk cell is in FORMULA-REFERENCE §1, not a registry metric) |
| E6 | Restore rehearsal | `node tools/pg/restore-rehearsal.js --rows 1000 --out /tmp/claude-0/p11attack-r6/reh` | exit 0, all PASS: migrate 111 + idempotent, ISO window, accents, UTC (year only), 12 audit chains + append-only trigger, **227 tables / 1 230 rows** equal, ticket md5, chain heads equal, broken dump refused, target unchanged | **VERIFIED (PG16, 1 000 rows)**. No RPO/RTO claim. Gap: the rehearsal never records an anchor, so the fix-24 anchor comparison is not exercised by it (O-2). |
| E7 | `node tools/agent/metric-lineage.js --check` (extra) | as written | up to date, exit 0 | **VERIFIED** |
| E8 | R5 repros + new attacks (extra) | §1, §3 | reproduced | VERIFIED |

Counts: **verified 8 of 8** (E1–E8). Not verified: 0. Still not verified as a claim: PG17, production volume, RPO/RTO.

## 3. New break attempts (one per capability, on code changed by fixes 19–24)

**B1 — Migrations (detector extended in fix 19; new migration 131 from fix 24).** Claim (`db/migrate.js`
`destructiveDdl` doc): destructive DDL "also inside a quoted dynamic EXECUTE" is never re-executed. Attack (`ddl6.js`):
dollar-quoted `EXECUTE $q$DROP TABLE legacy_x$q$` → `destructive=false, rerunOnChange=true` (the token is `$Q$DROP`;
only `"`, `'` and `(` are turned into separators). Same for `concat('DROP', …)`, `DROP EXTENSION … CASCADE`,
`ALTER TYPE … DROP ATTRIBUTE`. Outcome: **partially broken** (hypothetical: no current file affected). Dollar-quoting is
the house style for dynamic SQL (131 uses `$f$…$f$`), so this is the most likely way the gap would be hit. → F-25 (P3, still partial).

**B2 — Sync integrity.** Covered by E1 (truncation tests incl. anchors). No new attack; the operations seat owns fixes 17/22.

**B3 — Figure parity (fix 19 F-21, card == drill).** Claim: "count == rows of the opened list, always". Attack
(`drill6.js`): all cards and standard reports under 9 filter states (incl. a list key already active, a report already
active, both) × money on/off → **0 of 178 mismatched. Claim holds.** A string-shaped filter (`priority:'low'`, not an
array) is not intersected, but the route parses through the URL schema, and count still equals the list.

**B4 — Null vs 0 / partial data (fix 19 F-24, Vue Groupe helpdesk cell, live path).** Claim (fleet cell, FORMULA-REFERENCE):
"same closed-only doctrine as the site view … nothing closed → na (never green)". Attack (`fleet.js`, the real
`_computeSiteHelpdesk` + `fleetCell`): 30-day window with 50 tickets created, **1 closed on time, 49 open of which 40 already
flagged overdue** → new cell **GREEN "0/1"**; the r5 rule gave RED 40/50. The site view shows `open_overdue` next to its
rate; the fleet cell drops it entirely, and it feeds `overall_rag`, the Lot B "Sites needing attention" ranking and the Δ
chips. A one-ticket base gives a confident green on a site drowning in overdue work. Outcome: **claim technically true,
verdict misleading; regression introduced by fix 19.** → **F-26 (P2)**.

**B5 — Lineage / one formula per figure (fix 19 F-23).** Claim (`riskExposure.js` header): "this file is the ONE 'high
risk' rule of the portfolio". Attack (`risk6.js` + grep): `services/ppm/projectKpis.js:82-83` (project page card
`high_risks`) and `services/governanceStore.js:536` (`gateCounts.openRisksHigh`, read by the stage gates) still use
inherent P×I ≥ 6, `kind = 'risk'` only, `Number(null)` → 0.
- risk P3×I3, residual P1×I1: register / alerts **not high**; project page card **high_risks 1**; stage gate counts **1**.
- risk P1×I1, residual P3×I3: register **high**; project page **0**; gate **0** (a gate passes on a risk the register flags).
- open issue P3×I3: register **high**; project page **0**; gate **0**.
Also `services/portfolioDeck.js:50` filters `status === 'open'` while `isOpen` is `status !== 'closed'`.
Outcome: **claim broken** (two more surfaces). → **F-27 (P2)**.

**B6 — Input domain behind the shared rule (fix 19 `isOpen` / `inScope`).** Attack: the generic writer
(`governanceStore.upsertPortfolio('risk', …)`, `POST /api/governance/portfolio/risk`) validates `kind` but stores `status`
as free text (up to 300 chars) — only the newer RAID writer restricts it to `open | closed`. `isOpen` is `status !== 'closed'`
and `inScope` is `kind !== 'assumption'` (case-sensitive). `RE.isHigh({status:'Closed', P3, I3})` → **true**;
`status:'mitigated'` → true. Before fix 19, `portfolioSummary` counted `r.status === 'open'` only, so such a row was
NOT a high risk; it now is. Outcome: **edge regression** (needs a non-canonical status through the generic API). → F-28 (P3).

**B7 — Restore (fix 24 anchors + rehearsal adapter).** Re-ran the rehearsal (E6, all PASS). Cross-seat probe on a fresh
unhardened DB: the application role (owner) can `TRUNCATE audit_chain_anchors` (the append-only trigger covers UPDATE /
DELETE only), and `anchorBreak(rows, null)` returns null, so a truncate of anchors + ledger verifies clean until
`tools/pg/harden-audit-grants.sql` is applied. This is the audit seat's area and is the documented reason for the
hardening script; noted only (O-2).

## 4. Findings at e82d95ba

| ID | Sev | Title | Where | Reproduction | Regression test to add | Rollback risk | Recommendation |
|---|---|---|---|---|---|---|---|
| **F-26** | **P2 (new, regression of fix 19)** | Vue Groupe helpdesk cell is GREEN on a one-ticket closed base while most of the window is open and overdue; open overdue tickets vanish from the fleet grid, the overall RAG and the "worst sites" list | `services/siteHelpdeskSla.js:33-40` (`fleetCell`), `routes/siteAwareness.js:34,448-451` | `node /tmp/claude-0/p11attack-r6/fleet.js` → new `green 0/1` vs r5 `red 40/50` | 50 created / 1 closed on time / 40 open overdue → cell not green (amber/red or `na` with a "partial" flag), and `open_overdue` present in the fleet cell | None (pure display; the old rule is one function back) | Keep closed-only for the rate, but carry `open_overdue` into the cell and let it cap the colour (any open overdue ≥ N → not green), or require a minimum closed base before a verdict. Label the population in the tooltip. KPI Committee owns the bands (G06). |
| **F-27** | **P2 (F-23 remainder)** | "One high-risk rule" still has two other definitions: the project page card and the stage-gate count use inherent P×I ≥ 6, kind = risk, null → 0 | `services/ppm/projectKpis.js:82-83`, `services/governanceStore.js:536`, `services/portfolioDeck.js:50` | `node /tmp/claude-0/p11attack-r6/risk6.js` | same risk set → same high-risk verdict on register, alerts, project card and gate | Low for the card; **gate behaviour changes** if unified (a project could be blocked / unblocked differently) | Make the project card call `isHigh`. For the gate, the PMO decides residual vs inherent (record it); until then label the gate rule as "inherent, risks only". |
| F-28 | P3 (new) | Generic risk writer stores any status; the shared rule treats every status but exactly `closed` as open, and kind matching is case-sensitive | `services/governanceStore.js` (`risk` cols, no status check), `services/ppm/riskExposure.js` `isOpen` / `inScope` | `node -e` with `RE.isHigh({status:'Closed',kind:'risk',probability:3,impact:3})` → true | generic writer refuses a status outside `open | closed` (as `raid.js:29` does); `isOpen` normalises case | None | Validate status in `upsertPortfolio('risk')`; lowercase in `isOpen` / `inScope`. |
| F-25 | P3 (carried, partial) | Destructive-DDL detector misses dollar-quoted dynamic SQL, `concat()`-built SQL, `DROP EXTENSION … CASCADE`, `ALTER TYPE … DROP ATTRIBUTE` | `db/migrate.js:58` (tokeniser) and `:62` (keyword list) | `node /tmp/claude-0/p11attack-r6/ddl6.js` | those variants → `rerunOnChange=false` | None | Treat `$tag$` delimiters as separators; add EXTENSION/ATTRIBUTE and `DROP FUNCTION … CASCADE` to the list (or classify any CASCADE as destructive). |
| F-15, F-11, F-12, F-13, F-06, F-08 | P3 | carried, unchanged | see r4 / r5 | — | — | — | — |

Observations (not graded): **O-1** the brief's run id `data-kpi-r6` is ignored by `testDbName` (hyphens), so the run-scoped
DB sweep cannot target this seat's DBs; either allow `-` in the regex or document the allowed charset. **O-2** the restore
rehearsal does not exercise the anchor path, and an unhardened app role can truncate `audit_chain_anchors` (audit seat).

**P0: 0. P1: 0.** P2: **2, both new this round** (F-26 regression of fix 19 on a live path; F-27 remainder of F-23 in
default-off PPM lots). P3: 8 (F-28 new; F-25 partial; 6 carried). Fixed this round: **F-21, F-23 (named surfaces), F-22, F-24**.

## 5. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L09 KPI trust (display-only) | **CONDITIONAL** | Parity/KPI 125/125, sweep/map/lineage exit 0, F-24 tooltip honest. **F-26** affects the Vue Groupe grid, which is live for group accounts and not behind a switch: fix (or revert to showing open overdue) before the group view is used as a pilot verdict. Committee switches stay dark until G06. |
| L05 Time, money and benefits | **NO-GO for pilot** (technically CONDITIONAL) | Finance gate G14 empty; PG16 only. |
| L13 Operations resilience (restore, sync drift) | **CONDITIONAL** | Rehearsal all PASS (PG16, 1 000 rows, 111 migrations, 227 tables). Needs PG17, production volume, RPO/RTO set by humans (G05). F-25 hypothetical. |
| L14 Portfolio Lots 1–5 | **CONDITIONAL → close to GO PILOT** | F-21 fixed (0/178), F-23 fixed for register/alerts. Fix **F-27** (project card) before the register and the project page are both shown to the same pilot users; PMO to decide the gate rule. PROPOSED DQ / unfunded / stalled / risk-mapping rules need PMO approval. |
| L15 Adoption Lot B | **CONDITIONAL** | Coverage now shown (F-22 fixed). The "worst sites" ranking inherits F-26 through the helpdesk cell. |
| L16 Portfolio Lot 6 | **CONDITIONAL → close to GO PILOT** | Partial demand cells and partial risk rollups no longer give verdicts. Capacity thresholds and effort weights are PROPOSED (PMO). |
| Group IT deck (not a lot) | **CONDITIONAL** | F-13, F-15 open; no official figure before G06. |
| Source reconciliation evidence | **GO for use as evidence tooling** (tool only) | Unchanged; a reconciliation sheet needs the data owner's export and sign-off (G12). |
| Committee-policy switches | **Keep dark** | Need adopted D-01/02/03. |

## 6. Human gates still empty in this area

Checked in the gate dossiers at e82d95ba (`docs/agent-execution/gate-dossiers/en/G0x-*.md`): each of the eight below says
"Decision cell in RELEASE-GATES.md | empty — this gate is **NO-GO** until the approver fills it".

- G05 Backup and restore RPO/RTO — CAB + SRE
- G06 KPI definitions, thresholds and score (D-01/02/03; `helpdesk_sla_definition`; fleet-cell bands, F-26) — KPI Committee
- G12 Data owner — anonymised data and 2026 history — Data owners
- G14 Finance — budgets and benefits — Finance
- G03 CAB — dependency upgrade and PostgreSQL-only cutover (PG17)
- G19 QA — CI green on the target SHA, skipped tests reviewed
- G20 Capacity — load / soak
- G09 Dashboard and tracker reviewers (portfolio dashboard definitions)

PMO decisions on the PROPOSED portfolio rules (DQ set and bands, unfunded / stalled rules, risk level mapping, residual vs
inherent for alerts **and stage gates** (F-27), capacity thresholds, effort weights) are pending and not filled by this seat.

No gate filled and no decision taken by this seat. AI review — not an independent human review.
