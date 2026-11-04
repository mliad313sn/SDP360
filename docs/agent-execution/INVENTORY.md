# Inventory (generated)

`node tools/agent/inventory.js` writes this file; `--check` fails CI when it is out of date.

"Tests" means the test files that **mention** the page, route or job. It is a coverage signal, not proof of correctness; field validation, deployment and acceptance are never derived from code.

| Item | Count |
|---|---:|
| pages | 54 |
| pages without test reference | 0 |
| pages without declared role | 6 |
| pages not in navigation | 26 |
| pages with inline scripts | 46 |
| routes | 550 |
| routes without test reference | 82 |
| routes in server js | 231 |
| jobs | 26 |
| jobs without test reference | 10 |
| migrations | 62 |
| test files | 541 |

## Pages

| Id | Page | Role required | In nav | Inline scripts | Tests |
|---|---|---|---|---:|---:|
| PG-activity-tracker | public/activity-tracker.html | any | yes | 0 | 6 |
| PG-analytics | public/analytics.html | admin / scorecard-viewer | yes | 1 | 4 |
| PG-assets-finance | public/assets-finance.html | UNKNOWN | no | 1 | 2 |
| PG-assets-hygiene | public/assets-hygiene.html | UNKNOWN | no | 1 | 3 |
| PG-assets | public/assets.html | any | yes | 10 | 11 |
| PG-cockpit | public/cockpit.html | any | yes | 1 | 6 |
| PG-commitments | public/commitments.html | any | no | 1 | 3 |
| PG-dashboard-composer | public/dashboard-composer.html | admin / dashboard-publisher | no | 1 | 4 |
| PG-dashboards | public/dashboards.html | any | yes | 1 | 6 |
| PG-exec-view | public/exec-view.html | public | no | 1 | 5 |
| PG-executive-report | public/executive-report.html | super_admin | yes | 1 | 7 |
| PG-executive | public/executive.html | executive / scorecard-viewer | yes | 1 | 6 |
| PG-handoffs | public/handoffs.html | any | yes | 1 | 5 |
| PG-help | public/help.html | any | yes | 1 | 8 |
| PG-home | public/home.html | any | yes | 0 | 5 |
| PG-index | public/index.html | any | yes | 1 | 18 |
| PG-infra-health | public/infra-health.html | any | yes | 2 | 3 |
| PG-inspection-actions | public/inspection-actions.html | any | no | 1 | 4 |
| PG-inspection | public/inspection.html | any | no | 2 | 6 |
| PG-inspections | public/inspections.html | any | yes | 1 | 4 |
| PG-integrations | public/integrations.html | any | yes | 1 | 3 |
| PG-it-review | public/it-review.html | executive / scorecard-viewer | yes | 2 | 5 |
| PG-itsm-integrations-plan | public/itsm-integrations-plan.html | UNKNOWN | no | 0 | 3 |
| PG-itsm-roadmap | public/itsm-roadmap.html | super_admin | no | 1 | 3 |
| PG-login | public/login.html | public | no | 1 | 7 |
| PG-meeting | public/meeting.html | any | no | 1 | 10 |
| PG-meetings-actions | public/meetings-actions.html | any | no | 2 | 6 |
| PG-meetings-compliance | public/meetings-compliance.html | any | no | 2 | 3 |
| PG-meetings-council | public/meetings-council.html | any | no | 2 | 2 |
| PG-meetings-import | public/meetings-import.html | editor | no | 2 | 3 |
| PG-meetings-insights | public/meetings-insights.html | any | no | 2 | 2 |
| PG-meetings-issues | public/meetings-issues.html | any | no | 2 | 4 |
| PG-meetings-progress | public/meetings-progress.html | any | no | 2 | 2 |
| PG-meetings-setup | public/meetings-setup.html | any | no | 1 | 2 |
| PG-meetings-unsigned | public/meetings-unsigned.html | any | no | 2 | 2 |
| PG-meetings | public/meetings.html | any | yes | 2 | 3 |
| PG-no-access | public/no-access.html | any | no | 0 | 1 |
| PG-notifications | public/notifications.html | any | yes | 1 | 2 |
| PG-obligations | public/obligations.html | any | yes | 0 | 1 |
| PG-policies | public/policies.html | admin / committee-member | yes | 1 | 3 |
| PG-portfolio | public/portfolio.html | any | yes | 1 | 6 |
| PG-project | public/project.html | any | no | 1 | 6 |
| PG-report-studio | public/report-studio.html | any | yes | 1 | 2 |
| PG-reports | public/reports.html | any | yes | 2 | 21 |
| PG-rfi | public/rfi.html | any | yes | 1 | 3 |
| PG-site-actions | public/site-actions.html | any | yes | 1 | 7 |
| PG-site-awareness | public/site-awareness.html | site-business / group-business / executive | yes | 2 | 4 |
| PG-site-report | public/site-report.html | UNKNOWN | no | 0 | 4 |
| PG-system-logs | public/system-logs.html | super_admin | yes | 1 | 2 |
| PG-tracker-builder | public/tracker-builder.html | admin / tracker-admin | no | 1 | 3 |
| PG-trackers | public/trackers.html | any | yes | 1 | 2 |
| PG-wan-health | public/wan-health.html | UNKNOWN | no | 0 | 2 |
| PG-wan-sla | public/wan-sla.html | UNKNOWN | no | 0 | 2 |
| PG-wan | public/wan.html | any | yes | 3 | 9 |

## Routes without a test reference

| Id | Method | Path | File:line |
|---|---|---|---|
| RT-POST-api-admin-backup-now | POST | `/api/admin/backup-now` | server.js:1232 |
| RT-GET-api-admin-backup-schedule | GET | `/api/admin/backup-schedule` | server.js:1214 |
| RT-POST-api-admin-backup-schedule | POST | `/api/admin/backup-schedule` | server.js:1224 |
| RT-POST-api-admin-refresh-major-incident-udfs | POST | `/api/admin/refresh-major-incident-udfs` | server.js:3796 |
| RT-GET-api-cab | GET | `/api/cab` | server.js:3497 |
| RT-POST-api-cache-clear | POST | `/api/cache/clear` | server.js:3768 |
| RT-GET-api-cache-status | GET | `/api/cache/status` | server.js:3901 |
| RT-GET-api-dashboard-groups-discovered | GET | `/api/dashboard/groups/discovered` | server.js:7472 |
| RT-GET-api-data-ageing-by-group | GET | `/api/data/ageing-by-group` | server.js:4706 |
| RT-GET-api-data-ageing-by-site | GET | `/api/data/ageing-by-site` | server.js:4656 |
| RT-GET-api-data-ageing | GET | `/api/data/ageing` | server.js:4184 |
| RT-GET-api-data-cab-approvals | GET | `/api/data/cab-approvals` | server.js:4228 |
| RT-GET-api-data-cab-recommendations | GET | `/api/data/cab-recommendations` | server.js:4250 |
| RT-GET-api-data-change-table | GET | `/api/data/change-table` | server.js:3994 |
| RT-GET-api-data-emergency-changes | GET | `/api/data/emergency-changes` | server.js:4162 |
| RT-GET-api-data-first-response | GET | `/api/data/first-response` | server.js:4027 |
| RT-GET-api-data-group-requests | GET | `/api/data/group-requests` | server.js:4140 |
| RT-GET-api-data-incident-vs-sr | GET | `/api/data/incident-vs-sr` | server.js:4206 |
| RT-GET-api-data-major-incidents | GET | `/api/data/major-incidents` | server.js:3967 |
| RT-GET-api-data-monthly-summary | GET | `/api/data/monthly-summary` | server.js:4611 |
| RT-GET-api-data-sla-by-category | GET | `/api/data/sla-by-category` | server.js:4097 |
| RT-GET-api-debug-raw-test | GET | `/api/debug/raw-test` | server.js:3726 |
| RT-POST-api-executive-new-pptx | POST | `/api/executive-new-pptx` | server.js:7133 |
| RT-GET-api-integration-fmp-readiness | GET | `/api/integration/fmp/readiness` | routes/fourmypeople.js:31 |
| RT-GET-api-meetings-import-incubation-template | GET | `/api/meetings/import/incubation-template` | routes/meetings.js:799 |
| RT-POST-api-meetings-import-incubation-commit | POST | `/api/meetings/import/incubation/commit` | routes/meetings.js:839 |
| RT-POST-api-meetings-import-incubation-preview | POST | `/api/meetings/import/incubation/preview` | routes/meetings.js:812 |
| RT-POST-api-meetings-import-preview | POST | `/api/meetings/import/preview` | routes/meetings.js:724 |
| RT-GET-api-meetings-import-template | GET | `/api/meetings/import/template` | routes/meetings.js:704 |
| RT-GET-api-meetings-people | GET | `/api/meetings/people` | routes/meetings.js:147 |
| RT-GET-api-meetings-progress-export-pptx | GET | `/api/meetings/progress/export-pptx` | routes/meetings.js:915 |
| RT-POST-api-meetings-reset | POST | `/api/meetings/reset` | routes/meetings.js:691 |
| RT-GET-api-notes | GET | `/api/notes` | server.js:7179 |
| RT-POST-api-notes | POST | `/api/notes` | server.js:7190 |
| RT-POST-api-reports-auth-change-password | POST | `/api/reports/auth/change-password` | server.js:5761 |
| RT-GET-api-reports-current-week | GET | `/api/reports/current-week` | server.js:5913 |
| RT-POST-api-reports-exec-pptx | POST | `/api/reports/exec-pptx` | server.js:7486 |
| RT-GET-api-reports-helpdesk-live | GET | `/api/reports/helpdesk-live` | server.js:6222 |
| RT-GET-api-reports-sessions-active | GET | `/api/reports/sessions/active` | routes/adminUsers.js:124 |
| RT-GET-api-reports-technicians | GET | `/api/reports/technicians` | server.js:6473 |
| RT-POST-api-reports-test-smtp | POST | `/api/reports/test-smtp` | routes/adminConfig.js:157 |
| RT-PUT-api-reports-users-emails | PUT | `/api/reports/users/emails` | routes/adminUsers.js:71 |
| RT-GET-api-risk-register-config-sites | GET | `/api/risk-register-config/sites` | routes/riskRegister.js:78 |
| RT-GET-api-risk-register-config-unmapped | GET | `/api/risk-register-config/unmapped` | routes/riskRegister.js:129 |
| RT-GET-api-roadmap-evidence-catalogue | GET | `/api/roadmap/evidence/catalogue` | routes/roadmap.js:56 |
| RT-GET-api-roadmap-evidence-incidents | GET | `/api/roadmap/evidence/incidents` | routes/roadmap.js:73 |
| RT-GET-api-roadmap-evidence-platform | GET | `/api/roadmap/evidence/platform` | routes/roadmap.js:64 |
| RT-GET-api-roadmap-project | GET | `/api/roadmap/project` | routes/roadmap.js:123 |
| RT-GET-api-sample-viewid | GET | `/api/sample/:viewId` | server.js:5025 |
| RT-POST-api-save-charts | POST | `/api/save-charts` | server.js:7204 |
| RT-POST-api-save-pptx | POST | `/api/save-pptx` | server.js:7213 |
| RT-GET-api-survey-by-dimension | GET | `/api/survey/by-dimension` | server.js:1928 |
| RT-POST-api-survey-cache-clear | POST | `/api/survey/cache/clear` | server.js:1878 |
| RT-GET-api-survey-debug | GET | `/api/survey/debug` | server.js:1887 |
| RT-POST-api-survey-dimension-cache-clear | POST | `/api/survey/dimension-cache/clear` | server.js:1971 |
| RT-GET-api-survey-kpis | GET | `/api/survey/kpis` | server.js:1817 |
| RT-GET-api-survey-list | GET | `/api/survey/list` | server.js:1699 |
| RT-GET-api-survey-summary | GET | `/api/survey/summary` | server.js:1731 |
| RT-POST-api-survey-voice-cache-clear | POST | `/api/survey/voice-cache/clear` | server.js:2159 |
| RT-GET-api-survey-voice | GET | `/api/survey/voice` | server.js:2038 |
| RT-GET-api-tracker-delete-year | GET | `/api/tracker/delete-year` | server.js:7660 |
| RT-POST-api-tracker-delete-year | POST | `/api/tracker/delete-year` | server.js:7677 |
| RT-POST-api-tracker-import-dept-meetings | POST | `/api/tracker/import-dept-meetings` | server.js:7325 |
| RT-POST-api-tracker-reset | POST | `/api/tracker/reset` | server.js:7627 |
| RT-GET-api-views | GET | `/api/views` | server.js:3760 |
| RT-GET-ext-odata-sites | GET | `/ext/odata/Sites` | routes/extApi.js:103 |
| RT-GET- | GET | `/` | server.js:1397 |
| RT-GET-handoffs-html | GET | `/handoffs.html` | routes/handoffs.js:77 |
| RT-GET-inspection-html | GET | `/inspection.html` | server.js:1419 |
| RT-GET-inspections-html | GET | `/inspections.html` | server.js:1458 |
| RT-GET-meetings-compliance-html | GET | `/meetings-compliance.html` | server.js:1503 |
| RT-GET-meetings-council-html | GET | `/meetings-council.html` | server.js:1502 |
| RT-GET-meetings-import-html | GET | `/meetings-import.html` | server.js:1504 |
| RT-GET-meetings-insights-html | GET | `/meetings-insights.html` | server.js:1506 |
| RT-GET-meetings-progress-html | GET | `/meetings-progress.html` | server.js:1505 |
| RT-GET-meetings-setup-html | GET | `/meetings-setup.html` | server.js:1507 |
| RT-GET-meetings-unsigned-html | GET | `/meetings-unsigned.html` | server.js:1501 |
| RT-GET-meetings-html | GET | `/meetings.html` | server.js:1494 |
| RT-GET-obligations-html | GET | `/obligations.html` | routes/obligations.js:16 |
| RT-GET-policies-html | GET | `/policies.html` | routes/policies.js:107 |
| RT-GET-site-awareness-html | GET | `/site-awareness.html` | server.js:1378 |
| RT-GET-system-logs-html | GET | `/system-logs.html` | server.js:1500 |

## Scheduled jobs

| Id | Job | Tests |
|---|---|---:|
| JB-assets-sync | assets.sync | 4 |
| JB-audit-chain-verify | audit.chain_verify | 2 |
| JB-audit-retention | audit.retention | 1 |
| JB-commitments-escalate | commitments.escalate | 1 |
| JB-db-backup | db.backup | 2 |
| JB-db-restore-drill | db.restore_drill | 2 |
| JB-engagement-alerts | engagement.alerts | 0 |
| JB-engagement-digest | engagement.digest | 0 |
| JB-engagement-digest-weekly | engagement.digest_weekly | 0 |
| JB-field-purge | field.purge | 1 |
| JB-governance-ppm-alerts | governance.ppm_alerts | 1 |
| JB-handoffs-escalate | handoffs.escalate | 1 |
| JB-meraki-wan | meraki.wan | 4 |
| JB-meraki-wan-events | meraki.wan_events | 0 |
| JB-meraki-wan-events-5m | meraki.wan_events_5m | 0 |
| JB-meraki-wan-poller | meraki.wan_poller | 0 |
| JB-meridian-resources | meridian.resources | 0 |
| JB-opmanager-availability | opmanager.availability | 1 |
| JB-publish-connectors | publish.connectors | 0 |
| JB-reports-monthly | reports.monthly | 0 |
| JB-reports-weekly | reports.weekly | 0 |
| JB-softdelete-purge | softdelete.purge | 2 |
| JB-teams-sla-poll | teams.sla_poll | 1 |
| JB-zoho-change-cab | zoho.change_cab | 1 |
| JB-zoho-requests | zoho.requests | 11 |
| JB-zoho-survey | zoho.survey | 1 |
