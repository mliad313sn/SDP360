# Inventory (generated)

`node tools/agent/inventory.js` writes this file; `--check` fails CI when it is out of date.

"Tests" means the test files that **mention** the page, route or job. It is a coverage signal, not proof of correctness; field validation, deployment and acceptance are never derived from code.

| Item | Count |
|---|---:|
| pages | 52 |
| pages without test reference | 2 |
| pages without declared role | 6 |
| pages not in navigation | 25 |
| pages with inline scripts | 45 |
| routes | 520 |
| routes without test reference | 104 |
| routes in server js | 229 |
| jobs | 24 |
| jobs without test reference | 10 |
| migrations | 48 |
| test files | 433 |

## Pages

| Id | Page | Role required | In nav | Inline scripts | Tests |
|---|---|---|---|---:|---:|
| PG-activity-tracker | public/activity-tracker.html | any | yes | 0 | 3 |
| PG-analytics | public/analytics.html | admin / scorecard-viewer | yes | 1 | 1 |
| PG-assets-finance | public/assets-finance.html | UNKNOWN | no | 1 | 2 |
| PG-assets-hygiene | public/assets-hygiene.html | UNKNOWN | no | 1 | 3 |
| PG-assets | public/assets.html | any | yes | 10 | 9 |
| PG-cockpit | public/cockpit.html | any | yes | 1 | 2 |
| PG-commitments | public/commitments.html | any | no | 1 | 2 |
| PG-dashboard-composer | public/dashboard-composer.html | admin / dashboard-publisher | no | 1 | 2 |
| PG-dashboards | public/dashboards.html | any | yes | 1 | 1 |
| PG-exec-view | public/exec-view.html | public | no | 1 | 2 |
| PG-executive-report | public/executive-report.html | super_admin | yes | 1 | 4 |
| PG-executive | public/executive.html | executive / scorecard-viewer | yes | 1 | 2 |
| PG-handoffs | public/handoffs.html | any | yes | 1 | 3 |
| PG-help | public/help.html | any | yes | 1 | 4 |
| PG-index | public/index.html | any | yes | 1 | 7 |
| PG-infra-health | public/infra-health.html | any | yes | 2 | 2 |
| PG-inspection-actions | public/inspection-actions.html | any | no | 1 | 3 |
| PG-inspection | public/inspection.html | any | no | 2 | 4 |
| PG-inspections | public/inspections.html | any | yes | 1 | 2 |
| PG-integrations | public/integrations.html | any | yes | 1 | 1 |
| PG-it-review | public/it-review.html | executive / scorecard-viewer | yes | 2 | 2 |
| PG-itsm-integrations-plan | public/itsm-integrations-plan.html | UNKNOWN | no | 0 | 3 |
| PG-itsm-roadmap | public/itsm-roadmap.html | super_admin | no | 1 | 2 |
| PG-login | public/login.html | public | no | 1 | 2 |
| PG-meeting | public/meeting.html | any | no | 1 | 5 |
| PG-meetings-actions | public/meetings-actions.html | any | no | 2 | 4 |
| PG-meetings-compliance | public/meetings-compliance.html | any | no | 2 | 1 |
| PG-meetings-council | public/meetings-council.html | any | no | 2 | 1 |
| PG-meetings-import | public/meetings-import.html | editor | no | 2 | 2 |
| PG-meetings-insights | public/meetings-insights.html | any | no | 2 | 1 |
| PG-meetings-issues | public/meetings-issues.html | any | no | 2 | 2 |
| PG-meetings-progress | public/meetings-progress.html | any | no | 2 | 1 |
| PG-meetings-setup | public/meetings-setup.html | any | no | 1 | 1 |
| PG-meetings-unsigned | public/meetings-unsigned.html | any | no | 2 | 1 |
| PG-meetings | public/meetings.html | any | yes | 2 | 2 |
| PG-no-access | public/no-access.html | any | no | 0 | 0 |
| PG-notifications | public/notifications.html | any | yes | 1 | 1 |
| PG-obligations | public/obligations.html | any | yes | 0 | 0 |
| PG-policies | public/policies.html | admin / committee-member | yes | 1 | 2 |
| PG-portfolio | public/portfolio.html | any | yes | 1 | 1 |
| PG-report-studio | public/report-studio.html | any | yes | 1 | 1 |
| PG-reports | public/reports.html | any | yes | 2 | 16 |
| PG-rfi | public/rfi.html | any | yes | 1 | 1 |
| PG-site-actions | public/site-actions.html | any | yes | 1 | 4 |
| PG-site-awareness | public/site-awareness.html | site-business / group-business / executive | yes | 2 | 1 |
| PG-site-report | public/site-report.html | UNKNOWN | no | 0 | 3 |
| PG-system-logs | public/system-logs.html | super_admin | yes | 1 | 1 |
| PG-tracker-builder | public/tracker-builder.html | admin / tracker-admin | no | 1 | 2 |
| PG-trackers | public/trackers.html | any | yes | 1 | 1 |
| PG-wan-health | public/wan-health.html | UNKNOWN | no | 0 | 2 |
| PG-wan-sla | public/wan-sla.html | UNKNOWN | no | 0 | 2 |
| PG-wan | public/wan.html | any | yes | 3 | 5 |

## Routes without a test reference

| Id | Method | Path | File:line |
|---|---|---|---|
| RT-GET-analytics-html | GET | `/analytics.html` | server.js:1392 |
| RT-POST-api-admin-backup-now | POST | `/api/admin/backup-now` | server.js:1222 |
| RT-GET-api-admin-backup-schedule | GET | `/api/admin/backup-schedule` | server.js:1204 |
| RT-POST-api-admin-backup-schedule | POST | `/api/admin/backup-schedule` | server.js:1214 |
| RT-POST-api-admin-refresh-major-incident-udfs | POST | `/api/admin/refresh-major-incident-udfs` | server.js:3707 |
| RT-POST-api-ai-analyze | POST | `/api/ai/analyze` | server.js:4920 |
| RT-GET-api-cab | GET | `/api/cab` | server.js:3411 |
| RT-POST-api-cache-clear | POST | `/api/cache/clear` | server.js:3679 |
| RT-GET-api-cache-status | GET | `/api/cache/status` | server.js:3812 |
| RT-GET-api-dashboard-groups-discovered | GET | `/api/dashboard/groups/discovered` | server.js:7371 |
| RT-GET-api-data-ageing-by-group | GET | `/api/data/ageing-by-group` | server.js:4617 |
| RT-GET-api-data-ageing-by-site | GET | `/api/data/ageing-by-site` | server.js:4567 |
| RT-GET-api-data-ageing | GET | `/api/data/ageing` | server.js:4095 |
| RT-GET-api-data-cab-approvals | GET | `/api/data/cab-approvals` | server.js:4139 |
| RT-GET-api-data-cab-recommendations | GET | `/api/data/cab-recommendations` | server.js:4161 |
| RT-GET-api-data-change-table | GET | `/api/data/change-table` | server.js:3905 |
| RT-GET-api-data-emergency-changes | GET | `/api/data/emergency-changes` | server.js:4073 |
| RT-GET-api-data-first-response | GET | `/api/data/first-response` | server.js:3938 |
| RT-GET-api-data-group-requests | GET | `/api/data/group-requests` | server.js:4051 |
| RT-GET-api-data-incident-vs-sr | GET | `/api/data/incident-vs-sr` | server.js:4117 |
| RT-GET-api-data-major-incidents | GET | `/api/data/major-incidents` | server.js:3878 |
| RT-GET-api-data-monthly-summary | GET | `/api/data/monthly-summary` | server.js:4522 |
| RT-GET-api-data-sla-by-category | GET | `/api/data/sla-by-category` | server.js:4008 |
| RT-GET-api-debug-raw-test | GET | `/api/debug/raw-test` | server.js:3637 |
| RT-POST-api-executive-new-pptx | POST | `/api/executive-new-pptx` | server.js:7032 |
| RT-GET-api-integration-fmp-readiness | GET | `/api/integration/fmp/readiness` | routes/fourmypeople.js:31 |
| RT-GET-api-meetings-import-incubation-template | GET | `/api/meetings/import/incubation-template` | routes/meetings.js:790 |
| RT-POST-api-meetings-import-incubation-commit | POST | `/api/meetings/import/incubation/commit` | routes/meetings.js:830 |
| RT-POST-api-meetings-import-incubation-preview | POST | `/api/meetings/import/incubation/preview` | routes/meetings.js:803 |
| RT-POST-api-meetings-import-preview | POST | `/api/meetings/import/preview` | routes/meetings.js:715 |
| RT-GET-api-meetings-import-template | GET | `/api/meetings/import/template` | routes/meetings.js:695 |
| RT-GET-api-meetings-people | GET | `/api/meetings/people` | routes/meetings.js:146 |
| RT-GET-api-meetings-progress-export-pptx | GET | `/api/meetings/progress/export-pptx` | routes/meetings.js:906 |
| RT-POST-api-meetings-reset | POST | `/api/meetings/reset` | routes/meetings.js:682 |
| RT-POST-api-meridian-sync | POST | `/api/meridian/sync` | server.js:5155 |
| RT-GET-api-metrics-cab | GET | `/api/metrics/cab` | server.js:3514 |
| RT-GET-api-metrics-change | GET | `/api/metrics/change` | server.js:3493 |
| RT-GET-api-metrics-request-filter-options | GET | `/api/metrics/request-filter-options` | server.js:3587 |
| RT-GET-api-metrics-survey | GET | `/api/metrics/survey` | server.js:3535 |
| RT-GET-api-notes | GET | `/api/notes` | server.js:7078 |
| RT-POST-api-notes | POST | `/api/notes` | server.js:7089 |
| RT-POST-api-reports-auth-change-password | POST | `/api/reports/auth/change-password` | server.js:5669 |
| RT-GET-api-reports-current-week | GET | `/api/reports/current-week` | server.js:5821 |
| RT-POST-api-reports-exec-pptx | POST | `/api/reports/exec-pptx` | server.js:7385 |
| RT-GET-api-reports-helpdesk-live | GET | `/api/reports/helpdesk-live` | server.js:6130 |
| RT-DELETE-api-reports-sessions-token | DELETE | `/api/reports/sessions/:token` | routes/adminUsers.js:157 |
| RT-GET-api-reports-sessions-active | GET | `/api/reports/sessions/active` | routes/adminUsers.js:124 |
| RT-GET-api-reports-technicians | GET | `/api/reports/technicians` | server.js:6381 |
| RT-POST-api-reports-test-smtp | POST | `/api/reports/test-smtp` | routes/adminConfig.js:157 |
| RT-PUT-api-reports-users-emails | PUT | `/api/reports/users/emails` | routes/adminUsers.js:71 |
| RT-GET-api-risk-register-config-sites | GET | `/api/risk-register-config/sites` | routes/riskRegister.js:78 |
| RT-GET-api-risk-register-config-unmapped | GET | `/api/risk-register-config/unmapped` | routes/riskRegister.js:129 |
| RT-DELETE-api-roadmap-action-uid | DELETE | `/api/roadmap/action/:uid` | routes/roadmap.js:106 |
| RT-PUT-api-roadmap-action-uid | PUT | `/api/roadmap/action/:uid` | routes/roadmap.js:102 |
| RT-POST-api-roadmap-action | POST | `/api/roadmap/action` | routes/roadmap.js:98 |
| RT-DELETE-api-roadmap-deliverable-uid | DELETE | `/api/roadmap/deliverable/:uid` | routes/roadmap.js:63 |
| RT-PUT-api-roadmap-deliverable-uid | PUT | `/api/roadmap/deliverable/:uid` | routes/roadmap.js:58 |
| RT-POST-api-roadmap-deliverable | POST | `/api/roadmap/deliverable` | routes/roadmap.js:53 |
| RT-GET-api-roadmap-evidence-catalogue | GET | `/api/roadmap/evidence/catalogue` | routes/roadmap.js:26 |
| RT-GET-api-roadmap-evidence-incidents | GET | `/api/roadmap/evidence/incidents` | routes/roadmap.js:43 |
| RT-GET-api-roadmap-evidence-platform | GET | `/api/roadmap/evidence/platform` | routes/roadmap.js:34 |
| RT-PUT-api-roadmap-objective-key | PUT | `/api/roadmap/objective/:key` | routes/roadmap.js:48 |
| RT-GET-api-roadmap-project | GET | `/api/roadmap/project` | routes/roadmap.js:93 |
| RT-DELETE-api-roadmap-resource-uid | DELETE | `/api/roadmap/resource/:uid` | routes/roadmap.js:119 |
| RT-PUT-api-roadmap-resource-uid | PUT | `/api/roadmap/resource/:uid` | routes/roadmap.js:115 |
| RT-POST-api-roadmap-resource | POST | `/api/roadmap/resource` | routes/roadmap.js:111 |
| RT-GET-api-sample-viewid | GET | `/api/sample/:viewId` | server.js:4948 |
| RT-POST-api-save-charts | POST | `/api/save-charts` | server.js:7103 |
| RT-POST-api-save-pptx | POST | `/api/save-pptx` | server.js:7112 |
| RT-GET-api-survey-by-dimension | GET | `/api/survey/by-dimension` | server.js:1917 |
| RT-POST-api-survey-cache-clear | POST | `/api/survey/cache/clear` | server.js:1867 |
| RT-GET-api-survey-debug | GET | `/api/survey/debug` | server.js:1876 |
| RT-POST-api-survey-dimension-cache-clear | POST | `/api/survey/dimension-cache/clear` | server.js:1960 |
| RT-GET-api-survey-kpis | GET | `/api/survey/kpis` | server.js:1806 |
| RT-GET-api-survey-list | GET | `/api/survey/list` | server.js:1688 |
| RT-GET-api-survey-summary | GET | `/api/survey/summary` | server.js:1720 |
| RT-POST-api-survey-voice-cache-clear | POST | `/api/survey/voice-cache/clear` | server.js:2148 |
| RT-GET-api-survey-voice | GET | `/api/survey/voice` | server.js:2027 |
| RT-GET-api-tracker-delete-year | GET | `/api/tracker/delete-year` | server.js:7559 |
| RT-POST-api-tracker-delete-year | POST | `/api/tracker/delete-year` | server.js:7576 |
| RT-POST-api-tracker-import-dept-meetings | POST | `/api/tracker/import-dept-meetings` | server.js:7224 |
| RT-POST-api-tracker-reset | POST | `/api/tracker/reset` | server.js:7526 |
| RT-GET-api-views | GET | `/api/views` | server.js:3671 |
| RT-GET-ext-odata-sites | GET | `/ext/odata/Sites` | routes/extApi.js:103 |
| RT-GET- | GET | `/` | server.js:1387 |
| RT-GET-handoffs-html | GET | `/handoffs.html` | routes/handoffs.js:77 |
| RT-GET-help-html | GET | `/help.html` | server.js:1463 |
| RT-GET-inspection-html | GET | `/inspection.html` | server.js:1409 |
| RT-GET-inspections-html | GET | `/inspections.html` | server.js:1448 |
| RT-GET-meetings-actions-html | GET | `/meetings-actions.html` | server.js:1487 |
| RT-GET-meetings-compliance-html | GET | `/meetings-compliance.html` | server.js:1493 |
| RT-GET-meetings-council-html | GET | `/meetings-council.html` | server.js:1492 |
| RT-GET-meetings-import-html | GET | `/meetings-import.html` | server.js:1494 |
| RT-GET-meetings-insights-html | GET | `/meetings-insights.html` | server.js:1496 |
| RT-GET-meetings-issues-html | GET | `/meetings-issues.html` | server.js:1486 |
| RT-GET-meetings-progress-html | GET | `/meetings-progress.html` | server.js:1495 |
| RT-GET-meetings-setup-html | GET | `/meetings-setup.html` | server.js:1497 |
| RT-GET-meetings-unsigned-html | GET | `/meetings-unsigned.html` | server.js:1491 |
| RT-GET-meetings-html | GET | `/meetings.html` | server.js:1484 |
| RT-GET-no-access-html | GET | `/no-access.html` | server.js:1365 |
| RT-GET-obligations-html | GET | `/obligations.html` | routes/obligations.js:16 |
| RT-GET-policies-html | GET | `/policies.html` | routes/policies.js:106 |
| RT-GET-site-awareness-html | GET | `/site-awareness.html` | server.js:1368 |
| RT-GET-system-logs-html | GET | `/system-logs.html` | server.js:1490 |

## Scheduled jobs

| Id | Job | Tests |
|---|---|---:|
| JB-assets-sync | assets.sync | 3 |
| JB-audit-chain-verify | audit.chain_verify | 2 |
| JB-audit-retention | audit.retention | 1 |
| JB-commitments-escalate | commitments.escalate | 1 |
| JB-db-backup | db.backup | 2 |
| JB-db-restore-drill | db.restore_drill | 2 |
| JB-engagement-alerts | engagement.alerts | 0 |
| JB-engagement-digest | engagement.digest | 0 |
| JB-engagement-digest-weekly | engagement.digest_weekly | 0 |
| JB-field-purge | field.purge | 1 |
| JB-handoffs-escalate | handoffs.escalate | 1 |
| JB-meraki-wan | meraki.wan | 3 |
| JB-meraki-wan-events | meraki.wan_events | 0 |
| JB-meraki-wan-events-5m | meraki.wan_events_5m | 0 |
| JB-meraki-wan-poller | meraki.wan_poller | 0 |
| JB-meridian-resources | meridian.resources | 0 |
| JB-opmanager-availability | opmanager.availability | 1 |
| JB-publish-connectors | publish.connectors | 0 |
| JB-reports-monthly | reports.monthly | 0 |
| JB-reports-weekly | reports.weekly | 0 |
| JB-teams-sla-poll | teams.sla_poll | 1 |
| JB-zoho-change-cab | zoho.change_cab | 1 |
| JB-zoho-requests | zoho.requests | 9 |
| JB-zoho-survey | zoho.survey | 1 |
