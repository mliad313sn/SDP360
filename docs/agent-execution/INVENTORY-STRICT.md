# Inventory — strict coverage signal and criticality (generated)

`node tools/agent/inventory.js --strict` writes this file; `--strict --check` fails when the routes, jobs or classes changed.

A route counts as **strictly referenced** when a test source (`tests/**/*.{js,mjs}`) contains its whole path with the parameters filled in, credited to the most specific matching route, and — for a write — names the HTTP method next to it. A job counts when its name is a whole quoted string in a test. This is a stricter **mention** signal than `INVENTORY.md`; it is not proof of correctness, and the two figures are expected to differ.

Classes come from the declaration (method, path, guard names): `access`, `finance`, `export`, `audit`, `destructive` are the critical ones; `write` / `read` otherwise. A route whose path is built at run time is "not measurable" and is not counted as covered or uncovered.

| Item | Count |
|---|---:|
| routes | 733 |
| routes not measurable | 3 |
| routes without strict test | 59 |
| critical routes | 206 |
| critical routes without strict test | 18 |
| writes without strict test | 20 |
| jobs | 33 |
| jobs without strict test | 0 |
| test sources | 855 |
| without strict test access | 4 |
| without strict test finance | 2 |
| without strict test export | 7 |
| without strict test audit | 4 |
| without strict test destructive | 2 |

## Critical routes without a strict test reference

| Method | Path | Classes | File |
|---|---|---|---|
| POST | `/api/access/templates/:id/retire` | access, write | routes/access.js |
| POST | `/api/executive-new-pptx` | export, write | server.js |
| GET | `/api/finance/actuals/batches/:id` | finance, read | routes/finance.js |
| GET | `/api/finance/actuals/batches` | finance, read | routes/finance.js |
| POST | `/api/governance/cadences/:id/restore` | audit, destructive, write | routes/softDelete.js |
| GET | `/api/governance/ppm/project/:id/raci.csv` | export, read | routes/governancePpm.js |
| DELETE | `/api/governance/ppm/project/:id/team/:mid` | destructive, write | routes/governanceWorkbench.js |
| POST | `/api/governance/roles/assignments/:id/end` | access, write | routes/governanceRoles.js |
| POST | `/api/governance/roles/matrix/:id/retire` | access, write | routes/governanceRoles.js |
| GET | `/api/meetings/progress/export-pptx` | export, read | routes/meetings.js |
| GET | `/api/reports/monthly/:site_id/:year/:month/pptx-v2` | export, read | server.js |
| GET | `/api/reports/monthly/:site_id/:year/:month/pptx` | export, read | server.js |
| GET | `/api/reports/monthly/:site_id/:year/:month/site-template/pptx` | export, read | server.js |
| GET | `/api/reports/sessions/active` | access, read | routes/adminUsers.js |
| GET | `/api/roadmap/evidence/catalogue` | audit, read | routes/roadmap.js |
| GET | `/api/roadmap/evidence/incidents` | audit, read | routes/roadmap.js |
| GET | `/api/roadmap/evidence/platform` | audit, read | routes/roadmap.js |
| POST | `/api/save-pptx` | export, write | server.js |

## Other routes without a strict test reference

| Method | Path | Classes | File |
|---|---|---|---|
| POST | `/api/admin/refresh-major-incident-udfs` | write | server.js |
| GET | `/api/assets/reconcile/` | read | server.js |
| GET | `/api/cab` | read | server.js |
| GET | `/api/change` | read | server.js |
| PUT | `/api/dashboard/presets` | write | server.js |
| GET | `/api/data/ageing-by-group` | read | server.js |
| GET | `/api/data/ageing-by-site` | read | server.js |
| GET | `/api/data/cab-approvals` | read | server.js |
| GET | `/api/data/cab-recommendations` | read | server.js |
| GET | `/api/data/change-table` | read | server.js |
| GET | `/api/data/emergency-changes` | read | server.js |
| GET | `/api/data/first-response` | read | server.js |
| GET | `/api/data/group-requests` | read | server.js |
| GET | `/api/data/incident-vs-sr` | read | server.js |
| GET | `/api/data/major-incidents` | read | server.js |
| GET | `/api/data/monthly-summary` | read | server.js |
| GET | `/api/data/sla-by-category` | read | server.js |
| POST | `/api/governance/policies/proposals/:id/reject` | write | routes/policies.js |
| POST | `/api/governance/ppm/project/:id/changes/:cid/simulate` | write | routes/governanceWorkbench.js |
| PUT | `/api/governance/ppm/project/:id/raci` | write | routes/governancePpm.js |
| POST | `/api/governance/ppm/project/:id/timesheets/:action` | write | routes/governanceWorkbench.js |
| GET | `/api/integration/fmp/readiness` | read | routes/fourmypeople.js |
| GET | `/api/meetings/import/incubation-template` | read | routes/meetings.js |
| POST | `/api/meetings/import/incubation/commit` | write | routes/meetings.js |
| POST | `/api/meetings/import/incubation/preview` | write | routes/meetings.js |
| GET | `/api/reports/:id/active-incidents` | read | server.js |
| GET | `/api/reports/:id/carry-over-actions` | read | server.js |
| GET | `/api/reports/:id/carry-over-infra` | read | server.js |
| GET | `/api/reports/:id/light-weeks` | read | server.js |
| GET | `/api/reports/:id/lights-from/:source_report_id` | read | server.js |
| GET | `/api/reports/:id/open-changes` | read | server.js |
| GET | `/api/reports/helpdesk-live` | read | server.js |
| GET | `/api/reports/technicians` | read | server.js |
| POST | `/api/reports/test-smtp` | write | routes/adminConfig.js |
| GET | `/api/risk-register-config/unmapped` | read | routes/riskRegister.js |
| GET | `/api/sites/:siteId/active-incidents` | read | server.js |
| GET | `/api/sites/:siteId/open-changes` | read | server.js |
| POST | `/api/survey/cache/clear` | write | routes/survey.js |
| POST | `/api/survey/dimension-cache/clear` | write | routes/survey.js |
| POST | `/api/teams-sla/run` | write | routes/teamsSla.js |
| POST | `/api/tracker/import-dept-meetings` | write | routes/tracker.js |

## Routes not measurable (path built at run time)

| Method | Path | File |
|---|---|---|
| POST | `/api/access/requests/:id/${action}` | routes/access.js |
| POST | `/api/qualifications/:id/${action}` | routes/qualifications.js |
| POST | `/api/shift-handovers/:id/${verb}` | routes/shiftHandovers.js |

## Scheduled jobs without a strict test reference

| Job |
|---|

## Critical routes by class

| Class | Routes | Without strict test |
|---|---:|---:|
| access | 66 | 4 |
| finance | 40 | 2 |
| export | 63 | 7 |
| audit | 20 | 4 |
| destructive | 36 | 2 |
<!-- structure f2e20d9f0cf8a094 -->
