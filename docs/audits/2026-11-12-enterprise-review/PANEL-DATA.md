# Committee F — PANEL DATA (data, BI and steering) — 12 Nov 2026

Scope: KPI registry, source state vs useful data, screen/export/publication parity (E08), decision KPIs, lineage,
data quality, dashboard/widget catalogue, reporting and publication, benefit measurement, Finance currency rules.
Head reviewed: `sdp-waves` @ `413e26b` (read-only). Plan E wave 2 worktrees read for de-duplication:
`/home/user/w/w2-kpi` (E-K01/K03/K04 committed), `/home/user/w/w2-ppm` (E-P03/P04/P05), `/home/user/w/w2-srv`
(E-D07 not yet committed), `/home/user/w/w2-rep`. Nothing here was run against production or dev data.

## (a) Verdict summary

1. The data layer is better than both documents assume: ONE registry (52 metrics, 46 published), ONE widget resolver
   shared by viewer, CSV, report runs and Report Studio packs, a generated lineage sheet (`docs/ops/METRIC-LINEAGE.md`)
   and a versioned KPI policy store (db 065). E08's "same figure in every output" is largely built — not finished.
2. **P0 defect confirmed** (gap analysis §151): an unconfigured / skipped source is recorded as a SUCCESSFUL sync with a
   new watermark (`services/sync/jobs.js:43-44`, `syncRunner.js:166-171`). Health page, dashboard freshness banner,
   publication gate and the external API then call that source FRESH. A test pins the wrong behaviour.
3. **P0 defect found** (not in the documents): the WAN metric reader ignores the requested window and the sub-site — a
   WAN trend repeats the latest week, a re-generated past report shows this week's WAN, Exploration sub-sites collapse.
4. Two published metrics (`programme.site_score`, `programme.composite`) have a reader that is never wired: always
   "—" on the shipped Governance dashboard, the committee agenda and the external API.
5. Report runs drop three truths the screen keeps: partial period (trend findings on a running month), stale-source
   colour withdrawal, sample size. The Group IT deck turns a null SLA % into 0 % (DV-08, already listed by W2-KPI).
6. Benefit records cannot separate observed / estimated / validated value, have no measurement period and no source;
   "verified" means "a different person", not an independent role. Finance currency silently defaults to USD.
7. Partial sources are NOT carried as "rows kept + total unknown" at head (asset hygiene drops unreadable labels).
8. Every metric is "not certified" and 48/52 carry a placeholder owner role — correct honesty, but the decision KPIs,
   owners, thresholds and the two-KPI selection are people's decisions; the agent can only prepare them.
9. 12 goals proposed (F-DATA-01…12); 10 are AGENT-DOABLE without review.1 and without a human decision.
10. Nothing in this panel needs the review.1 artefact except the dev-environment counts and its profile behaviour.

## (b) Claim verification

Sources: [G] = gap analysis (ecarts.txt, line), [V] = vision pack (vision.txt, line).

| # | Claim | Label | Evidence |
|---|---|---|---|
| C01 | 52 KPIs in the dev inventory [G102] | CONFIRMED | `services/metricRegistry.js` SEED = 52 (46 `published`, 6 draft) |
| C02 | 5 dashboards, 43 widgets, 4 action widgets [G102] | CONFIRMED (seed) | `services/dashboardSeeds.js` SEED_DASHBOARDS: exec-home 11, site-weekly 10, assets-hygiene 9, field-site 5, governance 8; 4 `actions`. "Published in dev" = environment state |
| C03 | 46 publications in dev [G102] | NEEDS-REVIEW.1-ARTIFACT | count of `report_publications` rows on the user's dev DB; not reproducible here |
| C04 | "Partial sources keep the available rows and an unknown total" [G102] | CONFIRMED as a GAP at head; review.1 behaviour NEEDS-REVIEW.1-ARTIFACT | `metricRegistry.js:186-196` (`assets.hygiene_site`): an unreadable label is `continue`d, total and completeness computed on the remainder, no partial flag |
| C05 | Verify formula, unit, period, denominator, owner, data state, UI/CSV/report parity [G102] | OPEN-IN-PLAN-E (E-K01, E-D05 done) + residual gaps | lineage `docs/ops/METRIC-LINEAGE.md` (E-D05, merged); formula sheet `w2-kpi:docs/kpi/FORMULA-REFERENCE.md` (683c367, not merged); residual: denominator only for 3 metrics (`metricRegistry.js:248-252`), no per-figure data state → F-DATA-05/07 |
| C06 | Associate each dashboard with a decision [G102] | CONFIRMED gap; content NEEDS-HUMAN | no `decision`/`question` field in definitions (`services/dashboardWidgets.js` validator, `dashboardSeeds.js`) → F-DATA-12 |
| C07 | `jobs.js` turns `{skipped:true}` into an empty result with a new date; runner records success and advances watermark [G151] | CONFIRMED | `services/sync/jobs.js:43-44` (skip exempt from failOnZero, `nextWatermark: new Date()`), `services/sync/syncRunner.js:166-171` (`status:'ok'`); pinned by `tests/sync-jobs-registry.test.js:124-125` |
| C08 | `routes/sync.js` presents freshness from the last success [G151] | CONFIRMED (wider than stated) | `routes/sync.js:60-64`; same `last_ok` feeds `services/publishGate.js:76-85` (dashboard banner, report publication gate) and `routes/extApi.js` `tag()` (`authoritative`) |
| C09 | Recent Meraki poller "successes" do not prove WAN collection [G148] | CONFIRMED | `tools/meraki/poll-wan-outages.js:33`, `sync-wan.js:42`, `sync-wan-events.js:28` return `{skipped:true}` without a key → C07 path |
| C10 | 3 Zoho jobs in error, assets stale, OpManager inactive (dev) [G98] | NEEDS-REVIEW.1-ARTIFACT | environment observation |
| C11 | Meraki key missing on dev; Zoho `invalid_client_secret` [G148] | NEEDS-HUMAN | credentials (operator) |
| C12 | Actuals, money rules, benefit and independent proof are distinguished [G106] | partly CONFIRMED gap; actuals OPEN-IN-PLAN-E (E-P04) | `db/postgres/reports/056_portfolio_benefits.sql`: no basis (observed/estimated/validated), no measurement period, no source; verification = "different person" (`services/portfolioBenefits.js` header). Budget per period/EAC: `w2-ppm` def1125; benefit owner link: E-P05 2e2dd6b |
| C13 | No field financial result measured [G106] | NEEDS-HUMAN | by definition |
| C14 | Validate method, period, currency, scope, evidence, verifier role before showing savings [G106] | NEEDS-HUMAN (Finance) + schema AGENT-DOABLE | F-DATA-09/10 |
| C15 | E08: select two decision KPIs [G256] | NEEDS-HUMAN (selection); preparation AGENT-DOABLE | F-DATA-11 |
| C16 | E08: verify the same figure in every output [G256] | partly ALREADY-FIXED; residual CONFIRMED | done: `tests/dashboard-figure-parity.test.js` (viewer = ChartTable = pack CSV/XLSX), `tests/report-figures-parity.test.js`; missing: `/data.csv` route (`routes/dashboards.js:150-160`), ext API, stale colour, partial flag, deck null→0 (`services/reportPayload.js:88,121-122` = DV-08) |
| C17 | E04: map each promoted KPI to its job and source [G248] | ALREADY-FIXED (mostly) | `publishGate.js:16-23` SOURCES, lineage "Freshness" column; inconsistency: publishGate says typed modules "always current", lineage header says "no sync job reads UNKNOWN" |
| C18 | Every KPI and chart shows definition, source, freshness, scope, period, limitations [V159, V194, V442] | CONFIRMED gap (definition/limitations) | viewer shows sources + computed_at (`public/dashboards.html:134-142`), window/partial/n; no formula/limitation on a tile (`public/lib/dashboardRender.js`: 0 refs to `formula`) |
| C19 | Widget catalogue with decision, owner, threshold, action link [V82, V496] | partly CONFIRMED | `docs/ops/METRIC-WIDGET-MAP.md` (generated) gives metric → widget; no persona/decision/owner per widget |
| C20 | Data-trust and value indicators (stale-widget frequency, disputes, value table) [V404, G220] | OPEN-IN-PLAN-E | E-D07 data-quality board (W2-SRV), E-B03 value table (W2-KPI); both inherit C07 until F-DATA-01 lands |
| C21 | Q1–Q4 paired observation, task success, trust [G258] | NEEDS-HUMAN | pilot sessions |
| C22 | Analyst profile "formula, denominator, window, export" [G196] | NEEDS-REVIEW.1-ARTIFACT | profile engine not in repo |

## (c) New findings (not in the documents)

| Id | Severity | Finding | Evidence |
|---|---|---|---|
| N1 | P0 defect | `wan.latest_site` ignores `win` and `sub_site`: picks the newest snapshot per uplink. A 13-week WAN trend draws the same value 13 times; a report regenerated for week W shows the latest week; Exploration `wan1('')` and `wan1('FETEKRO')` overwrite each other (the exact collapse CLAUDE.md forbids on the client). | `services/metricRegistry.js:216-222`; consumers `dashboardData.js:175`, `reportGenerator.js:19`, `extApi.js:76`; seeds `dashboardSeeds.js:39-40,72-73`; agenda `agendaBuilder.js:17` |
| N2 | P1 defect | Published `programme.site_score` / `programme.composite` need `deps.programme`, which no route provides → permanently null on the shipped Governance dashboard (2 widgets), the committee/group agendas and `/ext/v1` (served as published). | `metricRegistry.js:223-224`; `routes/dashboards.js:45-48`, `routes/metrics.js:14`, `routes/extApi.js`; `dashboardSeeds.js:90,92`; `agendaBuilder.js:19-20` |
| N3 | P1 defect | Report analysis computes "improving/worsening" with the running (partial) period as last point; partial flag, `n`, target, low-sample are dropped from `figures`. Count metrics read "improving" every mid-month. | `services/reportAnalysis.js:16-22,35,41-42` vs `dashboardData.js:154,175` |
| N4 | P1 defect | A generated report run keeps RAG colours on a stale/never-synced source (no `degradeStale`); an admin override publishes and freezes those colours, while the dashboard and the external API withdraw them (G05). | `services/reportGenerator.js:19-27`; `routes/reportStudio.js:128-138`; compare `routes/dashboards.js:133-135`, `routes/extApi.js` `tag()` |
| N5 | P1 defect | `/api/dashboards/:key/data.csv` writes the literal `'FRESH'` when a widget carries no freshness, omits partial / n / target / low_sample / error, leaves the window blank on per-site rows. | `routes/dashboards.js:150-160` |
| N6 | P1 defect | Group IT deck baseline converts null rates and durations to 0 and derives deltas from 0 (null ≠ 0 rule). Listed as DV-08 "defect candidate" by W2-KPI, not fixed. | `services/reportPayload.js:88,118-125,131-133` |
| N7 | P1 gap | Sample size `n` exists for only 3 metrics; the two SLA % (the most-used decision KPIs) have none because `getCalendarMonthlyHelpdesk` does not return its denominators → E-K02 low-sample guard is inert where it matters most. | `metricRegistry.js:243-252` |
| N8 | P1 gap | Fleet comparator reports `n` measured sites but not sites in scope — "mean of 2" reads like "mean of 11". | `services/dashboardData.js:146-149` |
| N9 | P2 gap | DB load of `metric_registry` selects no `field` / `source` / `certification`; a committee-added row has no field → always null; formula edits in the table are unversioned (versioning lives in `kpi_policies`). | `metricRegistry.js:296-300` |
| N10 | P2 honesty | 48/52 metrics carry the default `owner_role` `service-support-manager`; lineage prints it as the owner role though nobody decided it. | `metricRegistry.js:27` (`o.owner \|\| 'service-support-manager'`) |
| N11 | P1 Finance | Project currency silently defaults to USD (column default + audit default); a `money` benefit is accepted with no currency. | `db/postgres/reports/018_governance.sql:29`; `services/governanceStore.js:488,421-427` |
| N12 | P2 | Historical pages `kpi-dictionary.html`, `publication.html` (1.11 branch) have no redirect at head → bookmarks 404. | gap analysis annex; no route in `server.js` |
| N13 | P2 doc | publishGate "typed modules always current" vs lineage "no sync job → UNKNOWN" — two different stories for meetings/inspection freshness. | `publishGate.js:13-15`; `docs/ops/METRIC-LINEAGE.md` header |

## (d) Vision capability map — data domain

| Vision capability (section) | At head | Verdict | Evidence / next |
|---|---|---|---|
| KPI catalogue with source, formula, owner, refresh, thresholds (§WP2, Prompt 4) | registry + lineage + kpi_policies + kpi-builder | RETAIN / IMPROVE | add denominator, coverage, data state, real owner (F-DATA-07); formula sheet E-K01 |
| Data lineage and quality report (§Data and integrations) | METRIC-LINEAGE.md, drift detector E-D04, board E-D07 in W2-SRV | RETAIN / IMPROVE | lineage must say "reader not wired" / "window honoured" (F-DATA-03/07) |
| Freshness / source trust (§3.3 widget standard, §Data) | sync_runs + publishGate + stale banner | IMPROVE (defect) | F-DATA-01 |
| Explainable data on every widget (§3.2) | sources + as_of + partial + n | IMPROVE | definition/limitations drawer (F-DATA-07 part B) |
| Actionable analytics (red → action) | E-K03 in W2-KPI | RETAIN (in plan) | — |
| Widget/dashboard catalogue with decision per widget (Prompt 3) | METRIC-WIDGET-MAP.md | IMPROVE | F-DATA-12 (decision column blank for people) |
| Chart/KPI rationalisation (Prompt 4) | 2 change-success definitions, 2 score models | CONSOLIDATE — human | D-01..D-03, DV-01..DV-11 |
| Reporting & publication with four-eyes + freeze | Report Studio, report_publications, publishGate | RETAIN / IMPROVE | parity of stale/partial (F-DATA-04/05) |
| Semantic/external model (OData, ext API) | `routes/extApi.js` | RETAIN | in parity harness (F-DATA-05) |
| Group IT deck pipeline | reportPayload + render.py | IMPROVE (defect) | F-DATA-06 |
| Benefits realisation (§WP8, Prompt 12) | portfolio_benefits + value table E-B03 | IMPROVE | F-DATA-09 |
| Finance currency rules | per-site currency A-26 (proposed), EAC per currency E-P04 | CONSOLIDATE — human | F-DATA-10 |
| Adoption / data-trust measures | page usage, value table E-B03 | RETAIN (in plan) | depends on F-DATA-01 for "freshness share" |
| 1.11 KPI dictionary / publication pages | not ported, no redirect | RETIRE with redirect (human) | F-DATA-12 note / UX panel |
| AI commentary on figures | off by default, number check E-B08 | RETAIN | uses run figures → benefits from F-DATA-04 |

## (e) Goals for plan F

Common guardrails for all goals: PostgreSQL only; null = UNKNOWN (never 0/green); no approval, owner name, threshold or
certification written; defect fixes active by default, anything else behind a `report_config` key whose default keeps
today's behaviour + a FLAG-REGISTER / PILOT-PROFILE row; tests fail before and pass after; no new connector; evidence
in `docs/agent-execution/F-DATA-NN.md`.

### /goal — SDP360 / F-DATA-01 A skipped or unconfigured sync is not a fresh one
- **Problem**: C07/C08/C09 — `{skipped:true}` becomes `status:'ok'` + new watermark; health, dashboard banner, publication gate and ext API call the source FRESH.
- **Change**: `services/sync/jobs.js` (`legacyJob.fetch` throws/returns a typed skip: no rows, no `nextWatermark`); `services/sync/syncRunner.js` (new terminal status `skipped` with `reason`, watermark untouched, `finishRun(status:'skipped')`); `services/sync/syncStore.js` (`last_ok` = status 'ok' only — already; add `last_skipped`, `skip_reason`); `routes/sync.js` (status `not_configured` / `skipped`, last valid collection date preserved); `services/publishGate.js` unchanged logic (skip no longer refreshes `last_ok`). A genuinely complete fetch with 0 rows stays `ok` unless `failOnZero`.
- **Switch**: none (defect fix).
- **Tests**: update `tests/sync-jobs-registry.test.js:119-128` (skip ≠ ok), `tests/sync-runner.test.js` (watermark unchanged on skip), `tests/sync-routes.smoke.test.js` (not_configured shown, last valid date kept), new `tests/sync-skip-freshness.test.js` (skipped meraki.wan → publishGate state UNKNOWN/STALE, not FRESH; failure; real zero-row collection).
- **Guardrails**: alerter must not page on a skip of an optional job (`OPTIONAL`); E-B03 value table and E-D07 board read the new status.
- **Size** S · **Priority** P0 · **Depends** — · **AGENT-DOABLE yes** (no review.1, no human).

### /goal — SDP360 / F-DATA-02 WAN metrics honour the window and the sub-site
- **Problem**: N1.
- **Change**: `services/metricRegistry.js` reader `wan.latest_site` → read the snapshot whose `period_start` is the window's week (`win.from`), `sub_site=''` only (site-level metric); no snapshot for that week → null. Keep "latest" only for a `current` call with no window (dashboard default) and say so in `formula`. `reports-db.js` `_wanWhere` already filters — use `period_start`, `sub_site`.
- **Switch**: none (defect fix).
- **Tests**: `tests/metrics-registry.test.js` (two weeks of snapshots → two different values; sub-site rows ignored), `tests/dashboard-figure-parity.test.js` extension (WAN trend not flat), `tests/metric-lineage.test.js` (`--check` after formula text change).
- **Guardrails**: calibrated % Time Up unchanged (same column); WAN Health page and V1b-C fill untouched.
- **Size** S · **P0** · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-DATA-03 Every published metric is computable (registry integrity)
- **Problem**: N2 — published metrics whose reader dependency is never wired.
- **Change**: shared `services/metricDeps.js` building the reader deps once (rdb, mdb, idb, adb, tracker, trackerScore, commitmentStore, `programme: { siteScore, composite }` built on `siteReportDeps` score inputs + `computeSiteScore`, and `scoreboardData`/`siteScoreboard`); `routes/dashboards.js`, `routes/metrics.js`, `routes/extApi.js`, `routes/engagement.js`, `routes/trackers.js`, `routes/reportStudio.js` use it. A published metric whose reader still lacks deps is reported by the boot log and by lineage ("reader not wired").
- **Switch**: `metric_programme_readers` default `'0'` → today (null) for the programme pair only, because a number will appear where "—" was (scores are uncertified: D-01..D-03); wiring of the shared deps is not switched.
- **Tests**: new `tests/metric-registry-integrity.test.js` (every `published` SEED key resolves through `metricDeps` without "reader not wired" on a fixture DB); `tests/kpi-change-parity.test.js` stays green; `tests/await-precedence.test.js`.
- **Guardrails**: certification text "not certified — D-01/D-02/D-03 pending" kept on every surface; author models untouched (`siteScore.js`, `siteComposite.js` unedited).
- **Size** M · **P1** · **AGENT-DOABLE yes** (turning the switch on = human, model author + KPI committee).

### /goal — SDP360 / F-DATA-04 Report runs keep partial, stale and sample truths
- **Problem**: N3, N4.
- **Change**: `services/reportAnalysis.js` — `trendDirection` ignores a trailing `partial` point and needs ≥3 complete points; figures carry `partial`, `n`, `low_sample`, `target`, `freshness`; per-site best/worst skip low-sample rows. `services/reportGenerator.js` — compute freshness (`publishGate.freshness` for the def's modules) and apply `degradeStale` before `analyse`; store `sources` in the run. `services/reportPack.js` renders "partial", "n =", "colour withdrawn: source stale".
- **Switch**: none for the defect parts (partial trend, stale colour); display of `n` follows existing `ui_kpi_sample_size`.
- **Tests**: `tests/report-analysis*.test.js` (partial month never yields improving/worsening), `tests/report-figures-parity.test.js` (stale source: screen rag NA = run rag NA = ext API rag NA), golden pack outputs regenerated only where the new columns appear (state why in evidence).
- **Guardrails**: publication override still possible, but the frozen figures say the source state; AI commentary receives the same flags (E-B08 refusal on stale already in plan).
- **Size** M · **P1** · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-DATA-05 One figure, five surfaces: parity harness (E08 core)
- **Problem**: C16, N5 — parity is proven for viewer = ChartTable = pack; not for `/data.csv`, `/api/metrics/:key`, `/ext/v1/values`, report run, deck.
- **Change**: `routes/dashboards.js` CSV: freshness from `v.sources` per module (never a literal default), columns `partial`, `n`, `target`, `low_sample`, `error`, per-site window label. New test harness resolving ONE fixture selection (metric × site × window, including a null site, a partial month and a stale source) through all surfaces and printing a diff table (figure · surface · expected · got).
- **Switch**: none (CSV columns are additive; column order kept, new columns appended).
- **Tests**: new `tests/figure-parity-five-surfaces.test.js`; `tests/csv-safe.test.js`, `tests/csv-guard-coverage.test.js` neighbours.
- **Guardrails**: fixture data only, labelled; no production data.
- **Size** M · **P1** · **Depends** F-DATA-01, F-DATA-04 · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-DATA-06 Group IT deck: null stays null
- **Problem**: N6 / DV-08.
- **Change**: `services/reportPayload.js` — `_safeNum` keeps `def=0` only for counts read from a measured window; rates, durations, deltas use a `_nullable` helper (null in → null out; delta null if either side null). `tools/exec-pptx/render.py` renders None as "—" on tiles that can now receive it (check `_DEFAULTS`, kpi tile formatter).
- **Switch**: none (defect fix) — BUT release timing respects the monthly reporting freeze (human: release manager).
- **Tests**: `tests/exec-pptx*.test.js` (payload with null SLA → "—", not "0%"); `tests/pptx-monthly-golden.test.js` unchanged (different decks).
- **Size** S · **P1** · **AGENT-DOABLE yes** (deployment window = human).

### /goal — SDP360 / F-DATA-07 KPI contract completion: denominator, coverage, data state, definition on screen
- **Problem**: C05, C18, N7, N8, N9, N10, N13.
- **Change**: (A) `metricRegistry.js` — `BASES` extended where the reader can return its denominator: `reports-db.getCalendarMonthlyHelpdesk` returns `sla_res_den` and `sla_reply_den` (no formula change); `resolve()` returns `data_state` ∈ measured | not_measured | reader_not_wired | error | partial; DB load also selects `field`; SEED `owner_role` default becomes `null` ("to be named") with lineage printing "to be named". (B) `dashboardData.js` fleet `{n, of}`; tile info drawer in `public/lib/dashboardRender.js` showing formula, unit, window, denominator label, source job, certification text from `/api/metrics/:key` (behind `ui_kpi_definition_drawer`, default `'0'`). (C) `tools/agent/metric-lineage.js` prints denominator, data-state of a fixture resolve, publishGate vs lineage freshness wording aligned (N13).
- **Switch**: `ui_kpi_definition_drawer` default `'0'`; data fields additive.
- **Tests**: `tests/metrics-registry.test.js`, `tests/metric-lineage.test.js --check`, `tests/dashboard-figure-parity.test.js`, renderer byte-identical at `'0'`.
- **Guardrails**: no denominator invented; owner role never filled with a name.
- **Size** M · **P1** · **Depends** F-DATA-03 · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-DATA-08 Partial sources: keep the rows, say the total is unknown
- **Problem**: C04 / N8 (asset hygiene) and the same pattern wherever a reader loops labels/sites.
- **Change**: `metricRegistry.js` `assets.hygiene_site` — count unreadable labels; if any, `total` / `completeness_pct` null with `partial_source: {read, unread}`, counts per kind kept as "at least". Audit other multi-part readers (`meetings.insights_site`, `tracker.fleet`) and list them in evidence.
- **Switch**: none (defect fix: a confident lower total is a wrong number).
- **Tests**: `tests/assets-*-readers.test.js` (one label throws → total null, available rows kept).
- **Size** S · **P1** · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-DATA-09 Benefit measurement data model (observed / estimated / validated)
- **Problem**: C12, C14.
- **Change**: additive migration (number from the plan owner; after W2-PPM 072) on `portfolio_benefits`: `basis` (`observed` | `estimated_avoidance`), `baseline_period_from/to`, `measure_period_from/to`, `source_kind` (`metric` + `metric_key` | `manual`), `verifier_role_required` (text, nullable), `verification_independent` (derived: verifier holds the required role AND ≠ realised_by AND ≠ owner_user_id from E-P05). `services/portfolioBenefits.js` exposes `valueClass` = observed | estimated | validated (validated only when verified AND independent AND evidence link); totals never add estimated to observed; money values require `currency` when `basis` set. Project page benefit tab shows three separate columns.
- **Switch**: `benefit_value_classes_enabled` default `'0'` (today's form and view).
- **Tests**: `tests/portfolio-benefits.test.js` (class derivation, no mixed sums, money without currency refused when on), `tests/pg-*benefit*` store test, `tests/await-precedence.test.js`.
- **Guardrails**: no value, target, verifier or approval entered by the agent; "validated" never set by code alone.
- **Size** M · **P1** · **Depends** E-P05 (W2-PPM) · **AGENT-DOABLE yes** (method = Finance, human).

### /goal — SDP360 / F-DATA-10 Finance currency: no silent default
- **Problem**: N11.
- **Change**: `services/governanceStore.js` — when a budget/spent/money value is written without a currency, record `currency_defaulted=true` in the `ppm_events` note and return a warning; benefit `money` without currency → warning (refusal when `finance_currency_required='1'`). Portfolio views show "USD (default, not confirmed)" for such rows; mixed-currency totals already split (`portfolioEvidence.js:85`). Doc `docs/ops/FINANCE-CURRENCY-RULES.md`: one table of every money path (assets XOF×rate, licences USD, per-site map A-26, project/benefit/budget periods E-P04, WAN SLA credits), each with "rule in code" and "Finance decision pending".
- **Switch**: `finance_currency_required` default `'0'`.
- **Tests**: `tests/portfolio-finance*.test.js` (warning at 0, refusal at 1), doc link test.
- **Size** S · **P1** · **AGENT-DOABLE yes** (the rule itself = Finance).

### /goal — SDP360 / F-DATA-11 Two decision KPIs — proposal pack (E08)
- **Problem**: C15. Candidates proposed for the committee (not decided): (1) `helpdesk.resolution_sla_pct` per site / month — decision: OLA escalation or staffing at site; blocked until DV-01..DV-03 settled; (2) `inspection.overdue_actions` per site (count, no denominator dispute, full lineage, action link via E-K03) — decision: escalate site corrective actions at the monthly council. Rejected as candidates today: WAN availability (N1 until F-DATA-02), programme scores (D-01..03, N2), change success (D-01).
- **Change**: `docs/kpi/DECISION-KPIS-PROPOSAL.md` (per KPI: decision supported, decider role, formula, window, denominator, coverage today on a fixture, freshness job, parity test name, open divergences); a draft (unpublished) dashboard definition `decision-kpis` in `dashboardSeeds.js` behind `dashboard_decision_kpis_seed` default `'0'`.
- **Tests**: doc-link test (every cited file:line/test exists), F-DATA-05 harness includes both keys.
- **Size** S · **P2** · **Depends** E-K01, F-DATA-05 · **AGENT-DOABLE yes** (selection/adoption = human).

### /goal — SDP360 / F-DATA-12 Dashboard/widget catalogue with a decision column
- **Problem**: C06, C19, N12.
- **Change**: optional definition fields `question`, `decision`, `audience_role`, `action_href` per widget (validator accepts, composer shows; empty = "not stated"); `tools/agent/widget-catalogue.js` → `docs/ops/WIDGET-CATALOGUE.md` (`--check`): per seed widget: metric, persona, source job, freshness, owner role, threshold source (kpi_targets / policy / none), action link, states covered (loading/empty/stale/partial/denied), decision = blank. Legacy `kpi-dictionary.html` / `publication.html`: list in the catalogue as "retire or redirect — decision pending".
- **Switch**: none (fields optional, generator dev-only).
- **Tests**: `tests/widget-catalogue.test.js` (`--check` stale detection), `tests/dashboard-widgets*.test.js` (new fields accepted, ignored when absent).
- **Size** S · **P2** · **AGENT-DOABLE yes**.

## (f) Decisions that belong to people

| Decision | Owner role |
|---|---|
| Which two KPIs are decision KPIs; what decision each one drives; thresholds and minimum sample | KPI committee (chair) + Service & Support Manager |
| DV-01…DV-11 (SLA rule, cancelled tickets, change success D-01, score models D-02/D-03, windows) | KPI committee; model author for the score models |
| Turning on `metric_programme_readers` (uncertified scores shown as numbers) | model author + KPI committee |
| Metric owners (48 placeholder roles) and data stewards per source | IT management / data owner |
| Benefit method: baseline period, measurement period, observed vs estimated rules, verifier role, evidence standard | Finance controller + PMO |
| Default currency, per-site currency map, FX rates and their source/date | Finance |
| Release window for the deck null→"—" change (reporting freeze) | Release manager / report owner |
| Credentials for Meraki / SDP Cloud / Zoho and which sources are promoted to "decision data" | Integration owner + Information Security |
| Retire or redirect the 1.11 `kpi-dictionary.html` / `publication.html` bookmarks | Product owner |
| Pilot observation Q1–Q4, data-trust measurement, benefit reviews on real data | Pilot lead + site coordinators + Finance |
