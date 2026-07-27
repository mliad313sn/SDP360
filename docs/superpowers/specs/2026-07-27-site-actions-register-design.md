# Per-Site Actions Register Hub (SP1a) — Design

**Date:** 2026-07-27
**Branch:** `feat/site-actions-register`
**Status:** design for review

## Problem

Action items for a site live in **three separate places** with no unified view:

1. **Meetings** — `md_actions` (surfaced at `meetings-actions.html`, closed via
   `POST /api/meetings/actions/:id/update`).
2. **Inspections** — `insp_actions` (surfaced at `inspection-actions.html`,
   closed via `POST /api/inspection/actions/:id/update`).
3. **Weekly site report** — `action_items` ("Actions & Follow-ups", edited in
   `reports.html`).

Two field-observed symptoms:

- **"Trop de lignes non fermées par site."** A coordinator has no single place
  to see everything still open for their site, so done-but-not-closed actions
  accumulate unseen — especially report follow-ups, which the weekly
  *"Import all (except closed) from previous week"* button copies forward every
  week until someone closes them.
- **"On ne sait pas quel rapport ouvrir pour aller les fermer."** Even when a
  coordinator wants to clean up, the action could be in any of three modules,
  each with its own page.

## Goal

One **per-site Actions Register** page that aggregates all still-open actions
from the three sources, **grouped by theme** (Meetings · Inspections · Report
follow-ups), with **age / overdue** flags, so a coordinator sees everything in
one place and can **close it or jump to where it is closed** in one click.

## Non-goals (explicitly out of SP1a)

- **No schema change. No touch to the report save path.** `action_items` is
  persisted by a full `DELETE`-then-`reINSERT` (`saveActionItems`,
  `reports-db.js:2501`), so its rows have **no stable identity** across saves.
  Anything needing a durable per-row link is deferred.
- **No merge / reference of hidden duplicates.** Manually linking a local report
  follow-up to its Meetings/Inspection twin needs stable identity + `source` /
  `origin_id` columns → that is **SP1b**.
- **No cross-week lineage dedup** of report actions (needs `carried_from`) →
  SP1b.
- **No coordinator-email changes** (the "by-theme summary + link to this hub")
  → that is **SP2**, and it will point at the page this sub-project delivers.
- **No new close/audit path for report actions.** Report follow-ups are closed
  where they already are — in the report editor — reached by a deep-link.

## Data sources & readers to reuse

All three per-site readers already exist and are dual-backend
(sqlite + postgres). The hub **composes** them; it introduces no new DB reader
against the three action tables.

| Source | Table | Reader | Site key |
|---|---|---|---|
| Meetings | `md_actions` | `meetingsDb.listActions({site})` (`meetings-db.js:1334`) | `md_meetings.site_code` (joined) |
| Inspections | `insp_actions` | `inspectionDb.listActions({site})` (`inspection-db.js:1130`) | `insp_inspections.site_code` (joined) |
| Report | `action_items` | latest report id via `reportsDb.listReports(site_id)` (`reports-db.js:2152`, ordered `year DESC, week DESC` → `[0]` is latest, but **lightweight — no `action_items`**), then `getReport(id)` (`reports-db.js:2122`) to hydrate `.action_items` | `weekly_reports.site_id` |

`services/siteReportAdapters.js` (`adaptMeetingsActions`, `adaptInspectionActions`)
already normalizes the first two into a common shape for `siteReportDeps.js`.
The hub's normalizer extends that pattern (it currently runs *overdue-only*; the
hub wants **all non-closed**, with overdue as a flag).

### "Non-closed" per source

Status vocabularies differ; each source filters in JS to exclude its terminal
states:

- Meetings terminal: `resolved` · `cancelled` · `closed` (lowercase).
- Inspection terminal: `Closed` · `Cancelled` (Title-case).
- Report terminal: `closed`.

`listActions` for meetings/inspection is called **without** a `status` filter
(it takes an exact match, not "non-terminal") and filtered in JS. Bounded by the
reader's default `LIMIT 1000`, ample for one site.

### Report follow-ups = the latest report's open items

SP1a defines a site's open report follow-ups as **the non-closed `action_items`
of that site's most recent report**. Rationale: the weekly carry-forward already
rolls every non-closed follow-up into the latest week, so the latest report is
the live open set — this sidesteps cross-week duplicate counting **without**
lineage (which is SP1b). Clearly labelled on the page as *"open follow-ups on
your latest site report (W## YYYY)"*. Limitation flagged below.

## Unified row shape

```
{
  source:      'meetings' | 'inspection' | 'report',
  title:       string,        // description / task
  owner:       string | null,
  due_date:    string | null, // ISO or as stored
  status:      string,        // native status, shown as-is
  age_days:    number | null, // now - created_at  (null for report — see below)
  overdue:     boolean,       // due_date < today AND not terminal
  origin_label:string,        // 'PV HGO_Maintenance_2026-05' | inspection label | 'W29 2026'
  action_id:   number | null, // meetings/inspection row id (for inline close); null for report
  close:       { kind: 'inline' | 'link', url?: string }
}
```

- **`age_days`**: meetings/inspection carry `created_at` → real age. `action_items`
  has **no created timestamp** (only `due_date`) → `age_days` is `null` for
  report rows; they show `due_date` / `overdue` only. Flagged, not faked.
- **`close`**: `inline` for meetings/inspection (posts to their existing update
  API); `link` for report rows → deep-link that opens that week's report.

## Site-code resolution

The hub takes a site code in the **`meetings` namespace** (`SMI`, `MGO`, `HGO`,
…) — the same namespace the reporting suite already uses
(`getSiteIdByModuleCode('meetings', code)`, `siteReportDeps.js:15`). Meetings and
inspection readers filter by this code directly (they share it — "meetings reuses
inspection codes"). Report rows resolve `site_id` via
`getSiteIdByModuleCode('meetings', code)`.

**Known gap (flagged):** sites with no meetings/inspection code (Exploration,
Tanda) show empty Meetings/Inspection groups; their report group still works if
they have reports. The Ity=`SMI` drift is handled by using the meetings
namespace throughout.

## Close semantics

| Source | How the hub closes it |
|---|---|
| Meetings | Inline status control → `POST /api/meetings/actions/:id/update`. Server-side RBAC (`_userMeetingsSite`, `server.js:7262`) already enforces per-site editor scope; the control is disabled with a reason when the user isn't permitted (mirrors `meetings-actions.html`). A refused change reverts + shows the server message. |
| Inspection | Same, against `POST /api/inspection/actions/:id/update` (`_userInspectionSite`, `routes/inspection.js:41`). |
| Report | **Deep-link** to the report editor. Requires a small additive entry point in `reports.html`: a `?report=<id>` query param that, on load, calls the existing `openReportById(id)` and switches to the Action Items tab. No new write/close path, no audit table, no touch to `saveActionItems`. |

The `?report=<id>` handler is the only change to an existing hot file
(`reports.html`); it is purely additive (new branch in the boot routine) and
does not affect the autosave / save paths. **Sequencing matters**:
`openReportById` is async and ends with `showFormPage()` → `showSection(0)`
(`reports.html:2252`), so the handler must `await openReportById(id)` **then**
`showSection(3)` (the Action Items tab, `stab-3`), or it lands on tab 0 / races.

## Surfaces

- **New page** `public/site-actions.html` — mirrors `meetings-actions.html` /
  `inspection-actions.html` (same shell, filters, table, inline-status pattern).
  Site filter (default = the user's own site for non-admins). Three theme groups
  with per-group count + oldest item. Aging/overdue badges. Deep-linkable
  `?site=CODE`. In the **Insights** nav.
- **New API** `GET /api/reports/site-actions?site=CODE` — `requireReportSession`;
  returns the grouped unified payload. Composes the three existing readers +
  the pure normalizer.
- **New pure service** `services/siteActionsRegister.js` — `buildSiteActions({
  meetings, inspection, report, asOf })` → grouped/normalized/aged payload.
  Pure (no DB), unit-testable with fixture rows. The route does the fetching and
  hands raw rows in.

## RBAC

- Page requires a report session (like the other registers).
- **Inline close** is authoritative server-side per module (unchanged). The
  client disables controls the user can't use and reverts on a 403 — same
  contract already shipped on `meetings-issues.html` / the two action registers.
- **Report deep-link** just navigates; the report editor enforces its own editor
  gate + site-scoped list.

## Testing

- **Unit** (`tests/site-actions-register.test.js`): `buildSiteActions` with
  seeded rows from all three sources → asserts grouping by theme, non-closed
  filtering per vocabulary, `overdue` computation, `age_days` (null for report),
  `close.kind` per source, and `origin_label`.
- **Route smoke** (`tests/site-actions-routes.smoke.test.js`): boots the app,
  `GET /api/reports/site-actions?site=…` returns 200 + the grouped shape; unknown
  site → empty groups, not 500.
- **Browser**: page renders three groups on a real site, inline-close a meetings
  action persists across reload, report deep-link opens the right week on the
  Actions tab, empty groups for a no-meetings-code site, zero console errors.

## Known limitations (shipped, flagged — not bugs)

1. **Report follow-ups = latest report only.** An open follow-up on an older
   report that was never carried forward won't appear. Full cross-week coverage
   needs lineage (SP1b).
2. **No `age_days` for report rows** (`action_items` has no created timestamp) —
   they show due/overdue only.
3. **No dedup of hidden duplicates** (a report follow-up retyped from a
   meetings/inspection action still appears in both groups) — that is exactly
   what SP1b's merge solves.
4. **Exploration / Tanda** have no meetings/inspection code → those groups are
   empty for them.

## Follow-ons (not this sub-project)

- **SP1b** — stable `uid` on `action_items` + `saveActionItems` upsert +
  `source`/`origin_id`/`carried_from` → cross-week lineage dedup **and** manual
  merge of hidden duplicates into their Meetings/Inspection origin.
- **SP2** — coordinator email: actions-by-theme summary (counts + oldest) + a
  link to this hub.
- **SP3** — import Meetings/Inspection actions into the report's Actions &
  Follow-ups section as references (checkbox picker) — builds on SP1b's columns.
- **Separate** — weekly volume + SLA trend chart on the site report's Helpdesk
  block (demande 1).
