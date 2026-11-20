# P11 seat data-kpi — ROUND 5 findings

**AI review — not an independent human review.** Seat: data-kpi (PostgreSQL migrations, KPI formulas, null vs 0,
figure parity, source reconciliation, lineage). The reviewer did not write this code. The files `data-kpi.md`,
`r2-data-kpi.md`, `r3-data-kpi.md` and `r4-data-kpi.md` were read and left unchanged.

- Frozen SHA: `3ee4dd23cbe661488f3f693a302358fb62eba6a0` (verified with `git rev-parse HEAD` in `/home/user/qual/data-kpi`).
  The `docs/agent-execution/` narratives were not read or fetched. Only the gate dossiers were used.
- Test cluster: **PostgreSQL 16.15**, max_connections 400. **The PostgreSQL 17 target is still not verified.**
- No product code was modified. Throwaway artefacts are in `/tmp/claude-0/p11attack-r5/`: `wk5.js`, `ddl.js`,
  `drill.js`, `risk.js`, `tests/r5-intake.test.js`, `e1.out`, `e3.out`, `sweep.out`, `sweep.md`, `reh.out`, `reh/`.
  Round-4 repros reused from `/tmp/claude-0/p11attack-r4/` (`f02.js`, `tests/r4-intake.test.js`, `sla-site.js`).
  The throwaway DB `r5_dk` was created and then dropped (`SELECT count(*) FROM pg_database WHERE datname LIKE 'r5_%'` → 0).
  `_pg-boot` and the rehearsal provision and drop their own databases. `drop-test-dbs.js` was not run.

## 1. Round-4 findings re-verified at 3ee4dd23 (fixes 14–18)

| R4 ID | Sev | Status | Evidence (reproduced by this seat) |
|---|---|---|---|
| F-16 site-view "SLA compliance %" rule / population / tooltip | P2 | **FIXED** (residual → F-24, P3) | `_computeSiteHelpdesk` now counts `res_sla_*` through `services/siteHelpdeskSla.js` + `slaDefinition` under the configured mode, cancelled and no-rule tickets out of the base, nothing closed → null; the route reads the field, `open_overdue` shown next to it. `tests/site-awareness-sla-parity.test.js` pins my r4 cases A1/A2/B against `resolutionSla(..., {excludeCancelled:true})` in both modes — passes (E3). Tooltip now says "tickets created in the week and already closed … same rule as the dictionary's Resolution SLA". That last clause is only true in the default `flag` mode (see F-24). |
| F-02 server fallback tracker month vs annual target | P2 | **FIXED** | `node /tmp/claude-0/p11attack-r4/f02.js`: server fallback `g1 a0 r0 avg 100, site score 100` = engine `g1 avg 100 GREEN`. (r4: red=1, 0 %.) |
| F-05 KPI baselines in removed folder | P2 | **FIXED** | Baselines are in `docs/kpi/baselines/`. E3 is 102/102 in this clean tree and E4 `--check` exits 0. |
| F-17 site-view SLA missing from METRIC-WIDGET-MAP | P3 | **FIXED** | `helpdesk.window_resolution_sla_pct` is registered and appears in `METRIC-WIDGET-MAP.md:38` and `METRIC-LINEAGE.md:202`. Both checks are up to date. The map row says **"untriaged"**. |
| F-18 intake value state kept beside a value | P3 | **FIXED on read** | `tests/r5-intake.test.js` (r4 repro, assertion moved to the API). The DB still stores `{"budget":"tbc"}` next to `budget 50000`. The API returns `value_states {avg_fte:'tbc'}` and drops the stale budget state. `project_ref` is still never reused (PRJ-2026-002 purged → next PRJ-2026-003). |
| F-19 Helpdesk week DST / W53 | P3 | **FIXED** | `wk5.js` (6-hour samples 2026–2029, TZ UTC / Europe/London / Africa/Abidjan / America/New_York): page vs `ReportingWeek` = **0 mismatches** in every zone (r4: 492 in London). `prevWk(2029,1)` → **2028-W53**. Residual by design: the shared helper buckets on the browser's local day, so a London summer Saturday 23:00–24:00 UTC lands in the next week (246 half-hour samples over 4 years). Observation only. |
| F-20 destructive DDL re-run | P3 | **PARTIAL** (→ F-25) | `destructiveDdl` catches plain `DROP COLUMN`, and `EXECUTE format('ALTER TABLE %I DROP COLUMN …')` / `… ALTER COLUMN … TYPE`. `ddl.js` shows that `DO $$ BEGIN EXECUTE 'DROP TABLE legacy_x'; END $$;`, `DROP DOMAIN … CASCADE` and `DROP OWNED BY …` are classified **rerunOnChange = true**. No current file contains one (the four new scripts classify `writes=false destr=false`, with 0 `EXECUTE`). |
| F-11 `kpiRag.rag('')` / `('—')` → RED | P3 | NOT FIXED | Re-ran: `RED RED NA`. |
| F-12 migrator advisory lock | P3 | NOT FIXED | `grep -c advisory db/migrate.js` → 0. |
| F-13 render.py CSAT donut `pct > 0` | P3 | NOT FIXED | `render.py:536` unchanged. |
| F-15 Group IT deck outside map / lineage | P3 | NOT FIXED | `reportPayload` / `render.py` appear 0 times in `docs/ops/METRIC-*.md`. |
| F-06 PG16 / small volume | P3 | NOT FIXED (env) | Rehearsal banner: 16.15. |
| F-08 fcr / KEEP_SERVER | P3 (committee) | unchanged | Not re-assessed. |

Round-4 P2s: 3 of 3 fixed (F-16, F-02, F-05). Round-4 P3s from that round: F-17, F-18 and F-19 fixed, F-20 partial.

## 2. Evidence re-run at 3ee4dd23 (command · result)

Prefix: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" PG_TESTS_REQUIRED=1 node --test --test-force-exit`, with `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`.

| # | Evidence | Command | Result | Status |
|---|---|---|---|---|
| E1 | Migration + rollback + truncation + CSAT-null tests | `<prefix> tests/pg-migrate*.test.js tests/pg-finance-migrations-rollback.test.js tests/zoho-sync-truncation-*.test.js tests/zoho-sync-survey-truncation.test.js tests/exec-pptx-csat-null.test.js tests/ppm-rollback-scripts.test.js` | **43/43 pass**, 0 skipped (now includes `pg-migrate-destructive`) | **VERIFIED (PG16)** |
| E2 | `db/migrate.js` on a fresh DB | `PG_URL=…/r5_dk node db/migrate.js` ×2, then `--status` | 1st run applied=110 (121, 125, 130 included). 2nd run applied=0, already=110, changed=0. 110 files on disk. | **VERIFIED (PG16)** |
| E3 | figure-parity + KPI suites (+ the fix-16 tests) | `<prefix> tests/figure-parity-*.test.js tests/kpi-*.test.js tests/dashboard-figure-parity.test.js tests/site-awareness-sla-parity.test.js tests/report-payload-tracker-null.test.js tests/reporting-week-dst.test.js` | **102/102 pass** | **VERIFIED** |
| E4 | `node tools/kpi/unknown-sweep.js --check` | as written | **exit 0**, 446 hits, **unjustified 0**. Every hit in the 56 server files changed since e43d11d5 was read in `--md` (portfolio Lots 2–6, siteAwareness, engagementStore): tally, ordering, row counts and parameters. No measure is defaulted to 0. Caveat: the `count_field` rule auto-justifies words such as `amount`, `hours`, `weight`, `threshold` (see §3 B4). | **VERIFIED** |
| E5 | `node tools/agent/metric-map.js --check` | as written | "up to date", exit 0 | **VERIFIED** (the new portfolio executive cards are not registry metrics, so the map does not cover them, see F-21) |
| E6 | Restore rehearsal | `node tools/pg/restore-rehearsal.js --rows 1000 --out /tmp/claude-0/p11attack-r5/reh` | exit 0. All PASS: migrate 110 + idempotent, ISO window, accents, UTC (year only), 12 audit chains + append-only trigger, **226 tables / 1 229 rows** equal, ticket md5, chain heads, broken dump refused, target unchanged | **VERIFIED (PG16, 1 000 rows)**. No RPO/RTO claim. |
| E7 | `node tools/agent/metric-lineage.js --check` (extra) | as written | up to date, exit 0 | **VERIFIED** |
| E8 | Round-4 repros (F-16, F-02, F-18, F-19, F-20) (extra) | §1 | reproduced | VERIFIED |

Counts: **verified 8 of 8** (E1–E8). Not verified: 0. Still not verified as a claim: PG17, production volume, RPO/RTO.

## 3. New break attempts (one per capability, prioritising the new lots; none repeated from rounds 1–4)

**B1 — Migrations (F-20 detector, new 121/125/130).** Claim: "an edited applied script containing destructive DDL is
never re-executed". Attack (`ddl.js`): classify eight variants with the exported `destructiveDdl` / `rerunOnChange`.
Outcome: **partially broken.** A single-quoted dynamic statement (`EXECUTE 'DROP TABLE x'`) slips through: the token is
`'DROP`, not `DROP`. `DROP DOMAIN … CASCADE` (drops the columns typed with the domain) and `DROP OWNED BY` also slip
through. No current file is affected. The 125 rollback narrows the `gate_to` CHECK back. It documents that it fails
while extended-stage checklists exist, and that projects keep their extended `stage` values (TEXT, no CHECK). → F-25 (P3).

**B2 — Sync integrity.** Covered by E1 (truncation tests 43/43, incl. sync/114 pending anchors). No new attack this
round; the operations seat owns fix 17.

**B3 — Figure parity, portfolio Lot 3 "executive KPI cards with exact drill-through".** Claim
(`public/lib/portfolioRegister.js:98`: "each a link to its drill-through (same filters, merged into the current
address)"; merge commit c9d95982: "exact drill-through"). Attack (`drill.js`, pure engine plus the page's own merge rule
`Object.assign({}, state, patch)` from `portfolioRegisterPage.js:19`):
- current filter `priority=low`. The **Critical / high card shows 0, "Show these projects (0)"**. The link replaces
  `priority` with `critical,high`, so the drill page lists **3** projects.
- current `report=on_hold`. The standard-report link "Without owners" shows **(0)**. The link replaces `report`, so
  the page lists **1**.
- The drill is exact only when the card's key is not already an active filter (e.g. `decisions_required` under
  `report=on_hold`: 1 = 1).
Outcome: **claim broken.** A card or report count and the list it opens disagree. → **F-21 (P2)**.

**B4 — Null vs 0 / partial data shown as a verdict (Lots 2, 6, Adoption Lot B).**
- Lot 6 resource demand (`services/ppm/resourceDemand.js` `monthlyLoad`). A line with no `avg_fte` goes to a global
  `unplaced` list. The month cell sums only the known lines and gets a RAG from that partial sum. Example: demand
  0.5 known + 1 line unknown, against capacity 1 → GREEN, with no per-cell unknown count. Peak FTE is handled correctly
  (`peak_unknown` → null); average FTE is not.
- Lot 6 risk rollup (`riskExposure.rollup`). A project with one open low risk and one open risk with unknown score
  reads level **low**. `counts.unknown` is returned but `level` is not null.
- Adoption Lot B group Home (`public/lib/homeGroup.js` `worstSites`). Fleet with 1 green site and 10 `na` sites →
  **"no site in red or amber"**, with no coverage figure (repro: `node -e` loading `public/lib/homeGroup.js`, calling
  `worstSites({sites:[1 green, 10 na]})` → `{"total":0,"items":[]}`, and `groupHtml` renders "no site in red or amber").
- Lot 2 DQ score depends on who reads it. The same project gives **88 AMBER (16/18) for an amount reader and 100
  GREEN (16/16) for a reader without money**: the budget checks are left out. The project page says so
  (`ppmFieldHelp` `without_budget`). The Lot 3 executive card "Data quality" does not.
→ F-22 (P3), F-23 (P3).

**B5 — Lineage / one formula per figure (Lot 3 vs Lot 4 vs Lot 6 "high risk").** Claim (Lot 6 header): "no second risk
register … unknown probability or impact → level null (never low)". Attack (`risk.js`):
- risk P3×I3 inherent, residual P1×I1. **Lot 3 register and Lot 4 `high_risk` alert** (`portfolioEvidence.riskView`,
  inherent only) say **high** and list the project under report `high_risk`. **Lot 6** exposure says **low**.
- probability/impact null: `riskView` → `Number(null)*…=0` → **low**. Lot 6 → null. The columns are nullable
  (default 2), so null is reachable through an explicit write.
- Lot 3 counts open rows of any `kind` (issues included). Lot 4 alerts count `kind = risk` only.
Outcome: **claim broken.** Three surfaces of the same portfolio classify the same risk differently. → **F-23 (P2)**.

**B6 — KPI doctrine after F-16 (site view vs dictionary).** Claim (tooltip `c_sla_def`): the site-view rate uses "the
same rule as the dictionary's Resolution SLA". Read: `helpdesk.resolution_sla_pct` (`_getCalendarMonthlyHelpdeskPg`,
reports-db.js:2977-2978) is **flag-only** (`overdue_status=0`) and **ignores** `helpdesk_sla_definition`. It rounds to
an integer. The site view follows the configured mode (1 decimal), and under `due_vs_resolved` it also counts no-flag
tickets that have a due time. The rules agree today only because the default is `flag`. Also, the Vue Groupe helpdesk
cell (`routes/siteAwareness.js:32-37, 453`) still colours on `sla_overdue ÷ created`, counting cancelled-but-flagged and
open tickets. This is the F-16 A2/B behaviour, kept on the fleet grid that Lot B "worst sites" ranks on. It is
labelled as its own metric ("SLA-overdue share"). → F-24 (P3).

**B7 — Lot 2 data-quality site score Σ/Σ.** Claim: "site score = Σ completed ÷ Σ required, never a mean". Checked
`siteScores`: unknown projects are excluded from both sums and counted, a site with nothing scored gives null, and it
is floored. **Claim holds.** Combined with B4, the sums differ by money right (F-22).

## 4. Findings at 3ee4dd23

| ID | Sev | Title | Where | Reproduction | Regression test to add | Rollback risk | Recommendation |
|---|---|---|---|---|---|---|---|
| **F-21** | **P2 (new)** | Lot 3 KPI card and standard-report counts ≠ the list their drill link opens, when the drill key is already an active filter | `services/ppm/portfolioRegister.js` `kpis()` / `reports`; `public/lib/portfolioRegisterPage.js:19,91` | `node /tmp/claude-0/p11attack-r5/drill.js` → card 0 / drill 3; report 0 / link 1 | for every card and report and every active filter: `build(filters ∪ drill).rows.length === card.count` | None (switch `ppm_portfolio_dashboard_v2_enabled` off by default) | Compute card counts with the same merge the link uses (`Object.assign(filters, drill)`), or intersect lists in the link instead of replacing them. Pick one rule and pin it. |
| **F-23** | **P2 (new)** | "High risk" has three definitions: Lot 3 register and Lot 4 alerts use inherent P×I ≥ 6 (any kind in Lot 3, null → low); Lot 6 uses residual-first with null → unknown | `services/portfolioEvidence.js:56`, `services/ppm/portfolioRegister.js:55-56`, `services/ppmAlerts.js:163`, `services/ppm/riskExposure.js` | `node /tmp/claude-0/p11attack-r5/risk.js` → P1: Lot 3 high vs Lot 6 low; P2: Lot 3 low vs Lot 6 null | the same risk set gives the same project high-risk verdict on register, alerts and exposure | Low (all behind default-off switches) | Make `riskExposure.view` the one classifier (residual when given, null when unknown). Have `riskView` and the alerts call it. PMO decides residual vs inherent for alerts. |
| F-22 | P3 (new) | Partial data shown as a verdict: demand cell RAG over known lines only; risk rollup level ignores unknown risks; Lot B "no site in red or amber" with 10/11 sites unmeasured; Lot 3 DQ card varies by money right without saying so | `resourceDemand.monthlyLoad`, `riskExposure.rollup`, `public/lib/homeGroup.js` `worstSites`, `portfolioRegister.kpis` | §3 B4 | unknown line in a cell → cell rag `NA` or carries `unknown_lines`; worstSites returns `measured / total` | None | Carry unknown counts per cell / per rollup and state coverage ("1 of 11 sites measured"). Add the scope note to the DQ card. |
| F-24 | P3 (new) | Site-view tooltip claims the dictionary's Resolution SLA rule, but the monthly dictionary reader is flag-only and ignores `helpdesk_sla_definition`. The Vue Groupe helpdesk cell still uses overdue ÷ created (cancelled/open counted) | `reports-db.js:2977-2978`, `public/site-awareness.html:392`, `routes/siteAwareness.js:32-37,453` | code reading. Switching to `due_vs_resolved` would move the site view and leave the monthly figure unchanged | with `helpdesk_sla_definition=due_vs_resolved`, monthly `sla_res_pct` and window `res_sla_pct` agree on the same tickets | None | Either make `getCalendarMonthlyHelpdesk` honour the mode (it is a committee switch, G06), or change the tooltip to "flag rule today". Label the fleet cell's population. |
| F-25 | P3 (carried F-20, partial) | Destructive-DDL detector misses single-quoted dynamic SQL, `DROP DOMAIN … CASCADE`, `DROP OWNED` | `db/migrate.js:51-75` | `node /tmp/claude-0/p11attack-r5/ddl.js` | those three variants → `rerunOnChange=false` | None | Tokenise after stripping quotes; add DOMAIN and OWNED to the list. |
| F-15, F-11, F-12, F-13, F-06, F-08 | P3 | carried, unchanged | see r4 | — | — | — | — |

**P0: 0. P1: 0.** P2: **2, both new** (F-21, F-23 — both in default-off portfolio lots). P3: 9 (F-22, F-24 new; F-25
carried partial; 6 carried unchanged). Fixed this round: **F-16, F-02, F-05** (P2) and **F-17, F-18, F-19** (P3).

## 5. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L09 KPI trust (display-only) | **CONDITIONAL → closer to GO PILOT** | Parity/KPI 102/102 in a clean tree, sweep and map checks exit 0, F-16/F-17 closed. Remaining: F-24 tooltip wording. Committee switches stay dark until G06. |
| L05 Time, money and benefits | **NO-GO for pilot** (technically CONDITIONAL) | Finance gate G14 empty; PG16 only. |
| L13 Operations resilience (restore, sync drift) | **CONDITIONAL** | Rehearsal all PASS (PG16, 1 000 rows, 110 migrations). Needs PG17, production volume, RPO/RTO set by humans (G05). F-25 is hypothetical today. |
| L14 Portfolio Lots 1–5 (intake, DQ, register + executive dashboard, decision agenda + alerts, lifecycle) | **CONDITIONAL** | Migrations 121/125 are idempotent with rollback scripts; F-18 fixed; DQ Σ/Σ holds. **Fix F-21 (drill counts) and F-23 (one high-risk rule) before the executive dashboard or the alerts are switched on for a pilot.** PMO must approve the PROPOSED DQ / unfunded / stalled rules. |
| L15 Adoption Lot B | **CONDITIONAL** | Every figure comes from existing routes; unknown reads "— not measured". The "worst sites" line gives a favourable verdict on a mostly unmeasured fleet (F-22). Show coverage before it goes on for executives. |
| L16 Portfolio Lot 6 (dependencies, demand/capacity, effort, scenario, BI) | **CONDITIONAL** | Migration 130 is idempotent and has a rollback script. F-23 (risk rule conflict with Lots 3/4) and F-22 (partial demand cell RAG) should be fixed first. Capacity and effort weights are PROPOSED (PMO). |
| Group IT deck (not a lot) | **CONDITIONAL** | F-02 fixed. F-13 and F-15 open; no official figure before G06. |
| Source reconciliation evidence | **GO for use as evidence tooling** (tool only) | Unchanged since r4. A reconciliation sheet still needs the data owner's export and sign-off (G12). |
| Committee-policy switches | **Keep dark** | Need adopted D-01/02/03. |

## 6. Human gates still empty in this area (gate dossiers at 3ee4dd23, each says "Decision cell … empty — this gate is NO-GO until the approver fills it")

- G05 Backup and restore RPO/RTO — CAB + SRE
- G06 KPI definitions, thresholds and score (D-01/02/03; also `helpdesk_sla_definition`, F-24) — KPI Committee
- G12 Data owner — anonymised data and 2026 history — Data owners
- G14 Finance — budgets and benefits — Finance
- G03 CAB — dependency upgrade and PostgreSQL-only cutover (PG17)
- G19 QA — CI green on the target SHA, skipped tests reviewed
- G20 Capacity — load / soak
- G09 Dashboard and tracker reviewers (tracker "not entered" semantics; portfolio dashboard definitions)

The PMO decisions on the PROPOSED portfolio rules (DQ required set and bands, unfunded and stalled rules, risk level
mapping and residual use, capacity thresholds, effort weights) are pending in `docs/business-readiness/REGISTRE-DECISIONS-HUMAINES.md`.
They are not filled by this seat.

No gate filled and no decision taken by this seat. AI review — not an independent human review.
