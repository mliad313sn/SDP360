# Inventory (generated)

`node tools/agent/inventory.js` writes this file; `--check` fails CI when it is out of date.

"Tests" means the test files that **mention** the page, route or job. It is a coverage signal, not proof of correctness; field validation, deployment and acceptance are never derived from code.

| Item | Count |
|---|---:|
| pages | 57 |
| pages without test reference | 0 |
| pages without declared role | 6 |
| pages not in navigation | 29 |
| pages not in shell or module tabs | 20 |
| pages deep link only | 8 |
| pages without entry point | 3 |
| pages with inline scripts | 46 |
| routes | 616 |
| routes without test reference | 48 |
| routes in server js | 210 |
| jobs | 30 |
| jobs without test reference | 10 |
| migrations | 75 |
| test files | 628 |

## Pages

| Id | Page | Role required | In nav | Inline scripts | Tests |
|---|---|---|---|---:|---:|
| PG-access | public/access.html | any | no | 0 | 5 |
| PG-activity-tracker | public/activity-tracker.html | any | yes | 0 | 6 |
| PG-analytics | public/analytics.html | admin / scorecard-viewer | yes | 1 | 7 |
| PG-assets-finance | public/assets-finance.html | UNKNOWN | no | 1 | 2 |
| PG-assets-hygiene | public/assets-hygiene.html | UNKNOWN | no | 1 | 3 |
| PG-assets | public/assets.html | any | yes | 10 | 15 |
| PG-cockpit | public/cockpit.html | any | yes | 1 | 8 |
| PG-commitments | public/commitments.html | any | no | 1 | 4 |
| PG-coverage | public/coverage.html | any | no | 0 | 3 |
| PG-dashboard-composer | public/dashboard-composer.html | admin / dashboard-publisher | no | 1 | 5 |
| PG-dashboards | public/dashboards.html | any | yes | 1 | 10 |
| PG-exec-view | public/exec-view.html | public | no | 1 | 6 |
| PG-executive-report | public/executive-report.html | super_admin | yes | 1 | 10 |
| PG-executive | public/executive.html | executive / scorecard-viewer | yes | 1 | 10 |
| PG-handoffs | public/handoffs.html | any | yes | 1 | 8 |
| PG-help | public/help.html | any | yes | 1 | 9 |
| PG-home | public/home.html | any | yes | 0 | 8 |
| PG-index | public/index.html | any | yes | 1 | 25 |
| PG-infra-health | public/infra-health.html | any | yes | 2 | 5 |
| PG-inspection-actions | public/inspection-actions.html | any | no | 1 | 6 |
| PG-inspection | public/inspection.html | any | no | 2 | 7 |
| PG-inspections | public/inspections.html | any | yes | 1 | 6 |
| PG-integrations | public/integrations.html | any | yes | 1 | 4 |
| PG-it-review | public/it-review.html | executive / scorecard-viewer | yes | 2 | 7 |
| PG-itsm-integrations-plan | public/itsm-integrations-plan.html | UNKNOWN | no | 0 | 5 |
| PG-itsm-roadmap | public/itsm-roadmap.html | super_admin | no | 1 | 4 |
| PG-kpi-builder | public/kpi-builder.html | any | no | 0 | 2 |
| PG-login | public/login.html | public | no | 1 | 10 |
| PG-meeting | public/meeting.html | any | no | 1 | 11 |
| PG-meetings-actions | public/meetings-actions.html | any | no | 2 | 8 |
| PG-meetings-compliance | public/meetings-compliance.html | any | no | 2 | 4 |
| PG-meetings-council | public/meetings-council.html | any | no | 2 | 3 |
| PG-meetings-import | public/meetings-import.html | editor | no | 2 | 4 |
| PG-meetings-insights | public/meetings-insights.html | any | no | 2 | 5 |
| PG-meetings-issues | public/meetings-issues.html | any | no | 2 | 5 |
| PG-meetings-progress | public/meetings-progress.html | any | no | 2 | 3 |
| PG-meetings-setup | public/meetings-setup.html | any | no | 1 | 4 |
| PG-meetings-unsigned | public/meetings-unsigned.html | any | no | 2 | 4 |
| PG-meetings | public/meetings.html | any | yes | 2 | 5 |
| PG-no-access | public/no-access.html | any | no | 0 | 2 |
| PG-notifications | public/notifications.html | any | yes | 1 | 3 |
| PG-obligations | public/obligations.html | any | yes | 0 | 3 |
| PG-policies | public/policies.html | admin / committee-member | yes | 1 | 4 |
| PG-portfolio | public/portfolio.html | any | yes | 1 | 8 |
| PG-project | public/project.html | any | no | 1 | 8 |
| PG-report-studio | public/report-studio.html | any | yes | 1 | 3 |
| PG-reports | public/reports.html | any | yes | 2 | 27 |
| PG-rfi | public/rfi.html | any | yes | 1 | 4 |
| PG-site-actions | public/site-actions.html | any | yes | 1 | 10 |
| PG-site-awareness | public/site-awareness.html | site-business / group-business / executive | yes | 2 | 5 |
| PG-site-report | public/site-report.html | UNKNOWN | no | 0 | 5 |
| PG-system-logs | public/system-logs.html | super_admin | yes | 1 | 3 |
| PG-tracker-builder | public/tracker-builder.html | admin / tracker-admin | no | 1 | 4 |
| PG-trackers | public/trackers.html | any | yes | 1 | 3 |
| PG-wan-health | public/wan-health.html | UNKNOWN | no | 0 | 4 |
| PG-wan-sla | public/wan-sla.html | UNKNOWN | no | 0 | 4 |
| PG-wan | public/wan.html | any | yes | 3 | 11 |

## Page entry points (E-U04)

"Not in navigation" above counts only the shell menu. A page is **reachable** when it is in the shell menu, in a module tab strip (public/module-tabs.js), linked from another page or page script, or allow-listed as deep-link only (with the reason). Parent = where Back / the breadcrumb leads.

| Page | Shell | Module tab | Linked from | Redirects to | Deep-link only | Parent |
|---|---|---|---|---|---|---|
| public/access.html | — | — | no-access.html, no-access.js | — | — | no-access.html |
| public/activity-tracker.html | yes | — | — | — | — | shell |
| public/analytics.html | yes | — | — | — | — | shell |
| public/assets-finance.html | — | — | — | assets.html | legacy redirect stub kept for old bookmarks → assets.html | assets.html |
| public/assets-hygiene.html | — | — | — | assets.html | legacy redirect stub kept for old bookmarks → assets.html | assets.html |
| public/assets.html | yes | — | assets-finance.html, assets-hygiene.html | — | — | shell |
| public/cockpit.html | yes | — | — | — | — | shell |
| public/commitments.html | — | — | site-actions.html | — | — | site-actions.html |
| public/coverage.html | — | — | — | — | — | **NO ENTRY POINT** — duty coverage page — no menu entry, no link from another page |
| public/dashboard-composer.html | — | — | dashboards.html | — | — | dashboards.html |
| public/dashboards.html | yes | — | — | — | — | shell |
| public/exec-view.html | — | — | — | — | public IT status snapshot: reached from the SharePoint Quick Link, outside the app | — |
| public/executive-report.html | yes | — | — | — | — | shell |
| public/executive.html | yes | — | dashboards.html | — | — | shell |
| public/handoffs.html | yes | — | home.html, site-actions.html | — | — | shell |
| public/help.html | yes | — | — | — | — | shell |
| public/home.html | yes | — | — | — | — | shell |
| public/index.html | yes | — | login.html, no-access.html | — | — | shell |
| public/infra-health.html | yes | — | — | — | — | shell |
| public/inspection-actions.html | — | yes | inspections.html | — | — | inspections.html |
| public/inspection.html | — | yes | inspection-actions.html, inspections.html | — | — | inspections.html |
| public/inspections.html | yes | yes | inspection-actions.html | — | — | shell |
| public/integrations.html | yes | — | — | — | — | shell |
| public/it-review.html | yes | — | — | — | — | shell |
| public/itsm-integrations-plan.html | — | — | itsm-roadmap.html | — | — | itsm-roadmap.html |
| public/itsm-roadmap.html | — | — | — | — | the manager's personal roadmap tool: reached by its URL (bookmark), deliberately outside the shared menu | — |
| public/kpi-builder.html | — | — | — | — | — | **NO ENTRY POINT** — KPI policy builder (kpi-committee) — only named in the role help text of the Users card |
| public/login.html | — | — | auth.js, executive-report.html, reports.html | — | sign-in page: reached by redirect from every gated page (auth.js), not from a menu | executive-report.html |
| public/meeting.html | — | — | lib/home-page.js, meetings-actions.html, meetings-council.html, meetings-issues.html (+4) | — | — | meetings-actions.html |
| public/meetings-actions.html | — | yes | — | — | — | meetings.html |
| public/meetings-compliance.html | — | yes | cockpit.html, meetings.html | — | — | meetings.html |
| public/meetings-council.html | — | yes | meetings.html | — | — | meetings.html |
| public/meetings-import.html | — | — | meetings.html | — | — | meetings.html |
| public/meetings-insights.html | — | yes | — | — | — | meetings.html |
| public/meetings-issues.html | — | yes | meetings.html | — | — | meetings.html |
| public/meetings-progress.html | — | — | meeting.html, meetings.html | — | — | meeting.html |
| public/meetings-setup.html | — | yes | — | — | — | meetings.html |
| public/meetings-unsigned.html | — | yes | — | — | — | meetings.html |
| public/meetings.html | yes | yes | meeting.html, meetings-import.html | — | — | shell |
| public/no-access.html | — | — | auth.js | — | denial page: reached by redirect from auth.js when a role is missing | auth.js |
| public/notifications.html | yes | — | home.html, site-actions.html | — | — | shell |
| public/obligations.html | yes | — | home.html, site-actions.html | — | — | shell |
| public/policies.html | yes | — | — | — | — | shell |
| public/portfolio.html | yes | — | itsm-roadmap.html, project.html | — | — | shell |
| public/project.html | — | — | lib/home-page.js, meeting.html | — | — | meeting.html |
| public/report-studio.html | yes | — | — | — | — | shell |
| public/reports.html | yes | — | site-report.html | — | — | shell |
| public/rfi.html | yes | — | meeting.html, portfolio.html | — | — | shell |
| public/site-actions.html | yes | yes | commitments.html, handoffs.html | — | — | shell |
| public/site-awareness.html | yes | — | auth.js | — | — | shell |
| public/site-report.html | — | — | — | — | — | **NO ENTRY POINT** — live site scoreboard — no link from the app (the coordinator e-mail names it but carries no link) |
| public/system-logs.html | yes | — | — | — | — | shell |
| public/tracker-builder.html | — | — | trackers.html | — | — | trackers.html |
| public/trackers.html | yes | — | tracker-builder.html | — | — | shell |
| public/wan-health.html | — | — | — | wan.html | legacy redirect stub kept for old bookmarks → wan.html | wan.html |
| public/wan-sla.html | — | — | — | wan.html | legacy redirect stub kept for old bookmarks → wan.html | wan.html |
| public/wan.html | yes | — | infra-health.html, wan-health.html, wan-sla.html | — | — | shell |

## Routes without a test reference

| Id | Method | Path | File:line |
|---|---|---|---|
| RT-POST-api-admin-backup-now | POST | `/api/admin/backup-now` | server.js:1231 |
| RT-GET-api-admin-backup-schedule | GET | `/api/admin/backup-schedule` | server.js:1213 |
| RT-POST-api-admin-backup-schedule | POST | `/api/admin/backup-schedule` | server.js:1223 |
| RT-POST-api-admin-refresh-major-incident-udfs | POST | `/api/admin/refresh-major-incident-udfs` | server.js:3199 |
| RT-GET-api-cab | GET | `/api/cab` | server.js:2949 |
| RT-POST-api-cache-clear | POST | `/api/cache/clear` | server.js:3171 |
| RT-GET-api-cache-status | GET | `/api/cache/status` | server.js:3304 |
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
| RT-POST-api-kpi-policies-validate | POST | `/api/kpi-policies/validate` | routes/kpiPolicies.js:89 |
| RT-GET-api-meetings-import-incubation-template | GET | `/api/meetings/import/incubation-template` | routes/meetings.js:801 |
| RT-POST-api-meetings-import-incubation-commit | POST | `/api/meetings/import/incubation/commit` | routes/meetings.js:841 |
| RT-POST-api-meetings-import-incubation-preview | POST | `/api/meetings/import/incubation/preview` | routes/meetings.js:814 |
| RT-POST-api-meetings-import-preview | POST | `/api/meetings/import/preview` | routes/meetings.js:726 |
| RT-GET-api-meetings-import-template | GET | `/api/meetings/import/template` | routes/meetings.js:706 |
| RT-GET-api-meetings-people | GET | `/api/meetings/people` | routes/meetings.js:147 |
| RT-GET-api-meetings-progress-export-pptx | GET | `/api/meetings/progress/export-pptx` | routes/meetings.js:917 |
| RT-POST-api-meetings-reset | POST | `/api/meetings/reset` | routes/meetings.js:693 |
| RT-POST-api-reports-auth-change-password | POST | `/api/reports/auth/change-password` | server.js:5174 |
| RT-GET-api-reports-current-week | GET | `/api/reports/current-week` | server.js:5250 |
| RT-GET-api-reports-helpdesk-live | GET | `/api/reports/helpdesk-live` | server.js:5560 |
| RT-GET-api-reports-sessions-active | GET | `/api/reports/sessions/active` | routes/adminUsers.js:174 |
| RT-GET-api-reports-technicians | GET | `/api/reports/technicians` | server.js:5811 |
| RT-POST-api-reports-test-smtp | POST | `/api/reports/test-smtp` | routes/adminConfig.js:159 |
| RT-PUT-api-reports-users-emails | PUT | `/api/reports/users/emails` | routes/adminUsers.js:118 |
| RT-GET-api-risk-register-config-sites | GET | `/api/risk-register-config/sites` | routes/riskRegister.js:78 |
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
| JB-engagement-alerts | engagement.alerts | 0 |
| JB-engagement-digest | engagement.digest | 0 |
| JB-engagement-digest-weekly | engagement.digest_weekly | 0 |
| JB-field-purge | field.purge | 1 |
| JB-governance-agenda-drafts | governance.agenda_drafts | 1 |
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
| JB-zoho-requests | zoho.requests | 12 |
| JB-zoho-survey | zoho.survey | 1 |
