# Asset engagement in the weekly report + asset reminder e-mails — design

Date: 2026-09-17 · Status: approved in conversation, revised after spec review (rev 3)

## 1. Goal

Make site asset follow-up a **required part of the coordinator's weekly report** and
**remind the people who fix the register** about four worklists:

1. **New** hardware detected in a given window;
2. **Unassigned** hardware — state `In Use` with neither `user_name` nor `department`
   (trimmed), **all product types** (user decision);
3. hardware **without purchase cost** (`purchase_cost` NULL or trimmed value in
   `('', '0', '0.00')`);
4. hardware **without acquisition date** (`acquisition_date` NULL or trimmed `''`).

Lists 3 and 4 cover only states `In Use`, `In Store`, `In Repair`.

## 2. User decisions (2026-09-17)

| Topic | Decision |
|---|---|
| Constraint | A **mandatory "Parc informatique" tab** in the weekly report; the server refuses `submitted` while its two notes are empty |
| Recipients | New **asset manager** contact per site (name, e-mail, confirmed flag); reminder → confirmed asset manager, confirmed coordinator in copy; no confirmed asset manager → confirmed coordinator alone |
| Cadence | **Weekly recap per site, Monday 07:00**, plus a **same-day "new hardware" alert** after the nightly sync (max one per site per day) |
| New-hardware detection | New first-sightings table, baseline on first successful run |
| "Unassigned" scope | All hardware in `In Use` without user and department |

## 3. Existing facts (verified)

- Assets tables are fully replaced nightly (`assets-db.js` DELETE+INSERT). The chain is
  `syncAllAssets().then(() => snapshotEffort({})).catch(...)` in the 04:30 cron
  (`server.js:489-491`) and the manual trigger (`server.js:~2347-2351`). `syncAllAssets`
  never rejects: per-view errors are in its returned summary (`assets-sync.js:84-95`).
  `snapshotEffort` dates are **UTC** (`new Date().toISOString().slice(0,10)`,
  `assets-db.js:1076`). Nothing records which asset ids are new.
- Assets tables and reports tables are separate data layers (`assets-db.js` /
  `reports-db.js`); no cross-layer SQL join is used below.
- Weekly reports are rows of `weekly_reports`; monthly reports live in `monthly_reports`
  (`reports-db.js:684`) with their own routes. `PUT /api/reports/:id/status`
  (`server.js:6782`) handles weekly reports only and validates only the value.
- `getReport` (sqlite) and `_getReportPg` (`reports-db.js:~3858`) assemble the children;
  `deleteReport` deletes each child table explicitly in both forks (`:3782-3790`).
- pg reports migrations are a **hard-coded list** in `initPgReports` (`:1336-1376`).
- Editor: weekly tabs `stab-0..3` with class `section-tab` (`reports.html:495-498`);
  monthly tabs `mr-stab-*` also use `section-tab` (`:899-903`). `_afterSectionSaved`
  (`:4579-4592`) counts `.stab.done` — which matches nothing, so auto-`ready` never fires.
  Tabs get `done` on load from existing data (`:4523-4558`). `submitReport` (`:4704`)
  shows `'Submit failed: ' + e` (`:4713`).
- Weekly e-mail: `weeklyReportData.js` sends only `submitted` reports; its authored part is
  frozen, but its hygiene counts are loaded live (`:137-147`); `assetsSection`
  (`reportTemplates/weekly.js:277-320`).
- Site mapping: a report has `site_id`; the meetings site code comes from
  `(await rdb.listSiteModuleCodes('meetings'))` matched on `site_id` (`reports-db.js:1987`);
  asset labels come from `assetHygieneForSite.labelsForCode(code, …)`.
- Directory: table **`report_recipients`** — sqlite schema in
  `services/reportDirectory.js:20` (`_initSchema`), pg in
  `db/postgres/reports/005_reporting.sql:2`; `upsertRecipient` writes only the columns in
  `COLS` (`reportDirectory.js:7,40`); `resolveFromRows` handles `fm` / coordinator
  (`:65`). Per-site senders must use `listRecipients` + `resolveFromRows`.
- Scheduling: tasks run `node <cli> --type=<t> --cadence=<c>` (`reportSchedule.js:81`);
  `TYPES` (`:16`), `cliFor` (`:24`); WEEKLY with a day and time is supported.
- `report_sent_log` exposes `record` and `alreadySentToday` (same UTC day,
  `reportSentLog.js:40-49`).
- New `report_config` keys must be in `reportConfig.DEFAULTS`; `getConfig` is a Promise on pg.
- Admin panels need five surfaces: `_ADMIN_PANEL_IDS` (`reports.html:~5641`), the rail group
  `PANEL_GROUPS.sends.members` (`:~5652`), the hash allowlist (`:~5758`), the rail role gate,
  the JS super-gate. Per-type send pipelines keep their schedule row on their own card
  (hygiene `:~7476`, weekly `:~7774`, asset group `:~7642`); `_AR_TYPES` is only for the
  generic coordinator/finance/group card.
- **Report weeks are Zoho weeks** (Sunday start, numbered from the year's first Sunday —
  `getISOWeek`/`getWeekRange` use `_zFirstSun`, `reports-db.js:1195-1218`), not ISO weeks.
  `listReports(site_id)` is sorted newest first and returns `start_date` (`:2634-2646`).
  `_authorizeReportWrite` returns the report with `site_id`, `start_date`, `end_date`.
  `api()` in `reports.html` already rejects with the server `error` text (`:2344-2345`).
- The status route allows `submitted → submitted` (`server.js:6793-6796` only blocks leaving it).

## 4. Design

### 4.1 Data layer (`assets-db.js`, both backends)

**Table `asset_first_seen`** (added to the shared `db/postgres/assets/001_init.sql` CREATE):

```sql
CREATE TABLE IF NOT EXISTS asset_first_seen (
  asset_id        TEXT PRIMARY KEY,
  site            TEXT NOT NULL DEFAULT '',   -- site at first sighting (information only)
  first_seen_date TEXT NOT NULL,              -- YYYY-MM-DD, UTC
  baseline        INTEGER NOT NULL DEFAULT 0  -- 1 = present at the baseline run
);
```

**`recordAssetSightings({ asOf })`** (`asOf` default = UTC today):
- if `assets` has 0 rows → do nothing;
- if `asset_first_seen` is empty → insert every current asset with `baseline = 1`;
- otherwise → insert asset ids not yet present with `baseline = 0`; existing rows are
  never updated; idempotent per day.

Wiring (nightly cron and manual trigger):

```js
syncAllAssets()
  .then(summary => { /* existing */ return snapshotEffort({}).catch(logEffort).then(() => summary); })
  .then(summary => assetsViewFailed(summary) ? null
        : recordAssetSightings({}).then(() => maybeSendNewAssetAlerts()).catch(logSightings))
```

`assetsViewFailed(summary)` = the summary entry for the `assets` view carries an error.
`maybeSendNewAssetAlerts` is the in-process alert of §4.4 (cron only; the manual trigger
records sightings but sends nothing).

**Predicates** — new constants next to `HYGIENE_KINDS` (the existing `no_owner` is not
reused: it does not trim and has no state filter): `FOLLOWUP_UNASSIGNED`,
`FOLLOWUP_NO_COST`, `FOLLOWUP_NO_DATE`, `FOLLOWUP_ACTIVE_STATES`. No SQL CAST on text.

**`getSiteAssetFollowups(labels, { newFrom, newTo })`** — `labels` = the site's asset
labels. Returns `{ counts: {new, unassigned, no_cost, no_date}, new: [], unassigned: [],
no_cost: [], no_date: [], generated_at }`.
- `new` = `asset_first_seen` rows with `baseline = 0` and
  `first_seen_date BETWEEN newFrom AND newTo`, joined to `assets` (asset still present);
  the site filter uses the **current** `assets.site`.
- Row columns: `asset_id, asset_name, product_type, manufacturer, serial_number, state,
  site, user_name, department, acquisition_date, has_cost` (boolean) and `first_seen_date`
  for `new`. **No amount is returned.**
- Empty `labels` → all counts 0 and empty lists.

### 4.2 Mandatory "Parc informatique" tab (weekly reports)

**Storage** — reports DB: sqlite in `_initSchema`; pg in a new
`db/postgres/reports/012_report_asset_review.sql` added to the `initPgReports` list:

```sql
CREATE TABLE IF NOT EXISTS report_asset_review (
  report_id     INTEGER PRIMARY KEY,
  applicable    INTEGER NOT NULL DEFAULT 1,
  counts_json   TEXT,     -- frozen {new, unassigned, no_cost, no_date}
  handled_note  TEXT,     -- "Traité cette semaine"
  plan_note     TEXT,     -- "Plan / blocages"
  updated_by    TEXT,
  updated_at    TEXT
);
```

Readers (both backends): `getReportAssetReview(id)`, `saveReportAssetReview(id, patch, user)`
(upsert). `getReport` and `_getReportPg` include it as `asset_review` (or `null`).
`deleteReport` deletes it in both forks.

**Site resolution helper** `_assetLabelsForReport(report)` (server side): meetings code
from `listSiteModuleCodes('meetings')` by `site_id` → `labelsForCode`. No code or no
labels → `applicable: false` (e.g. Exploration, Tanda).

**Window** — the report's (Zoho) week: `newFrom = report.start_date`,
`newTo = report.end_date` (the week being reported; already over when the coordinator writes).

**Routes** (registered above `/api/reports/:id`):
- `GET /api/reports/:id/asset-followups` — read rule: admin+ (admin, executive,
  super_admin) unscoped; otherwise the user must have `site_id === report.site_id`; no
  site → 403. Returns `{ applicable, counts, lists (first 50 rows each), previous_counts }`
  where `previous_counts` = `counts_json` of the first row of `listReports(report.site_id)`
  (newest first) whose `start_date < report.start_date`, or `null`.
- `PUT /api/reports/:id/asset-review` — `_authorizeReportWrite`; body
  `{ handled_note, plan_note }` trimmed; the server recomputes `applicable` and
  `counts_json` and freezes them (client counts ignored).

**Submission rule** — in `PUT /api/reports/:id/status` when the target is `submitted`
**and the current status is not already `submitted`** (a re-submit never re-freezes):
recompute and freeze `applicable`/`counts_json`; if `applicable` and either note is empty
→ `400 { error: 'Parc informatique : remplissez « Traité cette semaine » et « Plan / blocages » avant de soumettre.' }`.
If the assets layer throws, the counts are stored as `null`, `applicable` is taken as
false for this check, and submission proceeds (an outage must not block coordinators).
`ready` is never gated. Reports already `submitted` are not re-checked. Reports still in
draft / in progress / ready at deploy time must get the two notes before submission.

**Editor (`reports.html`)**
- weekly tab `stab-4` "5 · Parc informatique": 4 counters with the change vs
  `previous_counts`, per-counter link to `assets.html` filtered on the site, the lists
  (collapsible), two required textareas, autosave like other sections;
- non-applicable site → "Aucun matériel rattaché à ce site", tab counts as done;
- `done` on load when both notes are filled or the site is not applicable;
- `_afterSectionSaved` counts `#section-tabs .section-tab.done` inside the weekly editor
  container only (monthly editor unchanged); auto-`ready` needs 5 done tabs. This makes the
  existing auto-`ready` actually work — expect more "complete but not submitted" reports
  in the weekly e-mail flow;
- `submitReport` needs no change: `api()` already surfaces the server `error`, shown as
  "Submit failed: Parc informatique : …".

**Weekly e-mail** — `weeklyReportData` includes `asset_review`; `assetsSection` shows the
frozen four counts and the two notes under the existing live hygiene counts. Absent
`asset_review` → unchanged output. Monthly goldens stay byte-identical.

### 4.3 Asset manager contact

`report_recipients` gains `asset_manager_name`, `asset_manager_email`,
`asset_manager_email_confirmed` (INTEGER 0/1):
- sqlite: ALTERs in try/catch in `reportDirectory._initSchema`;
- pg: `ADD COLUMN IF NOT EXISTS` in `initPgReports` (not in the 005 CREATE);
- the three names are added to `COLS` (otherwise `upsertRecipient` drops them);
- `resolveFromRows(rows, site, 'asset_manager', opts)` returns the asset manager only when
  confirmed (same rules as the coordinator), else `null`;
- the admin directory card gets the three fields.

### 4.4 Reminder e-mails

**Composer** `services/assetReminderReport.js` (pure, French, no amounts):
- `buildAssetRecap({ site, followups, baseUrl, weekLabel })` → `{ subject, html,
  attachments }`: 4 counts, first 20 rows of each non-empty list, links to
  `assets.html?site=…` when `public_base_url` is set, and
  `assets-suivi-<SITE>-<YYYY-Www>.xlsx` (one sheet per list, full rows);
- `buildNewAssetAlert({ site, rows, baseUrl, date })` → short list of new hardware.

**CLI** `tools/reports/send-asset-reminders.js` (`require.main` guard, exported core):
- `--type=asset_reminder` → weekly recap (the scheduled form);
  `--type=asset_new_alert` → alert; `--preview`, `--site=CODE`.
- Gates: `asset_reminder_send_enabled`, `asset_new_alert_enabled` (default `'0'`, in
  `DEFAULTS`); preview ignores gates.
- Config via `await reportConfig.getConfig(db)`, recipients via `await listRecipients(db)`
  + `resolveFromRows`; `never_send_unconfirmed` honoured.
- Recipients: `to` = confirmed asset manager, `cc` = confirmed coordinator; else `to` =
  confirmed coordinator; else skip with reason.
- Weekly window: the report week that just ended, `getWeekRange(getPreviousWeek())` (Zoho
  week, same as the tab), for `new`; the other three lists are current. Skip a site whose
  four lists are empty.
- Alert window: `newFrom = newTo = asOf` (today UTC); skip when no new rows.
- Dedup (`report_sent_log`): `('asset_reminder', site, 'Wnn YYYY')` (Zoho week label),
  `('asset_new_alert', site, 'YYYY-MM-DD')`; results `'ok'` / `'fail'`. Like the other
  senders, dedup is **same-day only** (`alreadySentToday`; on pg it uses the database's
  `current_date`): a manual re-send on another day is allowed and logged.

**Scheduling**
- `asset_reminder` added to `reportSchedule.TYPES`, `cliFor` and the schedule tests; its
  schedule row lives on the `#ap-asset-reminders` card (not `_AR_TYPES`); default WEEKLY
  MON 07:00 (admin-editable).
- `asset_new_alert`: in-process after sightings (§4.1), only when armed; uses the same
  core function as the CLI; failures logged, never thrown.

**Admin card** `#ap-asset-reminders` (super_admin, the five surfaces): two arm toggles,
the weekly schedule row, per-site Preview, Send now. Route `POST /api/reports/asset-reminders/send?type=…&site=…&preview=1`
(super_admin, own route, not `SEND_TYPES`), registered above `/api/reports/:id`.

## 5. Tests

- `recordAssetSightings`: empty assets → no-op; baseline run; second run adds only new ids;
  same-day re-run idempotent; failed assets view → skipped (sqlite + pg).
- `getSiteAssetFollowups`: each predicate (blank-space user, `'0.00'`, state filters,
  window bounds, baseline excluded, multi-label site, asset since removed); no amount keys.
- Report review: upsert, server-side freeze, write auth, read rule (admin+, same site,
  no-site 403), delete cascade, `getReport` both forks.
- Status route: empty notes → 400; filled → 200; non-applicable → 200; assets layer
  throwing → 200; `ready` never gated.
- Editor counting: weekly container only (static/DOM test).
- Weekly e-mail with and without `asset_review`; monthly goldens byte-identical.
- Directory: new columns persisted through `upsertRecipient`; `asset_manager` resolution
  and fallback; unconfirmed never used.
- CLI: `--type` parsing, gates, skip reasons, dedup keys, preview sends nothing; schedule
  type tests updated.
- `await-precedence` covers the new dispatchers; route smokes force sqlite and use
  `tests/_http-fetch`.

## 6. Out of scope

Weekly PPTX slide; changes to the effort score; money amounts; the probable
`send-scoreboard.js` PostgreSQL crash (awaited `resolveRecipient`) — reported separately.

## 7. Documentation & owner steps

- `help.html` (EN + FR): the new weekly tab and the asset reminders card.
- `CLAUDE.md`: current-state entry + pitfalls if any are discovered.
- Owner: deploy (pm2 stop → start, Ctrl+F5); fill and confirm asset manager contacts; arm
  the two e-mails and set the Monday schedule; browser check with a coordinator account.
