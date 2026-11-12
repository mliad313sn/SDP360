# Inventory (generated)

`node tools/agent/inventory.js` writes this file; `--check` fails CI when it is out of date.

"Tests" means the test files that **mention** the page, route or job. It is a coverage signal, not proof of correctness; field validation, deployment and acceptance are never derived from code.

| Item | Count |
|---|---:|
| pages | 57 |
| pages without test reference | 0 |
| pages without declared role | 6 |
| pages not in navigation | 29 |
| pages with inline scripts | 46 |
| routes | 616 |
| routes without test reference | 35 |
| routes in server js | 210 |
| jobs | 31 |
| jobs without test reference | 1 |
| migrations | 77 |
| test files | 638 |

## Pages

| Id | Page | Role required | In nav | Inline scripts | Tests |
|---|---|---|---|---:|---:|
| PG-access | public/access.html | any | no | 0 | 5 |
| PG-activity-tracker | public/activity-tracker.html | any | yes | 0 | 6 |
| PG-analytics | public/analytics.html | admin / scorecard-viewer | yes | 1 | 6 |
| PG-assets-finance | public/assets-finance.html | UNKNOWN | no | 1 | 2 |
| PG-assets-hygiene | public/assets-hygiene.html | UNKNOWN | no | 1 | 3 |
| PG-assets | public/assets.html | any | yes | 10 | 14 |
| PG-cockpit | public/cockpit.html | any | yes | 1 | 8 |
| PG-commitments | public/commitments.html | any | no | 1 | 4 |
| PG-coverage | public/coverage.html | any | no | 0 | 3 |
| PG-dashboard-composer | public/dashboard-composer.html | admin / dashboard-publisher | no | 1 | 5 |
| PG-dashboards | public/dashboards.html | any | yes | 1 | 9 |
| PG-exec-view | public/exec-view.html | public | no | 1 | 6 |
| PG-executive-report | public/executive-report.html | super_admin | yes | 1 | 10 |
| PG-executive | public/executive.html | executive / scorecard-viewer | yes | 1 | 10 |
| PG-handoffs | public/handoffs.html | any | yes | 1 | 7 |
| PG-help | public/help.html | any | yes | 1 | 9 |
| PG-home | public/home.html | any | yes | 0 | 6 |
| PG-index | public/index.html | any | yes | 1 | 25 |
| PG-infra-health | public/infra-health.html | any | yes | 2 | 5 |
| PG-inspection-actions | public/inspection-actions.html | any | no | 1 | 5 |
| PG-inspection | public/inspection.html | any | no | 2 | 7 |
| PG-inspections | public/inspections.html | any | yes | 1 | 5 |
| PG-integrations | public/integrations.html | any | yes | 1 | 4 |
| PG-it-review | public/it-review.html | executive / scorecard-viewer | yes | 2 | 7 |
| PG-itsm-integrations-plan | public/itsm-integrations-plan.html | UNKNOWN | no | 0 | 5 |
| PG-itsm-roadmap | public/itsm-roadmap.html | super_admin | no | 1 | 4 |
| PG-kpi-builder | public/kpi-builder.html | any | no | 0 | 2 |
| PG-login | public/login.html | public | no | 1 | 9 |
| PG-meeting | public/meeting.html | any | no | 1 | 12 |
| PG-meetings-actions | public/meetings-actions.html | any | no | 2 | 7 |
| PG-meetings-compliance | public/meetings-compliance.html | any | no | 2 | 4 |
| PG-meetings-council | public/meetings-council.html | any | no | 2 | 3 |
| PG-meetings-import | public/meetings-import.html | editor | no | 2 | 4 |
| PG-meetings-insights | public/meetings-insights.html | any | no | 2 | 3 |
| PG-meetings-issues | public/meetings-issues.html | any | no | 2 | 5 |
| PG-meetings-progress | public/meetings-progress.html | any | no | 2 | 3 |
| PG-meetings-setup | public/meetings-setup.html | any | no | 1 | 3 |
| PG-meetings-unsigned | public/meetings-unsigned.html | any | no | 2 | 3 |
| PG-meetings | public/meetings.html | any | yes | 2 | 4 |
| PG-no-access | public/no-access.html | any | no | 0 | 2 |
| PG-notifications | public/notifications.html | any | yes | 1 | 3 |
| PG-obligations | public/obligations.html | any | yes | 0 | 3 |
| PG-policies | public/policies.html | admin / committee-member | yes | 1 | 4 |
| PG-portfolio | public/portfolio.html | any | yes | 1 | 8 |
| PG-project | public/project.html | any | no | 1 | 8 |
| PG-report-studio | public/report-studio.html | any | yes | 1 | 3 |
| PG-reports | public/reports.html | any | yes | 2 | 26 |
| PG-rfi | public/rfi.html | any | yes | 1 | 4 |
| PG-site-actions | public/site-actions.html | any | yes | 1 | 9 |
| PG-site-awareness | public/site-awareness.html | site-business / group-business / executive | yes | 2 | 5 |
| PG-site-report | public/site-report.html | UNKNOWN | no | 0 | 5 |
| PG-system-logs | public/system-logs.html | super_admin | yes | 1 | 3 |
| PG-tracker-builder | public/tracker-builder.html | admin / tracker-admin | no | 1 | 4 |
| PG-trackers | public/trackers.html | any | yes | 1 | 3 |
| PG-wan-health | public/wan-health.html | UNKNOWN | no | 0 | 4 |
| PG-wan-sla | public/wan-sla.html | UNKNOWN | no | 0 | 3 |
| PG-wan | public/wan.html | any | yes | 3 | 11 |

## Routes without a test reference

| Id | Method | Path | File:line |
|---|---|---|---|
| RT-POST-api-admin-refresh-major-incident-udfs | POST | `/api/admin/refresh-major-incident-udfs` | server.js:3199 |
| RT-GET-api-cab | GET | `/api/cab` | server.js:2949 |
| RT-GET-api-data-ageing-by-group | GET | `/api/data/ageing-by-group` | server.js:4109 |
| RT-GET-api-data-ageing-by-site | GET | `/api/data/ageing-by-site` | server.js:4059 |
| RT-GET-api-data-ageing | GET | `/api/data/ageing` | server.js:3587 |
| RT-GET-api-data-cab-approvals | GET | `/api/data/cab-approvals` | server.js:3631 |
| RT-GET-api-data-cab-recommendations | GET | `/api/data/cab-recommendations` | server.js:3653 |
| RT-GET-api-data-change-table | GET | `/api/data/change-table` | server.js:3397 |
| RT-GET-api-data-emergency-changes | GET | `/api/data/emergency-changes` | server.js:3565 |
| RT-GET-api-data-first-response | GET | `/api/data/first-response` | server.js:3430 |
| RT-GET-api-data-group-requests | GET | `/api/data/group-requests` | server.js:3543 |
| RT-GET-api-data-incident-vs-sr | GET | `/api/data/incident-vs-sr` | server.js:3609 |
| RT-GET-api-data-major-incidents | GET | `/api/data/major-incidents` | server.js:3370 |
| RT-GET-api-data-monthly-summary | GET | `/api/data/monthly-summary` | server.js:4014 |
| RT-GET-api-data-sla-by-category | GET | `/api/data/sla-by-category` | server.js:3500 |
| RT-POST-api-executive-new-pptx | POST | `/api/executive-new-pptx` | server.js:6471 |
| RT-GET-api-integration-fmp-readiness | GET | `/api/integration/fmp/readiness` | routes/fourmypeople.js:31 |
| RT-GET-api-meetings-import-incubation-template | GET | `/api/meetings/import/incubation-template` | routes/meetings.js:801 |
| RT-POST-api-meetings-import-incubation-commit | POST | `/api/meetings/import/incubation/commit` | routes/meetings.js:841 |
| RT-POST-api-meetings-import-incubation-preview | POST | `/api/meetings/import/incubation/preview` | routes/meetings.js:814 |
| RT-GET-api-meetings-progress-export-pptx | GET | `/api/meetings/progress/export-pptx` | routes/meetings.js:917 |
| RT-GET-api-reports-helpdesk-live | GET | `/api/reports/helpdesk-live` | server.js:5560 |
| RT-GET-api-reports-sessions-active | GET | `/api/reports/sessions/active` | routes/adminUsers.js:174 |
| RT-GET-api-reports-technicians | GET | `/api/reports/technicians` | server.js:5811 |
| RT-POST-api-reports-test-smtp | POST | `/api/reports/test-smtp` | routes/adminConfig.js:159 |
| RT-PUT-api-reports-users-emails | PUT | `/api/reports/users/emails` | routes/adminUsers.js:118 |
| RT-GET-api-risk-register-config-unmapped | GET | `/api/risk-register-config/unmapped` | routes/riskRegister.js:129 |
| RT-GET-api-roadmap-evidence-catalogue | GET | `/api/roadmap/evidence/catalogue` | routes/roadmap.js:56 |
| RT-GET-api-roadmap-evidence-incidents | GET | `/api/roadmap/evidence/incidents` | routes/roadmap.js:73 |
| RT-GET-api-roadmap-evidence-platform | GET | `/api/roadmap/evidence/platform` | routes/roadmap.js:64 |
| RT-GET-api-roadmap-project | GET | `/api/roadmap/project` | routes/roadmap.js:123 |
| RT-GET-api-sample-viewid | GET | `/api/sample/:viewId` | server.js:4428 |
| RT-POST-api-save-pptx | POST | `/api/save-pptx` | server.js:6551 |
| RT-POST-api-tracker-import-dept-meetings | POST | `/api/tracker/import-dept-meetings` | routes/tracker.js:108 |
| RT-GET- | GET | `/` | server.js:1396 |

## Scheduled jobs

| Id | Job | Tests |
|---|---|---:|
| JB-access-emergency-expiry | access.emergency_expiry | 1 |
| JB-access-entra-deprovision | access.entra_deprovision | 1 |
| JB-access-grant-expiry | access.grant_expiry | 2 |
| JB-assets-sync | assets.sync | 5 |
| JB-audit-chain-verify | audit.chain_verify | 2 |
| JB-audit-retention | audit.retention | 1 |
| JB-commitments-escalate | commitments.escalate | 1 |
| JB-db-backup | db.backup | 2 |
| JB-db-restore-drill | db.restore_drill | 2 |
| JB-engagement-alerts | engagement.alerts | 1 |
| JB-engagement-digest | engagement.digest | 1 |
| JB-engagement-digest-weekly | engagement.digest_weekly | 1 |
| JB-engagement-schedule-reminders | engagement.schedule_reminders | 0 |
| JB-field-purge | field.purge | 1 |
| JB-governance-agenda-drafts | governance.agenda_drafts | 1 |
| JB-governance-ppm-alerts | governance.ppm_alerts | 1 |
| JB-handoffs-escalate | handoffs.escalate | 1 |
| JB-meraki-wan | meraki.wan | 5 |
| JB-meraki-wan-events | meraki.wan_events | 1 |
| JB-meraki-wan-events-5m | meraki.wan_events_5m | 1 |
| JB-meraki-wan-poller | meraki.wan_poller | 1 |
| JB-meridian-resources | meridian.resources | 1 |
| JB-opmanager-availability | opmanager.availability | 1 |
| JB-publish-connectors | publish.connectors | 2 |
| JB-reports-monthly | reports.monthly | 1 |
| JB-reports-weekly | reports.weekly | 1 |
| JB-softdelete-purge | softdelete.purge | 2 |
| JB-teams-sla-poll | teams.sla_poll | 1 |
| JB-zoho-change-cab | zoho.change_cab | 1 |
| JB-zoho-requests | zoho.requests | 12 |
| JB-zoho-survey | zoho.survey | 1 |
