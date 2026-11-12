# R5 native project workbench — gap list against head (R1-DEMO, 12 Nov 2026)

Source: `REBUILD-SPEC.md` row R5 — "Project page as a workbench: plan, tasks, dependencies, milestones,
teams/resources, risks, changes, time/actuals, costs, benefits, list / board / timeline views of the portfolio,
controlled roadmap publication (private → portfolio with preview + confirmation, parity, duplicates, archive,
rollback)". Compared with head `37e93f8` (branch `goal/r1-demo`). Line numbers drift; re-check before editing.
**Nothing here is implemented by R1-DEMO** (F1-PPM edits those files now). The goals below are for **R2-WORKBENCH**
(after the F1-PPM merge; migration **085** is assigned to that bundle).

The synthetic demonstration (`tools/demo/seed-demo.js`, `tests/e2e/demo-journey.spec.js`) exercises every PRESENT
item on a throwaway database; the PARTIAL / MISSING items are the ones it had to work around.

## Verdict table

| # | R5 item | Verdict | Evidence on head |
|---|---|---|---|
| 1 | Plan (WBS, schedule, critical path, Gantt, baseline vs forecast vs actual) | **PRESENT** | `portfolio_tasks` (`db/postgres/reports/039_native_ppm.sql`), `services/projectSchedule.js` (`scheduleView`, `criticalPath`, `varianceOf`), Plan tab `public/project.html:87`; tests `project-page.test.js`, `ppm-project-lifecycle.smoke.test.js` (8), `ppm-baselines.smoke.test.js` (8); demo asserts the plan rows |
| 2 | Tasks | **PRESENT** | `TABLES.task` `services/governanceStore.js:395`, `PUT /api/governance/portfolio/task` `routes/governance.js:540` (plan-write rule A-15) |
| 3 | Dependencies | **PRESENT** (finish-to-start only) | `depends_on` + `dependencyProblem` (exists, same family, no cycle) `services/projectSchedule.js:20`; project-level `depends_on` too. Limit: no SS/FF/SF type, no lag, no task→task link across projects |
| 4 | Milestones | **PRESENT** | `TABLES.milestone` (baseline_date, owner — `044_project_page.sql`), Milestones tab `public/project.html:115`, workbook sheet "Milestones" |
| 5 | Teams / resources | **PARTIAL** | owner is free text; `allocation_pct` + `resourceConflicts` `services/projectSchedule.js:82`; capacity per site/week behind `ppm_capacity_view` (`routes/governancePpm.js`, `ppm-capacity.test.js` 5); RACI behind `ppm_raci_enabled` (`073_ppm_raci_templates.sql`, `ppm-raci-templates.test.js` 5). **Missing**: a project team (named members + role), person ids instead of free text, availability / calendar per person |
| 6 | Risks (RAID) | **PRESENT** | `portfolio_risks.kind` risk / issue / assumption (`RISK_KINDS` `services/governanceStore.js:287`), RAID tab `public/project.html:131`, probability × impact matrix on the portfolio |
| 7 | Changes (change requests) | **MISSING** | no change-request entity. Nearest: committee re-baseline with a reason behind `ppm_rebaseline_enabled` (`rebaseline` `services/governanceStore.js:704`) + the `ppm_events` ledger. The demo records its change request as a governance RFI — a stand-in, documented |
| 8 | Time / actuals | **PARTIAL** | planned `effort_hours` per task (`044`), task `actual_start` / `actual_end`, money actuals per month × currency behind `ppm_budget_periods_enabled` (`072`, `ppm-budget-periods.test.js` 5). **Missing**: time entries (who, day, hours) and actual-vs-planned hours; effort hours absent from the workbook export |
| 9 | Costs | **PARTIAL** | project budget / spent / currency, multi-currency summary `budget_by_currency`, money-read rule (`canSeeMoney` `routes/governance.js:482`); budget periods baseline / actual / forecast (switch). **Missing**: budget periods are not in `/portfolio/workbook.xlsx` nor the deck (`services/portfolioDeck.js:105`) — an export never shows the per-period actuals the screen shows |
| 10 | Benefits | **PRESENT** | `056_portfolio_benefits.sql`, realised value + evidence link + independent verification (`routes/governance.js:595`), Benefits tab, workbook sheet "Benefits"; tests `portfolio-benefits.test.js`, `portfolio-benefits.smoke.test.js` (8), e2e `c4-pmo-demand-project-benefit.spec.js` |
| 11 | Portfolio views: list / board / timeline | **PARTIAL** | timeline `#timeline` `public/portfolio.html:63` (keyboard-operable); list = the table view folded inside a `<details>` under it. **Missing**: a board (columns by stage or status), a first-class view switch with the choice kept in the URL |
| 12 | Controlled roadmap publication (private → portfolio) | **PARTIAL** | `POST /api/governance/roadmap-migration` `routes/governance.js:690`: dry-run preview by default, `?apply=1` applies, refuses a second run (409 "already migrated") ; parity report `services/roadmapParity.js` + `GET /api/roadmap/parity` + `tools/governance/roadmap-parity.js` (`roadmap-parity.test.js` 13) ; roadmap read-only switch `roadmap_redirect_to_portfolio` `routes/roadmap.js:18`. **Missing**: a page with preview → explicit confirmation (API only today); duplicate detection per objective / deliverable (only the programme key is checked); an archive state for the published source; a rollback ("delete it to redo" = manual); and it only publishes ONE hard-wired source (the super_admin's personal roadmap), not any private draft plan |

Counts: PRESENT 6 · PARTIAL 5 · MISSING 1.

## Ready `/goal` prompts (R2-WORKBENCH)

Common to every prompt: PostgreSQL only; new behaviour behind a `report_config` switch defaulting to today
(`services/reportConfig.js` DEFAULTS + a `docs/ops/pilot/PILOT-PROFILE.md` row + `node tools/agent/flag-register.js`);
errors through `httpFail`; no new hex colour in `public/`; French strings in `public/lib/i18n/<page>.fr.js` when the
page is in the i18n coverage test; a number with no source is `null` / "—", never 0; tests fail before and pass after;
the access rules are the existing helpers (`refusePlanWrite`, `readableProject`, `canSeeMoney`, `isCommittee`) —
never a new rule. Extend `tests/e2e/demo-journey.spec.js` + `tools/demo/seed-demo.js` when an item becomes PRESENT
(the demo's stand-in change request must then become a real one).

### /goal — SDP360 / R2-WB-01 change requests (item 7, MISSING)
Add a native project change request. Migration `085_ppm_change_requests.sql` (shared with the other R2-WORKBENCH
tables if needed): `ppm_change_requests(id identity, project_id FK CASCADE, title, reason, impact_dates_days NULL,
impact_budget NULL, currency NULL, status proposed|assessed|approved|rejected|applied|withdrawn, author_id, decided_by,
decided_at, decision_note, applied_baseline_version NULL, created_at)`. Store functions in
`services/governanceStore.js` (or a new `services/ppmChangeRequests.js` pure validator + store calls) writing a
`ppm_events` row per transition. Routes in `routes/governancePpm.js` under `/api/governance/ppm/project/:id/changes`
behind switch `ppm_change_requests_enabled` ('0' → 404): create = plan-write rule; assess / approve / reject =
committee, **approver ≠ author** (403); apply on an approved CR with dates impact calls the existing `rebaseline`
(needs `ppm_rebaseline_enabled`, else 409 with the reason). Money impact only visible under `canSeeMoney`. A
"Changes" tab in `public/project.html` (shown only when `/ppm/features` says so). Tests: pure lifecycle
(illegal transitions refused), smoke (404 while off, author cannot approve, apply → baseline version written, ledger
rows), e2e step in the demo journey. Workbook sheet "Changes".

### /goal — SDP360 / R2-WB-02 time entries and actual hours (item 8, PARTIAL)
Add `ppm_time_entries(id, task_id FK CASCADE, person_user_id NULL, person_label, day DATE text YYYY-MM-DD, hours
NUMERIC >= 0 CHECK <= 24, note, created_by, created_at)` in migration 085. Switch `ppm_time_entries_enabled`.
Routes under `/api/governance/ppm/task/:id/time` (GET readable project; POST/DELETE plan-write rule; a person may
always record their OWN time on a task of a readable project — decide with the PO, default = plan-write rule only).
`services/projectSchedule.js` gains a pure `actualHours(tasks, entries)` → per task `{planned: effort_hours|null,
actual: sum|null, variance}` where no entry = `null`, not 0. Plan tab shows planned / actual / variance columns.
Add `effort_hours` and actual hours to the workbook "Tasks" sheet (`services/portfolioDeck.js:114`). Tests: pure
(null vs 0), smoke (switch off 404, cross-site 404 under `portfolio_site_scope_reads`), workbook parity.

### /goal — SDP360 / R2-WB-03 budget periods in the exports (items 8–9, PARTIAL)
`buildWorkbookBuffer` (`services/portfolioDeck.js:105`) gets a "Budget periods" sheet (project, period, currency,
kind, amount, reason) ONLY when `showMoney` AND `ppm_budget_periods_enabled = '1'`; `exportData`
(`routes/governance.js` near the workbook route) passes the periods of the readable projects. Never mix currencies in
one total. Tests: `portfolio-deck.test.js` (sheet absent without money / with switch off; present and equal to
`store.listBudgetPeriods` otherwise); extend the demo e2e: XOF and USD actuals appear in the workbook with the
screen's figures.

### /goal — SDP360 / R2-WB-04 project team and resource identity (item 5, PARTIAL)
`ppm_project_members(project_id, user_id NULL, label, role, allocation_pct NULL, from_day, to_day)` in 085; switch
`ppm_project_team_enabled`. A "Team" panel on the Overview tab; task owner picker offers the members (free text
still accepted — no migration of existing owners). `resourceConflicts` / `capacityBySite` read member allocation
when present, otherwise unchanged. Tests: pure conflicts with and without members (unchanged output when no
member — golden), smoke RBAC (plan-write rule), no change while the switch is off.

### /goal — SDP360 / R2-WB-05 portfolio list / board / timeline (item 11, PARTIAL)
`public/portfolio.html`: a view switch (Timeline · List · Board) with `?view=` kept in the URL (reuse the URL-filter
helper shipped by W2-UX); List = today's table promoted out of `<details>`; Board = columns by `stage`
(`STAGES` from `/api/governance/portfolio`), cards keyboard-reachable, read-only (moving a card is NOT a stage
move — stage moves stay on the gated project page). Switch `portfolio_views_enabled` ('0' = today's single
timeline). Tests: static (exactly one `aria-current` view, escapeHtml on every field), e2e (t8 keyboard journey still
green; board shows the demo project under its stage), ui-design ratchet (tokens only).

### /goal — SDP360 / R2-WB-06 controlled roadmap publication (item 12, PARTIAL)
Turn the API-only migration into a controlled publication: (a) a "Publish to portfolio" section on
`public/itsm-roadmap.html` that calls the existing dry run and shows the plan, then requires an explicit
confirmation (`ReasonDialog.confirm`) before `?apply=1`; (b) duplicate detection per objective key and per
deliverable name (normalised like `roadmapParity.norm`) reported in the dry run and refused at apply unless
`?skip_duplicates=1`; (c) after apply, show `/api/roadmap/parity` and only then offer the read-only switch; (d) a
rollback `POST /api/governance/roadmap-migration/rollback` (super_admin, dry run by default) that SOFT-deletes the
migrated programme subtree through the existing soft-delete path (`soft_delete_enabled`), never a hard delete;
(e) an archive state = the existing `roadmap_redirect_to_portfolio` + a recorded `ppm_events` "published" row.
Switch `roadmap_publication_enabled` ('0' = API as today). Tests: `roadmap-parity.test.js` neighbours + smoke (dry run
writes nothing, duplicate refused, rollback dry run lists the subtree, apply after rollback works).
