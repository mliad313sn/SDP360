# Asset Engagement (weekly tab + reminders) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make site asset follow-up part of the coordinator's weekly report (a 5th "Parc informatique" tab whose four counts are frozen at submission and shown in the weekly e-mail, empty notes rendered "non renseigné", never blocking) and remind a new per-site "asset manager" contact by e-mail (weekly recap + same-day new-hardware alert).

**Architecture:** A first-sightings table (`asset_first_seen`) in the assets layer detects new hardware after each nightly sync; one dual-backend reader `getSiteAssetFollowups(labels, window)` returns four worklists (new / unassigned / no cost / no date) with no amounts. The reports layer stores one `report_asset_review` row per weekly report (notes + counts frozen by the server). Server routes resolve report → meetings code → asset labels; the editor gets a 5th tab; the weekly composer renders the frozen review; a new CLI (`send-asset-reminders.js`) composes per-site reminders through a pure composer, armed OFF by default, deduped in `report_sent_log`.

**Tech Stack:** Node.js + Express, better-sqlite3 / PostgreSQL (`services/pgDb.js`), `node:test`, SheetJS via `services/tableExcel.js`, vanilla JS in `public/reports.html`.

---

## Deviations from spec

1. **"Tabs get `done` on load from existing data (`reports.html:4523-4558`)" is false.** Those lines are inside `saveSection(n)`. Nothing marks a tab `done` when a report is opened, and the `done` class is never removed, so it leaks from one opened report to the next. Task 7 adds `_markSectionTabsFromData()` in `renderForm()`: it clears `done` on the five tabs, then marks tabs 0–3 from the loaded data (infra rows, helpdesk row, lights, actions present) and tab 4 by the spec rule.
2. **`submitReport()` has no confirmation dialog today** (`reports.html` `async function submitReport`). Task 7 adds a `confirm()` **only** when the asset tab is applicable and a note is empty; otherwise Submit behaves exactly as before (no dialog). It also flushes a pending tab-4 autosave before submitting (after submission a non-super_admin can no longer write the notes).
3. **`weeklyReportData.js` needs no change.** It loads the report through `getReport`, which (Task 4) now carries `asset_review`; only the composer (`reportTemplates/weekly.js`) changes.
4. **Sync wiring is a testable function, not an inline chain.** Task 3 adds `afterAssetsSync(summary, { sendAlerts, deps })` to `assets-sync.js`; the cron and the manual trigger in `server.js` call it. `snapshotEffort` still runs when the assets view failed (current behaviour kept); only the sightings/alert step is skipped.
5. **`_afterSectionSaved(n)` no longer adds `done` to tab 4 unconditionally** — tab 4 is `done` only when both notes are filled or the site is not applicable (spec §4.2 rule), otherwise every autosave of an empty textarea would tick it.
6. **Per-counter links:** `assets.html` has no worklist kind for "new" or "unassigned". Links: new / unassigned → `assets.html?site=<label>#inventory`; no cost → `?site=<label>&kind=no_cost#hygiene`; no date → `?site=<label>&kind=no_age#hygiene`. Links only when the site folds to exactly one asset label (same rule as the weekly e-mail, `weekly.js assetsSection`). The hygiene worklists are wider than our counts (no state filter, no trim) — the link text says "voir dans Assets", not "the same list".
7. **`resolveFromRows(rows, site, 'asset_manager')` returns `{ to, cc }` like the other kinds (cc = the row's `cc_emails`), but the reminder sender ignores `cc_emails`**: cc is the confirmed coordinator only (spec §4.4). `cc_emails` belong to the site report.
8. **`saveReportAssetReview` upserts only the columns present in the patch** (pattern of `reportDirectory.upsertRecipient`), not read-modify-write, so a freeze at submission and a notes save can never overwrite each other.
9. **`GET /api/reports/:id/asset-followups` returns 503 `{ error }` when the assets layer throws** (not an empty 200): zeros would read as a clean site.
10. **In-process callers inject `reportsDb`/`assetsDb`** into the CLI core so it never re-runs `initPgReports()`/`initPgAssets()` inside the server (the existing `send-weekly` route does re-init; we do not copy that).

---

## File Structure

| File | Create / Modify | Responsibility |
|---|---|---|
| `db/postgres/assets/001_init.sql` | Modify | `asset_first_seen` CREATE + index (shared sqlite/pg DDL) |
| `assets-db.js` | Modify | `recordAssetSightings`, `FOLLOWUP_*` predicates, `getSiteAssetFollowups` (both backends) |
| `assets-sync.js` | Modify | `assetsViewFailed`, `afterAssetsSync` (effort → sightings → alert) |
| `server.js` | Modify | cron + manual trigger call `afterAssetsSync`; `_assetLabelsForReport`, `_computeAssetReview`; `GET /api/reports/:id/asset-followups`; `PUT /api/reports/:id/asset-review`; freeze in `PUT /api/reports/:id/status`; `POST /api/reports/asset-reminders/send` |
| `db/postgres/reports/012_report_asset_review.sql` | Create | pg table |
| `reports-db.js` | Modify | sqlite CREATE; `getReportAssetReview`, `saveReportAssetReview`; `getReport`/`_getReportPg` include `asset_review`; `deleteReport` both forks; `initPgReports` runs 012 + directory ALTERs |
| `services/reportDirectory.js` | Modify | 3 asset-manager columns in `COLS`, sqlite ALTERs, `resolveFromRows` kind `asset_manager` |
| `services/reportTemplates/weekly.js` | Modify | frozen review block inside `assetsSection` |
| `services/assetReminderReport.js` | Create | pure French composer: `buildAssetRecap`, `buildNewAssetAlert` |
| `tools/reports/send-asset-reminders.js` | Create | CLI core + gates + recipients + dedup |
| `services/reportConfig.js` | Modify | `asset_reminder_send_enabled`, `asset_new_alert_enabled` in `DEFAULTS` |
| `services/reportSchedule.js` | Modify | `asset_reminder` in `TYPES` + `cliFor` |
| `public/reports.html` | Modify | tab `stab-4` + `section-4`; tab logic; submit note; directory fields; admin card `#ap-asset-reminders` (5 surfaces) |
| `public/help.html` | Modify | EN §4.6 + FR §4.6; admin card note in §7 EN/FR |
| `CLAUDE.md` | Modify | current-state entry + pitfall row |
| Tests (Create) | | `tests/asset-sightings.test.js`, `tests/asset-followups.test.js`, `tests/pg-asset-followups.test.js`, `tests/assets-after-sync.test.js`, `tests/report-asset-review.test.js`, `tests/pg-report-asset-review.test.js`, `tests/asset-review-routes.smoke.test.js`, `tests/asset-review-status.smoke.test.js`, `tests/reports-editor-asset-tab.test.js`, `tests/asset-reminder-report.test.js`, `tests/send-asset-reminders.test.js`, `tests/report-config-asset-reminders.test.js`, `tests/report-schedule-asset-reminder.test.js`, `tests/asset-reminders-route.smoke.test.js`, `tests/reports-admin-asset-reminders.test.js` |
| Tests (Modify) | | `tests/report-template-weekly.test.js`, `tests/report-directory.test.js` |

Conventions used in every task:
- Test command: `node --test --test-force-exit tests/<file>.test.js`.
- pg tests need an admin URL in the environment (`$env:PG_ADMIN_URL = 'postgres://postgres:<pw>@localhost:5432/postgres'`, the password is read from the operator's own setup, never written in the repo); they skip when Postgres is unreachable.
- Every smoke suite sets `SDP_DATA_DIR` to a `mkdtemp` dir and all five `*_BACKEND=sqlite` **before** requiring `server.js`, and uses `require('./_http-fetch')`.
- Every call to a dual-backend reader is written `(await f())` / `await f()` — never `await f().x`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: `asset_first_seen` table + `recordAssetSightings` (both backends)

**Files:**
- Modify: `db/postgres/assets/001_init.sql` (append at end of file)
- Modify: `assets-db.js` — `_ASSET_TABLES` (line ~87), new functions after `_snapshotEffortPg` (line ~1100), `module.exports` (line ~1487)
- Test: `tests/asset-sightings.test.js` (Create), `tests/pg-asset-followups.test.js` (Create — sightings part)

- [ ] **Step 1: Write the failing sqlite test** — `tests/asset-sightings.test.js`

```js
// tests/asset-sightings.test.js — first-sightings table: empty assets → no-op,
// first run = baseline, later runs add only unseen ids, same-day re-run idempotent,
// existing rows never updated.
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-'));
const adb = require('../assets-db');

const COLS = ['asset_id', 'asset_name', 'site', 'state'];
const seen = () => adb.getDB().prepare('SELECT * FROM asset_first_seen ORDER BY asset_id').all();

test('empty assets table → no-op (no baseline taken)', () => {
  adb.replaceTable('assets', COLS, []);
  const r = adb.recordAssetSightings({ asOf: '2026-07-20' });
  assert.strictEqual(r.inserted, 0);
  assert.strictEqual(seen().length, 0, 'a baseline on an empty register would mark every later asset "new"');
});

test('first run with assets = baseline (baseline=1 for every asset)', () => {
  adb.replaceTable('assets', COLS, [
    { asset_id: 'A1', asset_name: 'PC-1', site: 'Hounde', state: 'In Use' },
    { asset_id: 'A2', asset_name: 'PC-2', site: 'MANA', state: 'In Store' },
  ]);
  const r = adb.recordAssetSightings({ asOf: '2026-07-20' });
  assert.strictEqual(r.baseline, true);
  assert.strictEqual(r.inserted, 2);
  assert.deepStrictEqual(seen().map(x => [x.asset_id, x.site, x.first_seen_date, x.baseline]),
    [['A1', 'Hounde', '2026-07-20', 1], ['A2', 'MANA', '2026-07-20', 1]]);
});

test('second run adds only the new id with baseline=0; existing rows untouched', () => {
  adb.replaceTable('assets', COLS, [
    { asset_id: 'A1', asset_name: 'PC-1', site: 'Sabodala', state: 'In Use' },   // moved site
    { asset_id: 'A2', asset_name: 'PC-2', site: 'MANA', state: 'In Store' },
    { asset_id: 'A3', asset_name: 'PC-3', site: 'Hounde', state: 'In Use' },
  ]);
  const r = adb.recordAssetSightings({ asOf: '2026-07-28' });
  assert.strictEqual(r.baseline, false);
  assert.strictEqual(r.inserted, 1);
  const rows = seen();
  assert.deepStrictEqual(rows.find(x => x.asset_id === 'A3'),
    { asset_id: 'A3', site: 'Hounde', first_seen_date: '2026-07-28', baseline: 0 });
  assert.strictEqual(rows.find(x => x.asset_id === 'A1').site, 'Hounde', 'first-sighting site is never rewritten');
  assert.strictEqual(rows.find(x => x.asset_id === 'A1').first_seen_date, '2026-07-20');
});

test('same-day re-run is idempotent', () => {
  const r = adb.recordAssetSightings({ asOf: '2026-07-28' });
  assert.strictEqual(r.inserted, 0);
  assert.strictEqual(seen().length, 3);
});

test('default asOf is the UTC date', () => {
  adb.replaceTable('assets', COLS, [{ asset_id: 'A4', asset_name: 'PC-4', site: 'Hounde', state: 'In Use' }]);
  const r = adb.recordAssetSightings({});
  assert.strictEqual(r.date, new Date().toISOString().slice(0, 10));
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `node --test --test-force-exit tests/asset-sightings.test.js`
Expected: FAIL — `adb.recordAssetSightings is not a function` / `no such table: asset_first_seen`.

- [ ] **Step 3: Add the table to the shared DDL** — append to `db/postgres/assets/001_init.sql`:

```sql

-- Asset engagement (2026-09-18) — first sighting of each asset id. The assets
-- tables are full-replaced nightly, so "new hardware" can only be detected by
-- remembering which ids we have already seen. `baseline = 1` marks the ids that
-- were present on the very first run (never reported as new). Rows are never
-- updated; `site` is the site at first sighting, for information only.
CREATE TABLE IF NOT EXISTS asset_first_seen (
  asset_id        TEXT PRIMARY KEY,
  site            TEXT NOT NULL DEFAULT '',
  first_seen_date TEXT NOT NULL,
  baseline        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_asset_first_seen_date ON asset_first_seen (first_seen_date);
```

- [ ] **Step 4: Implement in `assets-db.js`**

In `_ASSET_TABLES` add `'asset_first_seen'`:

```js
const _ASSET_TABLES = new Set(['assets', 'asset_memory', 'asset_logical_drives', 'asset_monitors', 'software_licenses', 'software', 'asset_effort_history', 'asset_first_seen']);
```

After `_snapshotEffortPg` add:

```js
// ─── Asset engagement — first sightings (2026-09-18) ─────────────────────────
// Records every asset id not seen before. First run on a non-empty register =
// baseline (baseline=1, never reported as new). Existing rows are never updated
// (INSERT OR IGNORE / ON CONFLICT DO NOTHING) → idempotent per day. Dates are UTC,
// like snapshotEffort. Dual-backend: the pg fork is async — callers MUST await.
function _todayUtc() { return new Date().toISOString().slice(0, 10); }
const _SIGHT_SELECT = `SELECT asset_id, COALESCE(site, ''), ?, ? FROM assets WHERE asset_id IS NOT NULL AND asset_id <> ''`;

function recordAssetSightings(opts = {}) {
  if (ASSETS_BACKEND === 'postgres') return _recordAssetSightingsPg(opts);
  const date = (opts && opts.asOf) || _todayUtc();
  const db = getDB();
  const tx = db.transaction(() => {
    const assets = db.prepare('SELECT COUNT(*) AS n FROM assets').get().n;
    if (!assets) return { date, baseline: false, inserted: 0, skipped: 'no assets' };
    const baseline = db.prepare('SELECT COUNT(*) AS n FROM asset_first_seen').get().n === 0;
    const r = db.prepare(`INSERT OR IGNORE INTO asset_first_seen (asset_id, site, first_seen_date, baseline) ${_SIGHT_SELECT}`)
      .run(date, baseline ? 1 : 0);
    return { date, baseline, inserted: r.changes };
  });
  return tx();
}
async function _recordAssetSightingsPg(opts = {}) {
  const date = (opts && opts.asOf) || _todayUtc();
  const h = pgHandle();
  return h.runTransaction(async () => {
    const assets = Number((await h.prepare('SELECT COUNT(*) AS n FROM assets').get()).n);
    if (!assets) return { date, baseline: false, inserted: 0, skipped: 'no assets' };
    const baseline = Number((await h.prepare('SELECT COUNT(*) AS n FROM asset_first_seen').get()).n) === 0;
    // Explicit RETURNING keeps pgDb from appending RETURNING * (thousands of rows).
    const r = await h.prepare(`INSERT INTO asset_first_seen (asset_id, site, first_seen_date, baseline) ${_SIGHT_SELECT}
      ON CONFLICT (asset_id) DO NOTHING RETURNING asset_id`).run(date, baseline ? 1 : 0);
    return { date, baseline, inserted: Number(r.changes) || 0 };
  });
}
```

Add `recordAssetSightings,` to `module.exports` next to `snapshotEffort,`.

- [ ] **Step 5: Run — expect pass**

Run: `node --test --test-force-exit tests/asset-sightings.test.js` → all pass.

- [ ] **Step 6: Write the pg test** — `tests/pg-asset-followups.test.js` (Task 2 extends it)

```js
'use strict';
// Asset engagement — assets layer on PostgreSQL. Throwaway DB; skips cleanly when PG is down.
process.env.ASSETS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgafu-'));
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

let ctx = null, adb = null;
async function boot() {
  if (adb) return adb;
  ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  adb = require('../assets-db');
  await adb.initPgAssets();
  return adb;
}
const COLS = ['asset_id', 'asset_name', 'site', 'state', 'user_name', 'department', 'purchase_cost', 'acquisition_date'];

test('pg: sightings — empty no-op, baseline, new id, idempotent', async (t) => {
  const a = await boot();
  if (!a) return t.skip('Postgres unreachable');
  await a.replaceTable('assets', COLS, []);
  assert.strictEqual((await a.recordAssetSightings({ asOf: '2026-07-20' })).inserted, 0);
  await a.replaceTable('assets', COLS, [{ asset_id: 'A1', asset_name: 'PC-1', site: 'Hounde', state: 'In Use' }]);
  const b = await a.recordAssetSightings({ asOf: '2026-07-20' });
  assert.deepStrictEqual([b.baseline, b.inserted], [true, 1]);
  await a.replaceTable('assets', COLS, [
    { asset_id: 'A1', asset_name: 'PC-1', site: 'Hounde', state: 'In Use' },
    { asset_id: 'A2', asset_name: 'PC-2', site: 'Hounde', state: 'In Use' },
  ]);
  const n = await a.recordAssetSightings({ asOf: '2026-07-28' });
  assert.deepStrictEqual([n.baseline, n.inserted], [false, 1]);
  assert.strictEqual((await a.recordAssetSightings({ asOf: '2026-07-28' })).inserted, 0);
});

test('pg: teardown', async () => { if (ctx) await dropTestDb(ctx); });
```

Run: `node --test --test-force-exit tests/pg-asset-followups.test.js` → pass (or skip without PG).

- [ ] **Step 7: Regression** — `node --test --test-force-exit tests/assets-hygiene-readers.test.js tests/assets-integration.test.js tests/await-precedence.test.js` → green (await-precedence auto-discovers the new dispatcher).

- [ ] **Step 8: Commit**

```
git add db/postgres/assets/001_init.sql assets-db.js tests/asset-sightings.test.js tests/pg-asset-followups.test.js
git commit -m "feat(assets): asset_first_seen table + recordAssetSightings (sqlite + pg)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: FOLLOWUP predicates + `getSiteAssetFollowups`

**Files:**
- Modify: `assets-db.js` — constants right after `HYGIENE_KINDS` (line ~265), reader after `recordAssetSightings`, exports
- Test: `tests/asset-followups.test.js` (Create), extend `tests/pg-asset-followups.test.js`

- [ ] **Step 1: Write the failing test** — `tests/asset-followups.test.js`

```js
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'afu-'));
const adb = require('../assets-db');

const COLS = ['asset_id', 'asset_name', 'product_type', 'manufacturer', 'serial_number', 'state', 'site',
  'user_name', 'department', 'purchase_cost', 'acquisition_date'];
const ok = { product_type: 'Laptop', manufacturer: 'Dell', serial_number: 'SN', state: 'In Use',
  user_name: 'u', department: 'IT', purchase_cost: '1,250,000.00', acquisition_date: '2024-01-01' };

// Baseline register (day 1), then new arrivals (day 2).
adb.replaceTable('assets', COLS, [{ ...ok, asset_id: 'B1', asset_name: 'Base-1', site: 'Hounde' }]);
adb.recordAssetSightings({ asOf: '2026-07-20' });
adb.replaceTable('assets', COLS, [
  { ...ok, asset_id: 'B1', asset_name: 'Base-1', site: 'Hounde' },                                        // baseline → never "new"
  { ...ok, asset_id: 'N1', asset_name: 'New-1', site: 'Hounde' },                                         // new in window
  { ...ok, asset_id: 'U1', asset_name: 'Unassigned-blank', site: 'Hounde', user_name: '  ', department: ' ' }, // unassigned (spaces)
  { ...ok, asset_id: 'U2', asset_name: 'Store-no-user', site: 'Hounde', state: 'In Store', user_name: '', department: '' }, // NOT unassigned (not In Use)
  { ...ok, asset_id: 'U3', asset_name: 'Dept-only', site: 'Hounde', user_name: '', department: 'HR' },   // NOT unassigned (department set)
  { ...ok, asset_id: 'C1', asset_name: 'Cost-000', site: 'Hounde', purchase_cost: ' 0.00 ' },             // no cost (trimmed)
  { ...ok, asset_id: 'C2', asset_name: 'Cost-null', site: 'Hounde', state: 'In Repair', purchase_cost: null }, // no cost (In Repair counts)
  { ...ok, asset_id: 'C3', asset_name: 'Cost-disposed', site: 'Hounde', state: 'Disposed', purchase_cost: '0' }, // NOT counted (state)
  { ...ok, asset_id: 'D1', asset_name: 'Date-blank', site: 'Hounde', acquisition_date: ' ' },             // no date
  { ...ok, asset_id: 'D2', asset_name: 'Date-expired', site: 'Hounde', state: 'Expired', acquisition_date: '' }, // NOT counted (state)
  { ...ok, asset_id: 'M1', asset_name: 'Massawa-1', site: 'MASSAWA', user_name: '', department: '' },   // second label of a multi-label site
  { ...ok, asset_id: 'X1', asset_name: 'Other-site', site: 'MANA', user_name: '', department: '' },     // other site
]);
adb.recordAssetSightings({ asOf: '2026-07-28' });
// N1 later removed from the register: keep its first-seen row, then drop it from assets.
adb.getDB().prepare(`INSERT INTO asset_first_seen (asset_id, site, first_seen_date, baseline) VALUES ('GONE','Hounde','2026-07-28',0)`).run();

const W = { newFrom: '2026-07-26', newTo: '2026-08-01' };
const ids = (rows) => rows.map(r => r.asset_id).sort();

test('each list follows its predicate (trim, states, all product types)', () => {
  const f = adb.getSiteAssetFollowups(['Hounde'], W);
  assert.deepStrictEqual(ids(f.unassigned), ['U1']);
  assert.deepStrictEqual(ids(f.no_cost), ['C1', 'C2']);
  assert.deepStrictEqual(ids(f.no_date), ['D1']);
  assert.deepStrictEqual(ids(f.new).includes('N1'), true);
  assert.ok(!ids(f.new).includes('B1'), 'baseline rows are never new');
  assert.ok(!ids(f.new).includes('GONE'), 'an asset since removed from the register is not listed');
  assert.deepStrictEqual(f.counts, { new: f.new.length, unassigned: 1, no_cost: 2, no_date: 1 });
  assert.match(f.generated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('new respects the window bounds (inclusive)', () => {
  assert.strictEqual(adb.getSiteAssetFollowups(['Hounde'], { newFrom: '2026-07-28', newTo: '2026-07-28' }).counts.new > 0, true);
  assert.strictEqual(adb.getSiteAssetFollowups(['Hounde'], { newFrom: '2026-07-29', newTo: '2026-08-01' }).counts.new, 0);
  assert.strictEqual(adb.getSiteAssetFollowups(['Hounde'], {}).counts.new, 0, 'no window → no "new" list');
});

test('multi-label site sums across labels; other sites excluded', () => {
  const f = adb.getSiteAssetFollowups(['Hounde', 'MASSAWA'], W);
  assert.deepStrictEqual(ids(f.unassigned), ['M1', 'U1']);
  assert.ok(!ids(f.unassigned).includes('X1'));
});

test('empty labels → zeros and empty lists', () => {
  const f = adb.getSiteAssetFollowups([], W);
  assert.deepStrictEqual(f.counts, { new: 0, unassigned: 0, no_cost: 0, no_date: 0 });
  assert.deepStrictEqual([f.new, f.unassigned, f.no_cost, f.no_date], [[], [], [], []]);
});

test('rows carry has_cost (boolean) and NO amount key', () => {
  const f = adb.getSiteAssetFollowups(['Hounde'], W);
  for (const list of [f.new, f.unassigned, f.no_cost, f.no_date]) {
    for (const r of list) {
      assert.strictEqual(typeof r.has_cost, 'boolean');
      for (const k of ['purchase_cost', 'current_book_value', 'total_cost_of_ownership', 'operational_cost']) {
        assert.ok(!(k in r), `money key ${k} must not leak`);
      }
    }
  }
  assert.strictEqual(f.no_cost.find(r => r.asset_id === 'C1').has_cost, false);
  assert.strictEqual(f.new.find(r => r.asset_id === 'N1').has_cost, true);
  assert.strictEqual(f.new.find(r => r.asset_id === 'N1').first_seen_date, '2026-07-28');
});
```

- [ ] **Step 2: Run — expect failure** (`getSiteAssetFollowups is not a function`).

Run: `node --test --test-force-exit tests/asset-followups.test.js`

- [ ] **Step 3: Implement** — after `HYGIENE_KINDS` in `assets-db.js`:

```js
// ─── Asset engagement worklists (2026-09-18) ────────────────────────────────
// Deliberately NOT HYGIENE_KINDS.no_owner / no_cost / no_age: those do not trim
// and have no state filter. No SQL CAST on the TEXT columns — TRIM + IN only.
const FOLLOWUP_ACTIVE_STATES = "state IN ('In Use','In Store','In Repair')";
const FOLLOWUP_UNASSIGNED = "state = 'In Use' AND TRIM(COALESCE(user_name,'')) = '' AND TRIM(COALESCE(department,'')) = ''";
const FOLLOWUP_NO_COST = `(${FOLLOWUP_ACTIVE_STATES}) AND (purchase_cost IS NULL OR TRIM(purchase_cost) IN ('','0','0.00'))`;
const FOLLOWUP_NO_DATE = `(${FOLLOWUP_ACTIVE_STATES}) AND (acquisition_date IS NULL OR TRIM(acquisition_date) = '')`;
```

After `_recordAssetSightingsPg` add:

```js
// Identity columns only — `has_cost` is a 0/1 flag, never the amount. Qualified
// with `a.` because the "new" query joins asset_first_seen (which also has `site`).
const _FOLLOWUP_COLS = `a.asset_id, a.asset_name, a.product_type, a.manufacturer, a.serial_number,
  a.state, a.site, a.user_name, a.department, a.acquisition_date,
  CASE WHEN (a.purchase_cost IS NULL OR TRIM(a.purchase_cost) IN ('','0','0.00')) THEN 0 ELSE 1 END AS has_cost`;

function _followupQueries(labels, opts) {
  const L = (labels || []).map(v => String(v == null ? '' : v)).filter(Boolean);
  const ph = L.map(() => '?').join(', ');
  const q = {
    unassigned: { sql: `SELECT ${_FOLLOWUP_COLS} FROM assets a WHERE (${FOLLOWUP_UNASSIGNED}) AND a.site IN (${ph}) ORDER BY a.asset_name`, params: L },
    no_cost:    { sql: `SELECT ${_FOLLOWUP_COLS} FROM assets a WHERE (${FOLLOWUP_NO_COST}) AND a.site IN (${ph}) ORDER BY a.asset_name`, params: L },
    no_date:    { sql: `SELECT ${_FOLLOWUP_COLS} FROM assets a WHERE (${FOLLOWUP_NO_DATE}) AND a.site IN (${ph}) ORDER BY a.asset_name`, params: L },
  };
  const { newFrom, newTo } = opts || {};
  if (newFrom && newTo) {
    q.new = {
      sql: `SELECT ${_FOLLOWUP_COLS}, f.first_seen_date FROM asset_first_seen f
            JOIN assets a ON a.asset_id = f.asset_id
            WHERE f.baseline = 0 AND f.first_seen_date BETWEEN ? AND ? AND a.site IN (${ph})
            ORDER BY f.first_seen_date, a.asset_name`,
      params: [newFrom, newTo, ...L],
    };
  }
  return { L, q };
}
function _shapeFollowups(lists) {
  const shape = (rows) => (rows || []).map(r => ({ ...r, has_cost: Number(r.has_cost) === 1 }));
  const out = { new: shape(lists.new), unassigned: shape(lists.unassigned), no_cost: shape(lists.no_cost), no_date: shape(lists.no_date) };
  out.counts = { new: out.new.length, unassigned: out.unassigned.length, no_cost: out.no_cost.length, no_date: out.no_date.length };
  out.generated_at = new Date().toISOString();
  return out;
}

// getSiteAssetFollowups(labels, {newFrom, newTo}) — the four asset-engagement
// worklists for ONE site (its real asset labels). The "new" list uses the CURRENT
// assets.site. Empty labels → zeros. Dual-backend: the pg fork is async.
function getSiteAssetFollowups(labels, opts = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getSiteAssetFollowupsPg(labels, opts);
  const { L, q } = _followupQueries(labels, opts);
  if (!L.length) return _shapeFollowups({});
  const db = getDB();
  const lists = {};
  for (const [k, { sql, params }] of Object.entries(q)) lists[k] = db.prepare(sql).all(...params);
  return _shapeFollowups(lists);
}
async function _getSiteAssetFollowupsPg(labels, opts = {}) {
  const { L, q } = _followupQueries(labels, opts);
  if (!L.length) return _shapeFollowups({});
  const h = pgHandle();
  const lists = {};
  for (const [k, { sql, params }] of Object.entries(q)) lists[k] = await h.prepare(sql).all(...params);
  return _shapeFollowups(lists);
}
```

Exports: add `FOLLOWUP_ACTIVE_STATES, FOLLOWUP_UNASSIGNED, FOLLOWUP_NO_COST, FOLLOWUP_NO_DATE, recordAssetSightings, getSiteAssetFollowups,`.

- [ ] **Step 4: Run — expect pass**: `node --test --test-force-exit tests/asset-followups.test.js`.

- [ ] **Step 5: Extend the pg test** — insert before the teardown test in `tests/pg-asset-followups.test.js`:

```js
test('pg: followups — predicates, window, no amounts', async (t) => {
  const a = await boot();
  if (!a) return t.skip('Postgres unreachable');
  await a.replaceTable('assets', COLS, [
    { asset_id: 'A1', asset_name: 'PC-1', site: 'Hounde', state: 'In Use', user_name: ' ', department: '', purchase_cost: '0.00', acquisition_date: '' },
    { asset_id: 'A2', asset_name: 'PC-2', site: 'Hounde', state: 'In Use', user_name: 'x', department: 'IT', purchase_cost: '10', acquisition_date: '2024-01-01' },
  ]);
  const f = await a.getSiteAssetFollowups(['Hounde'], { newFrom: '2026-07-26', newTo: '2026-08-01' });
  assert.deepStrictEqual(f.counts, { new: 1, unassigned: 1, no_cost: 1, no_date: 1 });   // A2 first seen 2026-07-28 in the sightings test
  assert.strictEqual(f.new[0].asset_id, 'A2');
  assert.strictEqual(f.new[0].has_cost, true);
  assert.ok(!('purchase_cost' in f.unassigned[0]));
  assert.deepStrictEqual((await a.getSiteAssetFollowups([], {})).counts, { new: 0, unassigned: 0, no_cost: 0, no_date: 0 });
});
```

Run: `node --test --test-force-exit tests/pg-asset-followups.test.js`.

- [ ] **Step 6: Regression** — `node --test --test-force-exit tests/asset-sightings.test.js tests/assets-hygiene-readers.test.js tests/await-precedence.test.js`.

- [ ] **Step 7: Commit**

```
git add assets-db.js tests/asset-followups.test.js tests/pg-asset-followups.test.js
git commit -m "feat(assets): getSiteAssetFollowups — new/unassigned/no-cost/no-date worklists

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire sightings into the nightly cron + manual trigger

**Files:**
- Modify: `assets-sync.js` — add `assetsViewFailed`, `afterAssetsSync` before `module.exports` (line 173), export them
- Modify: `server.js` lines 490-492 (cron) and 2349-2351 (manual trigger)
- Test: `tests/assets-after-sync.test.js` (Create)

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sync = require('../assets-sync');

function deps(log, over = {}) {
  return {
    snapshotEffort: async () => { log.push('effort'); },
    recordAssetSightings: async () => { log.push('sightings'); return { inserted: 1 }; },
    sendNewAssetAlerts: async () => { log.push('alerts'); },
    ...over,
  };
}
const OK = [{ name: 'assets', rows: 10 }, { name: 'asset_memory', rows: 5 }];

test('assetsViewFailed looks at the assets view only', () => {
  assert.strictEqual(sync.assetsViewFailed(OK), false);
  assert.strictEqual(sync.assetsViewFailed([{ name: 'assets', error: 'timeout' }]), true);
  assert.strictEqual(sync.assetsViewFailed([{ name: 'asset_memory', error: 'x' }, { name: 'assets', rows: 1 }]), false);
  assert.strictEqual(sync.assetsViewFailed(null), true, 'no summary = cannot trust the table');
});

test('cron order: effort → sightings → alerts', async () => {
  const log = [];
  await sync.afterAssetsSync(OK, { sendAlerts: true, deps: deps(log) });
  assert.deepStrictEqual(log, ['effort', 'sightings', 'alerts']);
});

test('manual trigger: sightings but no alert', async () => {
  const log = [];
  await sync.afterAssetsSync(OK, { sendAlerts: false, deps: deps(log) });
  assert.deepStrictEqual(log, ['effort', 'sightings']);
});

test('failed assets view → effort still runs, sightings + alerts skipped', async () => {
  const log = [];
  const r = await sync.afterAssetsSync([{ name: 'assets', error: 'boom' }], { sendAlerts: true, deps: deps(log) });
  assert.deepStrictEqual(log, ['effort']);
  assert.strictEqual(r.sightings, 'skipped: assets view failed');
});

test('an effort failure never blocks sightings; a sightings failure never throws', async () => {
  const log = [];
  await sync.afterAssetsSync(OK, { sendAlerts: true, deps: deps(log, {
    snapshotEffort: async () => { throw new Error('effort down'); },
    recordAssetSightings: async () => { log.push('sightings'); throw new Error('db down'); },
  }) });
  assert.deepStrictEqual(log, ['sightings'], 'alerts are not sent after a sightings failure');
});
```

- [ ] **Step 2: Run — expect failure** (`sync.assetsViewFailed is not a function`).

Run: `node --test --test-force-exit tests/assets-after-sync.test.js`

- [ ] **Step 3: Implement in `assets-sync.js`** (before `module.exports`):

```js
// The assets view is the one sightings read. A failed (or missing) summary entry
// means the table may be stale or partial → do NOT record sightings from it.
function assetsViewFailed(summary) {
  if (!Array.isArray(summary)) return true;
  const e = summary.find(v => v && v.name === 'assets');
  return !e || !!e.error;
}

// Post-sync chain, shared by the 04:30 cron (sendAlerts:true) and the manual
// trigger (sendAlerts:false). Each step logs its own failure and never throws:
// effort snapshot → first sightings → same-day new-hardware alert (armed OFF by
// default inside the CLI). Runs AFTER syncAllAssets resolved (never in parallel).
async function afterAssetsSync(summary, { sendAlerts = false, deps = {} } = {}) {
  const adb = () => require('./assets-db');
  const snapshotEffort = deps.snapshotEffort || (() => adb().snapshotEffort({}));
  const recordAssetSightings = deps.recordAssetSightings || (() => adb().recordAssetSightings({}));
  const sendNewAssetAlerts = deps.sendNewAssetAlerts || (() => require('./tools/reports/send-asset-reminders').main({
    type: 'asset_new_alert', reportsDb: require('./reports-db'), assetsDb: adb(),
  }));
  const out = { effort: null, sightings: null, alerts: null };
  try { out.effort = await snapshotEffort(); }
  catch (e) { console.error('[assets-sync] effort snapshot failed:', e && e.message); }
  if (assetsViewFailed(summary)) {
    out.sightings = 'skipped: assets view failed';
    console.warn('[assets-sync] assets view failed — first sightings not recorded');
    return out;
  }
  try { out.sightings = await recordAssetSightings(); }
  catch (e) { console.error('[assets-sync] sightings failed:', e && e.message); return out; }
  if (!sendAlerts) return out;
  try { out.alerts = await sendNewAssetAlerts(); }
  catch (e) { console.error('[assets-sync] new-asset alert failed:', e && e.message); }
  return out;
}
```

Change the export line to:

```js
module.exports = { init, fetchAll, syncAssetView, syncAllAssets, ASSET_VIEWS, DEFAULT_MAP, assetsViewFailed, afterAssetsSync };
```

- [ ] **Step 4: Rewire `server.js`**

Cron (replace lines 490-492):

```js
cron.schedule('30 4 * * *', () => require('./assets-sync').syncAllAssets()
  .then(summary => require('./assets-sync').afterAssetsSync(summary, { sendAlerts: true }))
  .catch(e => console.error('[Cron:assets]', e && e.message)));
```

Manual trigger (replace the chain inside `app.post('/api/sync/trigger/assets'`):

```js
  require('./assets-sync').syncAllAssets()
    .then(summary => require('./assets-sync').afterAssetsSync(summary, { sendAlerts: false }))
    .catch(e => console.error('[ManualSync:assets]', e && e.message));
```

Note: the default `sendNewAssetAlerts` requires `tools/reports/send-asset-reminders.js`, created in Task 11. Until then the cron would log "Cannot find module" once per night inside the caught step — Tasks 3 and 11 ship in the same deploy; do not deploy between them.

- [ ] **Step 5: Run** — `node --test --test-force-exit tests/assets-after-sync.test.js` → pass.

- [ ] **Step 6: Regression** — `node --test --test-force-exit tests/await-precedence.test.js tests/admin-superadmin-gate.smoke.test.js` (the gate smoke hits the manual assets trigger).

- [ ] **Step 7: Commit**

```
git add assets-sync.js server.js tests/assets-after-sync.test.js
git commit -m "feat(assets): record first sightings after each successful assets sync

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `report_asset_review` storage (sqlite + pg 012)

**Files:**
- Create: `db/postgres/reports/012_report_asset_review.sql`
- Modify: `reports-db.js` — sqlite CREATE (new `db.exec` block right after the `CREATE TABLE IF NOT EXISTS exec_report_editorial` block, ~line 999); readers after `touchReport` (~line 3837); `getReport` (line 2604); `_getReportPg` (line 3858); `_deleteReportSqlite` / `_deleteReportPg` (lines 3782-3799); `initPgReports` (after the 011 exec, ~line 1376); `module.exports` (~line 8108)
- Test: `tests/report-asset-review.test.js` (Create), `tests/pg-report-asset-review.test.js` (Create)

- [ ] **Step 1: Write the failing sqlite test**

```js
'use strict';
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'rar-'));
process.env.REPORTS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

const site = rdb.listSites().find(s => s.name === 'Hounde');
const rep = rdb.ensureReport(site.id, 2026, 30);

test('no row → getReportAssetReview null, getReport.asset_review null', () => {
  assert.strictEqual(rdb.getReportAssetReview(rep.id), null);
  assert.strictEqual(rdb.getReport(rep.id).asset_review, null);
});

test('upsert notes then freeze counts — neither clobbers the other', () => {
  rdb.saveReportAssetReview(rep.id, { handled_note: 'Tagged 3 PCs', plan_note: 'Order labels' }, 'coord');
  rdb.saveReportAssetReview(rep.id, { applicable: true, counts: { new: 2, unassigned: 1, no_cost: 0, no_date: 4 } }, 'system');
  const r = rdb.getReportAssetReview(rep.id);
  assert.deepStrictEqual(
    { applicable: r.applicable, counts: r.counts, handled_note: r.handled_note, plan_note: r.plan_note, updated_by: r.updated_by },
    { applicable: true, counts: { new: 2, unassigned: 1, no_cost: 0, no_date: 4 }, handled_note: 'Tagged 3 PCs', plan_note: 'Order labels', updated_by: 'system' });
  assert.match(r.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('counts:null is stored as null; applicable:false round-trips', () => {
  rdb.saveReportAssetReview(rep.id, { applicable: false, counts: null }, 'system');
  const r = rdb.getReportAssetReview(rep.id);
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.counts, null);
  assert.strictEqual(r.handled_note, 'Tagged 3 PCs');
});

test('getReport carries asset_review', () => {
  assert.strictEqual(rdb.getReport(rep.id).asset_review.plan_note, 'Order labels');
});

test('deleteReport removes the review row', () => {
  const other = rdb.ensureReport(site.id, 2026, 31);
  rdb.saveReportAssetReview(other.id, { handled_note: 'x' }, 'u');
  rdb.deleteReport(other.id);
  assert.strictEqual(rdb.getReportAssetReview(other.id), null);
});
```

- [ ] **Step 2: Run — expect failure** (`rdb.getReportAssetReview is not a function`).

Run: `node --test --test-force-exit tests/report-asset-review.test.js`

- [ ] **Step 3: pg migration** — `db/postgres/reports/012_report_asset_review.sql`:

```sql
-- Asset engagement (2026-09-18) — the weekly report's "Parc informatique" tab.
-- One row per weekly report. counts_json is FROZEN by the server (never taken
-- from the client) at each tab save and at submission. updated_at = ISO text.
CREATE TABLE IF NOT EXISTS report_asset_review (
  report_id     INTEGER PRIMARY KEY,
  applicable    INTEGER NOT NULL DEFAULT 1,
  counts_json   TEXT,
  handled_note  TEXT,
  plan_note     TEXT,
  updated_by    TEXT,
  updated_at    TEXT
);
```

- [ ] **Step 4: sqlite CREATE** — new block after the `exec_report_editorial` `db.exec(...)` block in `reports-db.js`:

```js
// Asset engagement (2026-09-18) — weekly report "Parc informatique" tab. Same DDL
// as db/postgres/reports/012_report_asset_review.sql. Deleted explicitly by deleteReport.
db.exec(`
CREATE TABLE IF NOT EXISTS report_asset_review (
  report_id     INTEGER PRIMARY KEY,
  applicable    INTEGER NOT NULL DEFAULT 1,
  counts_json   TEXT,
  handled_note  TEXT,
  plan_note     TEXT,
  updated_by    TEXT,
  updated_at    TEXT
);
`);
```

- [ ] **Step 5: readers** — after `touchReport` in `reports-db.js`:

```js
// ── Asset engagement — report_asset_review ──────────────────────────────────
function _mapAssetReview(row) {
  if (!row) return null;
  let counts = null;
  if (row.counts_json) {
    try { const v = JSON.parse(row.counts_json); counts = (v && typeof v === 'object') ? v : null; } catch { counts = null; }
  }
  return {
    report_id: Number(row.report_id), applicable: Number(row.applicable) !== 0, counts,
    handled_note: row.handled_note ?? null, plan_note: row.plan_note ?? null,
    updated_by: row.updated_by ?? null, updated_at: row.updated_at ?? null,
  };
}
// Only the keys PRESENT in the patch are written (a freeze never touches the
// notes, a notes save never touches the counts) — no read-modify-write race.
function _assetReviewPatch(patch) {
  const p = patch || {}, out = {};
  if (p.applicable !== undefined) out.applicable = p.applicable ? 1 : 0;
  if (p.counts !== undefined) out.counts_json = p.counts == null ? null : JSON.stringify(p.counts);
  if (p.handled_note !== undefined) out.handled_note = p.handled_note == null ? null : String(p.handled_note);
  if (p.plan_note !== undefined) out.plan_note = p.plan_note == null ? null : String(p.plan_note);
  return out;
}
function _assetReviewUpsertSql(cols) {
  const ins = ['report_id', ...cols, 'updated_by', 'updated_at'];
  const upd = [...cols, 'updated_by', 'updated_at'].map(c => `${c}=excluded.${c}`).join(', ');
  return `INSERT INTO report_asset_review (${ins.join(', ')}) VALUES (${ins.map(() => '?').join(', ')})
          ON CONFLICT(report_id) DO UPDATE SET ${upd}`;
}
function getReportAssetReview(report_id) {
  if (REPORTS_BACKEND === 'postgres') return _getReportAssetReviewPg(report_id);
  return _mapAssetReview(db.prepare('SELECT * FROM report_asset_review WHERE report_id=?').get(report_id));
}
async function _getReportAssetReviewPg(report_id) {
  return _mapAssetReview(await pgHandle().prepare('SELECT * FROM report_asset_review WHERE report_id=?').get(report_id));
}
function saveReportAssetReview(report_id, patch, user) {
  if (REPORTS_BACKEND === 'postgres') return _saveReportAssetReviewPg(report_id, patch, user);
  const p = _assetReviewPatch(patch), cols = Object.keys(p);
  db.prepare(_assetReviewUpsertSql(cols)).run(report_id, ...cols.map(c => p[c]), user || 'unknown', new Date().toISOString());
  return getReportAssetReview(report_id);
}
async function _saveReportAssetReviewPg(report_id, patch, user) {
  const p = _assetReviewPatch(patch), cols = Object.keys(p);
  await pgHandle().prepare(_assetReviewUpsertSql(cols)).run(report_id, ...cols.map(c => p[c]), user || 'unknown', new Date().toISOString());
  return _getReportAssetReviewPg(report_id);
}
```

- [ ] **Step 6: getReport / _getReportPg / deleteReport**

In `getReport` (sqlite) after the `report.action_items = …` line:

```js
  report.asset_review  = getReportAssetReview(report_id);
```

In `_getReportPg` after the `report.action_items = …` line:

```js
  report.asset_review = await _getReportAssetReviewPg(report_id);
```

`_deleteReportSqlite`: add before the `DELETE FROM weekly_reports` line:

```js
  db.prepare(`DELETE FROM report_asset_review WHERE report_id=?`).run(id);
```

`_deleteReportPg`: add before its `DELETE FROM weekly_reports` line:

```js
    await H.prepare('DELETE FROM report_asset_review WHERE report_id=?').run(id);
```

`initPgReports`: after the `011_roadmap_project.sql` exec add:

```js
  // Asset engagement — weekly report "Parc informatique" tab.
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '012_report_asset_review.sql'), 'utf8'));
```

`module.exports`: add `getReportAssetReview, saveReportAssetReview,` on the line that exports `updateReportStatus, touchReport, deleteReport,`.

- [ ] **Step 7: Run** — `node --test --test-force-exit tests/report-asset-review.test.js` → pass.

- [ ] **Step 8: pg test** — `tests/pg-report-asset-review.test.js`:

```js
'use strict';
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgrar-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: report_asset_review upsert, getReport, delete', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) return t.skip('Postgres unreachable');
  try {
    process.env.PG_URL = ctx.url;
    const rdb = require('../reports-db');
    await rdb.initPgReports();
    await rdb.initPgReports();                       // 012 is idempotent
    const site = await rdb.createSite({ name: 'AssetSite', zoho_group: 'AssetSite IT' });
    const rep = await rdb.ensureReport(site.id, 2026, 30);
    assert.strictEqual(await rdb.getReportAssetReview(rep.id), null);
    await rdb.saveReportAssetReview(rep.id, { plan_note: 'p' }, 'u');
    await rdb.saveReportAssetReview(rep.id, { applicable: true, counts: { new: 1, unassigned: 0, no_cost: 2, no_date: 3 } }, 's');
    const r = (await rdb.getReport(rep.id)).asset_review;
    assert.deepStrictEqual([r.applicable, r.counts.no_date, r.plan_note], [true, 3, 'p']);
    await rdb.deleteReport(rep.id);
    assert.strictEqual(await rdb.getReportAssetReview(rep.id), null);
  } finally { await dropTestDb(ctx); }
});
```

Run: `node --test --test-force-exit tests/pg-report-asset-review.test.js`.

- [ ] **Step 9: Regression** — `node --test --test-force-exit tests/await-precedence.test.js tests/weekly-report-data.test.js tests/report-template-weekly.test.js tests/pptx-monthly-golden.test.js tests/audit-report-write-auth.smoke.test.js` (+ `tests/pg-reports-reports.test.js` with PG).

- [ ] **Step 10: Commit**

```
git add db/postgres/reports/012_report_asset_review.sql reports-db.js tests/report-asset-review.test.js tests/pg-report-asset-review.test.js
git commit -m "feat(reports): report_asset_review storage (sqlite + pg 012), getReport + delete

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `_assetLabelsForReport` + GET asset-followups + PUT asset-review

**Files:**
- Modify: `server.js` — insert the helpers + two routes immediately **above** `// GET /api/reports/:id/site-open-actions` (line ~6176; above `app.get('/api/reports/:id'` at 6542)
- Test: `tests/asset-review-routes.smoke.test.js` (Create)

- [ ] **Step 1: Write the failing smoke test**

```js
'use strict';
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'asset-review-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'asset-review-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'asset-review-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'asset-review-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, hounde, mana, explo, repH, repPrev, repExplo;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const put = (p, t, b) => fetch(base + p, { method: 'PUT', headers: H(t), body: JSON.stringify(b) });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const adb = require('../assets-db');
  const COLS = ['asset_id', 'asset_name', 'site', 'state', 'user_name', 'department', 'purchase_cost', 'acquisition_date'];
  adb.replaceTable('assets', COLS, [{ asset_id: 'B1', asset_name: 'B', site: 'Hounde', state: 'In Use', user_name: 'x', department: 'IT', purchase_cost: '5', acquisition_date: '2024-01-01' }]);
  adb.recordAssetSightings({ asOf: '2026-07-20' });
  adb.replaceTable('assets', COLS, [
    { asset_id: 'B1', asset_name: 'B', site: 'Hounde', state: 'In Use', user_name: 'x', department: 'IT', purchase_cost: '5', acquisition_date: '2024-01-01' },
    { asset_id: 'N1', asset_name: 'N', site: 'Hounde', state: 'In Use', user_name: '', department: '', purchase_cost: '0.00', acquisition_date: '' },
  ]);
  adb.recordAssetSightings({ asOf: '2026-07-28' });

  const sites = rdb.listSites();
  hounde = sites.find(s => s.name === 'Hounde');
  mana = sites.find(s => s.name === 'MANA');
  explo = sites.find(s => s.name === 'Exploration');
  repPrev = rdb.ensureReport(hounde.id, 2026, 29);
  rdb.saveReportAssetReview(repPrev.id, { applicable: true, counts: { new: 0, unassigned: 3, no_cost: 3, no_date: 3 } }, 'seed');
  repH = rdb.ensureReport(hounde.id, 2026, 30);      // 2026-07-26 .. 2026-08-01
  repExplo = rdb.ensureReport(explo.id, 2026, 30);

  const me = rdb.listUsers().find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['super_admin']);
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.editorH = await mk('ar-editor-h', ['editor'], hounde.id);
  tok.viewerH = await mk('ar-viewer-h', ['viewer'], hounde.id);
  tok.editorM = await mk('ar-editor-m', ['editor'], mana.id);
  tok.editorNoSite = await mk('ar-editor-nosite', ['editor'], null);
  tok.admin = await mk('ar-admin', ['admin'], null);

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('GET asset-followups: same-site viewer 200 with counts, lists, previous_counts', async () => {
  const r = await get(`/api/reports/${repH.id}/asset-followups`, tok.viewerH);
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.applicable, true);
  assert.deepStrictEqual(j.counts, { new: 1, unassigned: 1, no_cost: 1, no_date: 1 });
  assert.deepStrictEqual(j.labels, ['Hounde']);
  assert.strictEqual(j.lists.new[0].asset_id, 'N1');
  assert.deepStrictEqual(j.previous_counts, { new: 0, unassigned: 3, no_cost: 3, no_date: 3 });
  assert.ok(!JSON.stringify(j).includes('purchase_cost'), 'no amount on the wire');
});

test('GET asset-followups: admin (no site) 200; other-site editor 403; site-less editor 403', async () => {
  assert.strictEqual((await get(`/api/reports/${repH.id}/asset-followups`, tok.admin)).status, 200);
  assert.strictEqual((await get(`/api/reports/${repH.id}/asset-followups`, tok.editorM)).status, 403);
  assert.strictEqual((await get(`/api/reports/${repH.id}/asset-followups`, tok.editorNoSite)).status, 403);
  assert.strictEqual((await get(`/api/reports/999999/asset-followups`, tok.super)).status, 404);
});

test('GET asset-followups: site without meetings code → applicable:false', async () => {
  const j = await (await get(`/api/reports/${repExplo.id}/asset-followups`, tok.super)).json();
  assert.strictEqual(j.applicable, false);
  assert.strictEqual(j.counts, null);
});

test('PUT asset-review: server freezes counts (client counts ignored), trims notes', async () => {
  const r = await put(`/api/reports/${repH.id}/asset-review`, tok.editorH,
    { handled_note: '  Tagged N1 ', plan_note: 'Assign user', counts: { new: 99 }, applicable: false });
  assert.strictEqual(r.status, 200);
  const rev = rdb.getReportAssetReview(repH.id);
  assert.deepStrictEqual(rev.counts, { new: 1, unassigned: 1, no_cost: 1, no_date: 1 });
  assert.strictEqual(rev.applicable, true);
  assert.strictEqual(rev.handled_note, 'Tagged N1');
});

test('PUT asset-review: write auth (viewer, other site, site-less → 403)', async () => {
  for (const t of [tok.viewerH, tok.editorM, tok.editorNoSite]) {
    assert.strictEqual((await put(`/api/reports/${repH.id}/asset-review`, t, { plan_note: 'x' })).status, 403);
  }
});
```

- [ ] **Step 2: Run — expect failure** (404 on the new routes).

Run: `node --test --test-force-exit tests/asset-review-routes.smoke.test.js`

- [ ] **Step 3: Implement in `server.js`** (above the `site-open-actions` route):

```js
// ── Asset engagement — weekly "Parc informatique" tab (2026-09-18) ───────────
// report → meetings code (site_module_codes) → the REAL asset labels folded
// FORWARD (never invert ALIAS — see assetHygieneForSite.labelsForCode).
// No code or no label → not applicable (Exploration, Tanda).
async function _assetLabelsForReport(report) {
  const codes = await rdb.listSiteModuleCodes('meetings');
  const hit = (codes || []).find(c => c.site_id === report.site_id);
  if (!hit) return { code: null, labels: [] };
  const lookups = (await require('./assets-db').getAssetLookups()) || {};
  const { labelsForCode } = require('./services/assetHygieneForSite');
  const { assetLabelToCode } = require('./services/scoreboardAliases');
  return { code: hit.code, labels: labelsForCode(lookups.sites, hit.code, assetLabelToCode) };
}
// Window = the report's Zoho week (start_date..end_date). Throws when the assets
// layer throws — callers decide (GET → 503, submission → counts null).
async function _computeAssetReview(report) {
  const { code, labels } = await _assetLabelsForReport(report);
  if (!labels.length) return { applicable: false, code, labels, counts: null, followups: null };
  const followups = await require('./assets-db').getSiteAssetFollowups(labels, { newFrom: report.start_date, newTo: report.end_date });
  return { applicable: true, code, labels, counts: followups.counts, followups };
}
// Read rule: admin+ unscoped; everyone else must be on the report's site (a
// site-less profile is NOT global).
function _assetReviewReadDenial(user, report) {
  if (!report) return { status: 404, error: 'Report not found' };
  if (rdb.userHasRole(user, 'admin')) return null;
  if (!user.site_id || user.site_id !== report.site_id) return { status: 403, error: 'Access denied: this report belongs to another site' };
  return null;
}
const _NOTE_MAX = 4000;
const _cleanNote = v => String(v == null ? '' : v).trim().slice(0, _NOTE_MAX);

// GET /api/reports/:id/asset-followups — the four worklists for the report week
// (first 50 rows each) + the previous report's frozen counts.
app.get('/api/reports/:id/asset-followups', requireReportSession, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const report = Number.isInteger(id) ? await rdb.getReport(id) : null;
    const denial = _assetReviewReadDenial(req.reportUser, report);
    if (denial) return res.status(denial.status).json({ error: denial.error });
    let a;
    try { a = await _computeAssetReview(report); }
    catch (e) {
      console.error('[api/reports/asset-followups] assets layer:', e.message);
      return res.status(503).json({ error: 'Assets data unavailable: ' + e.message });
    }
    const prev = ((await rdb.listReports(report.site_id)) || []).find(r => r.start_date < report.start_date);
    const previous_counts = prev ? ((await rdb.getReportAssetReview(prev.id)) || {}).counts || null : null;
    if (!a.applicable) return res.json({ applicable: false, site_code: a.code, labels: [], counts: null, lists: null, previous_counts: null });
    const f = a.followups, cut = (l) => (l || []).slice(0, 50);
    res.json({
      applicable: true, site_code: a.code, labels: a.labels, counts: a.counts,
      lists: { new: cut(f.new), unassigned: cut(f.unassigned), no_cost: cut(f.no_cost), no_date: cut(f.no_date) },
      window: { from: report.start_date, to: report.end_date }, previous_counts, generated_at: f.generated_at,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/reports/:id/asset-review — notes only; applicable + counts are
// recomputed and frozen here (client values ignored). Write auth = F5 rule.
app.put('/api/reports/:id/asset-review', requireReportSession, jsonBody, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const report = await _authorizeReportWrite(req, res, id);
    if (!report) return;
    const a = await _computeAssetReview(report);
    const saved = await rdb.saveReportAssetReview(id, {
      applicable: a.applicable, counts: a.counts,
      handled_note: _cleanNote(req.body?.handled_note), plan_note: _cleanNote(req.body?.plan_note),
    }, req.reportUser.username);
    await rdb.touchReport(id);
    await rdb.logAudit({ report_id: id, site_id: report.site_id, user_id: req.reportUser.id, username: req.reportUser.username, action: 'edited_asset_review', details: { week_label: report.week_label } });
    res.json(saved);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 4: Run** — `node --test --test-force-exit tests/asset-review-routes.smoke.test.js` → pass.

- [ ] **Step 5: Regression** — `node --test --test-force-exit tests/audit-report-write-auth.smoke.test.js tests/await-precedence.test.js tests/infra-auto-route.smoke.test.js tests/site-open-actions-route.smoke.test.js`.

- [ ] **Step 6: Commit**

```
git add server.js tests/asset-review-routes.smoke.test.js
git commit -m "feat(reports): asset-followups + asset-review routes for the weekly Parc informatique tab

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Freeze the counts at submission (never block)

**Files:**
- Modify: `server.js` — `app.put('/api/reports/:id/status'` (line ~6782)
- Test: `tests/asset-review-status.smoke.test.js` (Create)

- [ ] **Step 1: Write the failing smoke test** — same boot header as Task 5 (copy lines 1-14 of `tests/asset-review-routes.smoke.test.js`, prefix `'asset-status-'`), then:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, adb, hounde, explo;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const put = (p, t, b) => fetch(base + p, { method: 'PUT', headers: H(t), body: JSON.stringify(b) });
const submit = (id, t) => put(`/api/reports/${id}/status`, t, { status: 'submitted' });
const COLS = ['asset_id', 'asset_name', 'site', 'state', 'user_name', 'department', 'purchase_cost', 'acquisition_date'];

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); adb = require('../assets-db');
  adb.replaceTable('assets', COLS, [{ asset_id: 'U1', asset_name: 'U', site: 'Hounde', state: 'In Use', user_name: '', department: '', purchase_cost: '5', acquisition_date: '2024-01-01' }]);
  adb.recordAssetSightings({ asOf: '2026-01-01' });
  const sites = rdb.listSites();
  hounde = sites.find(s => s.name === 'Hounde'); explo = sites.find(s => s.name === 'Exploration');
  const me = rdb.listUsers().find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['super_admin']);
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  const mk = async (u, roles, site_id) => { await rdb.createUser({ username: u, full_name: u, password: u + '-0000', roles, site_id }); return (await rdb.login(u, u + '-0000')).token; };
  tok.editorH = await mk('st-editor-h', ['editor'], hounde.id);
  tok.editorX = await mk('st-editor-x', ['editor'], explo.id);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('empty notes → 200, counts frozen, notes stay empty', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 20);
  const r = await submit(rep.id, tok.editorH);
  assert.strictEqual(r.status, 200);
  const rev = rdb.getReportAssetReview(rep.id);
  assert.deepStrictEqual(rev.counts, { new: 0, unassigned: 1, no_cost: 0, no_date: 0 });
  assert.strictEqual(rev.applicable, true);
  assert.strictEqual(rev.handled_note, null);
  assert.strictEqual(rdb.getReport(rep.id).status, 'submitted');
});

test('filled notes → 200 and notes untouched by the freeze', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 21);
  rdb.saveReportAssetReview(rep.id, { handled_note: 'h', plan_note: 'p' }, 'c');
  assert.strictEqual((await submit(rep.id, tok.editorH)).status, 200);
  const rev = rdb.getReportAssetReview(rep.id);
  assert.deepStrictEqual([rev.handled_note, rev.plan_note, rev.counts.unassigned], ['h', 'p', 1]);
});

test('non-applicable site → 200, applicable:false', async () => {
  const rep = rdb.ensureReport(explo.id, 2026, 21);
  assert.strictEqual((await submit(rep.id, tok.editorX)).status, 200);
  assert.strictEqual(rdb.getReportAssetReview(rep.id).applicable, false);
});

test('assets layer throwing → 200 with null counts', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 22);
  const orig = adb.getSiteAssetFollowups;
  adb.getSiteAssetFollowups = () => { throw new Error('assets down'); };
  try { assert.strictEqual((await submit(rep.id, tok.editorH)).status, 200); }
  finally { adb.getSiteAssetFollowups = orig; }
  assert.strictEqual(rdb.getReportAssetReview(rep.id).counts, null);
  assert.strictEqual(rdb.getReport(rep.id).status, 'submitted');
});

test('re-submitting an already submitted report keeps the frozen counts', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 23);
  await submit(rep.id, tok.editorH);
  const before = rdb.getReportAssetReview(rep.id).counts;
  adb.replaceTable('assets', COLS, []);                            // the register changes afterwards
  assert.strictEqual((await submit(rep.id, tok.super)).status, 200);
  assert.deepStrictEqual(rdb.getReportAssetReview(rep.id).counts, before);
});

test('ready is not a freeze point', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 24);
  assert.strictEqual((await put(`/api/reports/${rep.id}/status`, tok.editorH, { status: 'ready' })).status, 200);
  assert.strictEqual(rdb.getReportAssetReview(rep.id), null);
});
```

- [ ] **Step 2: Run — expect failure** (review null after submit).

Run: `node --test --test-force-exit tests/asset-review-status.smoke.test.js`

- [ ] **Step 3: Implement** — in the status route, directly before `await rdb.updateReportStatus(id, status, req.reportUser.id);`:

```js
    // Asset engagement: freeze the Parc informatique counts at the FIRST submission
    // (a re-submit never re-freezes). Never blocks: empty notes are allowed and an
    // assets failure stores counts=null. The notes are never touched here.
    if (status === 'submitted' && report.status !== 'submitted') {
      try {
        const a = await _computeAssetReview(report);
        await rdb.saveReportAssetReview(id, { applicable: a.applicable, counts: a.counts }, req.reportUser.username);
      } catch (e) {
        console.error('[api/reports/status] asset review freeze failed:', e.message);
        try { await rdb.saveReportAssetReview(id, { counts: null }, req.reportUser.username); } catch (_) { /* never block the submission */ }
      }
    }
```

- [ ] **Step 4: Run** — `node --test --test-force-exit tests/asset-review-status.smoke.test.js` → pass.

- [ ] **Step 5: Regression** — `node --test --test-force-exit tests/asset-review-routes.smoke.test.js tests/audit-report-write-auth.smoke.test.js tests/weekly-send-route.smoke.test.js tests/await-precedence.test.js`.

- [ ] **Step 6: Commit**

```
git add server.js tests/asset-review-status.smoke.test.js
git commit -m "feat(reports): freeze Parc informatique counts at first submission (never blocks)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Editor — tab 5, done-counting fix, submit note

**Files:**
- Modify: `public/reports.html`:
  - tab strip lines 494-499 (add `stab-4`)
  - new `section-4` markup immediately before `<!-- Submit bar -->` (~line 797)
  - `showSection` (line ~2661): loop `i<5`
  - `renderForm` (line ~2676): call `_markSectionTabsFromData()` + `loadAssetFollowups()`
  - `saveSection` (line ~4507): `n === 4` branch
  - `_afterSectionSaved` (line ~4579)
  - `autoSaveSection` (line ~4616): `n === 4` branch
  - `wireAutoSave` (line ~4666): add `['section-4', 4]`
  - `submitReport` (line ~4704)
- Test: `tests/reports-editor-asset-tab.test.js` (Create)

- [ ] **Step 1: Write the failing static/DOM test**

```js
'use strict';
// Static + mini-DOM checks on public/reports.html (the page is behind a session,
// so the browser check stays an owner step). Proves: the 5th weekly tab exists
// inside the WEEKLY strip only, the done-count reads the weekly strip (the old
// '.stab.done' matched nothing), auto-ready needs 5, and tab 4 is never ticked
// by a plain save.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'reports.html'), 'utf8');

function fnSource(name) {
  const start = src.indexOf(`async function ${name}(`) >= 0 ? src.indexOf(`async function ${name}(`) : src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

test('weekly strip has stab-4 "5 · Parc informatique"; monthly strip untouched', () => {
  const weekly = src.slice(src.indexOf('id="section-tabs"'), src.indexOf('<!-- Section 0'));
  assert.match(weekly, /id="stab-4"[^>]*>5 · Parc informatique</);
  assert.ok(src.includes('id="section-4"'));
  assert.ok(src.includes('id="mr-stab-4"'), 'monthly Annual Objectives tab still there');
});

test("no '.stab.done' selector remains", () => {
  assert.ok(!src.includes(".stab.done"), 'the dead selector must be gone');
});

test('_afterSectionSaved counts the weekly strip only and needs 5 for ready', async () => {
  const code = fnSource('_afterSectionSaved');
  const calls = [];
  const tabs = {};
  const document = {
    getElementById: (id) => (tabs[id] = tabs[id] || { cls: new Set(), classList: { add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } } }, tabs[id].classList._s = tabs[id].cls, tabs[id]),
    querySelectorAll: (sel) => { calls.push(sel); return { length: sel === '#section-tabs .section-tab.done' ? 5 : 99 }; },
  };
  let status = null;
  const api = async (m, p, b) => { status = b.status; };
  const currentReport = { id: 1, status: 'in_progress' };
  const updateStatusBar = () => {};
  const fn = new Function('document', 'api', 'currentReport', 'updateStatusBar', `${code}; return _afterSectionSaved;`)(document, api, currentReport, updateStatusBar);
  await fn(4);
  assert.deepStrictEqual(calls, ['#section-tabs .section-tab.done']);
  assert.strictEqual(status, 'ready');
  assert.ok(!tabs['stab-4'].cls.has('done'), 'tab 4 is not ticked by _afterSectionSaved');
});

test('showSection iterates 5 sections; autosave wires section-4', () => {
  assert.match(fnSource('showSection'), /i\s*<\s*5/);
  assert.ok(src.includes("['section-4', 4]"));
});

test('submitReport warns (but allows) when the applicable tab has an empty note', () => {
  const code = fnSource('submitReport');
  assert.ok(code.includes("n'est pas renseignée"));
  assert.ok(code.includes('confirm('));
});
```

- [ ] **Step 2: Run — expect failure** (`stab-4` missing).

Run: `node --test --test-force-exit tests/reports-editor-asset-tab.test.js`

- [ ] **Step 3: Tab + section markup**

Tab strip — after the `stab-3` button add:

```html
      <button class="section-tab" onclick="showSection(4)" id="stab-4">5 · Parc informatique</button>
```

Before `<!-- Submit bar -->` add:

```html
    <!-- Section 4: Parc informatique (asset engagement, 2026-09-18). The four counts are
         computed by the server for the report week and frozen at submission; the two notes
         are optional — an empty note is shown as « non renseigné » in the weekly e-mail. -->
    <div id="section-4" style="display:none">
      <div class="card">
        <h3><span class="section-num">5</span> Parc informatique</h3>
        <div id="asset-review-body"><div style="color:#94a3b8;font-style:italic">Chargement…</div></div>
        <div class="form-group" style="margin-top:12px">
          <label>Traité cette semaine</label>
          <textarea id="ar-handled-note" rows="3" style="width:100%" placeholder="Ex. 3 PC étiquetés, 2 utilisateurs affectés…"></textarea>
        </div>
        <div class="form-group">
          <label>Plan / blocages</label>
          <textarea id="ar-plan-note" rows="3" style="width:100%" placeholder="Ex. coûts en attente de la comptabilité…"></textarea>
        </div>
        <div style="font-size:0.78rem;color:#64748b">Facultatif — une note vide apparaîtra « non renseigné » dans le rapport envoyé.</div>
        <div style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="saveSection(4)">Enregistrer</button></div>
      </div>
    </div>
```

- [ ] **Step 4: Tab logic** — `showSection`: change `for (let i=0;i<4;i++)` to `for (let i=0;i<5;i++)`. In `renderForm`, after `renderActions();` add:

```js
  _markSectionTabsFromData();
  loadAssetFollowups();
```

Add these functions right after `renderForm`:

```js
// Tabs are marked done from what is already saved (they used to be marked only on
// a save in the current session, and the class leaked from one report to the next).
function _assetReviewDone(ar) {
  return !!ar && (ar.applicable === false ||
    (String(ar.handled_note || '').trim() !== '' && String(ar.plan_note || '').trim() !== ''));
}
function _markSectionTabsFromData() {
  const r = currentReport || {};
  for (let i = 0; i < 5; i++) { const t = document.getElementById('stab-' + i); if (t) t.classList.remove('done'); }
  const mark = (i, on) => { const t = document.getElementById('stab-' + i); if (t && on) t.classList.add('done'); };
  mark(0, (r.infra_kpis || []).length > 0);
  mark(1, !!(r.helpdesk && (r.helpdesk.fetched_at || r.helpdesk.updated_at)));
  mark(2, (r.lights || []).length > 0);
  mark(3, (r.action_items || []).length > 0);
  mark(4, _assetReviewDone(r.asset_review));
}

let _assetFollowups = null;   // last /asset-followups payload for the open report
const _AR_KINDS = [
  ['new', 'Nouveau matériel (semaine)', '#inventory', null],
  ['unassigned', 'En service sans utilisateur ni département', '#inventory', null],
  ['no_cost', "Sans coût d'achat", '#hygiene', 'no_cost'],
  ['no_date', "Sans date d'acquisition", '#hygiene', 'no_age'],
];
function _assetNotesFilled() {
  return !!document.getElementById('ar-handled-note').value.trim() && !!document.getElementById('ar-plan-note').value.trim();
}
async function loadAssetFollowups() {
  const box = document.getElementById('asset-review-body');
  const r = currentReport; if (!r || !box) return;
  const ar = r.asset_review || {};
  document.getElementById('ar-handled-note').value = ar.handled_note || '';
  document.getElementById('ar-plan-note').value = ar.plan_note || '';
  ['ar-handled-note', 'ar-plan-note'].forEach(id => { document.getElementById(id).disabled = !_reportEditable(); });
  _assetFollowups = null;
  box.innerHTML = '<div style="color:#94a3b8;font-style:italic">Chargement…</div>';
  try {
    _assetFollowups = await api('GET', `/api/reports/${r.id}/asset-followups`);
    renderAssetReview();
  } catch (e) {
    box.innerHTML = `<div style="color:#b91c1c">Données du parc indisponibles : ${esc(e)}</div>`;
  }
}
function renderAssetReview() {
  const box = document.getElementById('asset-review-body');
  const d = _assetFollowups; if (!box || !d) return;
  const tab = document.getElementById('stab-4');
  if (!d.applicable) {
    box.innerHTML = '<div style="color:#64748b">Aucun matériel rattaché à ce site.</div>';
    if (tab) tab.classList.add('done');
    return;
  }
  const submitted = currentReport.status === 'submitted' && currentReport.asset_review && currentReport.asset_review.counts;
  const counts = submitted ? currentReport.asset_review.counts : d.counts;
  const prev = d.previous_counts || null;
  const oneLabel = (d.labels || []).length === 1 ? d.labels[0] : null;
  const cards = _AR_KINDS.map(([k, label, hash, kind]) => {
    const v = Number(counts[k] || 0);
    let delta = '';
    if (prev && prev[k] != null) {
      const dv = v - Number(prev[k]);
      delta = dv === 0 ? '<span style="color:#64748b">= sem. préc.</span>'
        : `<span style="color:${dv > 0 ? '#b91c1c' : '#15803d'}">${dv > 0 ? '▲ +' : '▼ '}${dv} vs sem. préc.</span>`;
    }
    const href = oneLabel ? `assets.html?site=${encodeURIComponent(oneLabel)}${kind ? '&kind=' + kind : ''}${hash}` : null;
    const link = href ? `<a href="${esc(href)}" target="_blank" style="font-size:0.75rem">voir dans Assets ›</a>` : '';
    return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;min-width:170px;flex:1">
      <div style="font-size:1.4rem;font-weight:700;color:#1e3a5f">${v}</div>
      <div style="font-size:0.8rem;color:#334155">${esc(label)}</div>
      <div style="font-size:0.75rem">${delta}</div>${link}</div>`;
  }).join('');
  const cols = [['asset_name', 'Nom'], ['product_type', 'Type'], ['manufacturer', 'Fabricant'], ['serial_number', 'N° série'],
    ['state', 'État'], ['user_name', 'Utilisateur'], ['department', 'Département'], ['acquisition_date', 'Date acq.']];
  const lists = _AR_KINDS.map(([k, label]) => {
    const rows = (d.lists && d.lists[k]) || [];
    if (!rows.length) return '';
    const head = cols.map(c => `<th>${c[1]}</th>`).join('') + '<th>Coût renseigné</th>' + (k === 'new' ? '<th>Vu le</th>' : '');
    const body = rows.map(x => '<tr>' + cols.map(c => `<td>${esc(x[c[0]] || '—')}</td>`).join('') +
      `<td>${x.has_cost ? 'Oui' : 'Non'}</td>` + (k === 'new' ? `<td>${esc(x.first_seen_date || '')}</td>` : '') + '</tr>').join('');
    const more = Number(counts[k] || 0) > rows.length ? `<div style="font-size:0.75rem;color:#64748b">50 premières lignes sur ${Number(counts[k])}.</div>` : '';
    return `<details style="margin-top:8px"><summary>${esc(label)} (${rows.length})</summary>
      <table class="user-table" style="font-size:0.78rem"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${more}</details>`;
  }).join('');
  const note = submitted ? '<div style="font-size:0.75rem;color:#64748b;margin-bottom:6px">Compteurs figés à la soumission.</div>' : '';
  box.innerHTML = `${note}<div style="display:flex;gap:10px;flex-wrap:wrap">${cards}</div>${lists}`;
  if (tab) tab.classList.toggle('done', _assetReviewDone(currentReport.asset_review));
}
function collectAssetReview() {
  return { handled_note: document.getElementById('ar-handled-note').value, plan_note: document.getElementById('ar-plan-note').value };
}
```

- [ ] **Step 5: Save paths**

`saveSection` — add before the closing `}` of the `n === 3` branch chain (i.e. after the `n === 3` block):

```js
    } else if (n === 4) {
      const rev = await api('PUT', `/api/reports/${id}/asset-review`, collectAssetReview());
      currentReport.asset_review = rev;
      document.getElementById('stab-4').classList.toggle('done', _assetReviewDone(rev));
```

`autoSaveSection` — before `} else { return; }` add:

```js
    } else if (n === 4) {
      _autoSaveBusy = true; setSaving('saving');
      const rev = await api('PUT', `/api/reports/${id}/asset-review`, collectAssetReview());
      currentReport.asset_review = rev;
      document.getElementById('stab-4').classList.toggle('done', _assetReviewDone(rev));
```

`wireAutoSave`: `[['section-0', 0], ['section-1', 1], ['section-2', 2], ['section-3', 3], ['section-4', 4]]`.

Replace `_afterSectionSaved` with:

```js
async function _afterSectionSaved(n) {
  // Tab 4 (Parc informatique) has its own done rule (both notes, or not applicable),
  // applied by its save path — a plain save of an empty note must not tick it.
  const tab = document.getElementById('stab-' + n);
  if (tab && n !== 4) tab.classList.add('done');
  if (!currentReport || !['draft','in_progress'].includes(currentReport.status)) return;
  // Weekly strip ONLY (the monthly editor also uses .section-tab). The old
  // '.stab.done' selector matched nothing, so auto-ready never fired.
  const doneCnt = document.querySelectorAll('#section-tabs .section-tab.done').length;
  const newStatus = doneCnt >= 5 ? 'ready' : (doneCnt >= 1 ? 'in_progress' : null);
  if (newStatus && newStatus !== currentReport.status) {
    try {
      await api('PUT', `/api/reports/${currentReport.id}/status`, { status: newStatus });
      currentReport.status = newStatus;
      updateStatusBar();
    } catch(e) { /* status auto-advance failed silently */ }
  }
}
```

Replace `submitReport` with:

```js
async function submitReport() {
  if (!currentReport) return;
  // Send a pending notes autosave first — after submission only a super_admin may write.
  if (_autoSaveTimers[4]) await autoSaveSection(4);
  if (_assetFollowups && _assetFollowups.applicable && !_assetNotesFilled()) {
    if (!confirm("La section Parc informatique n'est pas renseignée — elle apparaîtra comme « non renseigné » dans le rapport.\n\nSoumettre quand même ?")) return;
  }
  try {
    await api('PUT', `/api/reports/${currentReport.id}/status`, { status: 'submitted' });
    currentReport.status = 'submitted';
    currentReport.submitted_at = new Date().toISOString();
    updateStatusBar();
    loadAuditLog();
    toast('Report submitted ✅', 'success');
    try { currentReport = await api('GET', `/api/reports/${currentReport.id}`); loadAssetFollowups(); } catch (_) {}
  } catch(e) { toast('Submit failed: ' + e, 'error'); }
}
```

- [ ] **Step 6: Run** — `node --test --test-force-exit tests/reports-editor-asset-tab.test.js` → pass. Syntax check of the inline scripts: `node -e "const s=require('fs').readFileSync('public/reports.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,i=0;while((m=re.exec(s))){new Function(m[1]);i++}console.log('ok',i)"`.

- [ ] **Step 7: Regression** — `node --test --test-force-exit tests/admin-superadmin-gate.smoke.test.js tests/site-actions-register.test.js tests/send-reports-cli.test.js`.

- [ ] **Step 8: Commit**

```
git add public/reports.html tests/reports-editor-asset-tab.test.js
git commit -m "feat(reports-ui): weekly tab 5 Parc informatique, working auto-ready, submit note

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Weekly e-mail — frozen counts + "non renseigné"

**Files:**
- Modify: `services/reportTemplates/weekly.js` — `assetsSection` (line 277) + its call in `composeWeekly` (line 377)
- Test: `tests/report-template-weekly.test.js` (append tests)

- [ ] **Step 1: Append failing tests** to `tests/report-template-weekly.test.js`:

```js
// ── asset engagement review (2026-09-18) ─────────────────────────────────────
test('absent / null / non-applicable asset_review → byte-identical output', () => {
  const base = composeWeekly(fixture()).htmlBody;
  for (const ar of [undefined, null, { applicable: false, counts: null, handled_note: '', plan_note: '' }]) {
    const f = fixture(); if (ar !== undefined) f.report.asset_review = ar;
    assert.strictEqual(composeWeekly(f).htmlBody, base);
  }
});

test('applicable review renders frozen counts and the notes; empty note = non renseigné', () => {
  const f = fixture();
  f.report.asset_review = { applicable: true, counts: { new: 2, unassigned: 5, no_cost: 7, no_date: 1 }, handled_note: '', plan_note: 'Commande <étiquettes>' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /Nouveau matériel/);
  assert.match(htmlBody, />7</);
  assert.match(htmlBody, /non renseign&eacute;/);
  assert.match(htmlBody, /Commande &lt;étiquettes&gt;/, 'notes are escaped');
  assert.ok(!htmlBody.includes('<étiquettes>'));
});

test('counts null (assets down at submission) says so, notes still shown', () => {
  const f = fixture();
  f.report.asset_review = { applicable: true, counts: null, handled_note: 'ok', plan_note: 'ok2' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /Compteurs non disponibles/);
  assert.match(htmlBody, /ok2/);
});
```

- [ ] **Step 2: Run — expect failure** (review not rendered).

Run: `node --test --test-force-exit tests/report-template-weekly.test.js`

- [ ] **Step 3: Implement** — above `assetsSection` add:

```js
// Asset engagement (2026-09-18): the coordinator's own "Parc informatique" tab,
// counts FROZEN at submission (never live). Empty note on an applicable site =
// « non renseigné » on purpose — visible for the meeting, never hidden.
// kpiGrid escapes its labels → literal accents here, not entities.
const REVIEW_KPIS = [
  ['new', 'Nouveau matériel (semaine)'],
  ['unassigned', 'En service sans utilisateur ni département'],
  ['no_cost', 'Sans coût d’achat'],
  ['no_date', 'Sans date d’acquisition'],
];
function assetReviewBlock(review) {
  const rv = review && typeof review === 'object' ? review : null;
  if (!rv || rv.applicable === false || rv.applicable === 0) return '';
  const c = rv.counts && typeof rv.counts === 'object' ? rv.counts : null;
  const counts = c
    ? kpiGrid(REVIEW_KPIS.map(([k, label]) => ({ label, value: String(num(c[k])) })))
    : staticNote('Compteurs non disponibles au moment de la soumission.');
  const note = (v) => {
    const s = String(v == null ? '' : v).trim();
    return s ? escapeHtml(s) : `<em style="color:${MUTED};">non renseign&eacute;</em>`;
  };
  return `<div style="padding-top:12px;">
${staticNote('Suivi du parc d&eacute;clar&eacute; par le coordinateur &mdash; compteurs fig&eacute;s &agrave; la soumission.')}
<div style="padding-top:6px;">${counts}</div>
<div style="font-family:${FONT};font-size:13px;color:${INK};line-height:1.5;padding-top:4px;"><strong>Trait&eacute; cette semaine&nbsp;:</strong> ${note(rv.handled_note)}</div>
<div style="font-family:${FONT};font-size:13px;color:${INK};line-height:1.5;padding-top:4px;"><strong>Plan / blocages&nbsp;:</strong> ${note(rv.plan_note)}</div>
</div>`;
}
```

Change the signature to `function assetsSection(assets, baseUrl, labels, review) {` and the final return to:

```js
  return card('Parc informatique', `${effortBlock}${intro}<div style="padding-top:8px;">${list}</div>${assetReviewBlock(review)}`, TEAL);
```

In `composeWeekly` change the call to:

```js
    d.assets ? assetsSection(d.assets, d.base_url, d.assets.labels, r.asset_review) : '',
```

(`assetReviewBlock` returns `''` for absent/non-applicable review, so those outputs are byte-identical.)

- [ ] **Step 4: Run** — `node --test --test-force-exit tests/report-template-weekly.test.js` → pass.

- [ ] **Step 5: Regression (goldens)** — `node --test --test-force-exit tests/report-template-primitives.test.js tests/report-template-coordinator.test.js tests/weekly-report-data.test.js tests/send-weekly-report.test.js tests/send-weekly-cli.test.js` — the two monthly goldens must stay byte-identical (do NOT regenerate them).

- [ ] **Step 6: Commit**

```
git add services/reportTemplates/weekly.js tests/report-template-weekly.test.js
git commit -m "feat(weekly-email): show frozen Parc informatique counts and notes (non renseigné)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Directory — asset manager contact

**Files:**
- Modify: `services/reportDirectory.js` — `COLS` (line 7), `_initSchema` (line 17), `resolveFromRows` (line 65)
- Modify: `reports-db.js` — `initPgReports`, right after the 012 exec from Task 4
- Test: `tests/report-directory.test.js` (append)

- [ ] **Step 1: Append failing tests**

```js
test('asset manager columns persist through upsertRecipient', () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { asset_manager_name: 'Awa', asset_manager_email: 'awa@edv-ops.com', asset_manager_email_confirmed: 1 }, 'a');
  const r = dir.listRecipients(db)[0];
  assert.deepStrictEqual([r.asset_manager_name, r.asset_manager_email, r.asset_manager_email_confirmed], ['Awa', 'awa@edv-ops.com', 1]);
});

test('asset_manager resolves only when confirmed', () => {
  const rows = [{ site_code: 'HGO', asset_manager_email: 'am@x', asset_manager_email_confirmed: 1, coordinator_email: 'c@x', coordinator_email_confirmed: 1, cc_emails: '' }];
  assert.deepStrictEqual(dir.resolveFromRows(rows, 'HGO', 'asset_manager'), { to: 'am@x', cc: [] });
  rows[0].asset_manager_email_confirmed = 0;
  assert.strictEqual(dir.resolveFromRows(rows, 'HGO', 'asset_manager'), null, 'unconfirmed never used');
  assert.deepStrictEqual(dir.resolveFromRows(rows, 'HGO', 'coordinator'), { to: 'c@x', cc: [] }, 'coordinator fallback still resolves');
});

test('an existing pre-asset-manager table is migrated by _initSchema', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_recipients (site_code TEXT PRIMARY KEY, site_name TEXT, coordinator_name TEXT, coordinator_email TEXT,
    coordinator_email_confirmed INTEGER DEFAULT 0, fm_name TEXT, fm_email TEXT, fm_email_confirmed INTEGER DEFAULT 0,
    cc_emails TEXT, active INTEGER DEFAULT 1, updated_at TIMESTAMP, updated_by TEXT)`);
  dir._initSchema(db);
  dir.upsertRecipient(db, 'MGO', { asset_manager_email: 'x@y' }, 'a');
  assert.strictEqual(dir.listRecipients(db)[0].asset_manager_email, 'x@y');
});
```

- [ ] **Step 2: Run — expect failure.** `node --test --test-force-exit tests/report-directory.test.js`

- [ ] **Step 3: Implement** — `reportDirectory.js`:

```js
const COLS = ['site_name', 'coordinator_name', 'coordinator_email', 'coordinator_email_confirmed',
  'fm_name', 'fm_email', 'fm_email_confirmed', 'cc_emails', 'active',
  'asset_manager_name', 'asset_manager_email', 'asset_manager_email_confirmed'];
```

In `_initSchema`, after the CREATE `db.exec(...)` and before `_inited.add(db);`:

```js
  // Asset engagement (2026-09-18) — per-site asset manager. sqlite has no ADD COLUMN
  // IF NOT EXISTS → plain ALTER in try/catch (duplicate column = already migrated).
  for (const c of ['asset_manager_name TEXT', 'asset_manager_email TEXT', 'asset_manager_email_confirmed INTEGER DEFAULT 0']) {
    try { db.exec(`ALTER TABLE report_recipients ADD COLUMN ${c}`); } catch (_) { /* already present */ }
  }
```

Replace the two lines in `resolveFromRows` that pick the email/confirmed:

```js
  const F = { fm: ['fm_email', 'fm_email_confirmed'], asset_manager: ['asset_manager_email', 'asset_manager_email_confirmed'] }[kind]
    || ['coordinator_email', 'coordinator_email_confirmed'];
  const email = row[F[0]];
  const confirmed = row[F[1]];
```

`reports-db.js` `initPgReports`, after the 012 exec:

```js
  for (const c of ['asset_manager_name TEXT', 'asset_manager_email TEXT', 'asset_manager_email_confirmed INTEGER DEFAULT 0']) {
    await _pg.exec(`ALTER TABLE report_recipients ADD COLUMN IF NOT EXISTS ${c}`);
  }
```

- [ ] **Step 4: Run** — `node --test --test-force-exit tests/report-directory.test.js` → pass.

- [ ] **Step 5: Regression** — `node --test --test-force-exit tests/send-reports-cli.test.js tests/send-weekly-cli.test.js tests/send-weekly-report.test.js tests/pg-reporting.test.js` (pg one with PG).

- [ ] **Step 6: Commit**

```
git add services/reportDirectory.js reports-db.js tests/report-directory.test.js
git commit -m "feat(directory): per-site asset manager contact (confirmed-only resolution)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Composer `services/assetReminderReport.js`

**Files:**
- Create: `services/assetReminderReport.js`
- Test: `tests/asset-reminder-report.test.js` (Create)

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const { buildAssetRecap, buildNewAssetAlert } = require('../services/assetReminderReport');

const row = (id, extra = {}) => ({ asset_id: id, asset_name: 'PC-' + id, product_type: 'Laptop', manufacturer: 'Dell',
  serial_number: 'S' + id, state: 'In Use', site: 'Hounde', user_name: '', department: '', acquisition_date: '', has_cost: false, ...extra });
const followups = () => ({
  counts: { new: 1, unassigned: 25, no_cost: 0, no_date: 2 },
  new: [row('N1', { first_seen_date: '2026-07-28' })],
  unassigned: Array.from({ length: 25 }, (_, i) => row('U' + i)),
  no_cost: [], no_date: [row('D1'), row('D2')],
});

test('recap: subject, counts, first 20 rows, no money glyph', () => {
  const r = buildAssetRecap({ site: 'HGO', followups: followups(), baseUrl: '', weekLabel: 'W30 2026', labels: ['Hounde'] });
  assert.match(r.subject, /HGO/);
  assert.match(r.subject, /W30 2026/);
  assert.match(r.html, /25/);
  assert.ok(r.html.includes('PC-U19') && !r.html.includes('PC-U20'), 'first 20 rows only in the body');
  assert.ok(!r.html.includes('$'));
  assert.ok(!/purchase_cost|book_value/.test(r.html));
});

test('recap: xlsx named assets-suivi-<SITE>-<YYYY>-W<nn>.xlsx, one sheet per non-empty list, full rows', () => {
  const r = buildAssetRecap({ site: 'HGO', followups: followups(), baseUrl: '', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'] });
  assert.strictEqual(r.attachments[0].filename, 'assets-suivi-HGO-2026-W30.xlsx');
  const wb = XLSX.read(r.attachments[0].content);
  assert.deepStrictEqual(wb.SheetNames, ['Nouveau', 'Sans affectation', 'Sans date']);
  assert.strictEqual(XLSX.utils.sheet_to_json(wb.Sheets['Sans affectation']).length, 25);
});

test('recap: links only with baseUrl AND a single label', () => {
  const withLink = buildAssetRecap({ site: 'HGO', followups: followups(), baseUrl: 'https://x.test', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'] });
  assert.match(withLink.html, /https:\/\/x\.test\/assets\.html\?site=Hounde/);
  const multi = buildAssetRecap({ site: 'SGO', followups: followups(), baseUrl: 'https://x.test', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Sabodala', 'MASSAWA'] });
  assert.ok(!multi.html.includes('assets.html'));
});

test('recap escapes untrusted asset names', () => {
  const f = followups(); f.new[0].asset_name = '<img src=x>';
  const r = buildAssetRecap({ site: 'HGO', followups: f, baseUrl: '', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'] });
  assert.ok(!r.html.includes('<img src=x>'));
});

test('new-asset alert: short list, date in subject, no attachment', () => {
  const r = buildNewAssetAlert({ site: 'HGO', rows: [row('N1', { first_seen_date: '2026-07-28' })], baseUrl: '', date: '2026-07-28', labels: ['Hounde'] });
  assert.match(r.subject, /HGO/);
  assert.match(r.subject, /2026-07-28/);
  assert.match(r.html, /PC-N1/);
  assert.deepStrictEqual(r.attachments, []);
});
```

- [ ] **Step 2: Run — expect failure** (module not found). `node --test --test-force-exit tests/asset-reminder-report.test.js`

- [ ] **Step 3: Implement** — `services/assetReminderReport.js`:

```js
'use strict';
// Asset engagement reminders (2026-09-18) — PURE composer, French, NO amounts.
//   buildAssetRecap({ site, followups, baseUrl, weekLabel, year, week, labels }) → { subject, html, attachments }
//   buildNewAssetAlert({ site, rows, baseUrl, date, labels })                   → { subject, html, attachments: [] }
// Every asset field is untrusted → escapeHtml. Links only when baseUrl is set AND
// the site folds to exactly ONE asset label (a multi-label link would open a
// smaller list than the count promises — same rule as the weekly e-mail).
const { NAVY, TEAL, MUTED, WASH, FONT, escapeHtml, num, card, kpiGrid } = require('./reportTemplates/_primitives');
const tableExcel = require('./tableExcel');

const LISTS = [
  ['new', 'Nouveau matériel', 'Nouveau', '#inventory', null],
  ['unassigned', 'En service sans utilisateur ni département', 'Sans affectation', '#inventory', null],
  ['no_cost', 'Sans coût d’achat', 'Sans cout', '#hygiene', 'no_cost'],
  ['no_date', 'Sans date d’acquisition', 'Sans date', '#hygiene', 'no_age'],
];
const COLS = [['asset_name', 'Nom'], ['product_type', 'Type'], ['manufacturer', 'Fabricant'], ['serial_number', 'N° série'],
  ['state', 'État'], ['user_name', 'Utilisateur'], ['department', 'Département'], ['acquisition_date', 'Date d’acquisition']];

function _link(baseUrl, labels, hash, kind) {
  if (!baseUrl || !Array.isArray(labels) || labels.length !== 1) return null;
  return `${baseUrl}/assets.html?site=${encodeURIComponent(labels[0])}${kind ? '&kind=' + encodeURIComponent(kind) : ''}${hash}`;
}
function _table(rows, withSeen) {
  const th = (t) => `<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #E2E5EA;font-family:${FONT};font-size:11px;color:${MUTED};">${escapeHtml(t)}</th>`;
  const td = (t) => `<td style="padding:4px 6px;border-bottom:1px solid #F1F3F6;font-family:${FONT};font-size:12px;">${escapeHtml(t == null || t === '' ? '—' : t)}</td>`;
  const head = COLS.map(c => th(c[1])).join('') + th('Coût renseigné') + (withSeen ? th('Vu le') : '');
  const body = rows.map(r => `<tr>${COLS.map(c => td(r[c[0]])).join('')}${td(r.has_cost ? 'Oui' : 'Non')}${withSeen ? td(r.first_seen_date) : ''}</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr>${head}</tr>${body}</table>`;
}
function _xlsxRows(rows, withSeen) {
  return (rows || []).map(r => {
    const o = {};
    for (const [k, h] of COLS) o[h] = r[k] == null ? '' : r[k];
    o['Coût renseigné'] = r.has_cost ? 'Oui' : 'Non';
    if (withSeen) o['Vu le'] = r.first_seen_date || '';
    return o;
  });
}
function _shell(subject, inner) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${WASH};">
<tr><td align="center" style="padding:16px 10px;"><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;"><tr><td>
<div style="font-family:${FONT};font-size:18px;font-weight:bold;color:${NAVY};padding:0 2px 12px 2px;">${escapeHtml(subject)}</div>
${inner}
<div style="font-family:${FONT};font-size:11px;color:${MUTED};padding:4px 2px;">Endeavour Mining &middot; IT Operations &middot; message automatique du SDP Dashboard. Corrigez ces fiches dans l&rsquo;inventaire (AssetExplorer) ; elles disparaissent de cette liste apr&egrave;s la synchronisation nocturne.</div>
</td></tr></table></td></tr></table>`;
}

function buildAssetRecap({ site, followups, baseUrl, weekLabel, year, week, labels } = {}) {
  const f = followups || {};
  const c = f.counts || {};
  const subject = `Suivi du parc informatique - ${site} - ${weekLabel || ''}`.trim();
  const kpis = kpiGrid(LISTS.map(([k, label]) => ({ label, value: String(num(c[k])) })));
  const blocks = LISTS.map(([k, label, , hash, kind]) => {
    const rows = Array.isArray(f[k]) ? f[k] : [];
    if (!rows.length) return '';
    const href = _link(baseUrl, labels, hash, kind);
    const more = num(c[k]) > 20 ? `<div style="font-family:${FONT};font-size:11px;color:${MUTED};padding-top:4px;">20 premi&egrave;res lignes sur ${escapeHtml(num(c[k]))} &mdash; liste compl&egrave;te en pi&egrave;ce jointe.</div>` : '';
    const link = href ? `<div style="padding-top:6px;"><a href="${escapeHtml(href)}" style="color:${NAVY};font-family:${FONT};font-size:12px;">Voir dans Assets</a></div>` : '';
    return card(`${label} (${num(c[k])})`, _table(rows.slice(0, 20), k === 'new') + more + link, TEAL);
  }).join('\n');
  const html = _shell(subject, card('Synthèse', kpis, NAVY) + '\n' + blocks);
  const sheets = LISTS.filter(([k]) => Array.isArray(f[k]) && f[k].length)
    .map(([k, , sheet]) => ({ name: sheet, rows: _xlsxRows(f[k], k === 'new') }));
  const ww = String(week == null ? '' : week).padStart(2, '0');
  return { subject, html, attachments: [{ filename: `assets-suivi-${site}-${year}-W${ww}.xlsx`, content: tableExcel.buildWorkbook(sheets) }] };
}

function buildNewAssetAlert({ site, rows, baseUrl, date, labels } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const subject = `Nouveau matériel détecté - ${site} - ${date}`;
  const href = _link(baseUrl, labels, '#inventory', null);
  const link = href ? `<div style="padding-top:6px;"><a href="${escapeHtml(href)}" style="color:${NAVY};font-family:${FONT};font-size:12px;">Voir dans Assets</a></div>` : '';
  const intro = `<div style="font-family:${FONT};font-size:13px;padding-bottom:8px;">${escapeHtml(list.length)} nouvel(le)(s) &eacute;quipement(s) vu(s) pour la premi&egrave;re fois lors de la synchronisation du ${escapeHtml(date)}. Merci de compl&eacute;ter utilisateur, d&eacute;partement, co&ucirc;t et date d&rsquo;acquisition.</div>`;
  return { subject, html: _shell(subject, card('Nouveau matériel', intro + _table(list, true) + link, TEAL)), attachments: [] };
}

module.exports = { buildAssetRecap, buildNewAssetAlert };
```

- [ ] **Step 4: Run** — `node --test --test-force-exit tests/asset-reminder-report.test.js` → pass.

- [ ] **Step 5: Commit**

```
git add services/assetReminderReport.js tests/asset-reminder-report.test.js
git commit -m "feat(assets): pure French composer for the asset reminder e-mails

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: CLI `send-asset-reminders.js` + config DEFAULTS + schedule type

**Files:**
- Create: `tools/reports/send-asset-reminders.js`
- Modify: `services/reportConfig.js` (`DEFAULTS`, after `asset_group_recipients`), `services/reportSchedule.js` (constants line 14, `TYPES` line 16, `cliFor` line 24)
- Test: `tests/send-asset-reminders.test.js`, `tests/report-config-asset-reminders.test.js`, `tests/report-schedule-asset-reminder.test.js` (Create)

- [ ] **Step 1: Config + schedule failing tests**

`tests/report-config-asset-reminders.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const cfg = require('../services/reportConfig');
function freshDb() { const db = new Database(':memory:'); cfg._initSchema(db); return db; }

test('asset reminder keys are in DEFAULTS, armed OFF', () => {
  assert.strictEqual(cfg.DEFAULTS.asset_reminder_send_enabled, '0');
  assert.strictEqual(cfg.DEFAULTS.asset_new_alert_enabled, '0');
});
test('setConfig round-trips both keys (else the admin write is silently dropped)', () => {
  const db = freshDb();
  cfg.setConfig(db, { asset_reminder_send_enabled: '1', asset_new_alert_enabled: '1' }, 'u');
  const all = cfg.getConfig(db);
  assert.deepStrictEqual([all.asset_reminder_send_enabled, all.asset_new_alert_enabled], ['1', '1']);
});
```

`tests/report-schedule-asset-reminder.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const rs = require('../services/reportSchedule');
function freshDb() { const db = new Database(':memory:'); rs._initSchema(db); return db; }

test('cliFor(asset_reminder) → send-asset-reminders.js; others unchanged', () => {
  assert.ok(rs.cliFor('asset_reminder').endsWith('send-asset-reminders.js'));
  assert.ok(rs.cliFor('weekly_report').endsWith('send-weekly.js'));
  assert.ok(rs.cliFor('coordinator').endsWith('send-reports.js'));
});
test('setSchedule accepts asset_reminder WEEKLY MON 07:00', async () => {
  const db = freshDb();
  let spec = null;
  const r = await rs.setSchedule(db, { report_type: 'asset_reminder', cadence: 'weekly', enabled: true, day: 'MON', time: '07:00' }, 'u',
    { runTask: async (s) => { spec = s; return { ok: true }; } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(spec.report_type, 'asset_reminder');
  assert.strictEqual(rs.getSchedules(db).find(x => x.report_type === 'asset_reminder').enabled, 1);
});
```

- [ ] **Step 2: Run — expect failure.** `node --test --test-force-exit tests/report-config-asset-reminders.test.js tests/report-schedule-asset-reminder.test.js`

- [ ] **Step 3: Implement config + schedule**

`reportConfig.js` `DEFAULTS`, after `asset_group_recipients: '',`:

```js
  // Asset engagement reminders (2026-09-18) — both armed OFF. Recipients come from
  // the directory (asset manager, coordinator in copy). Must live in DEFAULTS or
  // setConfig's KEYS filter silently drops the admin's write.
  asset_reminder_send_enabled: '0',
  asset_new_alert_enabled: '0',
```

`reportSchedule.js`:

```js
const SEND_ASSET_REMINDERS_CLI = path.join(APP_ROOT, 'tools', 'reports', 'send-asset-reminders.js');
const TYPES = ['coordinator', 'group', 'finance', 'hygiene', 'scoreboard', 'weekly_report', 'asset_group', 'asset_reminder'];
```

and in `cliFor`, before `return SEND_CLI;`:

```js
  if (report_type === 'asset_reminder') return SEND_ASSET_REMINDERS_CLI;
```

Run the two tests → pass. Also `node --test --test-force-exit tests/report-schedule.test.js tests/report-schedule-hygiene.test.js tests/report-schedule-weekly.test.js tests/report-schedule-asset-group.test.js tests/report-config.test.js`.

- [ ] **Step 4: CLI failing test** — `tests/send-asset-reminders.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cli = require('../tools/reports/send-asset-reminders');

const EMPTY = { counts: { new: 0, unassigned: 0, no_cost: 0, no_date: 0 }, new: [], unassigned: [], no_cost: [], no_date: [] };
const FULL = { counts: { new: 1, unassigned: 1, no_cost: 0, no_date: 0 },
  new: [{ asset_id: 'N1', asset_name: 'PC', has_cost: true, first_seen_date: '2026-07-28' }], unassigned: [{ asset_id: 'U1', asset_name: 'PC2', has_cost: false }], no_cost: [], no_date: [] };
const ROWS = [
  { site_code: 'HGO', active: 1, asset_manager_email: 'am@x', asset_manager_email_confirmed: 1, coordinator_email: 'c@x', coordinator_email_confirmed: 1, cc_emails: 'ignored@x' },
  { site_code: 'MGO', active: 1, asset_manager_email: 'am2@x', asset_manager_email_confirmed: 0, coordinator_email: 'c2@x', coordinator_email_confirmed: 1 },
  { site_code: 'SMI', active: 1, coordinator_email: 'c3@x', coordinator_email_confirmed: 0 },
  { site_code: 'KGO', active: 1, coordinator_email: 'c4@x', coordinator_email_confirmed: 1 },
  { site_code: 'OFF', active: 0, coordinator_email: 'c5@x', coordinator_email_confirmed: 1 },
];
function stub(over = {}) {
  const cap = { sends: [], records: [], windows: [] };
  const deps = {
    type: 'asset_reminder', db: {}, cfg: { asset_reminder_send_enabled: '1', asset_new_alert_enabled: '1', never_send_unconfirmed: '1', public_base_url: '' },
    listRecipients: async () => ROWS,
    loadSiteLabels: async (code) => (code === 'KGO' ? [] : ['L-' + code]),
    loadFollowups: async (labels, w) => { cap.windows.push(w); return labels[0] === 'L-SMI' ? EMPTY : FULL; },
    getPreviousWeek: () => ({ year: 2026, week: 30 }),
    getWeekRange: () => ({ start: '2026-07-26', end: '2026-08-01', label: 'W30 2026' }),
    now: new Date('2026-08-03T07:00:00Z'),
    mailerSend: async (m) => { cap.sends.push(m); return { ok: true }; },
    alreadySentToday: async () => false,
    record: async (db, row) => { cap.records.push(row); },
    ...over,
  };
  return { deps, cap };
}

test('requiring the CLI has no side effect and exports its core', () => {
  assert.strictEqual(typeof cli.main, 'function');
  assert.strictEqual(typeof cli.decideReminderSend, 'function');
  assert.strictEqual(typeof cli.recipientsFor, 'function');
});

test('gates: each type has its own arm flag; default OFF', () => {
  assert.strictEqual(cli.decideReminderSend('asset_reminder', {}), false);
  assert.strictEqual(cli.decideReminderSend('asset_reminder', { asset_reminder_send_enabled: '1' }), true);
  assert.strictEqual(cli.decideReminderSend('asset_new_alert', { asset_reminder_send_enabled: '1' }), false);
  assert.strictEqual(cli.decideReminderSend('asset_new_alert', { asset_new_alert_enabled: '1' }), true);
});

test('recipients: AM to + coordinator cc; unconfirmed AM → coordinator alone; none → null; cc_emails ignored', () => {
  assert.deepStrictEqual(cli.recipientsFor(ROWS, 'HGO', true), { to: 'am@x', cc: ['c@x'] });
  assert.deepStrictEqual(cli.recipientsFor(ROWS, 'MGO', true), { to: 'c2@x', cc: [] });
  assert.strictEqual(cli.recipientsFor(ROWS, 'SMI', true), null);
});

test('disarmed send → nothing composed, mailed or logged', async () => {
  const { deps, cap } = stub({ cfg: { asset_reminder_send_enabled: '0' } });
  const r = await cli.main(deps);
  assert.deepStrictEqual([r.sent, r.reason, cap.sends.length, cap.records.length], [0, 'disabled', 0, 0]);
});

test('weekly recap: window = previous Zoho week; skip reasons; dedup key = week label; ok logged', async () => {
  const { deps, cap } = stub();
  const r = await cli.main(deps);
  assert.strictEqual(r.sent, 2);                                    // HGO + MGO
  assert.deepStrictEqual(cap.windows[0], { newFrom: '2026-07-26', newTo: '2026-08-01' });
  const reasons = Object.fromEntries(r.results.filter(x => !x.ok).map(x => [x.site, x.reason]));
  assert.match(reasons.SMI, /nothing to report|no confirmed/);
  assert.match(reasons.KGO, /no asset label/);
  assert.ok(!r.results.some(x => x.site === 'OFF'), 'inactive directory rows are skipped');
  assert.deepStrictEqual(cap.records.map(x => [x.report_type, x.site_code, x.period, x.result]),
    [['asset_reminder', 'HGO', 'W30 2026', 'ok'], ['asset_reminder', 'MGO', 'W30 2026', 'ok']]);
  assert.strictEqual(cap.sends[0].to, 'am@x');
  assert.strictEqual(cap.sends[0].cc, 'c@x');
  assert.match(cap.sends[0].attachments[0].filename, /assets-suivi-HGO-2026-W30\.xlsx/);
});

test('dedup: already sent today → skipped (force overrides)', async () => {
  const a = stub({ alreadySentToday: async () => true });
  assert.strictEqual((await cli.main(a.deps)).sent, 0);
  const b = stub({ alreadySentToday: async () => true, force: true });
  assert.strictEqual((await cli.main(b.deps)).sent, 2);
});

test('new-asset alert: window = today UTC, period = YYYY-MM-DD, no new rows → skip', async () => {
  const { deps, cap } = stub({ type: 'asset_new_alert' });
  const r = await cli.main(deps);
  assert.deepStrictEqual(cap.windows[0], { newFrom: '2026-08-03', newTo: '2026-08-03' });
  assert.ok(cap.records.every(x => x.report_type === 'asset_new_alert' && x.period === '2026-08-03'));
  assert.strictEqual(r.results.find(x => x.site === 'SMI').ok, false);
});

test('preview ignores the gate, sends and logs nothing; --site narrows', async () => {
  const { deps, cap } = stub({ cfg: { asset_reminder_send_enabled: '0' }, preview: true, site: 'HGO' });
  const r = await cli.main(deps);
  assert.strictEqual(r.previewed, true);
  assert.deepStrictEqual(r.previews.map(p => p.site), ['HGO']);
  assert.deepStrictEqual([cap.sends.length, cap.records.length], [0, 0]);
});

test('a mail failure is logged fail and does not abort the other sites', async () => {
  let n = 0;
  const { deps, cap } = stub({ mailerSend: async () => (n++ === 0 ? { ok: false, error: 'smtp' } : { ok: true }) });
  const r = await cli.main(deps);
  assert.deepStrictEqual(cap.records.map(x => x.result), ['fail', 'ok']);
  assert.strictEqual(r.sent, 1);
});

test('--type parsing from args', async () => {
  const { deps } = stub({ type: undefined, args: { type: 'asset_new_alert' } });
  assert.strictEqual((await cli.main(deps)).type, 'asset_new_alert');
  const bad = stub({ type: undefined, args: { type: 'nope' } });
  await assert.rejects(() => cli.main(bad.deps), /unknown --type/);
});
```

- [ ] **Step 5: Run — expect failure** (module not found). `node --test --test-force-exit tests/send-asset-reminders.test.js`

- [ ] **Step 6: Implement** — `tools/reports/send-asset-reminders.js`:

```js
'use strict';
// Asset engagement reminders (2026-09-18). Two types, one core:
//   --type=asset_reminder   weekly recap per site (scheduled, Monday 07:00 by default)
//   --type=asset_new_alert  same-day "new hardware" alert (called in-process after
//                           the nightly assets sync — see assets-sync.afterAssetsSync)
// Flags: --preview (compose only, gate ignored, nothing sent/logged), --site=CODE,
// --force (ignore same-day dedup). Armed OFF by default (two config flags).
// Recipients: confirmed asset manager (to) + confirmed coordinator (cc); else the
// confirmed coordinator alone; else skip. cc_emails are NOT used (site report CC).
// Every reader is async under PostgreSQL — always `await`, never chain onto it.
const TYPES = { asset_reminder: 'asset_reminder_send_enabled', asset_new_alert: 'asset_new_alert_enabled' };

function decideReminderSend(type, cfg) {
  const key = TYPES[type];
  return !!key && String((cfg || {})[key]) === '1';
}

function recipientsFor(rows, site, neverSendUnconfirmed = true) {
  const { resolveFromRows } = require('../../services/reportDirectory');
  const opts = { neverSendUnconfirmed };
  const am = resolveFromRows(rows, site, 'asset_manager', opts);
  const coord = resolveFromRows(rows, site, 'coordinator', opts);
  if (am) return { to: am.to, cc: coord && coord.to !== am.to ? [coord.to] : [] };
  if (coord) return { to: coord.to, cc: [] };
  return null;
}

async function _defaultLoadSiteLabels(assetsDb, code) {
  const lookups = (await assetsDb.getAssetLookups()) || {};
  const { labelsForCode } = require('../../services/assetHygieneForSite');
  const { assetLabelToCode } = require('../../services/scoreboardAliases');
  return labelsForCode(lookups.sites, code, assetLabelToCode);
}

async function main(deps = {}) {
  const args = deps.args || Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
  const type = deps.type || args.type || 'asset_reminder';
  if (!TYPES[type]) throw new Error(`unknown --type "${type}" (asset_reminder | asset_new_alert)`);
  const preview = deps.preview !== undefined ? !!deps.preview : ('preview' in args);
  const force = deps.force !== undefined ? !!deps.force : (('force' in args) && args.force !== '0' && args.force !== 'false');
  const onlySite = String(deps.site || args.site || '').trim().toUpperCase() || null;

  // Boot only what was not injected (the server passes its own modules — never
  // re-run initPgReports/initPgAssets inside a live process).
  let rdb = deps.reportsDb, adb = deps.assetsDb, db = deps.db, cfg = deps.cfg;
  async function bootRdb() {
    if (!rdb) { rdb = require('../../reports-db'); if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await rdb.initPgReports(); }
    if (!db) db = rdb.db;
    return rdb;
  }
  async function bootAdb() {
    if (!adb) { adb = require('../../assets-db'); if (adb.ASSETS_BACKEND === 'postgres') await adb.initPgAssets(); }
    return adb;
  }
  if (!cfg) { await bootRdb(); cfg = await require('../../services/reportConfig').getConfig(db); }

  if (!preview && !decideReminderSend(type, cfg)) {
    console.log(`[send-asset-reminders] type=${type} → not sending (reason=disabled)`);
    return { type, sent: 0, reason: 'disabled' };
  }

  // ── window + dedup period ──
  const now = deps.now || new Date();
  let win, period, weekInfo = null;
  if (type === 'asset_reminder') {
    const getPreviousWeek = deps.getPreviousWeek || (await bootRdb()).getPreviousWeek;
    const getWeekRange = deps.getWeekRange || (await bootRdb()).getWeekRange;
    const pw = getPreviousWeek();
    const wr = getWeekRange(pw.year, pw.week);
    win = { newFrom: wr.start, newTo: wr.end };
    period = wr.label;                                   // 'Wnn YYYY' (Zoho week)
    weekInfo = { year: pw.year, week: pw.week, label: wr.label };
  } else {
    const today = now.toISOString().slice(0, 10);      // UTC, like recordAssetSightings
    win = { newFrom: today, newTo: today };
    period = today;
  }

  const listRecipients = deps.listRecipients || ((d) => require('../../services/reportDirectory').listRecipients(d));
  if (!deps.listRecipients) await bootRdb();
  const rows = (await listRecipients(db)) || [];
  const loadSiteLabels = deps.loadSiteLabels || (async (code) => _defaultLoadSiteLabels(await bootAdb(), code));
  const loadFollowups = deps.loadFollowups || (async (labels, w) => (await bootAdb()).getSiteAssetFollowups(labels, w));
  const alreadySentToday = deps.alreadySentToday || require('../../services/reportSentLog').alreadySentToday;
  const record = deps.record || require('../../services/reportSentLog').record;
  const mailerSend = deps.mailerSend || (msg => require('../../services/mailer').buildMailer(cfg).send(msg));
  const { buildAssetRecap, buildNewAssetAlert } = require('../../services/assetReminderReport');
  const neverUnconfirmed = String(cfg.never_send_unconfirmed ?? '1') !== '0';
  const baseUrl = String(cfg.public_base_url || '').replace(/\/+$/, '');

  const sites = rows.filter(r => r && r.site_code && Number(r.active ?? 1) !== 0)
    .map(r => r.site_code).filter(s => !onlySite || String(s).toUpperCase() === onlySite);

  const results = [], previews = [];
  let sent = 0;
  for (const site of sites) {
    try {
      const labels = (await loadSiteLabels(site)) || [];
      if (!labels.length) { results.push({ site, ok: false, reason: 'no asset label for this site' }); continue; }
      const f = await loadFollowups(labels, win);
      const c = (f && f.counts) || {};
      const empty = type === 'asset_reminder'
        ? !(c.new || c.unassigned || c.no_cost || c.no_date)
        : !c.new;
      if (empty) { results.push({ site, ok: false, reason: 'nothing to report' }); continue; }
      const rcpt = recipientsFor(rows, site, neverUnconfirmed);
      if (!rcpt) { results.push({ site, ok: false, reason: 'no confirmed asset manager or coordinator' }); continue; }
      const msg = type === 'asset_reminder'
        ? buildAssetRecap({ site, followups: f, baseUrl, weekLabel: weekInfo.label, year: weekInfo.year, week: weekInfo.week, labels })
        : buildNewAssetAlert({ site, rows: f.new, baseUrl, date: period, labels });
      if (preview) { previews.push({ site, subject: msg.subject, to: rcpt.to, cc: rcpt.cc.join(',') }); continue; }
      if (!force && await alreadySentToday(db, type, site, period)) { results.push({ site, ok: false, reason: 'already sent today' }); continue; }
      const res = await mailerSend({ to: rcpt.to, cc: rcpt.cc.length ? rcpt.cc.join(',') : undefined, subject: msg.subject, html: msg.html, attachments: msg.attachments });
      const ok = !!(res && res.ok);
      await record(db, { report_type: type, site_code: site, period, recipients: [rcpt.to, ...rcpt.cc].join(','), result: ok ? 'ok' : 'fail' });
      if (ok) sent++;
      results.push(ok ? { site, ok: true, to: rcpt.to } : { site, ok: false, reason: 'send failed: ' + ((res && res.error) || 'unknown') });
    } catch (e) {
      console.error(`[send-asset-reminders] FAIL site=${site} reason=${e.message}`);
      results.push({ site, ok: false, reason: 'error: ' + e.message });
    }
  }
  if (preview) return { type, previewed: true, sent: 0, period, previews, results };
  console.log(`[send-asset-reminders] DONE type=${type} period=${period} → sent=${sent}`);
  return { type, sent, period, results };
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('[send-asset-reminders] fatal:', e.message); process.exit(1); });
}

module.exports = { decideReminderSend, recipientsFor, main, TYPES };
```

- [ ] **Step 7: Run** — `node --test --test-force-exit tests/send-asset-reminders.test.js tests/report-config-asset-reminders.test.js tests/report-schedule-asset-reminder.test.js` → pass.

- [ ] **Step 8: Regression** — `node --test --test-force-exit tests/report-schedule.test.js tests/report-config.test.js tests/send-hygiene.test.js tests/assets-after-sync.test.js tests/await-precedence.test.js`.

- [ ] **Step 9: Commit**

```
git add tools/reports/send-asset-reminders.js services/reportConfig.js services/reportSchedule.js tests/send-asset-reminders.test.js tests/report-config-asset-reminders.test.js tests/report-schedule-asset-reminder.test.js
git commit -m "feat(reports): send-asset-reminders CLI (weekly recap + new-hardware alert), armed OFF

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: In-process new-asset alert + admin send route

**Files:**
- Modify: `server.js` — new route right after `app.post('/api/reports/asset-group/send'` (~line 2596)
- (the in-process alert is already wired by Task 3's `afterAssetsSync` default; this task proves it end to end)
- Test: `tests/asset-reminders-route.smoke.test.js` (Create)

- [ ] **Step 1: Write the failing smoke test** — boot header as in Task 5 (prefix `'asset-rem-route-'`), then:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb;
const tok = {};
const post = (p, t) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-report-token': t }, body: '{}' });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const adb = require('../assets-db');
  const COLS = ['asset_id', 'asset_name', 'site', 'state', 'user_name', 'department', 'purchase_cost', 'acquisition_date'];
  adb.replaceTable('assets', COLS, [{ asset_id: 'U1', asset_name: 'U', site: 'Hounde', state: 'In Use', user_name: '', department: '', purchase_cost: '5', acquisition_date: '2024-01-01' }]);
  adb.recordAssetSightings({});
  require('../services/reportDirectory').upsertRecipient(rdb.db, 'HGO',
    { coordinator_email: 'coord@edv-ops.com', coordinator_email_confirmed: 1, active: 1 }, 'seed');
  const me = rdb.listUsers().find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['super_admin']);
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'rem-admin', full_name: 'a', password: 'rem-admin-0000', roles: ['admin'] });
  tok.admin = (await rdb.login('rem-admin', 'rem-admin-0000')).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('admin (non super_admin) → 403', async () => {
  assert.strictEqual((await post('/api/reports/asset-reminders/send?type=asset_reminder&preview=1', tok.admin)).status, 403);
});

test('unknown type → 400', async () => {
  assert.strictEqual((await post('/api/reports/asset-reminders/send?type=nope&preview=1', tok.super)).status, 400);
});

test('super_admin preview (disarmed) composes for the site, sends nothing', async () => {
  const r = await post('/api/reports/asset-reminders/send?type=asset_reminder&site=HGO&preview=1', tok.super);
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.previewed, true);
  assert.deepStrictEqual(j.previews.map(p => [p.site, p.to]), [['HGO', 'coord@edv-ops.com']]);
});

test('disarmed Send now → sent 0, reason disabled', async () => {
  const j = await (await post('/api/reports/asset-reminders/send?type=asset_new_alert&preview=0', tok.super)).json();
  assert.deepStrictEqual([j.sent, j.reason], [0, 'disabled']);
});
```

- [ ] **Step 2: Run — expect failure** (404). `node --test --test-force-exit tests/asset-reminders-route.smoke.test.js`

- [ ] **Step 3: Implement** — after the asset-group send route:

```js
// POST /api/reports/asset-reminders/send?type=asset_reminder|asset_new_alert&site=CODE&preview=1|0&force=1
// Admin Preview / Send-now for the asset engagement reminders. Its OWN route (never
// SEND_TYPES — /api/reports/send hardcodes the coordinator composer). Disarm-safe:
// a disabled config returns {sent:0, reason:'disabled'}; preview ignores the gate
// and never mails or logs. Injects the live modules (no pg re-init in-process).
app.post('/api/reports/asset-reminders/send', requireReportSession, requireSuperAdmin, async (req, res) => {
  const _truthy = v => v === '1' || v === 1 || v === true || v === 'true';
  const type = String(req.query.type || req.body?.type || 'asset_reminder');
  if (!['asset_reminder', 'asset_new_alert'].includes(type)) return res.status(400).json({ error: 'type must be asset_reminder or asset_new_alert' });
  const preview = _truthy(req.query.preview) || _truthy(req.body?.preview);
  const force = _truthy(req.query.force) || _truthy(req.body?.force);
  const site = String(req.query.site || req.body?.site || '').trim() || undefined;
  try {
    res.json(await require('./tools/reports/send-asset-reminders').main({
      type, site, preview, force, args: {}, reportsDb: rdb, db: rdb.db, assetsDb: require('./assets-db'),
    }));
  } catch (e) {
    console.error('[api/reports/asset-reminders/send]', e.message);
    res.status(500).json({ error: e.message });
  }
});
```

Also update the default `sendNewAssetAlerts` in `assets-sync.js` (Task 3) to pass `args: {}` and `db: require('./reports-db').db` so the CLI does not parse the server's `process.argv`:

```js
  const sendNewAssetAlerts = deps.sendNewAssetAlerts || (() => require('./tools/reports/send-asset-reminders').main({
    type: 'asset_new_alert', args: {}, reportsDb: require('./reports-db'), db: require('./reports-db').db, assetsDb: adb(),
  }));
```

- [ ] **Step 4: Run** — `node --test --test-force-exit tests/asset-reminders-route.smoke.test.js tests/assets-after-sync.test.js` → pass.

- [ ] **Step 5: Regression** — `node --test --test-force-exit tests/weekly-send-route.smoke.test.js tests/admin-superadmin-gate.smoke.test.js tests/await-precedence.test.js`.

- [ ] **Step 6: Commit**

```
git add server.js assets-sync.js tests/asset-reminders-route.smoke.test.js
git commit -m "feat(reports): asset reminders admin send route + in-process new-hardware alert

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Admin card `#ap-asset-reminders` (5 surfaces) + directory fields

**Files:**
- Modify: `public/reports.html`:
  - card markup after the `ap-asset-group` card (search `id="ap-asset-group"`, insert after its closing `</div>`)
  - recipient modal fields after `id="rcp-fm-confirmed"` (line ~2006)
  - recipients table: extra column (render at line ~6600 + its `<thead>`; colspans `7` → `8`)
  - `openRecipientModal` / `submitRecipient` (lines ~6619-6660)
  - `_ADMIN_PANEL_IDS` (line 5641), `PANEL_GROUPS.sends` (line 5652), `showAdminPanel` super-gate list + loader hook, hash allowlist (line ~5758)
  - JS functions after `sendWeeklyNow` (~line 7825)
- Test: `tests/reports-admin-asset-reminders.test.js` (Create)

- [ ] **Step 1: Write the failing static test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'reports.html'), 'utf8');

test('card exists with both arm toggles, schedule host and result box', () => {
  for (const id of ['ap-asset-reminders', 'arm-recap-enabled', 'arm-alert-enabled', 'arm-schedule-body', 'arm-result', 'arm-site'])
    assert.ok(src.includes(`id="${id}"`), id);
});

test('the five admin surfaces all name the panel', () => {
  assert.match(src, /'asset-reminders':'ap-asset-reminders'/, '_ADMIN_PANEL_IDS');
  assert.match(src, /members: \[[^\]]*'asset-reminders'[^\]]*\]/, 'PANEL_GROUPS.sends.members');
  assert.match(src, /'asset-reminders': 'Rappels parc'/, 'group tab label');
  assert.match(src, /name === 'asset-reminders'\) && currentUser\?\.role !== 'super_admin'|name === 'asset-reminders' \|\|/, 'super-gate');
  assert.match(src, /'asset-group','asset-reminders'\]\.includes\(sub\)/, 'hash allowlist');
  assert.match(src, /name === 'asset-reminders' && typeof loadAssetRemindersCard === 'function'/, 'loader hook');
});

test('directory modal carries the asset manager fields and submits them', () => {
  for (const id of ['rcp-am-name', 'rcp-am-email', 'rcp-am-confirmed']) assert.ok(src.includes(`id="${id}"`), id);
  assert.match(src, /asset_manager_email_confirmed: document\.getElementById\('rcp-am-confirmed'\)\.checked \? 1 : 0/);
});

test('route + schedule row wiring', () => {
  assert.ok(src.includes('/api/reports/asset-reminders/send'));
  assert.ok(src.includes("saveScheduleRow('asset_reminder','weekly')"));
});
```

- [ ] **Step 2: Run — expect failure.** `node --test --test-force-exit tests/reports-admin-asset-reminders.test.js`

- [ ] **Step 3: Card markup** (after the `ap-asset-group` card):

```html
    <!-- ─── Rappels parc informatique (super_admin) ───────────────────────────
         Asset engagement (2026-09-18). Weekly recap per site (scheduled, default
         Monday 07:00) + same-day "new hardware" alert after the nightly sync. Both
         armed OFF. Recipients = confirmed asset manager (to) + confirmed coordinator
         (cc), from the directory; no confirmed contact → the site is skipped. -->
    <div class="card admin-panel" id="ap-asset-reminders" data-panel="asset-reminders">
      <h3>🧰 Rappels parc informatique
        <span style="font-size:0.78rem;font-weight:400;color:#6b7a99;margin-left:8px">
          Récap hebdomadaire par site &amp; alerte « nouveau matériel »
        </span>
      </h3>
      <div style="font-size:0.8rem;color:#6b7a99;margin:6px 0 12px">
        Désarmés par défaut. Destinataires : le <strong>responsable parc confirmé</strong> du site
        (annuaire), coordinateur confirmé en copie ; à défaut le coordinateur confirmé seul.
        Aucun montant n'est envoyé.
      </div>
      <div class="form-group"><label style="font-weight:400"><input type="checkbox" id="arm-recap-enabled"> <strong>Armer le récap hebdomadaire</strong></label></div>
      <div class="form-group"><label style="font-weight:400"><input type="checkbox" id="arm-alert-enabled"> <strong>Armer l'alerte « nouveau matériel »</strong> (après la synchro nocturne, max 1 par site et par jour)</label></div>
      <div class="modal-actions" style="justify-content:flex-start;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="saveAssetRemindersConfig()">Enregistrer</button>
        <select id="arm-type" style="padding:3px 6px;border:1px solid #E2E5EA;border-radius:4px">
          <option value="asset_reminder">Récap hebdomadaire</option>
          <option value="asset_new_alert">Alerte nouveau matériel</option>
        </select>
        <input id="arm-site" type="text" placeholder="Site (ex. HGO) — vide = tous" style="width:190px;padding:3px 6px;border:1px solid #E2E5EA;border-radius:4px">
        <button class="btn btn-secondary" onclick="previewAssetReminders(this)">Preview</button>
        <button class="btn btn-secondary" onclick="sendAssetRemindersNow(this)">Send now</button>
      </div>
      <div id="arm-result"></div>
      <h4 style="margin:14px 0 6px">Planification du récap</h4>
      <div id="arm-schedule-body"></div>
    </div>
```

- [ ] **Step 4: Five surfaces**

- `_ADMIN_PANEL_IDS`: append `, 'asset-reminders':'ap-asset-reminders'` before the closing `}`.
- `PANEL_GROUPS.sends`: `members: ['autoreports', 'weekly', 'hygiene', 'scoreboard', 'asset-group', 'asset-reminders']` and add `'asset-reminders': 'Rappels parc'` to its `labels`.
- `showAdminPanel` super-gate: extend the condition to `… || name === 'sla' || name === 'asset-reminders') && currentUser?.role !== 'super_admin') name = 'users';`.
- loader hook, after the `asset-group` hook:

```js
  // Fresh arm flags + schedule when opening the asset reminders card.
  if (name === 'asset-reminders' && typeof loadAssetRemindersCard === 'function') loadAssetRemindersCard();
```

- hash allowlist: `…,'weekly','asset-group','asset-reminders'].includes(sub) ? sub : 'users'`.
- Rail role gate: the card lives in the `sends` group whose rail item `admin-rail-grp-sends` is already shown to super_admin only (`loadAdminPage`) — no new rail element; the test asserts the four code surfaces plus the loader hook.

- [ ] **Step 5: JS** (after `sendWeeklyNow`):

```js
// ══════════════════════════════════════════════════════════════════
//  🧰 ASSET REMINDERS — weekly recap + new-hardware alert (2026-09-18)
//  Own route /api/reports/asset-reminders/send (never /api/reports/send).
// ══════════════════════════════════════════════════════════════════
function loadAssetRemindersCard() {
  api('GET', '/api/reports/config').then(c => {
    document.getElementById('arm-recap-enabled').checked = String(c.asset_reminder_send_enabled) === '1';
    document.getElementById('arm-alert-enabled').checked = String(c.asset_new_alert_enabled) === '1';
  }).catch(e => toast('Could not load asset reminder settings: ' + (e.message || e), 'error'));
  const box = document.getElementById('arm-schedule-body');
  api('GET', '/api/reports/schedule').then(rows => {
    const r = (rows || []).find(x => x.report_type === 'asset_reminder' && x.cadence === 'weekly') || {};
    const dayOpts = sel => _AR_DAYS.map(d => `<option value="${d}"${String(sel || '').toUpperCase() === d ? ' selected' : ''}>${d}</option>`).join('');
    box.innerHTML = `<div style="border:1px solid #E2E5EA;border-radius:8px;padding:12px 14px"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <label style="font-weight:400;min-width:88px"><input type="checkbox" id="sch-asset_reminder-weekly-en"${_arYN(r.enabled) ? ' checked' : ''}> Weekly</label>
      <span style="color:#6b7a99">on</span>
      <select id="sch-asset_reminder-weekly-day" style="padding:3px 6px;border:1px solid #E2E5EA;border-radius:4px">${dayOpts(r.day || 'MON')}</select>
      <span style="color:#6b7a99">at</span>
      <input type="time" id="sch-asset_reminder-weekly-time" value="${esc(r.time || '07:00')}" style="padding:3px 6px;border:1px solid #E2E5EA;border-radius:4px">
      <button class="btn btn-secondary btn-sm" onclick="saveScheduleRow('asset_reminder','weekly')">Save</button></div></div>`;
  }).catch(e => { box.innerHTML = `<div style="color:#b91c1c">Failed to load: ${esc(e.message || e)}</div>`; });
}
function saveAssetRemindersConfig() {
  api('PUT', '/api/reports/config', {
    asset_reminder_send_enabled: document.getElementById('arm-recap-enabled').checked ? '1' : '0',
    asset_new_alert_enabled: document.getElementById('arm-alert-enabled').checked ? '1' : '0',
  }).then(() => { toast('Asset reminder settings saved ✓', 'success'); loadAssetRemindersCard(); })
    .catch(e => toast('Save failed: ' + (e.message || e), 'error'));
}
function _armQuery(preview) {
  const type = document.getElementById('arm-type').value;
  const site = document.getElementById('arm-site').value.trim();
  return `/api/reports/asset-reminders/send?type=${encodeURIComponent(type)}&preview=${preview ? 1 : 0}${site ? '&site=' + encodeURIComponent(site) : ''}`;
}
function _armRender(r, previewing) {
  const box = document.getElementById('arm-result');
  if (r && r.reason && !(r.results || r.previews)) { box.innerHTML = `<div style="background:#FFFBEB;color:#92400E;padding:9px 11px;border-radius:6px;font-size:0.85rem">${previewing ? 'Preview' : 'Not sent'} — ${esc(r.reason)}</div>`; return; }
  const ok = (r.previews || []).map(p => `<li><strong>${esc(p.site)}</strong> — <span style="color:#065F46">prêt</span> → ${esc(p.to)}${p.cc ? ' (cc ' + esc(p.cc) + ')' : ''} · ${esc(p.subject)}</li>`);
  const rest = (r.results || []).map(x => x.ok
    ? `<li><strong>${esc(x.site)}</strong> — <span style="color:#065F46">envoyé</span> → ${esc(x.to || '')}</li>`
    : `<li><strong>${esc(x.site)}</strong> — <span style="color:#92400E">${esc(x.reason || 'ignoré')}</span></li>`);
  const li = ok.concat(rest).join('');
  box.innerHTML = li ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:0.85rem;line-height:1.6">${li}</ul>` : '<div style="color:#6b7a99;font-style:italic">Aucun site.</div>';
}
function previewAssetReminders(btn) {
  if (btn) btn.disabled = true;
  api('POST', _armQuery(true)).then(r => { _armRender(r, true); toast('Preview complete — nothing was sent', 'info'); })
    .catch(e => toast('Preview failed: ' + (e.message || e), 'error')).finally(() => { if (btn) btn.disabled = false; });
}
function sendAssetRemindersNow(btn) {
  if (!confirm('Envoyer maintenant les rappels parc aux contacts confirmés ?')) return;
  if (btn) btn.disabled = true;
  api('POST', _armQuery(false)).then(r => { _armRender(r, false); toast('Sent ' + ((r && r.sent) || 0), (r && r.sent) ? 'success' : 'info'); })
    .catch(e => toast('Send failed: ' + (e.message || e), 'error')).finally(() => { if (btn) btn.disabled = false; });
}
```

- [ ] **Step 6: Directory fields** — after the `rcp-fm-confirmed` form-group in the modal:

```html
    <div class="form-row cols-2">
      <div class="form-group"><label>Responsable parc (nom)</label><input id="rcp-am-name" type="text"></div>
      <div class="form-group"><label>Responsable parc (e-mail)</label><input id="rcp-am-email" type="email"></div>
    </div>
    <div class="form-group"><label style="font-weight:400"><input type="checkbox" id="rcp-am-confirmed"> E-mail responsable parc confirmé</label></div>
```

`openRecipientModal` — edit branch add `set('rcp-am-name', row.asset_manager_name); set('rcp-am-email', row.asset_manager_email); chk('rcp-am-confirmed', _arYN(row.asset_manager_email_confirmed));`; add branch add `set('rcp-am-name', ''); set('rcp-am-email', ''); chk('rcp-am-confirmed', 0);`.
`submitRecipient` patch add:

```js
    asset_manager_name: document.getElementById('rcp-am-name').value.trim(),
    asset_manager_email: document.getElementById('rcp-am-email').value.trim(),
    asset_manager_email_confirmed: document.getElementById('rcp-am-confirmed').checked ? 1 : 0,
```

Recipients table: add header `<th>Responsable parc</th>` after the FM email header (search the `ar-recipients-tbody` table `<thead>`), add the cell `<td>${emailCell(r.asset_manager_email, _arYN(r.asset_manager_email_confirmed))}</td>` after the FM email cell in `loadReportRecipients`, and change the three `colspan="7"` in that function to `colspan="8"`.

- [ ] **Step 7: Run** — `node --test --test-force-exit tests/reports-admin-asset-reminders.test.js tests/reports-editor-asset-tab.test.js` + the inline-script syntax check from Task 7 Step 6.

- [ ] **Step 8: Regression** — `node --test --test-force-exit tests/admin-superadmin-gate.smoke.test.js tests/report-directory.test.js`.

- [ ] **Step 9: Commit**

```
git add public/reports.html tests/reports-admin-asset-reminders.test.js
git commit -m "feat(admin): Rappels parc card (5 surfaces) + asset manager fields in the directory

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: help.html (EN + FR) + CLAUDE.md

**Files:**
- Modify: `public/help.html` — EN: after `4.5 Submitting a Report` block (end of `<div class="section" id="en-4">`, ~line 350) and in §7 (`id="en-5"` section, before `<h3 id="en-7-3">`); FR: the matching `fr-4` section (~line 1187-1230) and §7 FR (~line 1352)
- Modify: `CLAUDE.md` — new current-state section right after the "Deployment reality" block's closing `---` (before `## ⚡ Current state (as of 2026-09-06`), plus one Known Pitfalls row

- [ ] **Step 1: EN help** — insert before the closing `</div>` of `en-4`:

```html
        <h3 id="en-4-6">4.6 Parc informatique (asset follow-up)</h3>
        <p>Tab <strong>5 · Parc informatique</strong> shows four counts for your site, computed for the report week: <strong>new hardware</strong> first seen that week, hardware <strong>In Use without user and department</strong>, hardware <strong>without purchase cost</strong> and <strong>without acquisition date</strong> (the last two for In Use / In Store / In Repair only). Each count shows the change versus the previous week's report and opens the list; "voir dans Assets" opens the Assets module on your site.</p>
        <p>Two optional notes: <em>Traité cette semaine</em> and <em>Plan / blocages</em>. They save automatically. The counts are <strong>frozen when you submit</strong> and appear in the weekly e-mail with your notes; an empty note appears as <em>non renseigné</em> — Submit is never refused, it only warns you.</p>
        <div class="info">ℹ️ A site with no hardware in the register (e.g. Exploration, Tanda) shows "Aucun matériel rattaché à ce site" and the tab counts as done. Auto status now works: once the five tabs are done the report becomes <em>Ready</em> — you still have to click Submit.</div>
```

In §7 EN, before `<h3 id="en-7-3">` add:

```html
        <h3>Asset reminders (super_admin)</h3>
        <p><strong>Envois automatiques ▸ Rappels parc</strong> arms two e-mails, both OFF by default: a weekly recap per site (schedule on the card, Monday 07:00 suggested) and a same-day "new hardware" alert after the nightly assets sync. They go to the site's <strong>confirmed asset manager</strong> (set in Automated Reports ▸ Recipients), with the confirmed coordinator in copy; without a confirmed asset manager, to the confirmed coordinator alone. No amount is ever sent. Use Preview (optionally one site) before arming.</p>
```

- [ ] **Step 2: FR help** — same two blocks in French in `fr-4` (id `fr-4-6`, title `4.6 Parc informatique (suivi des actifs)`) and §7 FR (title `Rappels parc informatique (super_admin)`), same content translated:

```html
        <h3 id="fr-4-6">4.6 Parc informatique (suivi des actifs)</h3>
        <p>L'onglet <strong>5 · Parc informatique</strong> affiche quatre compteurs pour votre site, calculés sur la semaine du rapport : le <strong>nouveau matériel</strong> vu pour la première fois cette semaine, le matériel <strong>en service sans utilisateur ni département</strong>, le matériel <strong>sans coût d'achat</strong> et <strong>sans date d'acquisition</strong> (ces deux derniers pour les états En service / En stock / En réparation). Chaque compteur montre l'écart avec le rapport de la semaine précédente et ouvre la liste ; « voir dans Assets » ouvre le module Assets filtré sur votre site.</p>
        <p>Deux notes facultatives : <em>Traité cette semaine</em> et <em>Plan / blocages</em>, enregistrées automatiquement. Les compteurs sont <strong>figés à la soumission</strong> et apparaissent dans l'e-mail hebdomadaire avec vos notes ; une note vide apparaît « non renseigné ». La soumission n'est jamais refusée, un avertissement s'affiche seulement.</p>
        <div class="info">ℹ️ Un site sans matériel dans l'inventaire (ex. Exploration, Tanda) affiche « Aucun matériel rattaché à ce site » et l'onglet compte comme terminé. Le statut automatique fonctionne désormais : quand les cinq onglets sont terminés le rapport passe <em>Prêt</em> — il faut toujours cliquer sur Soumettre.</div>
```

```html
        <h3>Rappels parc informatique (super_admin)</h3>
        <p><strong>Envois automatiques ▸ Rappels parc</strong> arme deux e-mails, désarmés par défaut : un récap hebdomadaire par site (planification sur la carte, lundi 07:00 conseillé) et une alerte « nouveau matériel » le jour même, après la synchronisation nocturne. Ils partent au <strong>responsable parc confirmé</strong> du site (Automated Reports ▸ Recipients), coordinateur confirmé en copie ; sans responsable parc confirmé, au coordinateur confirmé seul. Aucun montant n'est envoyé. Faites un Preview (éventuellement sur un seul site) avant d'armer.</p>
```

If the page has a table of contents with `en-4-x` / `fr-4-x` anchors, add the `4.6` entries next to `4.5`.

- [ ] **Step 3: CLAUDE.md current-state entry** (insert before `## ⚡ Current state (as of 2026-09-06`):

```markdown
## ⚡ Current state (as of 2026-09-18 — Asset engagement : onglet « Parc informatique » + rappels, sur `main`, PAS déployé)

> Spec `docs/superpowers/specs/2026-09-17-asset-engagement-weekly-design.md` (rev 4), plan
> `docs/superpowers/plans/2026-09-18-asset-engagement.md`. **Données** : `asset_first_seen` (assets.db / pg,
> PK asset_id, baseline=1 au 1ᵉʳ passage, jamais mis à jour) alimentée par `afterAssetsSync` (assets-sync.js,
> cron 04:30 + trigger manuel ; sautée si la vue `assets` a échoué) ; `getSiteAssetFollowups(labels,{newFrom,newTo})`
> = 4 listes (nouveau / en service sans user+dept / sans coût / sans date — ces deux-là In Use·In Store·In Repair),
> **aucun montant** (`has_cost` booléen). **Rapport hebdo** : `report_asset_review` (reports.db + pg `012`, une
> ligne par rapport) ; onglet `stab-4` ; `GET /api/reports/:id/asset-followups` (admin+ ou même site),
> `PUT /api/reports/:id/asset-review` (F5), compteurs **recalculés et figés côté serveur**, re-figés à la
> **première** soumission seulement ; **la soumission n'est jamais bloquée** (note vide = « non renseigné » dans
> l'e-mail hebdo). L'auto-`ready` marche enfin (sélecteur `#section-tabs .section-tab.done`, 5 onglets) → plus de
> rapports « complets mais non soumis ». **Rappels** : `tools/reports/send-asset-reminders.js`
> (`asset_reminder` planifié / `asset_new_alert` in-process), désarmés (`asset_reminder_send_enabled`,
> `asset_new_alert_enabled`), destinataires = responsable parc confirmé (nouveau contact annuaire) + coordinateur
> confirmé en cc ; carte admin `#ap-asset-reminders` ; route `POST /api/reports/asset-reminders/send`.
> **Étapes user** : déployer (pm2 stop→start, Ctrl+F5), renseigner/confirmer les responsables parc, armer,
> planifier lundi 07:00, contrôle navigateur avec un compte coordinateur. La 1ʳᵉ nuit après déploiement prend la
> **baseline** (aucun « nouveau » ce jour-là).
```

Known Pitfalls row (append to the table):

```markdown
| **Asset engagement counts are FROZEN by the server — never trust client counts, never re-freeze on re-submit** | `PUT /api/reports/:id/asset-review` and the first `submitted` transition recompute `applicable`/`counts` from `getSiteAssetFollowups` (window = the report's Zoho week) and ignore whatever the client sent; a `submitted → submitted` call does not re-freeze. `saveReportAssetReview` writes ONLY the keys present in the patch (freeze vs notes can't clobber each other). "New hardware" = `asset_first_seen.baseline = 0` in the window and still present in `assets` — the first run after deploy is the baseline, so nothing is "new" that day. |
```

- [ ] **Step 4: Check** — open `public/help.html` in a browser locally or run `node -e "require('fs').readFileSync('public/help.html','utf8').includes('fr-4-6')||process.exit(1)"`.

- [ ] **Step 5: Full regression** — `node --test --test-force-exit tests/` must be at **0 failures** (CLAUDE.md rule: no "known" red). Then the pg suites with `PG_ADMIN_URL` set: `node --test --test-force-exit tests/pg-asset-followups.test.js tests/pg-report-asset-review.test.js tests/pg-reports-reports.test.js tests/pg-reporting.test.js`.

- [ ] **Step 6: Commit**

```
git add public/help.html CLAUDE.md
git commit -m "docs: help EN/FR + CLAUDE.md for the asset engagement feature

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Owner steps (not automatable here)

1. Build the ZIP, apply on prod, `pm2 stop` → wait → `pm2 start` (server.js + `_htmlCache` HTML changed), Ctrl+F5.
2. Admin → Automated Reports → Recipients: fill and confirm each site's asset manager.
3. Admin → Envois automatiques → Rappels parc: Preview, then arm, then save the Monday 07:00 schedule.
4. Browser check with a coordinator account: tab 5, autosave, submit with an empty note (warning, then submitted), weekly e-mail preview.
