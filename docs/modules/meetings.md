# Module — Meetings & Council Escalations

Moved verbatim from `CLAUDE.md` on 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5). `CLAUDE.md` is now an index; edit THIS file.

---

## Meetings & Council Escalations Module (v2)

Meeting-centric digital twin of the Endeavour Mining Group IT × Mines
operating system. **v2 replaces v1 entirely** — v1's flat-decision
schema is dropped on init (no production data lost; v1 was never
deployed). The unit of capture is a signed **PV** (Procès-Verbal) for
one site × one department × one month, with nested issues / actions /
projects. Escalations are auto-derived from issues flagged `escalate=1`.

Mirrors the Inspections / Activity Tracker pattern — own SQLite file
(`meetings.db`), `meetings-db.js`, `meetings-init.json`, dedicated HTML
pages, `/api/meetings/*` routes — fully additive (no migrations touch
the other DBs).

The model derives directly from three canonical templates:
- `Guide_Operationnel_Reunions_Departementales.docx` (May 2026)
- `Department_Meeting_Report_Template.docx` (the signed PV)
- `Site_IT_Tracker_Template.xlsx` (the quarterly site workbook)

### Architecture overview

```
Browser (meetings.html — list + KPI strip + quick-jump cards)
  ↓ GET /api/meetings/lookups          (11 lookups + sites in one call)
  ↓ GET /api/meetings/list?...         (paginated meetings + nested counts)
  ↓ GET /api/meetings/aggregate?...    (KPI roll-up across meetings + issues)

Browser (meeting.html — 7-section PV editor + audit thread)
  ↓ GET  /api/meetings/:id             (full record incl. updates + attachments)
  ↓ POST /api/meetings/save            (upsert: header + nested children)
  ↓ POST /api/meetings/issues/:id/update  (audit comment + status / escalate flip)
  ↓ DELETE /api/meetings/:id           (executive+)

Browser (meetings-issues.html — flat Issues Log)
  ↓ GET /api/meetings/issues?...       (severity / category / status filters)
  ↓ GET /api/meetings/aggregate?...    (by_category bar chart data)

Browser (meetings-council.html — Council escalations grouped by theme)
  ↓ GET /api/meetings/escalations?...  (alias for /issues?escalate=1)

Browser (meetings-compliance.html — 5 Engagements monitor)
  ↓ GET /api/meetings/compliance?month=YYYY-MM   (per-site leaderboard)

Server (server.js)
  ↓ meetings-db.js → meetings.db (SQLite, 11 lookups + 6 core tables, prefix md_*)
```

### Key files

| File | Purpose |
|------|---------|
| `meetings-init.json` | Seed: 4 intake sources · 15 departments · **9 canonical categories** (CN/HW/IN/OT/AP/SC/DR/SD/LV) · 3 severities · 6 statuses · 4 meeting statuses · **6 escalation reasons** · 6 council themes · 5 project phases · 5 IT involvement levels · the **5 Engagements** |
| `meetings-db.js` | Schema + CRUD + audit-trail + cross-site write guard + per-engagement compliance monitor + `compareDepartment()` for pre-brief diffs |
| `meetings-import.js` | Excel parser → dry-run → commit. Builds a 3-tab template (Meetings / Issues / Actions) + a 4th "Codes" tab listing every valid lookup code. |
| `public/meetings.html` | List/dashboard — hero (+ Bulk import button), 6 KPI tiles, 4 quick-jump cards, filters, sortable meetings table |
| `public/meeting.html` | 7-section PV editor — header / 3 priorities / projects / issues / actions / auto-escalations / sign-off + audit thread + quick-comment box + "Since last meeting" deep-link in the sticky bar |
| `public/meetings-issues.html` | Flat Issues Log — every issue across all PVs with the full filter set + by-category bar |
| `public/meetings-council.html` | Mine IT Council view — escalations grouped by Council theme with indicative ask |
| `public/meetings-compliance.html` | 5 Engagements monitor — per-site leaderboard for the selected month |
| `public/meetings-import.html` | Bulk historical import — admin+ — drag/drop xlsx, dry-run preview, commit (idempotent by `reference`) |
| `public/meetings-progress.html` | "Since last meeting" pre-brief — pick site + department, see standing/resolved/new issues + actions + audit trail since the previous PV in scope |

### SQLite schema (`meetings.db`)

11 bilingual lookup tables (`md_intake_sources`, `md_departments`,
`md_categories`, `md_severities`, `md_statuses`, `md_meeting_statuses`,
`md_escalation_reasons`, `md_council_themes`, `md_project_phases`,
`md_it_involvement`, `md_engagements`) — every row carries `name_en` +
`name_fr` so the UI flips language without a re-query. All extendable
via `POST /api/meetings/lookups/:table` (super_admin).

6 core tables:

```sql
md_meetings              -- one PV header: site × department × meeting_date
                         -- reference = SITE_Department_PV_YYYY-MM
                         -- status: draft / submitted / signed / closed
                         -- 3 priorities inline, sign-off timestamps,
                         -- next-meeting fields
md_meeting_projects      -- department projects in flight (phase, IT involvement,
                         -- status on_track/at_risk/blocked/done, leads, dates)
md_issues                -- issues raised; category (1 of 9), severity HIGH/MEDIUM/LOW,
                         -- champion (Engagement #3), target_date, status,
                         -- escalate flag + reason + council_theme
md_issue_updates         -- audit-trail: status_change, escalate_change, body
md_actions               -- IT commitments; owner_it (Champion), linked_issue_id
md_meeting_attachments   -- inline base64 (rarely used; PV PDFs typically live in SharePoint)
```

Reference format mirrors the SharePoint naming convention:
`HGO_Maintenance_PV_2026-05`. Auto-allocated on first save from
`site_code + department + meeting_date`. If the meeting date is moved
to a different month, the reference is regenerated.

### API surface — `/api/meetings/*`

All require `requireReportSession` (session cookie + `x-report-token` header).

| Method · Path | Min role | Purpose |
|---|---|---|
| `GET /lookups` | any | All 11 lookups + sites in one call |
| `GET /people?site=CODE` | any | Reuses `inspectionDb.listPeople()` for owner autocomplete |
| `GET /list?...` | viewer+ | Paginated meetings; filters: `site`, `department`, `status`, `intake`, `from`, `to`, `q` |
| `GET /aggregate?...` | viewer+ | Meeting + issue KPI roll-up + `by_category` + `by_council_theme` |
| `GET /insights?from=&to=&site=&department=` | viewer+ | Chart-shaped roll-up for `meetings-insights.html` — 7 datasets in one call (monthly time-series, by_month_site stacked-bar source, by_category top 12, by_severity, by_council_theme, compliance_heatmap per site, site_leaderboard with composite score). Default window = last 6 months. |
| `GET /compliance?month=YYYY-MM` | viewer+ | Per-site 5-Engagements leaderboard (single-month, drives the standalone `meetings-compliance.html`) |
| `GET /issues?...` | viewer+ | Flat Issues Log; filters: `site`, `department`, `category`, `severity`, `status`, `escalate`, `council_theme`, `from`, `to`, `q` |
| `GET /escalations?...` | viewer+ | Alias for `/issues?escalate=1` |
| `GET /:id` | viewer+ | Full record: header + projects + issues + actions + updates + attachments |
| `POST /save` | editor (own site) / admin+ (any site) | Upsert; children arrays optional — omit to preserve existing rows |
| `POST /issues/:id/update` | editor (own site) / admin+ | Append audit row; can flip status + escalate |
| `DELETE /:id` | executive+ | Cascading delete |
| `POST /lookups/:table` | super_admin | Append a row to any of the 11 lookups |
| `POST /reset` | super_admin | Wipe + re-seed all lookups (does NOT touch meeting rows) |
| `GET /import/template` | admin+ | Download a blank 3-tab xlsx template (Meetings / Issues / Actions + Codes cheat-sheet) |
| `POST /import/preview` | admin+ | Raw xlsx bytes in body → returns parsed summary + per-row validation errors. **Does not** touch the DB. |
| `POST /import/commit?force=0\|1` | admin+ | Same body shape. Persists. Existing references are UPDATED in place. `force=1` skips bad rows; default refuses if any errors. |
| `GET /progress?site=X&department=Y&[asOf=YYYY-MM-DD\|current_id=N]` | viewer+ | Pre-brief diff — standing issues, resolved-since, new-since, audit trail, meeting history for that site × dept |

The `/save` and aggregate routes use a 30 MB JSON body parser
(`meetingsJsonBody`) — keep it ahead of the global 2 MB parser if the
route handler is ever touched. The `/import/{preview,commit}` routes
take **raw bytes** via `meetingsImportBody` (`express.raw({type:'*/*',
limit:'30mb'})`) — the client POSTs the .xlsx ArrayBuffer directly
with `Content-Type: application/octet-stream`.

### Defensive children contract

`saveMeeting(state, userSiteCode, userId)` only mutates a child
collection when the caller **explicitly** sends the array:

```js
if (state.projects !== undefined) { /* wipe + reinsert */ }
if (state.issues   !== undefined) { /* preserve ids + reinsert */ }
if (state.actions  !== undefined) { /* wipe + reinsert */ }
```

A "header-only" PATCH (e.g. flipping status to `signed` from
`meetings.html`) preserves issues + actions + projects intact, along
with their audit history. This was a v2 smoke-test fix — earlier the
save was wiping children on every call.

### Cross-site write guard (v2)

For editors (userSiteCode set), saveMeeting blocks if **either**:
- the existing meeting belongs to a different site, **or**
- the incoming `header.site_code` is for a different site.

```js
if (existingSite && existingSite !== userSiteCode) throw 'Cross-site …';
if (incomingSite !== userSiteCode)                  throw 'Cross-site …';
```

Both checks are necessary — checking only the incoming site lets an
editor stamp their own site_code onto a meeting that already belongs to
someone else's site. Smoke-test caught this in the v2 build.

### Audit trail

Every issue save that changes `status` or `escalate` automatically
appends a row to `md_issue_updates` with the old → new transition. The
single-meeting editor's right column renders the thread newest-first
with author, timestamp, status-change chip, and body. The quick-comment
box at the bottom posts an update without re-saving the entire PV.

### The 5 Engagements monitor

`meetings-compliance.html` reads `/api/meetings/compliance?month=...`
and reports per-site:

| Engagement | Rule | How measured |
|---|---|---|
| #1 Three departments / month | At least 3 PVs per site per calendar month | Count of meetings per site_code that month |
| #2 Diffusion within 48 h | Signed PV shared within 48 h | `julianday(submitted_at) - julianday(meeting_date) <= 2` |
| #3 Champion / action | Every action has a named owner | `actions_without_champion` count |
| #4 Monthly feedback loop | Write back to depts seen in last 3 months | Currently tracked off-system (placeholder card) |
| #5 Escalation discipline | Every escalate=1 has reason + theme | `missing_reason` / `missing_theme` counts |

Engagement #4 currently shows `—` because the "feedback loop" needs an
outbound communication log we haven't built yet — flagged as future
work.

### Bilingual labels

Every lookup table has `name_en` + `name_fr`. The UI currently labels
form fields with both ("Site · Site", "Department head · Chef de
département"). The seeded category descriptions also carry both
languages for the future language toggle.

### RBAC summary

| Role | View | Create meeting | Edit own-site | Edit any-site | Re-open closed | Manage lookups |
|---|---|---|---|---|---|---|
| viewer | ✓ | — | — | — | — | — |
| editor | ✓ | ✓ (own) | ✓ | — | — | — |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| executive | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| super_admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`closed` meetings lock against editor edits; admin+ can flip the status
back to a non-terminal value via the status dropdown.

### Bulk historical import

The team came into v2 with months of past PVs already in Excel / Word /
SharePoint. `meetings-import.js` lets an admin upload them in one shot
via `/meetings-import.html`.

**Workbook format** (3 tabs + a cheat-sheet):

```
Meetings tab:   reference | site_code | department | meeting_date |
                duration_min | intake_source | status |
                department_head | department_head_title | site_it_lead | other_attendees |
                priority_1 | priority_2 | priority_3 |
                next_meeting_date | next_meeting_location

Issues tab:     meeting_reference | ord | title | description |
                category | severity | status |
                champion | champion_email | affects | target_date |
                escalate | escalation_reason | council_theme | notes

Actions tab:    meeting_reference | ord | description |
                owner_it | owner_email | target_date | status | linked_issue_ord

Codes tab:      auto-generated cheat-sheet — lists every valid site /
                department / category / severity / status / escalation
                reason / council theme code from the live lookups
```

**Foreign keys**:
- `reference` on the Meetings tab. If left blank, the server
  auto-generates `SITE_Department_PV_YYYY-MM` from site_code +
  department + meeting_date.
- `meeting_reference` on Issues + Actions joins back to the Meetings tab.
- `linked_issue_ord` on Actions joins to the 1-based ord of the issue
  in the SAME meeting.

**Two-step flow**:
1. **Preview** — `POST /api/meetings/import/preview` parses + validates
   + returns `{ summary, errors, warnings, meetings: [...] }` without
   touching the DB. UI renders a table of meetings + errors so the user
   can fix and re-upload.
2. **Commit** — `POST /api/meetings/import/commit` parses again and
   calls `saveMeeting()` per meeting in admin scope. Default behaviour:
   if `errors.length > 0`, the whole upload is refused. With
   `?force=1`, bad rows are skipped and the rest commits.

**Idempotency**: existing `reference` matches are UPDATED in place — so
re-uploading the same workbook doesn't create duplicates. The
defensive-children contract on `saveMeeting` still applies: an import
with empty Issues/Actions tabs would **wipe** that meeting's existing
issues. Don't rely on partial imports — re-upload the FULL state per
meeting.

**Date coercion**: Excel serial numbers (cellDates: false), ISO
`YYYY-MM-DD`, and `DD/MM/YYYY` are all accepted. Anything else returns
a validation error.

**`xlsx` dependency**: requires the `xlsx` (SheetJS) npm package on the
server. If it's missing, all `/import/*` routes return 503 but the
rest of the meetings module keeps working — degraded mode is acceptable.

### "Department Meetings" slide — on ALL report decks (added 2026-06-21)

Every report PPTX now emits a **"Department Meetings · <Month>"** slide so the
presenter can justify why department work is / isn't advancing.

- **Data**: `meetings-db.getSiteMonthlyMeetingSummary(siteCode, year, month)`
  — a calendar-month snapshot for one site: cadence KPIs (PVs held vs 3-dept
  target, open/HIGH issues, resolved/new this month, escalations), a
  per-department breakdown with a RAG status (`on_track` / `blocked` /
  `no_pv`), a 3-month opened/closed trend, and an auto-generated
  "why progress stalled" commentary string. Tested in
  `tests/meetings-summary.test.js`. meetings-db now also exports `getDB` +
  `siteNameToCode`.
- **Slide**: `slideDepartmentMeetings(pptx, summary)` + `hasDeptMeetingData()`
  live in **`reports-pptx-shared.js`** — self-contained (inline colours, own
  title/badge) so BOTH `reports-weekly-pptx.js` AND `reports-monthly-pptx.js`
  import it (no duplication despite their forked addTitle/C). Tested in
  `tests/pptx-meetings-slide.test.js` + `tests/pptx-meetings-all-decks.test.js`.
- **All 5 decks wired** (slide appended after that deck's last per-site slide):
  `generateWeeklyPptx` (5th arg `meetingsSummary`), `generateMonthlyPptx`,
  `generateWeeklySummaryPptx` (per site, `report.meetingsSummary`),
  `generateMonthlyPptxV2`, `generateAllSitesMonthlyPptx`
  (`monthlyData.meetingsSummary` / per-site `meetingsSummary`).
- **Wiring**: server.js helper `_meetingsSummaryForSite(siteName, year, month)`
  maps `site_name → site_code` via `meetingsDb.siteNameToCode`, derives the
  month (report period for weekly, `getWeekRange` for the weekly summary, route
  params for monthly), and attaches the summary in each of the 5 PPTX routes.
- **Conditional + backward-compatible**: emitted ONLY when the site has meeting
  data (`hasDeptMeetingData`: `available` + departments/PVs). Callers that don't
  supply a summary (the golden test fixtures) render exactly as before — that's
  why `tests/pptx-monthly-golden.test.js` still matches. Snapshot shows the
  CURRENT month (fills in as PVs land).

### Insights dashboard (`meetings-insights.html` — added 2026-06-02)

Chart-driven analytical view of the whole meetings module — for the IT
manager who wants a six-month snapshot of how the operating cadence is
performing without scrolling through individual PVs. Companions
`meetings.html` (list) and `meetings-compliance.html` (single-month
Engagements monitor) rather than replacing them.

**Layout** (top → bottom):
1. **Hero** + EN/FR toggle + period badge (`Jan 26 → Jun 26` etc.)
2. **Filter bar** — site / department / period (3 / 6 / 12 months)
3. **KPI strip — 6 tiles**: PVs total · Open issues · HIGH open ·
   Escalations open · Overdue · Departments covered
4. **Row 1**: Meetings per month × site (stacked bar) + Issues flow
   (multi-line opened vs closed)
5. **Row 2**: Issues by category (h-bar with HIGH overlay) + Severity
   donut
6. **Row 3**: Council escalations by theme (h-bar) + 5 Engagements
   compliance heatmap (CSS-grid, RAG-colored)
7. **Row 4**: Site leaderboard (sortable, composite score)

**Data plane**: single `/api/meetings/insights` round-trip returns all
7 datasets (see API table above). All filters apply uniformly across
the page — change site, everything re-renders.

**Score formula (composite leaderboard)** — Option A per user choice
2026-06-02: simple unweighted mean of the non-null engagement scores.
E1 (3 PVs/month) + E2 (48h diffusion) + E3 (champion on actions) + E5
(escalation discipline). E4 is excluded — it's a placeholder until the
outbound-comms log feature lands. RAG thresholds: ≥80% green, 60-79%
amber, <60% red. Same thresholds apply per-engagement column.

**Chart.js + heatmap**: Chart.js 4.4 from CDN (already in CSP
allowlist). Heatmap is pure CSS grid (12-col × N-rows) rather than a
chart library — cleaner for tabular RAG data with cell-level labels.

**Backfilled monthly time-series**: `_backfillMonths()` in
meetings-db.js ensures inactive months render as zero rows in the
charts rather than being silently skipped (which would compress the
x-axis and lie about the cadence).

**Period default**: trailing 6 months including current — matches the
ITSM standard visibility window doctrine in this file.

**Stable site colors**: `siteColor(code)` hashes the site code to a
deterministic palette slot, so MGO is always the same blue across
reloads + across the stacked bar and the leaderboard.

### "Since last meeting" pre-brief

Built on `meetings-db.compareDepartment(opts)` (called from
`GET /api/meetings/progress`). For a given site × department, returns:

```js
{
  site, department,
  current, previous,      // meeting headers or null
  as_of,
  standing,       // open issues in scope (HIGH-first, then earliest target)
  resolved,       // closed_at > previous.meeting_date
  new_items,      // issues attached to meetings dated AFTER previous
  actions_standing, actions_resolved, actions_new,
  escalations,    // escalate=1 AND not resolved
  updates_since,  // last 25 audit rows since previous.meeting_date
  meeting_history,// last 6 PVs in scope (UI breadcrumb strip)
  summary: { standing_total, standing_high, resolved_total, new_total,
             escalated_open, actions_standing, actions_resolved, actions_new },
}
```

The "previous meeting" is auto-derived in two ways depending on input:
- `?current_id=N` — previous = most recent PV in scope with
  `meeting_date < current.meeting_date`.
- `?asOf=YYYY-MM-DD` — previous = most recent PV before asOf.
- Neither → most recent PV overall in scope.

This is the IT coordinator's pre-brief view: they pick site + dept,
walk into the next meeting knowing exactly what carried over, what
closed (the wins to report back), what new issues bubbled up, and the
full audit trail since the last conversation. Also satisfies the spirit
of Engagement #4 (monthly feedback loop) — though the formal
"outbound communication log" check still shows `—`.

A deep-link from `meeting.html`'s sticky bar passes
`?site=X&department=Y&current_id=N` so the page lands directly on the
right diff with zero clicks.

### Known pitfalls

| Pitfall | Rule |
|---------|------|
| `meetings.db` missing on server | First request to `/api/meetings/lookups` auto-creates + seeds. Safe to delete to force re-seed. |
| v1 schema still on disk | Init drops v1 tables (`md_decisions` + v1 lookup shapes) before creating v2 schema. Idempotent. |
| Cross-site write 403 | Editor-role users scoped to their `site_id` via `inspectionDb.siteNameToCode()` (reused). `_userMeetingsSite()` returns null for admin+. Both incoming AND existing site must match. |
| Reference jumped a month | Reference is regenerated when `meeting_date` moves to a new month. The old reference is dropped — there's no rename trail. |
| Static-served HTML out-of-date | `meetings.html`, `meeting.html`, `meetings-issues.html`, `meetings-council.html`, `meetings-compliance.html`, `meetings-import.html`, `meetings-progress.html` are all in `_htmlCache` at boot. Edits require `pm2 reload`. |
| Editor can't re-open a closed meeting | Intended — once `closed`, only admin+ can flip status back. Editor would get a 403 with `Meeting is closed — only admin can re-open`. |
| Header-only save wiped children (v2 smoke test) | Fixed by `if (state.X !== undefined)` guard. Don't regress — header-only PATCH must preserve issues + actions + projects. |
| Bulk import wipes children too | The import always sends `issues:[…]` and `actions:[…]` arrays, so saveMeeting WILL wipe + reinsert. Don't run an import expecting it to "merge" with hand-edits — re-upload the FULL state per meeting. |
| Engagement #4 shows `—` | Intentional placeholder — the monthly feedback loop needs an outbound communication log we haven't built. The pre-brief page partially addresses this with its "Audit trail since last meeting" panel. |
| `_unset` Council theme bucket | `meetings-council.html` adds a synthetic `_unset` theme group for issues missing a theme. The API doesn't accept `_unset` as a `council_theme` filter — handled client-side. |
| Owner / Champion field free-text | Datalist autocomplete from `/api/meetings/people` (reuses inspection roster), but the saved value is the plain string — same pattern as inspections. |
| Audit row author "system" | If `req.reportUser.full_name` is missing, falls back to `username`; if both absent, UI shows "system". |
| `/import/*` returns 503 on prod | The `xlsx` npm package isn't loaded. **DO NOT just run `npm install xlsx`** — that fails on Node 24 because better-sqlite3 9.4.3's post-install tries to rebuild against C++17 instead of the required C++20 → `error C1189: #error: "C++20 or later required"`. **Workaround**: xcopy `node_modules/xlsx/` from a dev box that's already got it (xlsx is pure JS, no native bindings, ~7 MB). Then `pm2 reload`. Tested against `xlsx@^0.18`. Long-term fix: upgrade `better-sqlite3` to `^11` (has Node 24 prebuilts), then native `npm install` will work. |
| Label rename on already-seeded lookup row | The `_initSchema` seed gate (`if (n === 0)`) means editing `meetings-init.json` doesn't fix existing rows. Pattern: add an idempotent `UPDATE` block AFTER the seed gate that targets rows still carrying the old value (`WHERE name_en = '<old>'`). Logs once on the affected reload, no-op thereafter. See the `survey` → "IT Survey" rename in `meetings-db.js:_initSchema()` for the canonical example. |
| Excel dates parsed wrong | Set Excel cells to a real date type before saving, OR use ISO `YYYY-MM-DD` strings. `DD/MM/YYYY` is accepted but the dash format (`15-04-2026`) is also parsed as DD-MM-YYYY. |
| "No prior meeting" in pre-brief | Means this is the first PV for the site × dept. Every standing issue counts as "new since" (no reference point yet). Normal behavior, expected on first month. |

---
