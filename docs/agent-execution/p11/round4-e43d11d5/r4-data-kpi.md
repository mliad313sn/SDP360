# P11 seat data-kpi — ROUND 4 findings

**AI review — not an independent human review.** Seat: data-kpi (PostgreSQL migrations, KPI formulas, null vs 0,
figure parity, source reconciliation, lineage). The reviewer did not write this code. The files `data-kpi.md`,
`r2-data-kpi.md` and `r3-data-kpi.md` were read and left unchanged.

- Frozen SHA: `e43d11d5738dc4af650bd06715c54e6927f1649e`. Clone: `/home/user/qual/data-kpi`. The coordinator removed the
  `docs/agent-execution/` narratives; they were not read or fetched. Only the gate dossiers were used.
- Test cluster: **PostgreSQL 16.15**, max_connections 400. **The PostgreSQL 17 target is still not verified.**
- No product code was modified. Throwaway artefacts are in `/tmp/claude-0/p11attack-r4/`: `tests/r3-ratchet.test.js`,
  `tests/r4-intake.test.js`, `sla-site.js`, `f02.js`, `wk.js`, `mig.js`, `mroot/` (an edited copy of `db/postgres`),
  `e1.out`, `e3.out`, `sweep.out`, `unj.txt`, `reh.out`, `reh/`. The throwaway DB `r4_dk` was created and then dropped.
  Test files run under `_pg-boot`, which provisions and drops its own databases. The rehearsal dropped its own databases.

## 1. Round-3 findings re-verified at e43d11d5 (fixes 10–13)

| R3 ID | Sev | Status | Evidence (reproduced by this seat) |
|---|---|---|---|
| F-14 truncation anchor ratchet (alternating partial exports) | P2 | **FIXED** | Re-ran the r3 repro (`tests/r3-ratchet.test.js`) against the real `zoho-sync.syncRequestData`. The sequence 1000→810→820 is accepted, but the anchor **stays at 1000**. 660, 670 and 540 are all **refused** ("fetched 660 rows but 820 are stored, last confirmed count 1000 (−34 %)"). The pure model refuses 66 after 100 too. The anchor now never goes down without an operator (`tools/sync/confirm-shrink.js`) or the opt-in N-confirmations env. Tests `zoho-sync-truncation-*` pass (E1). |
| F-03 migrator re-executes edited applied data scripts | P2 | **FIXED** | Copied `db/postgres` into `mroot/` and added a comment line to `reports/039` and `reports/117`, on a DB migrated to 107. Result: `changed=[039,117]`, `notReapplied=[039,117]`, `applied=[]`, plus a warning. `tests/pg-migrate-changed.test.js` passes. Residual risk is noted as F-20 (P3). |
| F-10 reconcile-source RECONCILED on nothing compared | P2 | **FIXED** | Header-only `Wrong,Columns` → "missing column(s)", **exit 2**. Header-only with the right columns → `NOT_COMPARABLE`, **exit 3**, with no DB read. The SELECT now runs inside `BEGIN READ ONLY`. |
| F-04 dd/mm guessed | P2 | **FIXED** | `monthOf('01/10/2026')` and `monthOf('10/01/2026')` → `null`. `13/01/2026` → `2026-01`. `{dateOrder:'dmy'}` → `2026-10`. Ambiguous dates are counted in `totals.ambiguous_dates`. |
| F-02 server fallback `_tracker()` → 0/red | P2 | **PARTIAL** | The null handling is fixed: no input → not scored; avg and delta are null; `loadTracker` is awaited. **The formula still differs from the engine.** `_ragOf(month value, annual target)` scores ONE month against the ANNUAL target. The engine pro-rates the cumulative value. Repro `f02.js`: a COUNT activity with annual target 12 and inputs 1/1/1 (Jan–Mar). At month 3 the **engine gives GREEN, avg 100 %**; the **server fallback gives red=1, avg_score 0, site score 0**. This path is used only when the browser sends no tracker block (`reportPayload.js:999`). |
| F-05 KPI evidence baselines in removed `docs/agent-execution/` | P2 | **PARTIAL** | The message now names the missing file ("not a formula regression"). The baselines are still not re-homed, so in a clean tree E3 still fails 2 tests and E4 still exits 1. |
| F-15 Group IT deck outside METRIC-WIDGET-MAP / LINEAGE | P3 | NOT FIXED | `reportPayload` and `render.py` appear 0 times in `docs/ops/METRIC-*.md`. Extended by F-17. |
| F-11 `kpiRag.rag('')` / `rag('—')` → RED | P3 | NOT FIXED | Re-ran: `RED RED NA`. |
| F-12 migrator has no advisory lock | P3 | NOT FIXED | No `advisory` in `db/migrate.js`. |
| F-13 render.py CSAT donut guard `pct > 0` | P3 | NOT FIXED | `render.py` ~l.536 is unchanged. |
| F-06 PG16 / small volume | P3 | NOT FIXED (env) | Rehearsal banner shows 16.15. |
| F-08 fcr / KEEP_SERVER | P3 (committee) | unchanged | Not re-assessed. |

## 2. Evidence re-run at e43d11d5 (command · result)

Prefix: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" PG_TESTS_REQUIRED=1 node --test --test-force-exit`, with `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`.

| # | Evidence | Command | Result | Status |
|---|---|---|---|---|
| E1 | Migration + rollback + truncation + CSAT-null tests | `<prefix> tests/pg-migrate*.test.js tests/pg-finance-migrations-rollback.test.js tests/zoho-sync-truncation-*.test.js tests/zoho-sync-survey-truncation.test.js tests/exec-pptx-csat-null.test.js tests/ppm-rollback-scripts.test.js` | **39/39 pass**, 0 skipped | **VERIFIED (PG16)** |
| E2 | `db/migrate.js` on a fresh DB | `PG_URL=…/r4_dk node db/migrate.js` ×2, then `--status` | applied=107 (114, 116, 117 and 120 included); 2nd run: applied=0, already=107, changed=0; 107 applied | **VERIFIED (PG16)** |
| E3 | figure-parity + KPI suites | `<prefix> tests/figure-parity-*.test.js tests/kpi-*.test.js tests/dashboard-figure-parity.test.js` | 81 tests: **79 pass, 2 fail** — #38 (`P08-kpi-dossiers.md` missing), #79 (`P08-unknown-sweep.json` missing). Both are now named as "not a regression". | **PARTIAL** (F-05) |
| E4 | `node tools/kpi/unknown-sweep.js --check` | as written | exit 1. 439 hits, 79 UNJUSTIFIED because the baseline is missing. Diff against r3's 80: removed the two `reportPayload` tracker `\|\| 0` lines (F-02 fix); added `evm.js deleted_project_contributors` and `sliReadings errors` (both reviewed in commits as justified). **No hit from the new lots** (policyCenter, intake, activate-switches). | **NOT VERIFIED** (needs the baseline) |
| E5 | `node tools/agent/metric-map.js --check` | as written | "up to date", exit 0 | **VERIFIED** (but see F-17: the map misses a surface) |
| E6 | Restore rehearsal | `node tools/pg/restore-rehearsal.js --rows 1000 --out /tmp/claude-0/p11attack-r4/reh` | exit 0. All PASS: migrate 107 + idempotent, ISO window, accents, UTC (year-only check), 12 audit chains + append-only trigger, 222 tables / 1 226 rows equal, ticket md5, chain heads, broken dump refused, target unchanged | **VERIFIED (PG16, 1 000 rows)**. No RPO/RTO claim. |
| E7 | `node tools/agent/metric-lineage.js --check` (extra) | as written | up to date, exit 0 | **VERIFIED** |
| E8 | Round-3 repros (F-14, F-03, F-10, F-04, F-02) (extra) | §1 | reproduced | VERIFIED |

Counts: **verified 6** (E1, E2, E5, E6, E7, E8), **partial 1** (E3 79/81), **not verified 1** (E4).

## 3. New break attempts (one per capability, none repeated from rounds 1–3)

**B1 — Migrations (new 114/116/117/120 + F-03 detector).** Claim: "an edited applied script that writes data is
never re-executed; DDL-only scripts keep the re-apply contract".
Attack: (a) edit applied 039 and 117 on a copy root (see §1, holds); (b) scan all 107 files with the exported
`writesData()` and list the non-writing files that contain DO blocks or functions. All 15 such files only create
triggers or constraints, or rename the 1.11 table. None calls a writing function.
Outcome: **claim holds for today's files.** Gap: `writesData` ignores destructive DDL (`DROP TABLE/COLUMN`,
`ALTER … TYPE`). A future applied script edited to contain one would be re-executed. No current file has one (grep).
→ F-20 (P3).

**B2 — Sync integrity.** Covered by the F-14 re-verification (§1): alternating, repeated and growing-by-one partial
exports are refused. No new defect.

**B3 — KPI arithmetic / figure parity (Adoption Lot A, live by default). Claim** (`routes/siteAwareness.js:159`,
`public/site-awareness.html` tooltip `c_sla_def`): site view "SLA compliance %" = "tickets closed on time ÷ tickets
closed in the week (**same rule as the Helpdesk ranking**)".
Attack (`sla-site.js`): feed the same tickets to `_computeSiteHelpdesk` (the site view) and to `resolutionSla()`
(the Helpdesk ranking, `public/lib/dashboard-shared.js`):
- A1: a closed ticket with a **stale flag 0 but resolved after due** → site view **100 %**, ranking **66.7 %**.
- A2: a **cancelled ticket carrying flag 1** → site view **66.7 %**, ranking **100 %**. The ranking never counts a
  cancelled ticket as missed.
- B: the window is the **created-in-week cohort** (`getSiteHelpdeskWindow` filters on `created_time`), not
  "closed in the week". Example week: 10 created, 5 closed on time, 5 still open and already overdue → new column
  **100 %**; the replaced figure (missed ÷ created) read 50 % missed.
Outcome: **claim broken.** The site view uses the server `flag` rule and does not exclude cancelled tickets. The page
default is `due_vs_resolved` (a documented committee choice, P8/D-01). The tooltip states both the rule and the
population incorrectly. → **F-16 (P2)**.

**B4 — Null vs 0 (portfolio intake value states, Lot 1). Claim** (`services/ppm/intakeFields.js` header): "a state is
only stored while the field value is NULL … never collapsed".
Attack (`tests/r4-intake.test.js`, real `governanceStore` on a pg test DB): create a project with the switch on and
`value_states {budget:'tbc'}`; set `budget 50000` with the switch **off** (the default, or a lot rollback via
`tools/ops/activate-switches.js`); switch on again.
Result: DB and API both return `budget: 50000` **and** `value_states.budget: 'tbc'`. Paths that bypass
`normaliseIntake` never reconcile the states, and `readIntake` does not either. The intake form shows the value with
"TBC" selected until the next intake save. Also checked: `project_ref` is never reused after a hard delete, even when
a client sends the purged ref (PRJ-2026-002 purged → next is PRJ-2026-003; `aliases()` drops a client `project_ref`)
✔. → **F-18 (P3)**.

**B5 — Lineage. Claim:** "METRIC-WIDGET-MAP lists every consumer of a metric".
Attack: the new site-view Resolution SLA % (`res_sla_pct`) is a second inline formula in `routes/siteAwareness.js:164`.
It is not read through the registry reader, and it appears nowhere in the `helpdesk.resolution_sla_pct` row of
`docs/ops/METRIC-WIDGET-MAP.md`. `metric-map --check` still says "up to date".
Outcome: **claim broken** — a parity surface outside the net, the same class as F-15. → F-17 (P3).

**B6 — One reporting week (Adoption Lot A). Claim** (`public/lib/reportingWeek.js`): one Zoho-week definition shared
by the server and the browser.
Attack (`wk.js`, 6-hourly samples 2026–2029): compare `index.html` `isoWk/isoWkYr` with `ReportingWeek.weekOf`.
- `TZ=UTC`: 0 mismatches.
- `TZ=Europe/London` (LONDON is a site): **492 mismatches**. Every Sunday under BST lands in the previous week
  (e.g. 2026-04-05 → page W13, shared W14), so the Helpdesk default week on a summer Sunday is not the "in progress"
  week.
- Also `prevWk(2029,1)` returns **2028-W52**, but 2028 has a W53 (shared helper: Jan 1–6 2029 = 2028-W53). The
  comparison period skips W53 in 53-week years.
Both defects predate this lot. They break the "one week everywhere" claim only in DST browsers and in 53-week years.
→ F-19 (P3).

**B7 — Policy Center (KPI side).** The CSV export's `deviates` agrees with `PC.deviates` for all 275 report_config
rules (0 mismatches). KPI RAG policies are listed read-only and link to the KPI builder. Approval re-checks the stored
value before claiming the row and marks the request `stale` when it changed. There is a narrow TOCTOU window between
that check and `apply`, and the old `PUT /api/reports/config` path stays open by design. That is left to the security
seat. No data-side defect.

**Observation (no finding):** `services/trackerMonthState` treats a stored 0 as "not entered". Tracker storage
initialises cells to 0 (`App.jsx:1790`, `engine.js:77`), so a typed 0 and a blank cell cannot be told apart. A site
that truthfully enters 0 everywhere gets no RED and no alert. Fixing this needs a null-preserving input model; it is a
KPI-committee item.

## 4. Findings at e43d11d5

| ID | Sev | Title | Where | Reproduction | Regression test to add | Rollback risk | Recommendation |
|---|---|---|---|---|---|---|---|
| **F-16** | **P2 (new)** | Site view "SLA compliance %" claims the Helpdesk-ranking rule but uses the flag-only rule, counts cancelled-with-flag as missed, and measures the created-week cohort (labelled "closed in the week") | `routes/siteAwareness.js:159-165`, `reports-db.js:_computeSiteHelpdesk`, `public/site-awareness.html` `c_sla_def` | B3 `sla-site.js` (A1 100 vs 66.7; A2 66.7 vs 100; B 100 % with 5 open overdue) | same rows → site view == `resolutionSla()` under the configured `helpdesk_sla_definition`; cancelled never missed | Low (display only, no schema) | Route through `services/slaDefinition` with the configured mode, exclude cancelled, fix the tooltip ("tickets created in the week and already closed"), and show open-overdue next to it. Rule choice → KPI committee (G06). |
| F-02 | P2 | (carried, PARTIAL) server fallback tracker scores the month value against the annual target → on-track site shown red / 0 % | `services/reportPayload.js:536-541, 999` | `f02.js` | engine `ss()` vs `serverTracker` on the same D | Low | reuse `tracker-pptx` `ss/score` (as round 1 advised) or return null |
| F-05 | P2 | (carried, PARTIAL) KPI evidence baselines still under removed `docs/agent-execution/` | `tools/kpi/unknown-sweep.js:19`, `tests/kpi-dossiers.test.js` | E3/E4 | clean-tree run green | None | re-home under `docs/kpi/` |
| F-17 | P3 (new) | site-view Resolution SLA % is a second formula, missing from METRIC-WIDGET-MAP | `routes/siteAwareness.js:164`, `docs/ops/METRIC-WIDGET-MAP.md:32` | B5 | map check fails when a route computes a registry metric inline | None | read through the registry reader; map the surface |
| F-18 | P3 (new) | intake value state kept beside a value (budget 50000 + TBC) after a write made with the switch off / bypass path | `services/ppm/intakeFields.js` `readIntake`; `services/governanceStore.js:649` | `tests/r4-intake.test.js` | write with switch off, then read with switch on → state dropped for the filled field | Low | drop states of filled fields on read (or on every project write) |
| F-19 | P3 (new) | Helpdesk week: London DST Sundays in the previous week; `prevWk` skips W53 | `public/index.html:514-535` | `wk.js` | DST-zone parity with `ReportingWeek`; 2028-W53 previous of 2029-W01 | None | use `ReportingWeek` for bucketing and for prev-week |
| F-20 | P3 (new) | F-03 detector treats destructive DDL as re-runnable | `db/migrate.js:32-45` | B1 (hypothetical, no current file) | edited applied file with `DROP COLUMN` → not re-applied | None | add DROP / ALTER TYPE to the run-once class |
| F-15, F-11, F-12, F-13, F-06, F-08 | P3 | carried, unchanged | see r3/r2 | — | — | — | — |

**P0: 0. P1: 0.** P2: 3 (1 new F-16; F-02 and F-05 carried, both partial). P3: 10 (4 new F-17 to F-20; 6 carried).
Fixed this round: **F-14, F-03, F-10, F-04** (4 of the 6 round-3 P2s).

## 5. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L09 KPI trust (display-only) | **CONDITIONAL** | Parity/KPI 79/81. The 2 failures are evidence location (F-05). F-16/F-17 show that one live surface (site view) is outside the parity net. Committee switches stay dark until G06. |
| L05 Time, money and benefits | **NO-GO for pilot** (technically CONDITIONAL) | Finance gate G14 is empty. Migrations are green on PG16 only. |
| L13 Operations resilience (restore, sync drift; Policy Center switch classified here) | **CONDITIONAL** | Rehearsal all PASS (PG16, 1 000 rows), F-03 and F-14 fixed. Still needs PG17, production volume, and RPO/RTO set by humans (G05). Policy Center: no data defect found; four-eyes review belongs to the security seat. |
| L14 Portfolio intake register (`ppm_intake_register_enabled`) | **CONDITIONAL** | Migration 117 is idempotent and its re-edit protection works. `project_ref` is never reused (tested). F-18 should be fixed before switch toggling or rollback is used in a pilot. PMO must review the PROPOSED reference lists. |
| Adoption Lot A (ships ON, not a switch lot) | **CONDITIONAL** | Truthful unknowns are good. F-16 should be fixed or relabelled before site coordinators compare the site view with the Helpdesk ranking. |
| Activation tool (`tools/ops/activate-switches.js`) | **CONDITIONAL** | It restores config values only. Data written while a switch was on is not rolled back (see F-18). The operator runbook should say so. |
| Group IT deck (not a lot) | **CONDITIONAL** | F-02 (partial), F-13, F-15 open; no official figure before G06. |
| Source reconciliation evidence | **GO for use as evidence tooling** (tool only) | F-10 and F-04 are fixed. A reconciliation sheet still needs the data owner's export and sign-off (G12). |
| Committee-policy switches | **Keep dark** | Need adopted D-01/02/03. |

## 6. Human gates still empty in this area (gate dossiers at e43d11d5, all "Decision cell … empty")

- G05 Backup and restore RPO/RTO — CAB + SRE
- G06 KPI definitions, thresholds and score (D-01/02/03; also decides the F-16 rule) — KPI Committee
- G12 Data owner — anonymised data and 2026 history — Data owners
- G14 Finance — budgets and benefits — Finance
- G03 CAB — dependency upgrade and PostgreSQL-only cutover (PG17)
- G19 QA — CI green on the target SHA, skipped tests reviewed
- G20 Capacity — load / soak
- G09 Dashboard and tracker reviewers (tracker "not entered" semantics)

No gate filled and no decision taken by this seat. AI review — not an independent human review.
