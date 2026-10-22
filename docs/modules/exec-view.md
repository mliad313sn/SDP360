# Module — SharePoint Executive View

Moved verbatim from `CLAUDE.md` on 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5). `CLAUDE.md` is now an index; edit THIS file.

---

## SharePoint Executive View (v1 — 2026-07-01)

Public, read-only, **exception-only** IT status snapshot meant to be embedded as
a SharePoint Quick Link, not a replacement for the full dashboard. One page,
aggregates only.

**Purpose**: give any Endeavour employee (no login) a one-glance "is IT healthy
this month" view — headline KPIs, sites needing attention, upcoming planned
maintenance, strategic (Activity Tracker) progress, and admin-authored
highlights/focus — without exposing ticket-level detail.

### Data flow

```
Browser: GET /exec-view.html (public route, no auth, no window.__ak)
  └─ fetch GET /api/exec/summary   (public — exempted from the /api/ auth gate,
                                     60 s server-side in-memory cache)
       └─ services/execSummary.js loadExecSummary(deps)
            ├─ mapHelpdeskKpis / mapSpark / mapSiteRows / mapActiveMi
            │    → reports-db.js readers: getMonthlyHelpdeskHistory,
            │      getRequestMetrics, getSurveyKpisDB, getSlaTrendDB,
            │      listSites, getActiveMajorIncidentsForSite, getUpcomingChanges
            ├─ mapStrategic → tracker-db.loadTracker() + FAITHFUL scorers
            │      re-exported from tracker-pptx.js (fleetStats/ps2/ss/score —
            │      same math as the tracker PPTX, no reimplementation)
            └─ deriveSiteStatus (pure) → buildExecSummary (pure, whitelisted)
                    → JSON response consumed by exec-view.html
```

`GET /api/exec/summary` is exempted at `server.js` (`app.use('/api/', ...)`,
the `req.path === '/exec/summary'` short-circuit BEFORE the dash-key/session
check). It is one of exactly **TWO** exemptions from the global gate — the other is
`GET /api/actions/open` (Meridian, F1), which carries its own `X-API-Key` check
(`meridian_in_key`). Everything else under `/api/exec/*` (the editorial reader/writer)
stays behind the normal gate + `requireReportSession` + **`requireSuperAdmin`** (admin
settings were restricted to super_admin on 2026-08-16, commit `5e2f40e`).

### Site status — derived, exception-only, no OPManager in v1

`deriveSiteStatus(rows)` in `services/execSummary.js` is a pure function:
`has_active_mi → 'major'`, else `overdue_open >= 1 → 'degraded'`, else omitted
entirely (`'operational'` sites are never listed — the page shows problems,
not a roster). Sorted major-first then by open-incident count, capped at 4.
**No real device/uptime monitoring (OPManager) is wired in v1** — status is
inferred purely from SDP incident data (active Major Incident + overdue open
backlog). Site name matching is accent/case-folded (`_normSite`) to survive
`Houndé` vs `HOUNDE` drift, same class of trap documented elsewhere in this
file for `request_records.site`.

### Editorial store — admin-authored highlights/focus

New table `exec_view_editorial` in `reports.db` (sqlite-only, `TODO(pg)` noted
inline for the eventual `REPORTS_BACKEND=postgres` fork):

```sql
CREATE TABLE exec_view_editorial (
  period          TEXT PRIMARY KEY,   -- 'YYYY-MM'
  highlights_json TEXT,               -- string[], max 4, blanks dropped
  focus_json      TEXT,               -- {title, subtitle}[], max 3
  updated_at      TIMESTAMP,
  updated_by      TEXT
);
```

`reports-db.js` exports `getExecEditorial(period)` (returns `{highlights:[],
focus:[]}` default) and `setExecEditorial(period, {highlights, focus}, user)`
(caps + drops blank entries so the rendered page footprint stays predictable
regardless of admin input). Edited via a new **"Exec View" card** on
`reports.html#admin` (admin+) — `GET`/`PUT /api/exec/editorial?period=YYYY-MM`,
both behind the normal auth gate. The summary endpoint reads the editorial row
for the **current** period only.

### PII boundary

`buildExecSummary()` in `services/execSummary.js` builds the response by
**whitelisting fields one at a time** (`pick(obj, [...])` helper) — it never
forwards a raw DB row. Excluded by construction: ticket subjects, requester /
technician names, verbatim survey comments, per-technician stats, raw change
records (only `date/title/window/impact/scope` survive from
`getUpcomingChanges`). If a future field is added to the endpoint, whitelist it
explicitly in the same style — don't widen `pick()` calls to "just pass the
object through."

### Files

| File | Purpose |
|---|---|
| `services/execSummary.js` | `deriveSiteStatus` (pure) + `buildExecSummary` (pure, whitelisted assembler) + `loadExecSummary(deps)` (live-data glue, DI'd deps for testability) + the per-KPI mappers |
| `public/exec-view.html` | The public page. No `window.__ak`, no session — fetches only `/api/exec/summary` |
| `public/reports.html` | Admin "Exec View" editorial card (highlights/focus editor) |
| `reports-db.js` | `exec_view_editorial` table + `getExecEditorial`/`setExecEditorial`; `getUpcomingChanges(days)` reader (PII-safe column whitelist) |
| `tracker-pptx.js` | Now also exports `fleetStats`/`ps2`/`ss`/`score` (Task 1 of this feature) — no logic change, just re-exported so execSummary can reuse the exact same scoring math instead of forking it |
| `tests/exec-summary.test.js`, `tests/exec-summary-load.test.js`, `tests/exec-editorial.test.js`, `tests/exec-routes.smoke.test.js` | Unit + integration coverage for the assembler, the live-glue mappers, the editorial store, and the HTTP routes |

### Deploy note

`server.js`, `reports.html`, and `exec-view.html` are server-code / `_htmlCache`
surfaces — after `_deploy.cmd`, use `pm2 stop` → `timeout /t 5` → `pm2 start`
(NOT `pm2 reload` — see the EADDRINUSE pitfall in Known Pitfalls). SharePoint
Quick Link target: `https://itops-dashboard.edv-ops.com/exec-view.html`.

### v2 / follow-ups (not in scope for v1)

- Additional tabs (Service Health / Sites / Projects / Reports / Knowledge) —
  v1 ships a single summary screen only.
- Real OPManager uptime feed instead of incident-derived site status.
- Native SharePoint integration (SPFx web part / Microsoft Graph / embedded
  Power BI) instead of an iframe-able external page + Quick Link.
- Single-screen density polish + emoji→brand SVG icon pass (the rest of the
  dashboard completed this migration; exec-view.html hasn't yet).
- Real SDP deep-link URLs — the page currently has `#TODO_SDP_*` placeholders
  where a "view in SDP" link would go.
- A pg fork of `getExecEditorial`/`setExecEditorial`/`getUpcomingChanges` (all
  currently sqlite-only) + an async fork of `loadExecSummary`'s mappers for
  when `reports.db` cuts over to `REPORTS_BACKEND=postgres`.
| Stylings dropped on .xlsx | SheetJS CE limitation, documented above. Users can "Format as Table" in Excel once to restyle. Or switch to SheetJS Pro (license cost) for full styling support. |
