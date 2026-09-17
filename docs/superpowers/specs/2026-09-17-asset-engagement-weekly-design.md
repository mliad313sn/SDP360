# Asset engagement in the weekly report + asset reminder e-mails — design

Date: 2026-09-17 · Status: approved in conversation, pending written review

## 1. Goal

Make site asset follow-up a **required part of the coordinator's weekly report** and
**remind the people who fix the register** about four worklists:

1. **New** hardware detected since the last reminder / report week;
2. **Unassigned** hardware — state `In Use` with neither `user_name` nor `department`
   (all product types, per user decision);
3. hardware **without purchase cost** (`purchase_cost` NULL, `''`, `'0'`, `'0.00'`);
4. hardware **without acquisition date** (`acquisition_date` NULL or `''`).

Lists 3 and 4 cover only assets in state `In Use`, `In Store` or `In Repair` (hardware
that is discovered-not-enrolled, expired, lost or disposed is out of scope).

## 2. User decisions (2026-09-17)

| Topic | Decision |
|---|---|
| Constraint | A **mandatory "Parc informatique" tab** in the weekly report; the server refuses submission while it is empty |
| Recipients | New **asset manager** contact per site (name, e-mail, confirmed flag); reminder goes to the confirmed asset manager with the coordinator in copy; falls back to the coordinator alone |
| Cadence | **Weekly recap per site, Monday morning**, plus a **same-day "new hardware" alert** after the nightly sync (max one per site per day) |
| New-hardware detection | New table of first sightings, baseline on first run (no alert flood) |
| "Unassigned" scope | **All hardware** in `In Use` with no user and no department |

## 3. Existing facts this design builds on

- The assets tables are **fully replaced** every night (`assets-db.js` DELETE+INSERT,
  cron 04:30 in `server.js:489-491`, chained `snapshotEffort`). Nothing today records
  which asset ids are new.
- The weekly report editor (`public/reports.html`) has 4 tabs (`stab-0..3`, :495-498);
  status auto-advance lives in `_afterSectionSaved` (:4579-4592) and currently never
  fires because it counts `.stab.done` while the tabs carry class `section-tab`.
- `PUT /api/reports/:id/status` (`server.js:6782`) validates only the status value.
- The weekly e-mail (`services/weeklyReportData.js`, `services/reportTemplates/weekly.js`
  `assetsSection` :277-320) already renders per-kind hygiene counts for the site; it only
  sends `submitted` reports and replays the frozen report.
- Site mapping: asset `site` labels → meetings site code via `assetHygieneForSite.labelsForCode`
  (forward through `assetLabelToCode`, never an inverted alias).
- Recipients: `services/reportDirectory.js` (`coordinator_*`, `fm_*`, `cc_emails`);
  per-site senders must use `listRecipients` + `resolveFromRows` (the awaited
  `resolveRecipient` path breaks on PostgreSQL).
- Every new `report_config` key must be added to `reportConfig.DEFAULTS`.

## 4. Design

### 4.1 Data layer (`assets-db.js`, dual backend)

**Table `asset_first_seen`** (in the shared `db/postgres/assets/001_init.sql` CREATE):

```sql
CREATE TABLE IF NOT EXISTS asset_first_seen (
  asset_id        TEXT PRIMARY KEY,
  site            TEXT NOT NULL DEFAULT '',
  first_seen_date TEXT NOT NULL,          -- YYYY-MM-DD (local server date)
  baseline        INTEGER NOT NULL DEFAULT 0  -- 1 = present at the first run
);
```

**`recordAssetSightings({ asOf })`** — after each successful assets sync:
- if the table is empty → insert every current asset with `baseline = 1`,
  `first_seen_date = asOf`;
- otherwise → insert only asset ids not yet present (`baseline = 0`); existing rows are
  never updated (an asset that disappears and returns keeps its first date);
- `site` = `COALESCE(site,'')` at first sighting.
Chained in the same `.then()` as `snapshotEffort` (nightly cron and manual trigger), with
its own `.catch` that logs. Idempotent per day.

**`getSiteAssetFollowups(labels, { newSince, asOf })`** — `labels` are the site's asset
labels (from `labelsForCode`). Returns:

```js
{
  counts: { new, unassigned, no_cost, no_date },
  new:        [row], unassigned: [row], no_cost: [row], no_date: [row],
  generated_at
}
```

- `new` = joined `asset_first_seen.baseline = 0 AND first_seen_date >= newSince`, asset
  still present in `assets`;
- `unassigned` = `state = 'In Use'` and trimmed `user_name` and `department` both empty;
- `no_cost` = `purchase_cost` NULL or IN `('', '0', '0.00')`, state in the three active states;
- `no_date` = `acquisition_date` NULL or `''`, same states.
- Row columns: `asset_id, asset_name, product_type, manufacturer, serial_number, state,
  site, user_name, department, acquisition_date, has_cost` (boolean) and, for `new`,
  `first_seen_date`. **No amount is ever returned.**
- Predicates are defined once (constants next to `HYGIENE_KINDS`) and reused by the
  counts, the lists and the Excel builder. No SQL CAST on text columns.

### 4.2 Mandatory "Parc informatique" tab (weekly report only)

**Storage** — new table in reports DB (sqlite `_initSchema` + pg migration):

```sql
CREATE TABLE IF NOT EXISTS report_asset_review (
  report_id     INTEGER PRIMARY KEY,
  counts_json   TEXT,     -- frozen {new, unassigned, no_cost, no_date} at save
  handled_note  TEXT,     -- "Traité cette semaine"
  plan_note     TEXT,     -- "Plan / blocages"
  updated_by    TEXT,
  updated_at    TEXT
);
```

Readers `getReportAssetReview(id)` / `saveReportAssetReview(id, data, user)` (upsert,
both backends), included in `getReport()` as `asset_review`.

**Routes** (registered above `/api/reports/:id`):
- `GET /api/reports/:id/asset-followups` — resolves report → site → labels, returns
  `getSiteAssetFollowups` with `newSince` = report week start, plus `applicable`
  (`false` when the site has no asset label).
- `PUT /api/reports/:id/asset-review` — through `_authorizeReportWrite`; trims both
  notes; server recomputes and freezes `counts_json` (client counts are ignored).

**Submission rule** — in `PUT /api/reports/:id/status` when the target is `submitted`
and the report is weekly (`week_number` set): if the site is applicable and either note
is empty after trim → `400 { error: 'Parc informatique: fill "Traité cette semaine" and "Plan / blocages" before submitting.' }`.
Monthly reports and non-applicable sites are unaffected. Already-submitted reports are
not re-checked.

**Editor (`reports.html`)**:
- tab `stab-4` "5 · Parc informatique" in the weekly editor only;
- shows the 4 counters (live on open), the change vs the previous week's frozen counts
  when available, and per-counter links to `assets.html` filtered on the site;
- two required textareas with inline "required" state; autosave like other sections;
- non-applicable site → panel says "Aucun matériel rattaché à ce site" and the tab counts
  as done;
- fix `_afterSectionSaved` to count the real tab class; the weekly editor needs all 5
  tabs done (4 when non-applicable) before auto-`ready`;
- `submitReport` shows the server's 400 message verbatim.

**Weekly e-mail** — `weeklyReportData` loads `asset_review`; `assetsSection` adds the
frozen four counts and the two notes under the existing hygiene counts. Nothing changes
when `asset_review` is absent (older reports). Monthly goldens stay byte-identical.

### 4.3 Asset manager contact

`report_recipients` (or the actual directory table) gains
`asset_manager_name`, `asset_manager_email`, `asset_manager_email_confirmed`
(additive ALTER, both backends). The admin directory card gets the three fields.
`resolveFromRows` gains kind `'asset_manager'`: returns the asset manager when confirmed,
else `null`.

### 4.4 Reminder e-mails

**Composer** `services/assetReminderReport.js` (pure):
- `buildAssetRecap({ site, followups, baseUrl, period })` → `{ subject, html, attachments }`
  with the 4 counts, the first 20 rows of each list, links to `assets.html?site=…`, and
  `assets-suivi-<SITE>-<YYYY-Www>.xlsx` (4 sheets).
- `buildNewAssetAlert({ site, rows, baseUrl, date })` → short e-mail listing new hardware.
- French wording; no currency, no amounts.

**Sender** `tools/reports/send-asset-reminders.js` (`require.main` guard, exported core):
- `--mode weekly` (recap) and `--mode new` (alert); `--preview`; `--site CODE`.
- Gates: `asset_reminder_send_enabled` (weekly) and `asset_new_alert_enabled` (alert),
  both default `'0'` and listed in `reportConfig.DEFAULTS`.
- Per site from `listRecipients` rows: `to` = confirmed asset manager, `cc` = confirmed
  coordinator; if no confirmed asset manager, `to` = confirmed coordinator; nobody
  confirmed → skip with reason. Honors `never_send_unconfirmed`.
- Skip a site whose lists are all empty (weekly) or with no new rows (alert).
- Dedup via `report_sent_log`: `('asset_reminder', site, 'YYYY-Www')` and
  `('asset_new_alert', site, 'YYYY-MM-DD')`; results `'ok'` / `'fail'`.
- weekly `newSince` = the Monday of the previous week; alert `newSince` = the day after
  the last alert sent for that site (or yesterday).

**Scheduling**
- weekly: new schedule type `asset_reminder` in `reportSchedule.TYPES` with a `cliFor`
  entry → Task Scheduler WEEKLY, default Monday 07:00 (admin-editable).
- alert: run in-process at the end of the nightly chain (sync → snapshot → sightings →
  alert) only when armed; failures are logged and never break the chain.

**Admin card** `#ap-asset-reminders` (super_admin, four admin-panel surfaces): arm
toggles, schedule, Preview (per site), Send now. Manual route
`POST /api/reports/asset-reminders/send?mode=weekly|new&preview=1` (its own route, not
`SEND_TYPES`).

## 5. Error handling

- Assets DB unavailable → the tab shows "Données actifs indisponibles" and **submission is
  still allowed** (a platform outage must not block coordinators); the refusal applies only
  to missing notes.
- Sighting or alert failure → logged, sync result unaffected.
- Mail failure → `report_sent_log` `'fail'`, retried next run.

## 6. Tests

- `asset_first_seen`: baseline run marks all rows baseline; second run inserts only new
  ids; re-run same day is idempotent (sqlite + pg).
- `getSiteAssetFollowups`: each predicate on seeded rows (incl. `'0.00'` cost, blank-space
  user, state filters, multi-label site); no amount in output.
- Report review: upsert, frozen counts recomputed server-side, write auth by site.
- Status route: weekly + applicable + empty notes → 400; filled → 200; monthly → 200;
  non-applicable → 200; assets DB down → 200.
- Weekly e-mail with and without `asset_review`; monthly goldens byte-identical.
- Directory `asset_manager` resolution and fallback; unconfirmed never used.
- Sender: gates, skip reasons, dedup keys, preview sends nothing.
- `await-precedence` stays green for the new dispatchers.
- Route smokes force sqlite and use `tests/_http-fetch`.

## 7. Out of scope

Weekly PPTX slide; changing the effort score; money amounts; the probable
`send-scoreboard` PostgreSQL crash (`resolveRecipient` awaited) — reported separately.

## 8. Owner steps

Deploy + pm2 stop/start; fill asset manager contacts and confirm them; arm the two
e-mails; browser check of the new tab with a coordinator account.
