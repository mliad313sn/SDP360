# ADR-ADOPTION-LOTA — "Say the truth, no dead ends" (adoption review 2026-11-20, Lot A)

Status: technical decisions (reversible engineering details), taken by an AI agent in a sandbox. Nothing here sets a
business policy, a KPI threshold or an access scope beyond what the routes already enforce; where one is needed it is
written **PROPOSED** for its owner. Source: `docs/ux/adoption-review-2026-11-20/ADOPTION-REVIEW.md` §5–§6.

## ADR-ADOPTION-LOTA-01 — `itsm-integrations-plan.html` is restricted to the admin tier (not removed)
- The page is an internal project document (integrations plan) linked from `itsm-roadmap.html`, the super_admin's
  personal tool. Every signed-in account, business users included, could read it.
- Decision: keep it served (the roadmap link keeps working) but require `rdb.userHasRole(user, 'admin')` in the
  server route; any other session gets a 302 to the French `no-access.html`. Removing it from the served pages would
  break the roadmap link and is a page-retirement decision (sponsor D-P09-3, Lot C) — not taken here.
- Reversible: one line in `server.js` (`/itsm-integrations-plan.html`). Test: `tests/integrations-plan-gate.smoke.test.js`.

## ADR-ADOPTION-LOTA-02 — menu roles are the route's roles; refusals reuse the no-access wording
- A menu entry is shown only to the roles its page's primary data route accepts (Activity Tracker → `admin |
  tracker-admin | tracker-editor`, as `GET /api/tracker/load`; Finance certification → `admin | finance-viewer`, the
  read rule of `GET /api/finance/certifications`). The page gate (`auth.js data-require`) matches, so a direct URL lands
  on the French no-access page, never on a raw `Forbidden`.
- This narrows nothing the server allowed: those accounts were already refused the data.
- Enforcement: `tests/adoption-lota-nav-authz.test.js` walks every persona of `docs/ops/authz-outcomes.json` × every
  menu entry it sees and fails on a refusal (U/F) of the page's primary route or a page gate that refuses. A new menu
  entry must name its primary route there.
- A page whose feature switch is off (data-quality, workspace-settings) redirects to `no-access.html?reason=off`
  ("Cette fonction n'est pas activée") instead of returning `{"error":"Not found"}`. The API routes keep their 404.

## ADR-ADOPTION-LOTA-03 — page-view telemetry accepted from business-only accounts
- `POST /api/ux/page-view` writes ONE `page_viewed` system_log row for the caller (actor `u<id>`, page id from the
  known-page list, role tier) and answers `{ok, logged}`. It reads and returns nothing, so opening it to
  site-business / group-business exposes no data. Added to `services/businessGuard` ALLOWED; the usage READ
  (`GET /api/ux/page-usage`, super_admin) and the task events (`/api/ux/event`) stay closed to business accounts.

## ADR-ADOPTION-LOTA-04 — one reporting week
- `public/lib/reportingWeek.js` (UMD) is the only definition of the Zoho week and of the week a weekly report is due
  (the previous week). `reports-db.getISOWeek / getPreviousWeek` delegate to it; the report picker, Home and the
  Helpdesk week labels use it. The picker's second step back (the W44 default) is removed.
- The Helpdesk keeps defaulting to the week in progress (documented user decision in `public/index.html`
  `defaultP`), but its week options now say which is "in progress" and which is "report due".

## ADR-ADOPTION-LOTA-05 — unknown is "—", not 0
- A never-synced source (asset register `last_sync` null; a KPI tile with `freshness: 'UNKNOWN'`; Helpdesk with no
  ticket ever loaded and no data date) shows "—" + "jamais synchronisé / never synced", neutral colour.
- A tracker month with nothing entered for a site is "not entered": no score, rag NA, no `tracker.site.red` firing
  (`services/trackerMonthState.js`, registry reader + dashboard widget). The rule for a PARTIALLY entered month is
  unchanged and **PROPOSED** to the KPI committee (see the evidence file).

## ADR-ADOPTION-LOTA-06 — site-view SLA compliance uses the doctrine denominator
- Site Awareness "Conformité SLA %" was `100 − overdue ÷ created`; the Helpdesk ranking uses
  `(closed − closed & overdue) ÷ closed` (KPI doctrine, `docs/sop/SOP-kpi-sla.md`). Same site, same week: 60 % vs 50 %.
  The site view now uses the doctrine figure (`res_sla_pct`); `missed_pct` stays in the payload for older callers.
- Remaining, documented difference: the Helpdesk ranking groups tickets by the free-form `site` field (spellings
  folded), the site view by the site's Zoho groups (`tech_group`). Aligning the population is a KPI-committee question
  (**PROPOSED**), not changed here.
