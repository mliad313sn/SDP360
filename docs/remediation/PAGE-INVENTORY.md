# PAGE-INVENTORY — 74 HTML pages (M00 Phase 0 / M03 input)

> Status: **TESTED_SYNTHETICALLY** (static source scan). Client `auth.js` gating is UX, not security — server/API evidence is in RBAC-MATRIX.md. Owner/persona per page still to be confirmed by product (M03 step 4).

| Page | Class | Gate / note | Keyed (dash key) | External hosts |
|---|---|---|---|---|
| activity-tracker.html | primary | auth.js data-require=any |  | cdnjs.cloudflare.com, unpkg.com |
| analytics.html | primary | auth.js data-require=admin|scorecard-viewer | yes — session-only since F-M02-001 | fonts.googleapis.com, fonts.gstatic.com, cdnjs.cloudflare.com |
| assets-finance.html | redirect | stub (`location.replace` → assets.html#…), no data — target page is gated |  |  |
| assets-hygiene.html | redirect | stub (`location.replace` → assets.html#…), no data — target page is gated |  |  |
| assets.html | primary | auth.js data-require=any |  | cdnjs.cloudflare.com, entra.microsoft.com |
| cockpit-session.html | primary | auth.js data-require=(none → any signed-in user) |  |  |
| cockpit.html | primary | auth.js data-require=(none → any signed-in user) |  |  |
| dashboard-composer.html | primary | auth.js data-require=dashboard-author|dashboard-publisher|super_admin |  |  |
| dashboard-preview/index.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  | unpkg.com |
| dashboard.html | primary | auth.js data-require=any |  |  |
| design-system/01-logo-lockup.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/02-primary-palette.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/03-tints-secondary.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/04-pillars.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/05-type-display.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/06-type-body.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/07-type-scale.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/08-banners.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/09-4ps-values.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/10-golden-rules.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/11-mine-logos.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/12-programme-logos.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/13-buttons.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/14-card.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/15-kpi.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/16-forms.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/17-spacing.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/18-radii-shadows.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/19-contour-pattern.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/20-tone.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| design-system/goldy.html | static/public | design reference — no data; RETIREMENT/ISOLATION candidate (product decision) |  |  |
| direction.html | primary | auth.js data-require=executive|scorecard-viewer |  |  |
| exec-view.html | public | SharePoint public view (aggregates only, by design) |  | fonts.googleapis.com, fonts.gstatic.com |
| executive-report.html | primary | auth.js data-require=super_admin | yes — session-only since F-M02-001 | fonts.googleapis.com, cdn.jsdelivr.net, fonts.gstatic.com |
| executive.html | primary | auth.js data-require=executive|scorecard-viewer | yes — session-only since F-M02-001 | fonts.googleapis.com, fonts.gstatic.com, cdnjs.cloudflare.com |
| field.html | primary | auth.js data-require=field-tech|editor |  |  |
| governance.html | primary | auth.js data-require=(none → any signed-in user) |  |  |
| help.html | primary | auth.js data-require=any |  |  |
| index.html | primary | auth.js data-require=any | yes — session-only since F-M02-001 | cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com |
| infra-health.html | primary | auth.js data-require=any |  | cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com |
| inspection-actions.html | primary | auth.js data-require=any |  | cdnjs.cloudflare.com |
| inspection.html | primary | auth.js data-require=any |  |  |
| inspections.html | primary | auth.js data-require=any |  | cdnjs.cloudflare.com |
| it-review.html | primary | auth.js data-require=executive|scorecard-viewer |  |  |
| itsm-integrations-plan.html | UNGATED-STATIC | no auth.js — served to anonymous visitors; classification needed (F-M03-001) |  |  |
| itsm-roadmap.html | primary | auth.js data-require=super_admin |  |  |
| kpi-dictionary.html | primary | auth.js data-require=any |  |  |
| login.html | public | login form |  | fonts.googleapis.com, fonts.gstatic.com |
| meeting.html | primary | auth.js data-require=any |  |  |
| meetings-actions.html | primary | auth.js data-require=any |  | cdnjs.cloudflare.com |
| meetings-compliance.html | primary | auth.js data-require=any |  |  |
| meetings-council.html | primary | auth.js data-require=any |  |  |
| meetings-import.html | primary | auth.js data-require=editor |  |  |
| meetings-insights.html | primary | auth.js data-require=any |  | cdnjs.cloudflare.com |
| meetings-issues.html | primary | auth.js data-require=any |  |  |
| meetings-progress.html | primary | auth.js data-require=any |  |  |
| meetings-setup.html | primary | auth.js data-require=any |  |  |
| meetings-unsigned.html | primary | auth.js data-require=any |  |  |
| meetings.html | primary | auth.js data-require=any |  |  |
| notifications.html | primary | auth.js data-require=(none → any signed-in user) |  |  |
| portfolio.html | primary | auth.js data-require=(none → any signed-in user) |  |  |
| publication.html | primary | auth.js data-require=super_admin|report-reviewer |  |  |
| report-studio.html | primary | auth.js data-require=(none → any signed-in user) |  |  |
| reports.html | primary | auth.js data-require=any | yes — session-only since F-M02-001 | cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com |
| rfi.html | primary | auth.js data-require=(none → any signed-in user) |  |  |
| site-actions.html | primary | auth.js data-require=any |  |  |
| site-awareness.html | primary | auth.js data-require=site-business|group-business|executive |  | cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com |
| site-report.html | primary | auth.js data-require=(none → any signed-in user) |  | fonts.googleapis.com, fonts.gstatic.com, cdnjs.cloudflare.com |
| system-logs.html | primary | auth.js data-require=super_admin |  | cdn.jsdelivr.net |
| tracker-builder.html | primary | auth.js data-require=tracker-author|tracker-publisher|super_admin |  |  |
| trackers.html | primary | auth.js data-require=(none → any signed-in user) |  |  |
| wan-health.html | redirect | stub, no data — target page is gated |  |  |
| wan-sla.html | redirect | stub, no data — target page is gated |  |  |
| wan.html | primary | auth.js data-require=any |  | cdnjs.cloudflare.com |

**Counts:** primary 45 · UNGATED-STATIC 1 · static/public 22 · public 2 · redirect 4 · pages referencing external hosts: 19 (M17)

**The roadmap's "four redirect/static targets lacking auth.js" = `wan-health`, `wan-sla`, `assets-finance`, `assets-hygiene`.**
All four are server-rendered with `sendHtmlPage(…, false)` (no dash key), contain only a redirect to a gated page
and no data → classified **public-safe redirect**. Verified by reading each file (≤ 420 bytes).
One further ungated page was found: **`itsm-integrations-plan.html`** (30 KB internal project-plan document, no
data API, no secrets found by pattern scan) — exposure to anonymous visitors is a **product decision** (DEC-03).
