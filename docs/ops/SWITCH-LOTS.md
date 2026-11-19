# Switch activation lots — PROPOSED plan (P03)

**Generated** by `node tools/agent/switch-lots.js` from `docs/ops/FLAG-REGISTER.json` (the dark switches) and
`docs/ops/switch-lots.json` (the agent's proposal). Do not edit by hand; `--check` fails when this file is out of date
or the plan breaks a rule (`tests/switch-lots.test.js`).

> **Nothing here is approved.** Every lot is PROPOSED by an AI agent. Owner, canary site, decision dates, expiry,
> thresholds and the numeric rollback trigger are **left empty on purpose** — they are human fields of
> `docs/ops/flag-decisions.json`. No switch was turned on anywhere but a throwaway test database.

## Summary

| Dark switches in the register | In a lot | Keep dark | Retire (proposal) | Lots | Proposed count after decisions |
|---|---|---|---|---|---|
| 152 | 111 | 38 (of which 5 are not switches) | 3 | 13 | 144 dark entries if the 3 retirements and the 5 reclassifications are accepted (activations then lower it further, lot by lot) |

Plan checks: **clean** · dependency cycles: **0** · orphans (no code reads the key): **0**.

## Lots (ordered by user journey)

| Lot | Journey | Switches | Status |
|---|---|---|---|
| L01 | Daily work journey | 10 | PROPOSED — Suggested first lot (prompt-pack P03). |
| L02 | PMO journey — portfolio and project reading | 10 | PROPOSED — Suggested second lot (prompt-pack P03). |
| L03 | PMO journey — change control, baselines and gates | 9 | PROPOSED |
| L04 | PMO journey — scheduling, resources and collaboration | 9 | PROPOSED |
| L05 | PMO journey — time, money and benefits | 10 | PROPOSED |
| L06 | PMO journey — optional plan exchange (extras) | 6 | PROPOSED |
| L07 | Roadmap publication and portfolio sensitivity | 7 | PROPOSED |
| L08 | Governance cadence — decisions, reviews, handovers | 10 | PROPOSED |
| L09 | KPI trust — read-only explanations on dashboards | 10 | PROPOSED |
| L10 | Reporting rhythm — reminders, drift and deck clarity | 8 | PROPOSED |
| L11 | Site operations evidence — inspections, field, assets, WAN | 7 | PROPOSED |
| L12 | Access security hardening | 10 | PROPOSED |
| L13 | Operations resilience — sync drift, delivery failures, restore, identity | 5 | PROPOSED |

Run a lot's targeted tests with its switches forced on (throwaway database only):

```
export SDP_FORCE_SWITCHES="$(node tools/agent/switch-lots.js --lot=L01 --force)"
NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --require $PWD/tools/test/force-switches.js --import file://$PWD/tests/_pg-boot.mjs" \
  node --test --test-force-exit $(node tools/agent/switch-lots.js --lot=L01 --tests)
```

## Dossier L01 — Daily work journey

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: Every signed-in person (site coordinators, site IT, technicians, managers); data stewards for the data-quality board.
- **What changes**: Workspace profiles and settings page; Home shows one queue of the person's own work, per-block states, an 'Awaiting me' list; commitments become a register; role landing page; menu active entry from the address and site carried in links; data-quality board for the admin tier; feedback button.
- **Risk**: low-medium (AI estimate): presentation and read-only queues; every reader keeps its own site check. commitments_enabled opens a new write surface (commitments register).
- **Metric that would show it worked** (candidate, no threshold): value-scoreboard: share of pilot users opening Home ▸ My work weekly; first-click success (FIRST-CLICK-PROTOCOL) on the daily tasks.
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: none.

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `workspace_profiles_enabled` | PO | once the PO confirms the 11 profiles and their first destinations — presentation profiles  | — | — | — | — | 9 | 7 |
| `ui_role_landing` | Owner (UI policy) | — | — | — | — | — | 5 | 2 |
| `ui_home_queue` | Owner (UI policy) | after a browser review in EN and FR at 320 px: Home shows one queue of the person's own work read from the existing per-site readers  | — | — | portfolio_benefits, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_projects, portfolio_tasks +2 | — | 8 | 5 |
| `ui_home_blocks` | Owner (UI policy) | after a browser review: per-block states and per-card reload on Home | — | — | — | — | 2 | 2 |
| `commitments_enabled` | to be named | — | — | — | action_items, audit_log, commitments, connector_fix_tasks, field_outbox, gov_control_tests +22 | yes | 21 | 11 |
| `mywork_awaiting_me_enabled` | Product owner | once the product owner has compared it with the review | `commitments_enabled` | — | portfolio_benefits, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_projects, portfolio_tasks +2 | — | 4 | 2 |
| `ui_data_quality_page` | Data owner | A data steward per source to act on the board. | — | admin | — | — | 2 | 2 |
| `ui_nav_active_from_url` | Owner (UI policy) | — | — | — | — | — | 2 | 2 |
| `ui_nav_carry_site` | Owner (UI policy) | — | — | — | — | — | 2 | 2 |
| `ui_feedback_enabled` | PO | Someone named to answer feedback (B-05 RACI) before the button is shown. | — | admin | portfolio_benefits, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_projects, portfolio_tasks +2 | — | 8 | 3 |

## Dossier L02 — PMO journey — portfolio and project reading

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: PMO, project managers, committee members, site editors reading their site's projects.
- **What changes**: Portfolio scoped to the reader's sites, list/board views, 'My projects' default, named project team and project roles, RACI per task, RAID log, composite project RAG, on-demand project report, Simplified/Expert switch.
- **Risk**: medium (AI estimate): portfolio_site_scope_reads changes who reads which project (narrows reads to own sites); project roles feed capability checks.
- **Metric that would show it worked** (candidate, no threshold): share of active projects with a named team and an up-to-date RAG at the monthly committee.
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: none.

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `portfolio_site_scope_reads` | Owner (access policy) | — | — | — | — | — | 6 | 8 |
| `portfolio_views_enabled` | PMO | once the PMO wants the portfolio read as a list or a board as well as the timeline  | — | — | — | — | 3 | 0 |
| `portfolio_my_projects_default` | PMO | once the PMO wants the portfolio page to open on "My projects"  | — | admin, finance-viewer | — | — | 3 | 1 |
| `ppm_project_team_enabled` | PMO | once the PMO wants a named team per project  | — | — | portfolio_deliverables, portfolio_objectives, portfolio_programmes, portfolio_projects | — | 5 | 3 |
| `ppm_project_roles_enabled` | PMO | once the PMO decides who holds which PROJECT role  | `ppm_project_team_enabled` | admin | — | — | 8 | 2 |
| `ppm_raci_enabled` | PMO | — | — | — | — | — | 3 | 1 |
| `ppm_raid_enabled` | PMO + Finance | once the PMO wants the RAID log  | — | admin, finance-viewer | — | — | 6 | 1 |
| `ppm_project_rag_enabled` | PMO | once the PMO adopts a composite project RAG  | — | — | — | — | 5 | 1 |
| `ppm_project_report_enabled` | PMO | once the PMO wants the project status report on demand  | — | admin, finance-viewer | — | — | 3 | 1 |
| `ppm_simplified_view_enabled` | PMO | once the PMO wants the Simplified ↔ Expert switch on the project page  | — | admin, finance-viewer | — | — | 5 | 1 |

## Dossier L03 — PMO journey — change control, baselines and gates

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: PMO, committee, project managers; site editors (plan writes).
- **What changes**: Baseline written at approval, committee re-baseline, change requests (with simulation), gate checklists, MS-Project-style baseline slots, DCMA schedule check, templates; editors of the project's site may write plans.
- **Risk**: HIGH (AI estimate): portfolio_editor_plan_writes WIDENS write access (site editors write plans that only the committee writes today) — STOP-AND-REPORT, access-policy owner decision required.
- **Metric that would show it worked** (candidate, no threshold): share of schedule changes going through a change request; number of re-baselines per project per quarter.
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: none.

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `ppm_baseline_versions` | Committee | — | — | — | decisions, meeting_cadences, meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits +16 | — | 7 | 1 |
| `ppm_rebaseline_enabled` | Committee | — | — | — | portfolio_deliverables, portfolio_objectives, portfolio_programmes, portfolio_projects, portfolio_tasks, ppm_change_requests +4 | — | 7 | 3 |
| `ppm_change_requests_enabled` | PMO | once the PMO adopts a change-control step on projects  | `ppm_rebaseline_enabled` | — | dashboard_definition_versions, dashboard_definitions, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives +9 | — | 7 | 2 |
| `ppm_cr_simulation_enabled` | PMO | once the PMO wants change requests decided on simulated numbers: a request may list task changes  | `ppm_change_requests_enabled`, `ppm_rebaseline_enabled` | — | portfolio_deliverables, portfolio_objectives, portfolio_programmes, portfolio_projects | — | 4 | 2 |
| `ppm_gate_checklist_enabled` | PMO | once the PMO defines gate checklists: per project and target stage, required artifacts  | — | — | — | — | 7 | 1 |
| `ppm_baseline_slots_enabled` | PMO | once the PMO wants MS-Project-style comparison points: Baseline, Baseline1 | — | — | — | — | 4 | 1 |
| `ppm_dcma_enabled` | PMO / scheduler | once the PMO wants the DCMA 14-point schedule quality check on the Plan tab  | — | — | — | — | 3 | 1 |
| `ppm_templates_enabled` | PMO (template validation is a human act) | once the PMO names who validates templates  | — | — | — | — | 4 | 1 |
| `portfolio_editor_plan_writes` | Owner (access policy) | — | — | — | — | — | 6 | 4 |

## Dossier L04 — PMO journey — scheduling, resources and collaboration

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: PMO, schedulers, project managers, project teams.
- **What changes**: Task scheduling editor (modes, constraints, link types), interactive Gantt, calendars, resource pool and levelling proposals, team-load (capacity) view, board view, Now/Next/Later roadmap, append-only comments with in-app mentions.
- **Risk**: medium (AI estimate): interactive Gantt writes through the existing task route and plan-write guard; capacity meaning undefined until CAPACITY-DATA-CONTRACT is signed.
- **Metric that would show it worked** (candidate, no threshold): share of pilot projects with a dependency-linked schedule; levelling proposals accepted vs rejected.
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: none.

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `ppm_schedule_engine_v2_ui` | PMO | once the PMO wants to enter scheduling data on tasks  | — | editor | — | — | 5 | 1 |
| `ppm_gantt_v2_enabled` | PMO | once the PMO has tried it on a pilot project: the Plan tab shows the interactive, virtualised Gantt  | — | — | — | — | 3 | 1 |
| `ppm_calendars_enabled` | PMO | once the PMO wants schedules on real working time: project / task / resource calendars  | — | — | — | — | 4 | 1 |
| `ppm_resources_enabled` | PMO + Finance | once the PMO maintains an enterprise resource pool: work / material / cost resources  | — | — | — | — | 4 | 1 |
| `ppm_leveling_enabled` | PMO | once the PMO wants levelling proposals: delay-only, priority-based  | `ppm_resources_enabled` | — | — | — | 4 | 1 |
| `ppm_capacity_view` | PMO + capacity owner (to be named) | once the PMO accepts the team-load reading  | — | — | decisions, meeting_cadences, meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits +16 | — | 5 | 1 |
| `ppm_agile_board_enabled` | PMO | once the PMO wants a board view: a Board tab on the project page with the work packages  | — | — | — | — | 1 | 0 |
| `ppm_roadmap_nnl_enabled` | PMO | once the PMO wants a Now / Next / Later roadmap on the portfolio  | — | — | — | — | 2 | 0 |
| `ppm_comments_enabled` | PMO | once the PMO wants discussion on projects and tasks: append-only comments  | — | — | — | — | 4 | 1 |

## Dossier L05 — PMO journey — time, money and benefits

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: PMO, Finance controller, finance-viewer, benefit owners, CIO (annual pack).
- **What changes**: Time entries and timesheet approval, earned value, budget periods, actuals FILE import (dry run first), mandatory currency, finance certification by a named verifier, benefit value classes and benefit owners as users, annual planning pack (draft).
- **Risk**: HIGH (AI estimate): money surfaces — money stays admin tier + finance-viewer; certification must never be shown without a named verifier; actuals import is a manual file, never a Pronto connector (boundary).
- **Metric that would show it worked** (candidate, no threshold): share of projects with actuals reconciled to budget periods each month; certified vs uncertified money tiles.
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: `ppm_baseline_versions` (L03).

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `ppm_time_entries_enabled` | PMO + PO | once the PMO wants actual hours per task  | — | — | portfolio_deliverables, portfolio_objectives, portfolio_programmes, portfolio_projects | — | 5 | 3 |
| `ppm_timesheet_approval_enabled` | PMO | once the PMO wants approved hours: the Plan tab gains "Timesheet weeks"  | `ppm_time_entries_enabled` | — | portfolio_deliverables, portfolio_objectives, portfolio_programmes, portfolio_projects, portfolio_tasks, ppm_change_requests +4 | — | 7 | 2 |
| `ppm_evm_enabled` | PMO + Finance | once the PMO and Finance agree to read earned value  | `ppm_baseline_versions` | — | — | — | 6 | 2 |
| `ppm_budget_periods_enabled` | Finance + PMO | once Finance agrees the period grid  | — | — | — | — | 5 | 2 |
| `actuals_import_enabled` | Finance controller + PMO | once Finance supplies the Pronto export layout and the rate source: dated FX rates  | `ppm_budget_periods_enabled` | admin | portfolio_projects, ppm_budget_periods | — | 5 | 3 |
| `finance_currency_required` | Finance controller | once Finance requires a stated currency on every amount  | — | — | decisions, meeting_cadences, meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits +16 | — | 2 | 2 |
| `finance_certification_enabled` | Finance controller (names the verifier) + Owner | once Finance names the verifier  | — | super_admin, admin, editor, finance-viewer | portfolio_projects, ppm_budget_periods | — | 9 | 4 |
| `benefit_value_class_enabled` | Finance + executive sponsor | once Finance and the sponsor agree the classes used at a benefits review  | — | — | — | — | 5 | 2 |
| `benefit_owner_link_enabled` | PMO | once the PMO wants benefit owners named as users  | — | — | portfolio_benefits, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_projects, portfolio_tasks +2 | — | 7 | 2 |
| `ppm_annual_pack_enabled` | CIO + PMO + Finance | — | — | — | — | — | 3 | 2 |

## Dossier L06 — PMO journey — optional plan exchange (extras)

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: PMO and project teams that plan in an external tool; IT admin (credentials).
- **What changes**: MSPDI XML and P6 XER exchange, .mpp import through a locally installed converter, read-only Jira / Azure DevOps pulls, offline task edits queued on the project page.
- **Risk**: medium (AI estimate): optional extras only (boundary 2026-11-12: the native tool must stay fully usable alone); Jira/AzDO need credentials (human); offline edits need a field test.
- **Metric that would show it worked** (candidate, no threshold): number of plans exchanged without manual re-keying; offline queue items stuck (should be zero).
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: none.

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `ppm_mspdi_enabled` | PMO | once the PMO wants to exchange plans with MS Project as an XML file  | — | — | — | — | 3 | 1 |
| `ppm_xer_enabled` | PMO | only if the PMO exchanges plans with Primavera P6  | — | — | — | — | 2 | 1 |
| `ppm_mpp_import_enabled` | IT admin + PMO | only if the PMO receives binary  | — | — | — | — | 2 | 1 |
| `ppm_jira_sync_enabled` | PMO + IT admin | only if a project team plans in Jira  | — | super_admin, admin | — | — | 4 | 1 |
| `ppm_azdo_sync_enabled` | PMO + IT admin | only if a project team plans in Azure DevOps  | — | — | — | — | 4 | 2 |
| `ppm_offline_edit_enabled` | PMO | once a field test is planned: task / milestone edits made on the project page without a connection are kept on the device  | — | — | — | — | 1 | 0 |

## Dossier L07 — Roadmap publication and portfolio sensitivity

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: Service & Support Manager, PMO publication owner, committee, exec readers of the monthly pack, incubation coordinators.
- **What changes**: Publish Roadmap Manager into the portfolio (dry run → apply → parity), audience snapshots with optional public link (never amounts), soft delete with two-person rule for portfolio nodes, sensitive projects, portfolio slide in the exec pack, incubation-born RFIs in the queue.
- **Risk**: medium (AI estimate): public share link for site/programme snapshots (never amounts — to verify in the lot run); soft delete is the rollback of a publication.
- **Metric that would show it worked** (candidate, no threshold): roadmap parity checks clean after publication; snapshots published per audience.
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: `portfolio_site_scope_reads` (L02).

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `soft_delete_enabled` | Owner (retention policy) | — | — | — | decisions, meeting_cadences, meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits +16 | — | 13 | 7 |
| `soft_delete_two_person` | Owner (retention policy) | once the retention owner wants deletions of portfolio nodes and cadences to need a reason  | `soft_delete_enabled` | admin | — | — | 4 | 3 |
| `roadmap_publication_enabled` | Service & Support Manager | once the Service & Support Manager wants to publish the Roadmap Manager into the portfolio from the page  | `soft_delete_enabled` | — | portfolio_deliverables, portfolio_objectives, portfolio_programmes, portfolio_projects, roadmap_publications | — | 6 | 2 |
| `roadmap_audience_publication_enabled` | PMO (publication owner) | once the PMO names the publication owner and the audiences to use: frozen roadmap snapshots per audience  | `roadmap_publication_enabled` | admin, finance-viewer | roadmap_publications | — | 6 | 2 |
| `portfolio_sensitive_projects` | Owner (access policy) | once the access-policy owner decides who may mark a project sensitive  | `portfolio_site_scope_reads` | admin | — | — | 6 | 3 |
| `exec_pack_portfolio_slide` | Committee | once the committee wants portfolio highlights in the monthly Group IT pack: one slide  | — | admin, finance-viewer | change_records, request_records, sites | — | 2 | 2 |
| `incubation_rfi_link_enabled` | PMO + Owner | once the PMO accepts incubation-born RFIs in the queue  | — | — | — | — | 4 | 1 |

## Dossier L08 — Governance cadence — decisions, reviews, handovers

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: Governance committee chair, committee members, site managers, incident and problem owners, site IT leads (shifts).
- **What changes**: Decision lifecycle and mandatory motive, site obligations count decisions, draft Monday agendas (nothing sent), controls register (candidates), post-incident reviews, problem candidates, handoffs register, shift handover, A01 escalation of commitments without a due date.
- **Risk**: medium (AI estimate): new mandatory fields change daily gestures; nothing is sent (handoff notifications stay dark in the keep list).
- **Metric that would show it worked** (candidate, no threshold): share of committee decisions with owner + due date + motive; handoffs accepted within the shift.
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: `commitments_enabled` (L01).

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `decision_lifecycle_enforced` | Governance committee chair | once the governance committee chair accepts the rule  | — | — | — | — | 3 | 2 |
| `decision_motive_required` | Governance committee chair | once the governance committee chair wants a written motive on EVERY decision status change  | `decision_lifecycle_enforced` | — | decisions, meeting_cadences, meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits +16 | — | 3 | 3 |
| `obligations_include_decisions` | Committee + Owner | — | — | — | — | — | 2 | 1 |
| `agenda_cron_enabled` | Committee | — | — | — | — | yes | 5 | 2 |
| `controls_register_enabled` | GRC owner + Security owner | once GRC names who adopts controls  | — | — | gov_control_tests, gov_controls, site_module_codes, sites | — | 4 | 1 |
| `pir_reviews_enabled` | Incident manager + business sponsor | once the Incident manager names who signs a post-incident review and the business sponsor per major incident  | — | — | — | — | 3 | 1 |
| `problem_candidates_enabled` | Problem owner + Owner | once a problem owner is named  | — | — | — | — | 1 | 1 |
| `handoffs_enabled` | to be named | — | — | — | portfolio_benefits, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_projects, portfolio_tasks +2 | — | 9 | 5 |
| `shift_handover_enabled` | Site IT lead + Owner | once the incoming / outgoing people of each shift are on the duty roster  | — | — | — | — | 3 | 1 |
| `a01_missing_due_date` | Commitments owner (D-04) | — | `commitments_enabled` | — | — | — | 3 | 1 |

## Dossier L09 — KPI trust — read-only explanations on dashboards

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: All dashboard readers; KPI committee.
- **What changes**: Base population line, sample-size warnings (only once a min_sample is adopted), definition drawer, metric explanation, small multiples, shareable URL filters, human-entered chart notes with a source, red-tile → action links (needs commitments), value scoreboard, translated pages.
- **Risk**: low (AI estimate): display only, no figure the server did not send; nothing is certified by showing a definition.
- **Metric that would show it worked** (candidate, no threshold): drill/definition-drawer opens per week; questions to the KPI committee about 'what does this number mean'.
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: `commitments_enabled` (L01).

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `ui_kpi_base_line` | Owner (UI policy) | — | — | — | — | — | 3 | 2 |
| `ui_kpi_sample_size` | KPI committee | once the KPI committee adopts a `min_sample`) | — | — | — | — | 4 | 3 |
| `ui_kpi_definition_drawer` | KPI committee | — | — | — | — | — | 4 | 2 |
| `metric_explain_enabled` | KPI committee | — | — | — | — | — | 1 | 1 |
| `ui_small_multiples` | Owner (UI policy) | after a browser review of the widget) | — | — | — | — | 3 | 2 |
| `ui_url_filters` | Owner (UI policy) | — | — | — | — | — | 2 | 2 |
| `chart_annotations_enabled` | Owner (UI policy) | after a browser review | — | — | — | — | 4 | 1 |
| `dashboard_red_action_links` | Owner (UI policy) + PMO | — | `commitments_enabled` | — | — | — | 4 | 1 |
| `value_scoreboard_enabled` | Owner (UI policy) + KPI committee | once the committee agrees the value contract  | — | super_admin, admin | value_scoreboard_snapshots | — | 4 | 2 |
| `ui_i18n_pages` | Owner (D-2) | — | — | — | — | — | 37 | 5 |

## Dossier L10 — Reporting rhythm — reminders, drift and deck clarity

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: Site coordinators, Service & Support Manager, reporting owner, admins, HR/department heads (roll-up).
- **What changes**: Report drift banner, 'Other (n)' bucket on deck charts, alert digest grouped by rule, in-app schedule reminders, weekly-report nudges, action-ageing reminders, connector health page, department roll-up.
- **Risk**: low-medium (AI estimate): in-app only; deck output changes (golden fingerprint expected to move for exec_deck_other_bucket).
- **Metric that would show it worked** (candidate, no threshold): weekly reports submitted on time (WEEKLY-REPORT-STOPWATCH); overdue site actions.
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: none.

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `report_drift_banner` | Owner (D-3) | — | — | — | — | — | 3 | 0 |
| `exec_deck_other_bucket` | Reporting owner (PO P4) | — | — | — | change_records, request_records, sites | — | 3 | 1 |
| `alert_group_by_rule` | Owner (alerting policy) | — | — | — | insp_inspections, md_meetings, meeting_cadences, notifications | — | 3 | 1 |
| `schedule_reminders_enabled` | Site coordination owner | once the lead days are decided  | — | — | insp_inspections, md_meetings, meeting_cadences, notifications | yes | 3 | 1 |
| `weekly_report_nudges_enabled` | Service & Support Manager | once the deadline below is decided — in-app nudges only  | — | — | notifications, weekly_reports, weeks | — | 1 | 2 |
| `action_aging_reminders_enabled` | Service & Support Manager | once the delays below are decided — in-app reminders on site actions  | — | — | notifications | yes | 2 | 2 |
| `connector_health_page_enabled` | Owner (UI policy) | once the admins are told where the page is: shows the **Connector health** entry  | — | admin | — | — | 1 | 1 |
| `department_rollup_enabled` | HR / department heads + Group IT | only after HR / the department heads and Group IT have reviewed the crosswalk  | — | — | department_crosswalk | — | 2 | 1 |

## Dossier L11 — Site operations evidence — inspections, field, assets, WAN

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: Inspection owner, technicians (field app), Finance, Network owner.
- **What changes**: Repeat findings, independent verification of Critical/High corrective actions, field review step and task timing baseline, certified asset-money display, WAN SLA contract evidence required, WAN SLA claims register.
- **Risk**: medium (AI estimate): money display (admin tier + finance-viewer only); claims e-mail never leaves while the WAN notify arm is dark.
- **Metric that would show it worked** (candidate, no threshold): share of Critical/High actions independently verified; field form time per task (baseline only).
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: none.

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `insp_repeat_findings` | Infrastructure / inspection owner | once the inspection owner sets the window below  | — | — | decisions, insp_actions, insp_inspections, md_actions, md_meetings, portfolio_projects +2 | — | 4 | 1 |
| `insp_action_verify_enabled` | Infrastructure / inspection owner + GRC | once the inspection owner confirms that Critical and High corrective actions need an independent check  | — | — | — | — | 3 | 1 |
| `field_review_step` | PO / adoption lead | after one session shows it does not slow the technician  | — | — | — | — | 2 | 2 |
| `field_task_timing` | PO / adoption lead | only after the baseline  | — | — | action_items, audit_log, commitments, field_outbox, insp_actions, insp_inspections +11 | — | 4 | 2 |
| `asset_money_certify_display` | Finance / IT management | — | — | — | — | — | 3 | 2 |
| `wan_sla_require_contract_evidence` | Finance | once contracts are uploaded | — | — | wan_sla_claim_events, wan_sla_claims | — | 4 | 1 |
| `wan_sla_claims_enabled` | Finance + Network owner | once Finance names the claim owner and the contract terms of that circuit are entered and reviewed  | `wan_sla_require_contract_evidence` | admin, finance-viewer | decisions, insp_actions, insp_inspections, md_actions, md_meetings, portfolio_projects +2 | — | 6 | 2 |

## Dossier L12 — Access security hardening

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: Security owner, super_admins, every account (sign-in), direction (executive read-only), data owner (exports).
- **What changes**: Per-account sign-in throttle and failures-only limiter, nightly grant expiry, approval before a grant, emergency access, break-glass time box, recertification campaign (answers recorded only), executive read-only portfolio, strict export policy and watermark.
- **Risk**: HIGH (AI estimate): can lock people out (throttle, approvals, read-only direction); break-glass must stay possible.
- **Metric that would show it worked** (candidate, no threshold): expired grants ended per night; sign-in lock-outs reported to the helpdesk.
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: none.

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `auth_account_throttle_enabled` | Security owner | — | — | — | — | — | 2 | 2 |
| `login_limit_failures_only` | Security owner | once the Security owner accepts it  | — | — | — | — | 1 | 1 |
| `access_grant_expiry_job` | Security owner | — | — | — | — | yes | 3 | 1 |
| `access_require_approval` | Security owner + Owner (approver matrix) | once the approver rule and the requires_request list are decided  | — | — | access_grants, access_recert_campaigns, access_recert_lines, access_request_events, access_requests, access_template_versions +5 | — | 3 | 4 |
| `emergency_access_enabled` | Security owner + Owner | once the super_admins who may grant and review are named  | — | super_admin, admin | access_emergencies, access_request_events, access_requests, deputies | yes | 5 | 2 |
| `breakglass_timebox_enabled` | Security owner | once the security owner names the break-glass holder and SSO is `available` / `only` — a break-glass password sign-in then needs a reason  | — | admin | sessions | — | 2 | 3 |
| `access_recert_enabled` | Security owner + site managers | once the Security owner schedules the first campaign  | — | — | — | — | 4 | 2 |
| `portfolio_executive_readonly` | Owner + IAM | only after the PO / IAM decide that the direction reads the portfolio without changing it  | — | super_admin, executive, admin, committee-member | — | — | 2 | 1 |
| `export_policy_strict` | Data owner + Security | once the data owner + security adopt the strict sensitivity matrix of `services/exportPolicy | — | admin, viewer, finance-viewer, committee-member | — | — | 1 | 2 |
| `export_watermark_enabled` | Security | — | `export_policy_strict` | — | — | — | 2 | 2 |

## Dossier L13 — Operations resilience — sync drift, delivery failures, restore, identity

- **Status**: PROPOSED. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.
- **Who sees a change**: Platform/ops owner, data owners per flow, Information Security, data owner (site codes).
- **What changes**: Drift alerts through the existing sync alert path, delivery-failure alerts, full restore drill (TEST instance), Entra deprovisioning DRY RUN, controlled 409 on shared site codes.
- **Risk**: medium (AI estimate): alerts use the already-armed sync alert path (recipients needed); site_code_shared_block refuses saves until the data owner fixes shared codes.
- **Metric that would show it worked** (candidate, no threshold): sync drift alerts acknowledged; restore drill RTO measured (no threshold set here).
- **Rollback**: set every switch of the lot back to its default `0` (Admin or `setConfig`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is `tests/switch-lots-rollback.test.js`. **Rollback trigger**: _(observable and threshold left to the owner)_.
- **Needs earlier lots**: none.

| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |
|---|---|---|---|---|---|---|---|---|
| `sync_drift_alerts` | Ops + data owner per flow | once each flow has an owner  | — | — | — | yes | 3 | 1 |
| `delivery_failure_alert_enabled` | Platform owner (D-13) | once `sync_alert_recipients`  | — | — | report_sent_log, sync_runs | yes | 4 | 1 |
| `restore_drill_full` | Operations owner | once a backup copy of `data/blobs` exists  | — | — | report_config, system_log | — | 1 | 1 |
| `entra_deprovision_enabled` | Information Security + tenant administrator | only after the tenant administrator decides on the Graph `User | — | — | users | yes | 2 | 2 |
| `site_code_shared_block` | Data owner + Owner | Decide who owns each shared site code (e.g. TND) and correct the data first; then test the controlled 409 and the editors' rights. | — | editor | — | — | 4 | 3 |

## Keep dark (with the reason)

### armed in production (4)

Outbound send. The code default is dark but CLAUDE.md (2026-09-23) records it ARMED in production; the owner must record a keep decision for the production value — not a lot activation.

- `weekly_report_send_enabled` — decides: to be named
- `scoreboard_send_enabled` — decides: to be named
- `hygiene_send_enabled` — decides: to be named
- `asset_group_send_enabled` — decides: to be named

### outbound (9)

Sends something outside the server (e-mail, Teams, webhook, scheduled publication, source-system write). Stays dark until a reviewed recipient list, a dry run and the notifications_stop test (alert_external_enabled prerequisite) — a separate outbound decision, not a journey lot.

- `alert_external_enabled` — decides: to be named
- `asset_new_alert_enabled` — decides: to be named
- `asset_reminder_send_enabled` — decides: to be named
- `commitment_notify_enabled` — decides: to be named
- `handoff_notify_enabled` — decides: to be named
- `teams_sla_enabled` — decides: to be named
- `publish_cron_enabled` — decides: to be named
- `ppm_report_send_enabled` — decides: PMO
- `sla_wan_config.notify.enabled` — decides: Network owner

### source system write (1)

Writes to ServiceDesk Plus. Boundary: source systems are read-only. Keep dark; any activation is a CAB/owner decision outside this plan.

- `sdp_api_write_enabled` — decides: to be named

### kill switch (1)

Emergency stop for every notification; dark is its correct resting state.

- `notifications_stop` — decides: to be named

### not a switch (5)

A setting or a recorded fact, not a behaviour switch — the register counts it as dark only because its default is '0'. PROPOSED: exclude it from the dark list in tools/agent/flag-register.js (reclassification; no code removal).

- `smtp_secure` — decides: to be named
- `asset_replacement_uplift_pct` — decides: to be named
- `group_report_to_confirmed` — decides: to be named
- `exec_view_min_cell` — decides: Owner (reverses Exec View v1)
- `tracker_engine_cutover` — decides: to be named

### irreversible or destructive (4)

Deletes, revokes or migrates one way; keep dark until the named prerequisite has run on TEST and the owner decides.

- `soft_delete_purge_enabled` — decides: Owner (retention policy)
- `entra_deprovision_apply` — decides: Information Security
- `access_recert_apply` — decides: Security owner
- `roadmap_redirect_to_portfolio` — decides: PMO + PO (deletion of roadmap data: CAB)

### committee policy (8)

Changes a published number or an official policy; needs an adopted committee decision (DEC/D-xx) first — not an activation lot.

- `kpi_policy_enforced` — decides: KPI committee + Owner
- `site_codes_from_registry` — decides: Data owner + KPI committee
- `sla_headline_definition` — decides: KPI committee
- `metric_programme_readers` — decides: KPI committee + model author
- `dashboard_decision_kpis_seed` — decides: KPI committee
- `ui_exec_charts_v2` — decides: Executive sponsor + data / BI owner
- `ppm_alerts_enabled` — decides: Committee
- `asset_cost_outlier_exclude` — decides: Finance

### external precondition (6)

Waits for a fact that does not exist yet (privacy notice, HSE evidence, non-UTC site, AI provider, real-device field sessions, installer E2E on TEST).

- `ux_event_telemetry` — decides: Data protection officer + Owner (UI policy)
- `qualification_check_enabled` — decides: HSE owner + Security owner
- `site_local_calendar` — decides: Owner + Finance (month-end figures)
- `ai_commentary_stale_block` — decides: Owner (AI) + KPI committee
- `field_outbox_resolve_enabled` — decides: PO + site IT
- `frozen:installer_safety_parity` — decides: Owner (deployment)

## Retire list (proposals — no code was deleted)

| Switch | Why it looks dead or superseded | What removal would delete |
|---|---|---|
| `frozen:tracker_green_band_90` | Pseudo-switch for a frozen deployment lot. The sibling repository's CLAUDE.md (step 5, DEC-4, 2026-10-22) records the tracker freeze as RELEASED and the files shipped by hand. If the owner confirms production carries commit 437a80f, the entry is dead. | the FROZEN_FALLBACK entry in tools/agent/flag-register.js (no product code) |
| `frozen:tracker_weighted_donut` | Same release as above (commit b681083, App.jsx). | the FROZEN_FALLBACK entry in tools/agent/flag-register.js (no product code) |
| `opmanager_tls_insecure` | Superseded by opmanager_ca_bundle (the client logs a warning telling the operator to paste the CA bundle and set it back to 0). Turning it on disables TLS verification; it has no place in an activation lot. | the key in services/reportConfig.js DEFAULTS, the tlsInsecure branch in services/opmanagerClient.js and the admin field — only after the owner confirms production value is 0 and a CA bundle is pasted |

## Dependency graph

Edges = a switch whose register text (recommended value or prerequisite) names another dark switch, plus the plan's
`dependencies_extra`; mentions listed in `dependencies_soft` (e.g. "nothing is sent while `notifications_stop`") are not edges.

| Switch | Class | Depends on |
|---|---|---|
| `a01_missing_due_date` | L08 | `commitments_enabled` (L01) |
| `access_recert_apply` | keep:irreversible_or_destructive | `access_recert_enabled` (L12) |
| `actuals_import_enabled` | L05 | `ppm_budget_periods_enabled` (L05) |
| `alert_external_enabled` | keep:outbound | `notifications_stop` (keep:kill_switch) |
| `commitment_notify_enabled` | keep:outbound | `commitments_enabled` (L01) |
| `dashboard_red_action_links` | L09 | `commitments_enabled` (L01) |
| `decision_motive_required` | L08 | `decision_lifecycle_enforced` (L08) |
| `entra_deprovision_apply` | keep:irreversible_or_destructive | `entra_deprovision_enabled` (L13) |
| `export_watermark_enabled` | L12 | `export_policy_strict` (L12) |
| `handoff_notify_enabled` | keep:outbound | `handoffs_enabled` (L08) |
| `mywork_awaiting_me_enabled` | L01 | `commitments_enabled` (L01) |
| `portfolio_sensitive_projects` | L07 | `portfolio_site_scope_reads` (L02) |
| `ppm_change_requests_enabled` | L03 | `ppm_rebaseline_enabled` (L03) |
| `ppm_cr_simulation_enabled` | L03 | `ppm_change_requests_enabled` (L03), `ppm_rebaseline_enabled` (L03) |
| `ppm_evm_enabled` | L05 | `ppm_baseline_versions` (L03) |
| `ppm_leveling_enabled` | L04 | `ppm_resources_enabled` (L04) |
| `ppm_project_roles_enabled` | L02 | `ppm_project_team_enabled` (L02) |
| `ppm_report_send_enabled` | keep:outbound | `ppm_project_report_enabled` (L02) |
| `ppm_timesheet_approval_enabled` | L05 | `ppm_time_entries_enabled` (L05) |
| `roadmap_audience_publication_enabled` | L07 | `roadmap_publication_enabled` (L07) |
| `roadmap_publication_enabled` | L07 | `soft_delete_enabled` (L07) |
| `roadmap_redirect_to_portfolio` | keep:irreversible_or_destructive | `roadmap_publication_enabled` (L07) |
| `soft_delete_purge_enabled` | keep:irreversible_or_destructive | `soft_delete_enabled` (L07) |
| `soft_delete_two_person` | L07 | `soft_delete_enabled` (L07) |
| `wan_sla_claims_enabled` | L11 | `wan_sla_require_contract_evidence` (L11) |

Cycles: none.

Orphans (dark keys no code file reads, outside `services/reportConfig.js`): none.

## Cross-lot overlaps (pairwise tests needed)

Pairs of switches in different lots that share a consumer file or a table named in that file's SQL. Hub files read by more
than 6 lot switches (and the two monoliths) are excluded: sharing them says nothing. File-level approximation.
Hub files excluded: `public/portfolio.html`, `public/project.html`, `routes/governance.js`, `routes/governancePpm.js`, `routes/governanceW3.js`, `routes/governanceWorkbench.js`, `routes/myWork.js`, `server.js`, `services/reportCatalogue.js`, `services/sync/jobs.js`, `services/uiPolicy.js`. Hub tables excluded: decisions, meeting_cadences, portfolio_projects, portfolio_tasks, ppm_budget_periods, ppm_events, ppm_project_members, sites.

| Lot pair | Overlapping switch pairs |
|---|---|
| L01 × L03 | 3 |
| L01 × L05 | 6 |
| L01 × L08 | 5 |
| L01 × L09 | 2 |
| L01 × L10 | 3 |
| L01 × L11 | 3 |
| L01 × L12 | 1 |
| L01 × L13 | 3 |
| L02 × L03 | 9 |
| L02 × L04 | 1 |
| L02 × L05 | 3 |
| L02 × L07 | 3 |
| L02 × L12 | 2 |
| L03 × L04 | 6 |
| L03 × L05 | 9 |
| L03 × L06 | 1 |
| L03 × L07 | 3 |
| L03 × L08 | 4 |
| L03 × L11 | 2 |
| L03 × L12 | 2 |
| L03 × L13 | 2 |
| L04 × L05 | 1 |
| L04 × L06 | 4 |
| L04 × L07 | 1 |
| L04 × L08 | 1 |
| L05 × L07 | 1 |
| L05 × L08 | 1 |
| L05 × L09 | 1 |
| L05 × L11 | 2 |
| L05 × L13 | 1 |
| L07 × L08 | 2 |
| L07 × L09 | 2 |
| L07 × L10 | 3 |
| L07 × L11 | 3 |
| L07 × L12 | 2 |
| L07 × L13 | 1 |
| L08 × L09 | 2 |
| L08 × L11 | 1 |
| L09 × L10 | 1 |
| L09 × L11 | 3 |
| L10 × L11 | 8 |
| L11 × L12 | 3 |
| L11 × L13 | 7 |
| L12 × L13 | 1 |

| Lots | Switch A | Switch B | Shared files | Shared tables |
|---|---|---|---|---|
| L01 × L03 | `commitments_enabled` | `ppm_baseline_versions` | `public/help.html` | — |
| L01 × L03 | `commitments_enabled` | `ppm_change_requests_enabled` | — | users |
| L01 × L03 | `commitments_enabled` | `ppm_rebaseline_enabled` | `public/help.html` | users |
| L01 × L05 | `benefit_owner_link_enabled` | `mywork_awaiting_me_enabled` | `public/lib/home-page.js`, `services/myWork.js` | — |
| L01 × L05 | `benefit_owner_link_enabled` | `ui_feedback_enabled` | `public/lib/home-page.js` | — |
| L01 × L05 | `benefit_owner_link_enabled` | `ui_home_blocks` | `public/lib/home-page.js` | — |
| L01 × L05 | `benefit_owner_link_enabled` | `ui_home_queue` | `public/lib/home-page.js`, `services/myWork.js` | — |
| L01 × L05 | `benefit_owner_link_enabled` | `workspace_profiles_enabled` | `public/lib/home-page.js` | — |
| L01 × L05 | `commitments_enabled` | `ppm_timesheet_approval_enabled` | — | users |
| L01 × L08 | `commitments_enabled` | `controls_register_enabled` | `routes/policies.js`, `services/controlRegister.js` | gov_control_tests, gov_controls, site_module_codes |
| L01 × L08 | `commitments_enabled` | `handoffs_enabled` | `public/help.html`, `routes/handoffs.js`, `routes/obligations.js`, `services/governanceValues.js` | — |
| L01 × L08 | `commitments_enabled` | `obligations_include_decisions` | `routes/obligations.js` | — |
| L01 × L08 | `commitments_enabled` | `pir_reviews_enabled` | `routes/commitments.js` | — |
| L01 × L08 | `commitments_enabled` | `problem_candidates_enabled` | `routes/commitments.js` | — |
| L01 × L09 | `commitments_enabled` | `dashboard_red_action_links` | `routes/commitments.js` | — |
| L01 × L09 | `ui_i18n_pages` | `ui_role_landing` | `tools/reports/set-ui-policy.js` | — |
| L01 × L10 | `alert_group_by_rule` | `commitments_enabled` | — | insp_inspections, md_meetings |
| L01 × L10 | `commitments_enabled` | `schedule_reminders_enabled` | — | insp_inspections, md_meetings |
| L01 × L10 | `commitments_enabled` | `weekly_report_nudges_enabled` | — | weekly_reports, weeks |
| L01 × L11 | `commitments_enabled` | `field_task_timing` | `services/pilotMetrics.js`, `tools/pilot/pilot-metrics.js` | action_items, audit_log, commitments, field_outbox, insp_actions, insp_inspections, md_action_updates, md_actions, md_meetings, report_config, site_module_codes, sync_runs, system_log, users, weekly_reports, weeks |
| L01 × L11 | `commitments_enabled` | `insp_repeat_findings` | — | insp_actions, insp_inspections, md_actions, md_meetings, system_log |
| L01 × L11 | `commitments_enabled` | `wan_sla_claims_enabled` | — | insp_actions, insp_inspections, md_actions, md_meetings, system_log |
| L01 × L12 | `access_require_approval` | `commitments_enabled` | — | system_log |
| L01 × L13 | `commitments_enabled` | `delivery_failure_alert_enabled` | — | sync_runs |
| L01 × L13 | `commitments_enabled` | `entra_deprovision_enabled` | — | users |
| L01 × L13 | `commitments_enabled` | `restore_drill_full` | — | report_config, system_log |
| L02 × L03 | `portfolio_editor_plan_writes` | `portfolio_site_scope_reads` | `db/postgres/reports/043_portfolio_scope.sql`, `db/postgres_rollback/043_portfolio_scope_drop.sql`, `services/portfolioAccess.js`, `tools/agent/portfolio-access-matrix.js` | — |
| L02 × L03 | `portfolio_editor_plan_writes` | `ppm_project_roles_enabled` | `services/portfolioAccess.js` | — |
| L02 × L03 | `ppm_change_requests_enabled` | `ppm_project_team_enabled` | `db/postgres/reports/085_ppm_workbench.sql` | — |
| L02 × L03 | `ppm_dcma_enabled` | `ppm_project_rag_enabled` | `services/ppm/w3Context.js` | — |
| L02 × L03 | `ppm_dcma_enabled` | `ppm_raid_enabled` | `services/ppm/w3Context.js` | — |
| L02 × L03 | `ppm_gate_checklist_enabled` | `ppm_project_rag_enabled` | `db/postgres/reports/110_ppm_governance_w3.sql`, `db/postgres_rollback/110_ppm_governance_w3_drop.sql`, `services/ppm/w3Context.js` | — |
| L02 × L03 | `ppm_gate_checklist_enabled` | `ppm_raid_enabled` | `db/postgres/reports/110_ppm_governance_w3.sql`, `db/postgres_rollback/110_ppm_governance_w3_drop.sql`, `services/ppm/w3Context.js` | — |
| L02 × L03 | `ppm_gate_checklist_enabled` | `ppm_simplified_view_enabled` | `db/postgres/reports/110_ppm_governance_w3.sql`, `db/postgres_rollback/110_ppm_governance_w3_drop.sql` | — |
| L02 × L03 | `ppm_raci_enabled` | `ppm_templates_enabled` | `db/postgres/reports/073_ppm_raci_templates.sql`, `db/postgres_rollback/073_ppm_raci_templates_drop.sql` | — |
| L02 × L04 | `ppm_comments_enabled` | `ppm_project_roles_enabled` | `db/postgres/reports/108_ppm_roles_comments.sql`, `db/postgres_rollback/108_ppm_roles_comments_drop.sql`, `routes/governanceCollab.js` | — |
| L02 × L05 | `ppm_evm_enabled` | `ppm_project_rag_enabled` | `services/ppm/w3Context.js` | — |
| L02 × L05 | `ppm_evm_enabled` | `ppm_raid_enabled` | `services/ppm/w3Context.js` | — |
| L02 × L05 | `ppm_project_team_enabled` | `ppm_time_entries_enabled` | `db/postgres/reports/085_ppm_workbench.sql` | — |
| L02 × L07 | `exec_pack_portfolio_slide` | `portfolio_site_scope_reads` | `services/execPackPortfolio.js` | — |
| L02 × L07 | `portfolio_sensitive_projects` | `portfolio_site_scope_reads` | `services/execPackPortfolio.js`, `services/portfolioAccess.js` | — |
| L02 × L07 | `portfolio_sensitive_projects` | `ppm_project_roles_enabled` | `services/portfolioAccess.js` | — |
| L02 × L12 | `export_policy_strict` | `ppm_project_report_enabled` | `services/exportPolicy.js` | — |
| L02 × L12 | `export_watermark_enabled` | `ppm_project_report_enabled` | `services/exportPolicy.js` | — |
| L03 × L04 | `ppm_baseline_slots_enabled` | `ppm_calendars_enabled` | `db/postgres/reports/105_ppm_engine_w2.sql`, `db/postgres_rollback/105_ppm_engine_w2_drop.sql`, `routes/ppmEngine.js` | — |
| L03 × L04 | `ppm_baseline_slots_enabled` | `ppm_leveling_enabled` | `db/postgres/reports/105_ppm_engine_w2.sql`, `db/postgres_rollback/105_ppm_engine_w2_drop.sql`, `routes/ppmEngine.js` | — |
| L03 × L04 | `ppm_baseline_slots_enabled` | `ppm_resources_enabled` | `db/postgres/reports/105_ppm_engine_w2.sql`, `db/postgres_rollback/105_ppm_engine_w2_drop.sql`, `routes/ppmEngine.js` | — |
| L03 × L04 | `ppm_baseline_slots_enabled` | `ppm_schedule_engine_v2_ui` | `routes/ppmEngine.js` | — |
| L03 × L04 | `ppm_baseline_versions` | `ppm_capacity_view` | `services/governanceStore.js` | meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_project_sites, portfolio_risks, ppm_alert_state, ppm_raci, ppm_templates, rfi_requests, session_actions |
| L03 × L04 | `ppm_capacity_view` | `ppm_change_requests_enabled` | — | portfolio_objectives, portfolio_programmes, rfi_requests |
| L03 × L05 | `finance_currency_required` | `ppm_baseline_versions` | `services/governanceStore.js` | meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_project_sites, portfolio_risks, ppm_alert_state, ppm_raci, ppm_templates, rfi_requests, session_actions |
| L03 × L05 | `finance_currency_required` | `ppm_change_requests_enabled` | — | portfolio_objectives, portfolio_programmes, rfi_requests |
| L03 × L05 | `ppm_budget_periods_enabled` | `ppm_change_requests_enabled` | `services/portfolioDeck.js` | — |
| L03 × L05 | `ppm_change_requests_enabled` | `ppm_time_entries_enabled` | `db/postgres/reports/085_ppm_workbench.sql` | — |
| L03 × L05 | `ppm_change_requests_enabled` | `ppm_timesheet_approval_enabled` | — | users |
| L03 × L05 | `ppm_cr_simulation_enabled` | `ppm_timesheet_approval_enabled` | `db/postgres/reports/102_ppm_timesheets_cr_simulation.sql`, `db/postgres_rollback/102_ppm_timesheets_cr_simulation_drop.sql` | — |
| L03 × L05 | `ppm_dcma_enabled` | `ppm_evm_enabled` | `services/ppm/w3Context.js` | — |
| L03 × L05 | `ppm_evm_enabled` | `ppm_gate_checklist_enabled` | `services/ppm/w3Context.js` | — |
| L03 × L05 | `ppm_rebaseline_enabled` | `ppm_timesheet_approval_enabled` | `services/ppmWorkbenchStore.js` | ppm_change_requests, ppm_time_entries, ppm_timesheet_weeks, users |
| L03 × L06 | `ppm_baseline_slots_enabled` | `ppm_mspdi_enabled` | `db/postgres_rollback/105_ppm_engine_w2_drop.sql`, `routes/ppmEngine.js` | — |
| L03 × L07 | `portfolio_editor_plan_writes` | `portfolio_sensitive_projects` | `services/portfolioAccess.js` | — |
| L03 × L07 | `ppm_baseline_versions` | `soft_delete_enabled` | `services/governanceStore.js` | meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_project_sites, portfolio_risks, ppm_alert_state, ppm_raci, ppm_templates, rfi_requests, session_actions |
| L03 × L07 | `ppm_change_requests_enabled` | `soft_delete_enabled` | — | portfolio_objectives, portfolio_programmes, rfi_requests |
| L03 × L08 | `decision_motive_required` | `ppm_baseline_versions` | `services/governanceStore.js` | meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_project_sites, portfolio_risks, ppm_alert_state, ppm_raci, ppm_templates, rfi_requests, session_actions |
| L03 × L08 | `decision_motive_required` | `ppm_change_requests_enabled` | — | portfolio_objectives, portfolio_programmes, rfi_requests |
| L03 × L08 | `handoffs_enabled` | `ppm_baseline_versions` | `public/help.html` | — |
| L03 × L08 | `handoffs_enabled` | `ppm_rebaseline_enabled` | `public/help.html` | — |
| L03 × L11 | `field_task_timing` | `ppm_change_requests_enabled` | — | users |
| L03 × L11 | `field_task_timing` | `ppm_rebaseline_enabled` | — | users |
| L03 × L12 | `access_require_approval` | `ppm_change_requests_enabled` | — | sessions |
| L03 × L12 | `breakglass_timebox_enabled` | `ppm_change_requests_enabled` | — | sessions |
| L03 × L13 | `entra_deprovision_enabled` | `ppm_change_requests_enabled` | — | users |
| L03 × L13 | `entra_deprovision_enabled` | `ppm_rebaseline_enabled` | — | users |
| L04 × L05 | `finance_currency_required` | `ppm_capacity_view` | `services/governanceStore.js` | meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_project_sites, portfolio_risks, ppm_alert_state, ppm_raci, ppm_templates, rfi_requests, session_actions |
| L04 × L06 | `ppm_calendars_enabled` | `ppm_mspdi_enabled` | `db/postgres_rollback/105_ppm_engine_w2_drop.sql`, `routes/ppmEngine.js` | — |
| L04 × L06 | `ppm_leveling_enabled` | `ppm_mspdi_enabled` | `db/postgres_rollback/105_ppm_engine_w2_drop.sql`, `routes/ppmEngine.js` | — |
| L04 × L06 | `ppm_mspdi_enabled` | `ppm_resources_enabled` | `db/postgres_rollback/105_ppm_engine_w2_drop.sql`, `routes/ppmEngine.js` | — |
| L04 × L06 | `ppm_mspdi_enabled` | `ppm_schedule_engine_v2_ui` | `routes/ppmEngine.js` | — |
| L04 × L07 | `ppm_capacity_view` | `soft_delete_enabled` | `services/governanceStore.js` | meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_project_sites, portfolio_risks, ppm_alert_state, ppm_raci, ppm_templates, rfi_requests, session_actions |
| L04 × L08 | `decision_motive_required` | `ppm_capacity_view` | `services/governanceStore.js` | meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_project_sites, portfolio_risks, ppm_alert_state, ppm_raci, ppm_templates, rfi_requests, session_actions |
| L05 × L07 | `finance_currency_required` | `soft_delete_enabled` | `services/governanceStore.js` | meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_project_sites, portfolio_risks, ppm_alert_state, ppm_raci, ppm_templates, rfi_requests, session_actions |
| L05 × L08 | `decision_motive_required` | `finance_currency_required` | `services/governanceStore.js` | meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_project_sites, portfolio_risks, ppm_alert_state, ppm_raci, ppm_templates, rfi_requests, session_actions |
| L05 × L09 | `finance_certification_enabled` | `ui_i18n_pages` | `public/assets.html` | — |
| L05 × L11 | `asset_money_certify_display` | `finance_certification_enabled` | `public/assets.html` | — |
| L05 × L11 | `field_task_timing` | `ppm_timesheet_approval_enabled` | — | users |
| L05 × L13 | `entra_deprovision_enabled` | `ppm_timesheet_approval_enabled` | — | users |
| L07 × L08 | `decision_lifecycle_enforced` | `soft_delete_two_person` | `public/cockpit.html` | — |
| L07 × L08 | `decision_motive_required` | `soft_delete_enabled` | `services/governanceStore.js` | meeting_sessions, minutes_history, portfolio_baselines, portfolio_benefits, portfolio_deliverables, portfolio_milestones, portfolio_objectives, portfolio_programmes, portfolio_project_sites, portfolio_risks, ppm_alert_state, ppm_raci, ppm_templates, rfi_requests, session_actions |
| L07 × L09 | `incubation_rfi_link_enabled` | `ui_i18n_pages` | `public/meeting.html` | — |
| L07 × L09 | `soft_delete_enabled` | `ui_i18n_pages` | `public/reports.html` | — |
| L07 × L10 | `alert_group_by_rule` | `roadmap_audience_publication_enabled` | `routes/engagement.js` | — |
| L07 × L10 | `exec_deck_other_bucket` | `exec_pack_portfolio_slide` | `services/reportPayload.js` | change_records, request_records |
| L07 × L10 | `report_drift_banner` | `soft_delete_enabled` | `public/reports.html` | — |
| L07 × L11 | `insp_action_verify_enabled` | `soft_delete_enabled` | `routes/inspection.js` | — |
| L07 × L11 | `insp_repeat_findings` | `soft_delete_enabled` | `routes/inspection.js` | — |
| L07 × L11 | `soft_delete_enabled` | `wan_sla_require_contract_evidence` | `public/reports.html` | — |
| L07 × L12 | `access_grant_expiry_job` | `soft_delete_enabled` | `tools/security/retention-inventory.js` | — |
| L07 × L12 | `access_recert_enabled` | `soft_delete_enabled` | `tools/security/retention-inventory.js` | — |
| L07 × L13 | `site_code_shared_block` | `soft_delete_enabled` | `routes/inspection.js`, `routes/meetings.js` | — |
| L08 × L09 | `dashboard_red_action_links` | `pir_reviews_enabled` | `routes/commitments.js` | — |
| L08 × L09 | `dashboard_red_action_links` | `problem_candidates_enabled` | `routes/commitments.js` | — |
| L08 × L11 | `controls_register_enabled` | `field_task_timing` | — | site_module_codes |
| L09 × L10 | `report_drift_banner` | `ui_i18n_pages` | `public/reports.html` | — |
| L09 × L11 | `asset_money_certify_display` | `ui_i18n_pages` | `public/assets.html` | — |
| L09 × L11 | `ui_i18n_pages` | `wan_sla_claims_enabled` | `public/wan.html` | — |
| L09 × L11 | `ui_i18n_pages` | `wan_sla_require_contract_evidence` | `public/reports.html` | — |
| L10 × L11 | `alert_group_by_rule` | `field_task_timing` | — | insp_inspections, md_meetings |
| L10 × L11 | `alert_group_by_rule` | `insp_repeat_findings` | — | insp_inspections, md_meetings |
| L10 × L11 | `alert_group_by_rule` | `wan_sla_claims_enabled` | — | insp_inspections, md_meetings |
| L10 × L11 | `field_task_timing` | `schedule_reminders_enabled` | — | insp_inspections, md_meetings |
| L10 × L11 | `field_task_timing` | `weekly_report_nudges_enabled` | — | weekly_reports, weeks |
| L10 × L11 | `insp_repeat_findings` | `schedule_reminders_enabled` | — | insp_inspections, md_meetings |
| L10 × L11 | `report_drift_banner` | `wan_sla_require_contract_evidence` | `public/reports.html` | — |
| L10 × L11 | `schedule_reminders_enabled` | `wan_sla_claims_enabled` | — | insp_inspections, md_meetings |
| L11 × L12 | `access_require_approval` | `field_task_timing` | — | system_log |
| L11 × L12 | `access_require_approval` | `insp_repeat_findings` | — | system_log |
| L11 × L12 | `access_require_approval` | `wan_sla_claims_enabled` | — | system_log |
| L11 × L13 | `delivery_failure_alert_enabled` | `field_task_timing` | — | sync_runs |
| L11 × L13 | `entra_deprovision_enabled` | `field_task_timing` | — | users |
| L11 × L13 | `field_task_timing` | `restore_drill_full` | — | report_config, system_log |
| L11 × L13 | `insp_action_verify_enabled` | `site_code_shared_block` | `routes/inspection.js` | — |
| L11 × L13 | `insp_repeat_findings` | `restore_drill_full` | — | system_log |
| L11 × L13 | `insp_repeat_findings` | `site_code_shared_block` | `routes/inspection.js` | — |
| L11 × L13 | `restore_drill_full` | `wan_sla_claims_enabled` | — | system_log |
| L12 × L13 | `access_require_approval` | `restore_drill_full` | — | system_log |

## Expiry (step 7)

N (days a switch may stay on in the pilot without a keep or removal decision): **not set — the owner sets `expiry.max_days_on_without_decision` in docs/ops/switch-lots.json**.
An entry of `docs/ops/flag-decisions.json` opts in with `pilot_on_since: "YYYY-MM-DD"` and closes the clock with
`lifecycle_decision: "keep" | "remove"`. `tests/switch-expiry.test.js` fails when one has passed N days; while N is unset
it is not armed and says so (the check itself is unit-tested with fixtures).

