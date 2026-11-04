# ADR-G15 — portfolio: site-scoped reads and site editors maintaining their projects' plan

Status: technical decision (AI) · 2026-11-04 · **access policy PROPOSED, not approved** · both switches OFF by default

## Context
`GET /api/governance/portfolio` returned every programme, project, task, risk and milestone to any session (only
money was stripped). Every write was committee-only, so site editors could not keep the plan of their own projects
current. Changing who reads or writes the portfolio is an access policy — an owner decision.

## Decision (technical)
- One pure guard, `services/portfolioAccess.js`: `ownerMatches` (the single owner-identity rule — username, full
  name or e-mail, case-insensitive; `projectSchedule.stageGate` now calls it), `projectSiteIds`, `canReadProject`,
  `canEditPlan`, `filterPortfolio` (drops children of hidden projects and **recomputes** resource conflicts,
  objective views and the programme summary so no count of a hidden project leaks).
- Primary site stays `portfolio_projects.site_id`; extra sites live in `portfolio_project_sites` (migration
  `043_portfolio_scope.sql`, additive). A project with no site at all is group-level. Committee edits the extra
  sites with `PUT /api/governance/portfolio/project/:id/sites` (ledger action `sites_edit`).
- `portfolio_site_scope_reads='1'`: a non-committee reader sees projects of their sites (services/userSites),
  group-level projects and projects they own; history of an invisible project answers 404; the monthly report
  follows the same filter.
- `portfolio_editor_plan_writes='1'`: an editor of one of the project's sites, or its owner, may create / edit /
  delete tasks, milestones, risks and deliverables. The stored row's project decides (never `body.project_id` on an
  update); a move needs the right on both projects; links (`milestone_id`, `parent_id`) must stay in the project.
  Refusals are `403 PLAN_SCOPE`. Project rows, stages, money, RFI conversion and project deletes stay committee-only.

## Proof
`tests/portfolio-access.test.js` (pure), `tests/portfolio-site-scope.smoke.test.js` (HTTP, both switch states),
`tests/pg-governance-store.test.js` (`setProjectSites`, cascade).

## Rollback
Set both switches to `'0'` (immediate). The table stays (unused); never DROP on a live system.

## Left to the owner
Classify existing projects as site or group-level; decide whether to switch either policy on.
