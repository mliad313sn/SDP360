# Inventory (generated)

`node tools/agent/inventory.js` writes this file; `--check` fails CI when it is out of date.

"Tests" means the test files that **mention** the page, route or job. It is a coverage signal, not proof of correctness; field validation, deployment and acceptance are never derived from code.

| Item | Count |
|---|---:|
| pages | 62 |
| pages without test reference | 0 |
| pages without declared role | 6 |
| pages not in navigation | 30 |
| pages not in shell or module tabs | 21 |
| pages deep link only | 9 |
| pages without entry point | 3 |
| pages with inline scripts | 46 |
| routes | 710 |
| routes without test reference | 32 |
| routes in server js | 209 |
| jobs | 33 |
| jobs without test reference | 0 |
| migrations | 98 |
| test files | 793 |

## Pages

| Id | Page | Role required | In nav | Inline scripts | Tests |
|---|---|---|---|---:|---:|
| PG-access | public/access.html | any | no | 0 | 7 |
| PG-activity-tracker | public/activity-tracker.html | any | yes | 0 | 6 |
| PG-analytics | public/analytics.html | admin / scorecard-viewer | yes | 1 | 8 |
| PG-assets-finance | public/assets-finance.html | UNKNOWN | no | 1 | 2 |
| PG-assets-hygiene | public/assets-hygiene.html | UNKNOWN | no | 1 | 3 |
| PG-assets | public/assets.html | any | yes | 10 | 16 |
| PG-cockpit | public/cockpit.html | any | yes | 1 | 10 |
| PG-commitments | public/commitments.html | any | no | 1 | 6 |
| PG-connector-health | public/connector-health.html | admin | yes | 0 | 2 |
| PG-coverage | public/coverage.html | any | no | 0 | 3 |
| PG-dashboard-composer | public/dashboard-composer.html | admin / dashboard-publisher | no | 1 | 5 |
| PG-dashboards | public/dashboards.html | any | yes | 1 | 13 |
| PG-data-quality | public/data-quality.html | admin | yes | 0 | 2 |
| PG-exec-view | public/exec-view.html | public | no | 1 | 8 |
| PG-executive-report | public/executive-report.html | super_admin | yes | 1 | 11 |
| PG-executive | public/executive.html | executive / scorecard-viewer | yes | 1 | 15 |
| PG-finance | public/finance.html | admin / finance-viewer / finance-verifier | yes | 0 | 3 |
| PG-handoffs | public/handoffs.html | any | yes | 1 | 9 |
| PG-help | public/help.html | any | yes | 1 | 10 |
| PG-home | public/home.html | any | yes | 0 | 15 |
| PG-index | public/index.html | any | yes | 1 | 31 |
| PG-infra-health | public/infra-health.html | any | yes | 2 | 6 |
| PG-inspection-actions | public/inspection-actions.html | any | no | 1 | 6 |
| PG-inspection | public/inspection.html | any | no | 2 | 7 |
| PG-inspections | public/inspections.html | any | yes | 1 | 8 |
| PG-integrations | public/integrations.html | any | yes | 1 | 4 |
| PG-it-review | public/it-review.html | executive / scorecard-viewer | yes | 2 | 8 |
| PG-itsm-integrations-plan | public/itsm-integrations-plan.html | UNKNOWN | no | 0 | 5 |
| PG-itsm-roadmap | public/itsm-roadmap.html | super_admin | no | 1 | 5 |
| PG-kpi-builder | public/kpi-builder.html | any | no | 0 | 2 |
| PG-login | public/login.html | public | no | 1 | 12 |
| PG-meeting | public/meeting.html | any | no | 1 | 13 |
| PG-meetings-actions | public/meetings-actions.html | any | no | 2 | 9 |
| PG-meetings-compliance | public/meetings-compliance.html | any | no | 2 | 4 |
| PG-meetings-council | public/meetings-council.html | any | no | 2 | 3 |
| PG-meetings-import | public/meetings-import.html | editor | no | 2 | 4 |
| PG-meetings-insights | public/meetings-insights.html | any | no | 2 | 5 |
| PG-meetings-issues | public/meetings-issues.html | any | no | 2 | 5 |
| PG-meetings-progress | public/meetings-progress.html | any | no | 2 | 3 |
| PG-meetings-setup | public/meetings-setup.html | any | no | 1 | 4 |
| PG-meetings-unsigned | public/meetings-unsigned.html | any | no | 2 | 4 |
| PG-meetings | public/meetings.html | any | yes | 2 | 7 |
| PG-no-access | public/no-access.html | any | no | 0 | 2 |
| PG-notifications | public/notifications.html | any | yes | 1 | 3 |
| PG-obligations | public/obligations.html | any | yes | 0 | 4 |
| PG-policies | public/policies.html | admin / committee-member | yes | 1 | 5 |
| PG-portfolio | public/portfolio.html | any | yes | 1 | 16 |
| PG-project | public/project.html | any | no | 1 | 19 |
| PG-report-studio | public/report-studio.html | any | yes | 1 | 3 |
| PG-reports | public/reports.html | any | yes | 2 | 37 |
| PG-rfi | public/rfi.html | any | yes | 1 | 4 |
| PG-site-actions | public/site-actions.html | any | yes | 1 | 17 |
| PG-site-awareness | public/site-awareness.html | site-business / group-business / executive | yes | 2 | 5 |
| PG-site-report | public/site-report.html | UNKNOWN | no | 0 | 6 |
| PG-system-logs | public/system-logs.html | super_admin | yes | 1 | 3 |
| PG-tracker-builder | public/tracker-builder.html | admin / tracker-admin | no | 1 | 4 |
| PG-trackers | public/trackers.html | any | yes | 1 | 3 |
| PG-value-scoreboard | public/value-scoreboard.html | admin | yes | 0 | 2 |
| PG-wan-health | public/wan-health.html | UNKNOWN | no | 0 | 4 |
| PG-wan-sla | public/wan-sla.html | UNKNOWN | no | 0 | 4 |
| PG-wan | public/wan.html | any | yes | 3 | 15 |
| PG-workspace-settings | public/workspace-settings.html | any | no | 0 | 3 |

## Page entry points (E-U04)

"Not in navigation" above counts only the shell menu. A page is **reachable** when it is in the shell menu, in a module tab strip (public/module-tabs.js), linked from another page or page script, or allow-listed as deep-link only (with the reason). Parent = where Back / the breadcrumb leads.

| Page | Shell | Module tab | Linked from | Redirects to | Deep-link only | Parent |
|---|---|---|---|---|---|---|
| public/access.html | — | — | no-access.html, no-access.js | — | — | no-access.html |
| public/activity-tracker.html | yes | — | lib/homeQueue.js, lib/workspaceProfiles.js | — | — | shell |
| public/analytics.html | yes | — | lib/workspaceProfiles.js | — | — | shell |
| public/assets-finance.html | — | — | — | assets.html | legacy redirect stub kept for old bookmarks → assets.html | assets.html |
| public/assets-hygiene.html | — | — | — | assets.html | legacy redirect stub kept for old bookmarks → assets.html | assets.html |
| public/assets.html | yes | — | assets-finance.html, assets-hygiene.html, lib/workspaceProfiles.js | — | — | shell |
| public/cockpit.html | yes | — | lib/workspaceProfiles.js | — | — | shell |
| public/commitments.html | — | — | lib/dashboardRender.js, site-actions.html | — | — | site-actions.html |
| public/connector-health.html | yes | — | — | — | — | shell |
| public/coverage.html | — | — | — | — | — | **NO ENTRY POINT** — duty coverage page — no menu entry, no link from another page |
| public/dashboard-composer.html | — | — | dashboards.html | — | — | dashboards.html |
| public/dashboards.html | yes | — | lib/workspaceProfiles.js | — | — | shell |
| public/data-quality.html | yes | — | — | — | — | shell |
| public/exec-view.html | — | — | — | — | public IT status snapshot: reached from the SharePoint Quick Link, outside the app | — |
| public/executive-report.html | yes | — | — | — | — | shell |
| public/executive.html | yes | — | dashboards.html | — | — | shell |
| public/finance.html | yes | — | lib/moneyCertBand.js | — | — | shell |
| public/handoffs.html | yes | — | home.html, site-actions.html | — | — | shell |
| public/help.html | yes | — | — | — | — | shell |
| public/home.html | yes | — | index.html, lib/pageStates.js, lib/workspaceProfiles.js, workspace-settings.html | — | — | shell |
| public/index.html | yes | — | lib/workspaceProfiles.js, login.html, no-access.html | — | — | shell |
| public/infra-health.html | yes | — | — | — | — | shell |
| public/inspection-actions.html | — | yes | inspections.html | — | — | inspections.html |
| public/inspection.html | — | yes | inspection-actions.html, inspections.html | — | — | inspections.html |
| public/inspections.html | yes | yes | inspection-actions.html, lib/workspaceProfiles.js | — | — | shell |
| public/integrations.html | yes | — | lib/workspaceProfiles.js | — | — | shell |
| public/it-review.html | yes | — | lib/workspaceProfiles.js | — | — | shell |
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
| public/meetings.html | yes | yes | lib/workspaceProfiles.js, meeting.html, meetings-import.html | — | — | shell |
| public/no-access.html | — | — | auth.js | — | denial page: reached by redirect from auth.js when a role is missing | auth.js |
| public/notifications.html | yes | — | home.html, site-actions.html | — | — | shell |
| public/obligations.html | yes | — | home.html, site-actions.html | — | — | shell |
| public/policies.html | yes | — | access.html, lib/workspaceProfiles.js | — | — | shell |
| public/portfolio.html | yes | — | itsm-roadmap.html, lib/workspaceProfiles.js, project.html | — | — | shell |
| public/project.html | — | — | lib/home-page.js, lib/portfolioViews.js, meeting.html, portfolio.html | — | — | meeting.html |
| public/report-studio.html | yes | — | lib/workspaceProfiles.js | — | — | shell |
| public/reports.html | yes | — | access.html, site-report.html, wan.html | — | — | shell |
| public/rfi.html | yes | — | meeting.html, portfolio.html | — | — | shell |
| public/site-actions.html | yes | yes | commitments.html, handoffs.html, lib/workspaceProfiles.js | — | — | shell |
| public/site-awareness.html | yes | — | auth.js, lib/workspaceProfiles.js | — | — | shell |
| public/site-report.html | — | — | — | — | — | **NO ENTRY POINT** — live site scoreboard — no link from the app (the coordinator e-mail names it but carries no link) |
| public/system-logs.html | yes | — | lib/workspaceProfiles.js | — | — | shell |
| public/tracker-builder.html | — | — | trackers.html | — | — | trackers.html |
| public/trackers.html | yes | — | tracker-builder.html | — | — | shell |
| public/value-scoreboard.html | yes | — | — | — | — | shell |
| public/wan-health.html | — | — | — | wan.html | legacy redirect stub kept for old bookmarks → wan.html | wan.html |
| public/wan-sla.html | — | — | — | wan.html | legacy redirect stub kept for old bookmarks → wan.html | wan.html |
| public/wan.html | yes | — | infra-health.html, wan-health.html, wan-sla.html | — | — | shell |
| public/workspace-settings.html | — | — | — | — | workspace settings: the header "My workspace" link is drawn by _shell.js only while workspace_profiles_enabled = 1 (not visible to this static scan); 404 while off | — |

## Routes without a test reference

| Id | Method | Path | File:line |
|---|---|---|---|
| RT-POST-api-admin-refresh-major-incident-udfs | POST | `/api/admin/refresh-major-incident-udfs` | server.js:3174 |
| RT-GET-api-cab | GET | `/api/cab` | server.js:2924 |
| RT-GET-api-change | GET | `/api/change` | server.js:2902 |
| RT-GET-api-data-ageing-by-group | GET | `/api/data/ageing-by-group` | server.js:4084 |
| RT-GET-api-data-ageing-by-site | GET | `/api/data/ageing-by-site` | server.js:4034 |
| RT-GET-api-data-cab-approvals | GET | `/api/data/cab-approvals` | server.js:3606 |
| RT-GET-api-data-cab-recommendations | GET | `/api/data/cab-recommendations` | server.js:3628 |
| RT-GET-api-data-change-table | GET | `/api/data/change-table` | server.js:3372 |
| RT-GET-api-data-emergency-changes | GET | `/api/data/emergency-changes` | server.js:3540 |
| RT-GET-api-data-first-response | GET | `/api/data/first-response` | server.js:3405 |
| RT-GET-api-data-group-requests | GET | `/api/data/group-requests` | server.js:3518 |
| RT-GET-api-data-incident-vs-sr | GET | `/api/data/incident-vs-sr` | server.js:3584 |
| RT-GET-api-data-major-incidents | GET | `/api/data/major-incidents` | server.js:3345 |
| RT-GET-api-data-monthly-summary | GET | `/api/data/monthly-summary` | server.js:3989 |
| RT-GET-api-data-sla-by-category | GET | `/api/data/sla-by-category` | server.js:3475 |
| RT-POST-api-executive-new-pptx | POST | `/api/executive-new-pptx` | server.js:6373 |
| RT-GET-api-integration-fmp-readiness | GET | `/api/integration/fmp/readiness` | routes/fourmypeople.js:31 |
| RT-GET-api-meetings-import-incubation-template | GET | `/api/meetings/import/incubation-template` | routes/meetings.js:806 |
| RT-POST-api-meetings-import-incubation-commit | POST | `/api/meetings/import/incubation/commit` | routes/meetings.js:846 |
| RT-POST-api-meetings-import-incubation-preview | POST | `/api/meetings/import/incubation/preview` | routes/meetings.js:819 |
| RT-GET-api-meetings-progress-export-pptx | GET | `/api/meetings/progress/export-pptx` | routes/meetings.js:922 |
| RT-GET-api-reports-helpdesk-live | GET | `/api/reports/helpdesk-live` | server.js:5517 |
| RT-GET-api-reports-sessions-active | GET | `/api/reports/sessions/active` | routes/adminUsers.js:174 |
| RT-GET-api-reports-technicians | GET | `/api/reports/technicians` | server.js:5774 |
| RT-POST-api-reports-test-smtp | POST | `/api/reports/test-smtp` | routes/adminConfig.js:176 |
| RT-GET-api-risk-register-config-unmapped | GET | `/api/risk-register-config/unmapped` | routes/riskRegister.js:130 |
| RT-GET-api-roadmap-evidence-catalogue | GET | `/api/roadmap/evidence/catalogue` | routes/roadmap.js:56 |
| RT-GET-api-roadmap-evidence-incidents | GET | `/api/roadmap/evidence/incidents` | routes/roadmap.js:73 |
| RT-GET-api-roadmap-evidence-platform | GET | `/api/roadmap/evidence/platform` | routes/roadmap.js:64 |
| RT-POST-api-save-pptx | POST | `/api/save-pptx` | server.js:6453 |
| RT-POST-api-tracker-import-dept-meetings | POST | `/api/tracker/import-dept-meetings` | routes/tracker.js:109 |
| RT-GET- | GET | `/` | server.js:1389 |

## Scheduled jobs

| Id | Job | Tests |
|---|---|---:|
| JB-access-emergency-expiry | access.emergency_expiry | 1 |
| JB-access-entra-deprovision | access.entra_deprovision | 1 |
| JB-access-grant-expiry | access.grant_expiry | 2 |
| JB-assets-sync | assets.sync | 6 |
| JB-audit-chain-verify | audit.chain_verify | 2 |
| JB-audit-retention | audit.retention | 3 |
| JB-commitments-escalate | commitments.escalate | 1 |
| JB-db-backup | db.backup | 2 |
| JB-db-restore-drill | db.restore_drill | 2 |
| JB-engagement-action-aging | engagement.action_aging | 1 |
| JB-engagement-alerts | engagement.alerts | 1 |
| JB-engagement-digest | engagement.digest | 2 |
| JB-engagement-digest-weekly | engagement.digest_weekly | 1 |
| JB-engagement-schedule-reminders | engagement.schedule_reminders | 1 |
| JB-engagement-weekly-report-nudges | engagement.weekly_report_nudges | 1 |
| JB-field-purge | field.purge | 1 |
| JB-governance-agenda-drafts | governance.agenda_drafts | 1 |
| JB-governance-ppm-alerts | governance.ppm_alerts | 1 |
| JB-handoffs-escalate | handoffs.escalate | 1 |
| JB-meraki-wan | meraki.wan | 9 |
| JB-meraki-wan-events | meraki.wan_events | 1 |
| JB-meraki-wan-events-5m | meraki.wan_events_5m | 1 |
| JB-meraki-wan-poller | meraki.wan_poller | 2 |
| JB-meridian-resources | meridian.resources | 1 |
| JB-opmanager-availability | opmanager.availability | 3 |
| JB-publish-connectors | publish.connectors | 2 |
| JB-reports-monthly | reports.monthly | 1 |
| JB-reports-weekly | reports.weekly | 2 |
| JB-softdelete-purge | softdelete.purge | 2 |
| JB-teams-sla-poll | teams.sla_poll | 3 |
| JB-zoho-change-cab | zoho.change_cab | 1 |
| JB-zoho-requests | zoho.requests | 23 |
| JB-zoho-survey | zoho.survey | 2 |
