# Reporting Suite — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared engine + config module + live scoreboard page that every reporting-suite product (Coordinator report, Finance Manager report) will sit on top of — with zero report-sending yet.

**Architecture:** Follow the codebase's established per-module backend-flag pattern (`REPORTS_BACKEND=sqlite|postgres`, sqlite body + async PG fork resolved via an `_h(db)` handle, exactly like `services/groupPresets.js`). New config/directory data lives in four reports.db tables; a set of small single-responsibility services composes the *existing* per-site PG-forked readers into one JSON object; a live HTML page and an admin config card consume it over new `/api/reports/*` routes. Email/PDF are built as adapters but wired to nothing that auto-sends in Foundation.

**Tech Stack:** Node.js + Express, better-sqlite3 (sqlite) / `services/pgDb.js` (PostgreSQL), `nodemailer` (new, pure-JS, xcopy-vendored), headless Chrome/Edge (system browser, no npm dep), Chart.js (CDN, already in CSP), `node --test`.

**Spec:** `docs/superpowers/specs/2026-07-14-reporting-suite-design.md`
**Branch:** `feat/reporting-suite` (already created)

---

## File Structure

| File | Responsibility |
|---|---|
| `services/siteScore.js` | **NEW.** Pure function — the composite scoreboard score + `two_moves` (spec §4.1). No I/O. |
| `services/reportConfig.js` | **NEW.** Key/value delivery settings store (transport, smtp_*, from, safety flag, group recipient). sqlite + PG fork via `_h(db)`. |
| `services/reportDirectory.js` | **NEW.** `report_recipients` CRUD + `suggestFromMeetings()` (non-destructive pre-fill) + `resolveRecipient(site, kind)`. sqlite + PG fork. |
| `services/reportSchedule.js` | **NEW.** `report_schedules` store + schtasks bridge (mirrors `services/backupSchedule.js`). |
| `services/reportSentLog.js` | **NEW.** `report_sent_log` insert + same-day dedup check. sqlite + PG fork. |
| `services/mailer.js` | **NEW.** Transport adapter (`smtp` now, `graph` stub). `send()` never throws into caller. |
| `services/reportRender.js` | **NEW.** `renderPdf(html)` via system Chrome/Edge with hard timeout + degradation. |
| `services/siteReport.js` | **NEW.** `siteReportData(siteCode, period, deps)` — composes existing readers into the spec §4 contract. DI'd deps for testability (like `execSummary.loadExecSummary`). |
| `db/postgres/reports/005_reporting.sql` | **NEW.** PG DDL for the four tables. |
| `reports-db.js` | **MODIFY.** Wire `005_reporting.sql` into `initPgReports()` (after `004_hot.sql`). |
| `tools/pg/copy-reports-reporting.js` | **NEW.** sqlite→PG copy for the four tables (mirrors `copy-reports-config.js`). |
| `tools/pg/copy-reports-all.js` | **MODIFY.** Add the new copy step. |
| `tools/reports/send-reports.js` | **NEW.** CLI entry the scheduled task calls (Foundation: wired to config/dedup, prints a plan; actual composing lands in sub-project 2). |
| `server.js` | **MODIFY.** New `/api/reports/*` routes + `site-report.html` route + `_htmlCache` boot-load + schema init calls. |
| `public/site-report.html` | **NEW.** Live scoreboard page (the user's Chart.js dashboard, fed by `fetch`). |
| `public/reports.html` | **MODIFY.** New "Automated Reports" admin card (3 tabs). |
| `tests/*` | **NEW** per task. |

**Design rule reused from `groupPresets.js`:** every service exposes `_h(db)` that returns `{H, isPg}` — sqlite path is synchronous, pg path returns a Promise. Callers `await` either way (await on a sync value is a no-op). sqlite schema is created by the module's own idempotent `_initSchema(db)`; PG schema is applied by `initPgReports()`.

---

## Task 0: Branch, dependency vendoring, and skeleton

**Files:**
- Verify: `feat/reporting-suite` branch
- Create dir: `services/` (exists), `tools/reports/`, `tests/` (exists)

- [ ] **Step 1: Confirm branch + clean tree**

Run: `git branch --show-current && git status --porcelain`
Expected: `feat/reporting-suite` and no uncommitted changes (spec already committed).

- [ ] **Step 2: Vendor `nodemailer` (dev box) — do NOT `npm install` on prod**

`nodemailer` is pure JS (no native binding). Install on the dev box only; prod gets it by xcopy of the folder (same story as the pg driver — see CLAUDE.md deploy notes).

Run: `npm install nodemailer@^6`
Expected: added to `package.json` dependencies; `node -e "require('nodemailer')"` prints nothing (success).

- [ ] **Step 3: Create the tools/reports dir with a placeholder**

Run: `mkdir -p tools/reports`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(reporting): vendor nodemailer for the reporting suite foundation"
```

---

## Task 1: `services/siteScore.js` — composite score (pure, TDD)

Implements spec §4.1 exactly. Pure function, no DB — the easiest unit to test first and the anchor everything else references.

**Files:**
- Create: `services/siteScore.js`
- Test: `tests/site-score.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/site-score.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeSiteScore } = require('../services/siteScore');

// Inputs mirror the fields siteReport.js will pass from the readers.
const perfect = {
  meetings: { pvs_held: 3, pvs_target: 3, resolved: 10, open_issues: 0, overdue_actions_count: 0, signoff_pct: 100 },
  inspection: { inspections_done: 1, findings_critical_major: 0 },
};

test('perfect inputs → 100 / green', () => {
  const r = computeSiteScore(perfect.meetings, perfect.inspection);
  assert.strictEqual(r.composite, 100);
  assert.strictEqual(r.rag, 'green');
});

test('weights sum to 1.0 (composite never exceeds 100)', () => {
  const r = computeSiteScore(perfect.meetings, perfect.inspection);
  assert.ok(r.composite <= 100);
});

test('RAG cutoffs at 45 and 70', () => {
  assert.strictEqual(computeSiteScore(
    { pvs_held: 3, pvs_target: 3, resolved: 7, open_issues: 3, overdue_actions_count: 0, signoff_pct: 100 },
    { inspections_done: 1, findings_critical_major: 0 }).rag, 'green');   // ~91
  // Force a mid score: no meetings cadence, some issues open, one critical finding.
  const amber = computeSiteScore(
    { pvs_held: 1, pvs_target: 3, resolved: 3, open_issues: 3, overdue_actions_count: 2, signoff_pct: 50 },
    { inspections_done: 1, findings_critical_major: 1 });
  assert.ok(amber.composite >= 45 && amber.composite < 70, `expected amber, got ${amber.composite}`);
  assert.strictEqual(amber.rag, 'amber');
  const red = computeSiteScore(
    { pvs_held: 0, pvs_target: 3, resolved: 0, open_issues: 5, overdue_actions_count: 5, signoff_pct: 0 },
    { inspections_done: 0, findings_critical_major: 3 });
  assert.ok(red.composite < 45, `expected red, got ${red.composite}`);
  assert.strictEqual(red.rag, 'red');
});

test('resolution_pct is 100 when there are no issues at all', () => {
  const r = computeSiteScore(
    { pvs_held: 3, pvs_target: 3, resolved: 0, open_issues: 0, overdue_actions_count: 0, signoff_pct: 100 },
    { inspections_done: 1, findings_critical_major: 0 });
  assert.strictEqual(r.dimensions.resolution_pct, 100);
});

test('two_moves ranks by weight × recoverable gap, with template text + gain_pts', () => {
  const r = computeSiteScore(
    { pvs_held: 0, pvs_target: 3, resolved: 5, open_issues: 5, overdue_actions_count: 0, signoff_pct: 100 },
    { inspections_done: 1, findings_critical_major: 0 });
  assert.strictEqual(r.two_moves.length, 2);
  // reviews sub-score = 0 (weight .20) is the biggest recoverable gap → ranked first.
  assert.match(r.two_moves[0].text, /PV|department|review/i);
  assert.ok(r.two_moves[0].gain_pts >= r.two_moves[1].gain_pts);
  assert.strictEqual(typeof r.two_moves[0].gain_pts, 'number');
});

test('trend_pts is null when no previous composite is supplied', () => {
  const r = computeSiteScore(perfect.meetings, perfect.inspection, null);
  assert.strictEqual(r.trend_pts, null);
});

test('trend_pts = composite − previous when supplied', () => {
  const r = computeSiteScore(perfect.meetings, perfect.inspection, 80);
  assert.strictEqual(r.trend_pts, 20);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/site-score.test.js`
Expected: FAIL — `Cannot find module '../services/siteScore'`.

- [ ] **Step 3: Implement `services/siteScore.js`**

```javascript
'use strict';
// Composite scoreboard score — spec §4.1. Pure, deterministic, no I/O.
// Six dimensions, fixed weights summing to exactly 1.0.

const clamp = (n) => Math.max(0, Math.min(100, n));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

// [key, weight, sub-score fn(m, i)] — order is also the tie-break order.
const DIMS = [
  ['reviews',        0.20, (m) => clamp((num(m.pvs_held) / (num(m.pvs_target) || 1)) * 100)],
  ['resolution_pct', 0.20, (m) => { const den = num(m.resolved) + num(m.open_issues); return den === 0 ? 100 : clamp((num(m.resolved) / den) * 100); }],
  ['overdue',        0.15, (m) => clamp(100 - Math.min(100, num(m.overdue_actions_count) * 15))],
  ['inspections',    0.15, (_m, i) => clamp(Math.min(100, num(i.inspections_done) * 100))],
  ['findings',       0.15, (_m, i) => clamp(100 - Math.min(100, num(i.findings_critical_major) * 20))],
  ['signoff_pct',    0.15, (m) => clamp(num(m.signoff_pct))],
];

// Template sentence per dimension for the "two moves" (deterministic, no AI).
const MOVE_TEXT = {
  reviews:        (m) => `Hold the ${Math.max(0, num(m.pvs_target) - num(m.pvs_held))} missing department PV(s) this month`,
  resolution_pct: (m) => `Close ${num(m.open_issues)} open issue(s) still standing`,
  overdue:        (m) => `Clear ${num(m.overdue_actions_count)} overdue action(s)`,
  inspections:    () => `Complete at least one site inspection this month`,
  findings:       (_m, i) => `Resolve ${num(i.findings_critical_major)} critical/major inspection finding(s)`,
  signoff_pct:    () => `Get outstanding PVs signed off`,
};

function computeSiteScore(meetings = {}, inspection = {}, previousComposite = null) {
  const dimensions = {};
  let composite = 0;
  const gaps = [];
  for (const [key, weight, fn] of DIMS) {
    const sub = clamp(fn(meetings, inspection));
    dimensions[key] = Math.round(sub);
    composite += weight * sub;
    gaps.push({ key, weight, gain: weight * (100 - sub) });
  }
  composite = Math.round(composite);
  const rag = composite >= 70 ? 'green' : composite >= 45 ? 'amber' : 'red';

  // two_moves: largest recoverable gap first; ties broken by DIMS order (stable sort).
  const two_moves = gaps
    .map((g, ix) => ({ ...g, ix }))
    .filter((g) => g.gain > 0)
    .sort((a, b) => (b.gain - a.gain) || (a.ix - b.ix))
    .slice(0, 2)
    .map((g) => ({ text: MOVE_TEXT[g.key](meetings, inspection), gain_pts: Math.round(g.gain) }));

  const trend_pts = (previousComposite === null || previousComposite === undefined)
    ? null : composite - Math.round(num(previousComposite));

  return { composite, rag, trend_pts, dimensions, two_moves };
}

module.exports = { computeSiteScore, DIMS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/site-score.test.js`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add services/siteScore.js tests/site-score.test.js
git commit -m "feat(reporting): siteScore composite + two_moves (spec 4.1)"
```

---

## Task 2: `services/reportConfig.js` — delivery settings KV store (TDD)

Key/value store for delivery settings. Mirrors `exec_view_editorial` (KV with sqlite + PG fork) and the `_h(db)` resolver from `groupPresets.js`.

**Files:**
- Create: `services/reportConfig.js`
- Test: `tests/report-config.test.js`

- [ ] **Step 1: Write the failing test (sqlite path)**

```javascript
// tests/report-config.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const cfg = require('../services/reportConfig');

function freshDb() { const db = new Database(':memory:'); cfg._initSchema(db); return db; }

test('defaults returned when unset', () => {
  const db = freshDb();
  const all = cfg.getConfig(db);
  assert.strictEqual(all.transport, 'smtp');        // default
  assert.strictEqual(all.never_send_unconfirmed, '1'); // safety on by default
});

test('set then get a value round-trips', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_host: 'mail.edv-ops.com', from: 'it-reports@edv-ops.com' }, 'azize');
  const all = cfg.getConfig(db);
  assert.strictEqual(all.smtp_host, 'mail.edv-ops.com');
  assert.strictEqual(all.from, 'it-reports@edv-ops.com');
});

test('setConfig only writes known keys (ignores junk)', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_host: 'x', not_a_key: 'y' }, 'azize');
  const all = cfg.getConfig(db);
  assert.strictEqual(all.smtp_host, 'x');
  assert.strictEqual(all.not_a_key, undefined);
});
```

- [ ] **Step 2: Run test → FAIL** (`Cannot find module`).

Run: `node --test tests/report-config.test.js`

- [ ] **Step 3: Implement `services/reportConfig.js`**

```javascript
'use strict';
// Delivery settings for the reporting suite — key/value in report_config.
// sqlite + PG fork via the same _h(db) resolver used by groupPresets.js.

// Whitelisted keys + defaults. setConfig ignores anything not listed here.
const DEFAULTS = {
  transport: 'smtp',                 // 'smtp' | 'graph'
  smtp_host: '', smtp_port: '587', smtp_secure: '0', smtp_user: '', smtp_pass: '',
  from: '', reply_to: '',
  default_email_domain: 'edv-ops.com',
  formats: 'html,pdf',               // csv of enabled attachment formats
  never_send_unconfirmed: '1',       // safety gate — '1' = skip unconfirmed emails
  group_report_to: '', group_report_cc: '', group_report_to_confirmed: '0',
};
const KEYS = Object.keys(DEFAULTS);

function _h(db) {
  const rdb = require('../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: db, isPg: false };
}

// Guard on the DB HANDLE, not a module-level boolean. Tests create a fresh
// :memory: db per test; a boolean guard would skip CREATE on the 2nd db and
// the test would hit "no such table". WeakSet keys on the handle → each db is
// initialised exactly once. (groupPresets.js uses a boolean because prod has a
// single persistent handle; our unit tests do not.)
const _inited = new WeakSet();
function _initSchema(db) {
  if (_h(db).isPg) return;   // pg schema applied by initPgReports / 005_reporting.sql
  if (_inited.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS report_config (
    key TEXT PRIMARY KEY, value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_by TEXT
  );`);
  _inited.add(db);
}

function _fold(rows) {
  const out = { ...DEFAULTS };
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
}
function getConfig(db) {
  const { H, isPg } = _h(db);
  if (isPg) return (async () => _fold(await H.prepare('SELECT key, value FROM report_config').all()))();
  _initSchema(db);
  try { return _fold(H.prepare('SELECT key, value FROM report_config').all()); }
  catch (e) { console.warn('[report-config] get failed:', e.message); return { ...DEFAULTS }; }
}

const _UPSERT = `INSERT INTO report_config (key, value, updated_at, updated_by)
  VALUES (?, ?, {NOW}, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`;
function setConfig(db, patch, user) {
  const clean = Object.entries(patch || {}).filter(([k]) => KEYS.includes(k));
  const { H, isPg } = _h(db);
  if (isPg) return (async () => {
    await H.runTransaction(async () => {
      for (const [k, v] of clean) await H.prepare(_UPSERT.replace('{NOW}', 'now()')).run(k, String(v), user || 'unknown');
    });
    return getConfig(db);
  })();
  _initSchema(db);
  const stmt = H.prepare(_UPSERT.replace('{NOW}', "datetime('now')"));
  H.transaction(() => { for (const [k, v] of clean) stmt.run(k, String(v), user || 'unknown'); })();
  return getConfig(db);
}

module.exports = { DEFAULTS, KEYS, _initSchema, getConfig, setConfig };
```

- [ ] **Step 4: Run test → PASS.**

Run: `node --test tests/report-config.test.js`

- [ ] **Step 5: Commit**

```bash
git add services/reportConfig.js tests/report-config.test.js
git commit -m "feat(reporting): reportConfig delivery-settings KV store (sqlite + pg fork)"
```

---

## Task 3: `services/reportDirectory.js` — recipients directory (TDD)

`report_recipients` CRUD + `suggestFromMeetings()` (non-destructive pre-fill) + `resolveRecipient()`. This is where the "never send to an unconfirmed email" safety rule is enforced at resolve time.

**Files:**
- Create: `services/reportDirectory.js`
- Test: `tests/report-directory.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/report-directory.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const dir = require('../services/reportDirectory');

function freshDb() { const db = new Database(':memory:'); dir._initSchema(db); return db; }

test('upsert + list a recipient row', () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { site_name: 'Hounde', coordinator_name: 'Jean Traore' }, 'azize');
  const rows = dir.listRecipients(db);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].site_code, 'HGO');
  assert.strictEqual(rows[0].coordinator_name, 'Jean Traore');
});

test('resolveRecipient returns null when email unconfirmed and safety on', () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { coordinator_name: 'Jean', coordinator_email: 'jean.traore@edv-ops.com', coordinator_email_confirmed: 0 }, 'a');
  const r = dir.resolveRecipient(db, 'HGO', 'coordinator', { neverSendUnconfirmed: true });
  assert.strictEqual(r, null);
});

test('resolveRecipient returns to/cc when confirmed', () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { coordinator_email: 'jean@edv-ops.com', coordinator_email_confirmed: 1, cc_emails: 'boss@edv-ops.com' }, 'a');
  const r = dir.resolveRecipient(db, 'HGO', 'coordinator', { neverSendUnconfirmed: true });
  assert.deepStrictEqual(r, { to: 'jean@edv-ops.com', cc: ['boss@edv-ops.com'] });
});

test('suggestFromMeetings never overwrites a confirmed row', () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { coordinator_name: 'Confirmed Person', coordinator_email: 'x@edv-ops.com', coordinator_email_confirmed: 1 }, 'a');
  // stub meetings reader: returns a DIFFERENT name
  const stubMeetings = { getSiteContacts: () => ({ coordinator_name: 'Someone Else', fm_name: 'FM Person' }) };
  dir.suggestFromMeetings(db, ['HGO'], stubMeetings, 'system');
  const row = dir.listRecipients(db).find(r => r.site_code === 'HGO');
  assert.strictEqual(row.coordinator_name, 'Confirmed Person');  // untouched
  assert.strictEqual(row.fm_name, 'FM Person');                  // filled (was blank)
});
```

- [ ] **Step 2: Run test → FAIL.**

Run: `node --test tests/report-directory.test.js`

- [ ] **Step 3: Implement `services/reportDirectory.js`**

```javascript
'use strict';
// Recipients directory for the reporting suite. report_recipients keyed by
// site_code. suggestFromMeetings() PRE-FILLS blank fields from meetings data
// but NEVER overwrites a confirmed value. resolveRecipient() enforces the
// "no confirmed email → no send" safety rule.

const COLS = ['site_name', 'coordinator_name', 'coordinator_email', 'coordinator_email_confirmed',
  'fm_name', 'fm_email', 'fm_email_confirmed', 'cc_emails', 'active'];

function _h(db) {
  const rdb = require('../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: db, isPg: false };
}

const _inited = new WeakSet();   // guard per DB handle — see reportConfig note
function _initSchema(db) {
  if (_h(db).isPg) return;
  if (_inited.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS report_recipients (
    site_code TEXT PRIMARY KEY, site_name TEXT,
    coordinator_name TEXT, coordinator_email TEXT, coordinator_email_confirmed INTEGER DEFAULT 0,
    fm_name TEXT, fm_email TEXT, fm_email_confirmed INTEGER DEFAULT 0,
    cc_emails TEXT, active INTEGER DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_by TEXT
  );`);
  _inited.add(db);
}

function listRecipients(db) {
  const { H, isPg } = _h(db);
  const SQL = 'SELECT * FROM report_recipients ORDER BY site_code';
  if (isPg) return H.prepare(SQL).all();
  _initSchema(db);
  try { return H.prepare(SQL).all(); } catch (e) { console.warn('[report-dir] list failed:', e.message); return []; }
}

// Partial upsert: only the columns present in `patch` are written; existing
// row values for absent columns are preserved (COALESCE-style).
function upsertRecipient(db, siteCode, patch, user) {
  const { H, isPg } = _h(db);
  const set = COLS.filter(c => patch[c] !== undefined);
  const insCols = ['site_code', ...set, 'updated_by'];
  const insVals = [siteCode, ...set.map(c => patch[c]), user || 'unknown'];
  const ph = insCols.map(() => '?').join(', ');
  const upd = set.map(c => `${c}=excluded.${c}`).concat('updated_by=excluded.updated_by').join(', ');
  const SQL = `INSERT INTO report_recipients (${insCols.join(', ')}) VALUES (${ph})
               ON CONFLICT(site_code) DO UPDATE SET ${upd}`;
  if (isPg) return (async () => { await H.prepare(SQL).run(...insVals); return { ok: true }; })();
  _initSchema(db);
  H.prepare(SQL).run(...insVals);
  return { ok: true };
}

// Returns {to, cc:[…]} or null. When neverSendUnconfirmed, an unconfirmed or
// blank email yields null (caller skips + logs).
function resolveRecipient(db, siteCode, kind, { neverSendUnconfirmed = true } = {}) {
  const rows = listRecipients(db);
  // rows may be a Promise under pg — resolveRecipient is sync-only in Foundation
  // callers (routes await listRecipients separately); guard defensively.
  if (typeof rows.then === 'function') throw new Error('resolveRecipient: pass an already-resolved row set');
  const row = rows.find(r => r.site_code === siteCode);
  if (!row) return null;
  const email = kind === 'fm' ? row.fm_email : row.coordinator_email;
  const confirmed = kind === 'fm' ? row.fm_email_confirmed : row.coordinator_email_confirmed;
  if (!email || (neverSendUnconfirmed && !confirmed)) return null;
  const cc = String(row.cc_emails || '').split(',').map(s => s.trim()).filter(Boolean);
  return { to: email, cc };
}

// Pre-fill blank name/email fields from meetings data. NEVER overwrites a
// confirmed field. meetingsReader.getSiteContacts(siteCode) →
// { coordinator_name, fm_name } (added to meetings-db in sub-project 2; a stub
// is injected in tests here).
function suggestFromMeetings(db, siteCodes, meetingsReader, user) {
  const existing = listRecipients(db);
  if (typeof existing.then === 'function') throw new Error('suggestFromMeetings: sqlite-only in Foundation');
  const byCode = Object.fromEntries(existing.map(r => [r.site_code, r]));
  let filled = 0;
  for (const code of siteCodes) {
    const c = (meetingsReader.getSiteContacts && meetingsReader.getSiteContacts(code)) || {};
    const cur = byCode[code] || {};
    const patch = {};
    if (c.coordinator_name && !cur.coordinator_email_confirmed && !cur.coordinator_name) patch.coordinator_name = c.coordinator_name;
    if (c.fm_name && !cur.fm_email_confirmed && !cur.fm_name) patch.fm_name = c.fm_name;
    if (Object.keys(patch).length) { upsertRecipient(db, code, patch, user || 'system'); filled++; }
  }
  return { ok: true, filled };
}

module.exports = { COLS, _initSchema, listRecipients, upsertRecipient, resolveRecipient, suggestFromMeetings };
```

> NOTE for the implementer: `meetings-db.getSiteContacts(siteCode)` does not exist yet — it is added in sub-project 2. Foundation only depends on the **stubbed** reader in the test. Do not add it to meetings-db in this plan.

- [ ] **Step 4: Run test → PASS.**

Run: `node --test tests/report-directory.test.js`

- [ ] **Step 5: Commit**

```bash
git add services/reportDirectory.js tests/report-directory.test.js
git commit -m "feat(reporting): reportDirectory recipients + safety-gated resolve"
```

---

## Task 4: PG schema `005_reporting.sql` + wire into `initPgReports` + sent-log store

**Files:**
- Create: `db/postgres/reports/005_reporting.sql`
- Modify: `reports-db.js` (`initPgReports()` — add the 005 exec after 004)
- Create: `services/reportSentLog.js`  (reportSchedule.js is created entirely in Task 9)
- Test: `tests/report-sent-log.test.js`, `tests/pg-reporting.test.js` (PG-gated, skips without PG)

- [ ] **Step 1: Write `db/postgres/reports/005_reporting.sql`**

```sql
-- Chunk 4E — reporting suite (recipients / config / schedules / sent-log).
CREATE TABLE IF NOT EXISTS report_recipients (
  site_code TEXT PRIMARY KEY, site_name TEXT,
  coordinator_name TEXT, coordinator_email TEXT, coordinator_email_confirmed INTEGER DEFAULT 0,
  fm_name TEXT, fm_email TEXT, fm_email_confirmed INTEGER DEFAULT 0,
  cc_emails TEXT, active INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT
);
CREATE TABLE IF NOT EXISTS report_config (
  key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT
);
CREATE TABLE IF NOT EXISTS report_schedules (
  report_type TEXT, cadence TEXT, enabled INTEGER DEFAULT 0,
  day TEXT, time TEXT, updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT,
  PRIMARY KEY (report_type, cadence)
);
CREATE TABLE IF NOT EXISTS report_sent_log (
  id SERIAL PRIMARY KEY, report_type TEXT, site_code TEXT, period TEXT,
  recipients TEXT, result TEXT, sent_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_report_sent_log_dedup ON report_sent_log(report_type, site_code, period);
```

- [ ] **Step 2: Wire it into `initPgReports()`**

Modify `reports-db.js` — after the `004_hot.sql` exec + `_seedSyncMetadataPg(_pg)` (around line 981), add:

```javascript
  // Chunk 4E — reporting suite tables.
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '005_reporting.sql'), 'utf8'));
```

- [ ] **Step 3: Write the failing sent-log test (sqlite)**

```javascript
// tests/report-sent-log.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const log = require('../services/reportSentLog');

function freshDb() { const db = new Database(':memory:'); log._initSchema(db); return db; }

test('record then alreadySentToday true for same (type,site,period)', () => {
  const db = freshDb();
  log.record(db, { report_type: 'coordinator', site_code: 'HGO', period: '2026-07', recipients: 'a@x', result: 'ok' });
  assert.strictEqual(log.alreadySentToday(db, 'coordinator', 'HGO', '2026-07'), true);
});

test('alreadySentToday false for a different period', () => {
  const db = freshDb();
  log.record(db, { report_type: 'coordinator', site_code: 'HGO', period: '2026-07', recipients: 'a@x', result: 'ok' });
  assert.strictEqual(log.alreadySentToday(db, 'coordinator', 'HGO', '2026-08'), false);
});

test('alreadySentToday false when nothing recorded', () => {
  assert.strictEqual(log.alreadySentToday(freshDb(), 'coordinator', 'HGO', '2026-07'), false);
});
```

- [ ] **Step 4: Run test → FAIL.**

Run: `node --test tests/report-sent-log.test.js`

- [ ] **Step 5: Implement `services/reportSentLog.js`**

```javascript
'use strict';
// Idempotency + audit for report sends. alreadySentToday() dedups a
// (type,site,period) send within the same calendar day.

function _h(db) {
  const rdb = require('../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: db, isPg: false };
}

const _inited = new WeakSet();   // guard per DB handle — see reportConfig note
function _initSchema(db) {
  if (_h(db).isPg) return;
  if (_inited.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS report_sent_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, report_type TEXT, site_code TEXT, period TEXT,
    recipients TEXT, result TEXT, sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS ix_report_sent_log_dedup ON report_sent_log(report_type, site_code, period);`);
  _inited.add(db);
}

function record(db, { report_type, site_code, period, recipients, result }) {
  const { H, isPg } = _h(db);
  const SQL = `INSERT INTO report_sent_log (report_type, site_code, period, recipients, result) VALUES (?, ?, ?, ?, ?)`;
  if (isPg) return (async () => { await H.prepare(SQL).run(report_type, site_code, period, recipients, result); return { ok: true }; })();
  _initSchema(db);
  H.prepare(SQL).run(report_type, site_code, period, recipients, result);
  return { ok: true };
}

// sqlite date('sent_at') vs pg sent_at::date — same-day check.
function alreadySentToday(db, report_type, site_code, period) {
  const { H, isPg } = _h(db);
  if (isPg) return (async () => {
    const r = await H.prepare(`SELECT 1 FROM report_sent_log WHERE report_type=? AND site_code=? AND period=? AND result='ok' AND sent_at::date = current_date LIMIT 1`).get(report_type, site_code, period);
    return !!r;
  })();
  _initSchema(db);
  const r = H.prepare(`SELECT 1 FROM report_sent_log WHERE report_type=? AND site_code=? AND period=? AND result='ok' AND date(sent_at)=date('now') LIMIT 1`).get(report_type, site_code, period);
  return !!r;
}

module.exports = { _initSchema, record, alreadySentToday };
```

- [ ] **Step 6: Run test → PASS.** Run: `node --test tests/report-sent-log.test.js`

- [ ] **Step 7: (PG-gated) Write `tests/pg-reporting.test.js`**

Mirror `tests/pg-reports-config.test.js` structure exactly (same skip-without-PG guard via `tests/pg-helpers.js`). Assert: after `initPgReports`, the four tables exist and a round-trip through `reportConfig.setConfig`/`getConfig` and `reportDirectory.upsertRecipient`/`listRecipients` works under `REPORTS_BACKEND=postgres`.

Run: `PG_ADMIN_URL=… node --test tests/pg-reporting.test.js`
Expected: PASS (or clean skip when no PG).

- [ ] **Step 8: Commit**

```bash
git add db/postgres/reports/005_reporting.sql reports-db.js services/reportSentLog.js tests/report-sent-log.test.js tests/pg-reporting.test.js
git commit -m "feat(reporting): 005_reporting.sql schema + sent-log store + initPgReports wiring"
```

---

## Task 5: `services/mailer.js` — transport adapter (TDD, stub transport)

**Files:**
- Create: `services/mailer.js`
- Test: `tests/mailer.test.js`

- [ ] **Step 1: Write the failing test (inject a stub transport, no real SMTP)**

```javascript
// tests/mailer.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildMailer } = require('../services/mailer');

test('smtp transport composes to/cc/subject/attachments', async () => {
  const sent = [];
  const stub = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' }; } };
  const mailer = buildMailer({ transport: 'smtp', from: 'it@edv-ops.com' }, { makeSmtp: () => stub });
  const r = await mailer.send({ to: 'a@x', cc: ['b@x'], subject: 'S', html: '<b>hi</b>', attachments: [{ filename: 'r.pdf', content: Buffer.from('%PDF') }] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(sent[0].to, 'a@x');
  assert.deepStrictEqual(sent[0].cc, ['b@x']);
  assert.strictEqual(sent[0].from, 'it@edv-ops.com');
  assert.strictEqual(sent[0].attachments[0].filename, 'r.pdf');
});

test('send never throws — returns {ok:false,error} on transport failure', async () => {
  const stub = { sendMail: async () => { throw new Error('smtp down'); } };
  const mailer = buildMailer({ transport: 'smtp', from: 'it@edv-ops.com' }, { makeSmtp: () => stub });
  const r = await mailer.send({ to: 'a@x', subject: 'S', html: 'x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /smtp down/);
});

test('graph transport is stubbed → returns ok:false not-implemented', async () => {
  const mailer = buildMailer({ transport: 'graph' }, {});
  const r = await mailer.send({ to: 'a@x', subject: 'S', html: 'x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /graph.*not/i);
});
```

- [ ] **Step 2: Run test → FAIL.** Run: `node --test tests/mailer.test.js`

- [ ] **Step 3: Implement `services/mailer.js`**

```javascript
'use strict';
// Transport adapter. buildMailer(config, deps) → { send(msg) }.
// send() NEVER throws into the caller — always returns {ok, error?}.
// deps.makeSmtp lets tests inject a stub instead of a real nodemailer transport.

function buildMailer(config = {}, deps = {}) {
  const transport = config.transport || 'smtp';

  function _smtp() {
    if (deps.makeSmtp) return deps.makeSmtp();
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
      host: config.smtp_host, port: +(config.smtp_port || 587),
      secure: String(config.smtp_secure) === '1',
      auth: config.smtp_user ? { user: config.smtp_user, pass: config.smtp_pass } : undefined,
    });
  }

  async function send({ to, cc, subject, html, attachments } = {}) {
    try {
      if (transport === 'graph') return { ok: false, error: 'graph transport not implemented (v1 uses smtp)' };
      const tx = _smtp();
      const info = await tx.sendMail({
        from: config.from, to, cc, replyTo: config.reply_to || undefined,
        subject, html, attachments: attachments || [],
      });
      return { ok: true, messageId: info && info.messageId };
    } catch (e) {
      console.warn('[mailer] send failed:', e.message);
      return { ok: false, error: e.message };
    }
  }

  async function verify() {
    try {
      if (transport === 'graph') return { ok: false, error: 'graph not implemented' };
      const tx = _smtp();
      if (tx.verify) await tx.verify();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  return { send, verify };
}

module.exports = { buildMailer };
```

- [ ] **Step 4: Run test → PASS.** Run: `node --test tests/mailer.test.js`

- [ ] **Step 5: Commit**

```bash
git add services/mailer.js tests/mailer.test.js
git commit -m "feat(reporting): mailer transport adapter (smtp now, graph stub)"
```

---

## Task 6: `services/reportRender.js` — PDF via headless browser (TDD, stubbed spawn)

**Files:**
- Create: `services/reportRender.js`
- Test: `tests/report-render.test.js`

- [ ] **Step 1: Write the failing test (inject a stub spawner)**

```javascript
// tests/report-render.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderPdf } = require('../services/reportRender');

test('no browser found → degrades to htmlOnly result', async () => {
  const r = await renderPdf('<h1>hi</h1>', { findBrowser: () => null });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.htmlOnly, true);
  assert.match(r.reason, /no browser/i);
});

test('successful render returns a pdf buffer', async () => {
  const fakeSpawn = () => ({ on: (ev, cb) => { if (ev === 'close') setImmediate(() => cb(0)); }, kill: () => {} });
  const r = await renderPdf('<h1>hi</h1>', {
    findBrowser: () => 'chrome.exe',
    spawnFn: fakeSpawn,
    readOut: () => Buffer.from('%PDF-1.4 fake'),
  });
  assert.strictEqual(r.ok, true);
  assert.ok(Buffer.isBuffer(r.pdf));
  assert.match(r.pdf.toString('latin1').slice(0, 5), /%PDF/);
});

test('hung process past timeout is killed → htmlOnly', async () => {
  let killed = false;
  const hangSpawn = () => ({ on: () => {}, kill: () => { killed = true; } });
  const r = await renderPdf('<h1>hi</h1>', { findBrowser: () => 'chrome.exe', spawnFn: hangSpawn, timeoutMs: 30 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.htmlOnly, true);
  assert.strictEqual(killed, true);
});
```

- [ ] **Step 2: Run test → FAIL.** Run: `node --test tests/report-render.test.js`

- [ ] **Step 3: Implement `services/reportRender.js`**

```javascript
'use strict';
// renderPdf(html, opts) → {ok, pdf?} | {ok:false, htmlOnly:true, reason}
// Uses the system Chrome/Edge in headless --print-to-pdf mode. All external
// bits (browser discovery, spawn, temp I/O) are injectable for tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TIMEOUT = +(process.env.REPORT_PDF_TIMEOUT_MS || 90000);

function _findBrowser() {
  const candidates = [
    process.env.REPORT_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

async function renderPdf(html, opts = {}) {
  const findBrowser = opts.findBrowser || _findBrowser;
  const spawnFn = opts.spawnFn || spawn;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;
  const browser = findBrowser();
  if (!browser) return { ok: false, htmlOnly: true, reason: 'no browser found for PDF render' };

  const tmp = opts.tmpDir || os.tmpdir();
  const stamp = opts.stamp || 'report';   // caller passes a unique stamp; Date.now avoided for determinism in tests
  const inHtml = path.join(tmp, `sdp-report-${stamp}.html`);
  const outPdf = path.join(tmp, `sdp-report-${stamp}.pdf`);
  try { (opts.writeFile || fs.writeFileSync)(inHtml, html); } catch (e) { return { ok: false, htmlOnly: true, reason: 'temp write failed: ' + e.message }; }

  const args = ['--headless', '--disable-gpu', '--no-sandbox', `--print-to-pdf=${outPdf}`, '--print-to-pdf-no-header', `file://${inHtml.replace(/\\/g, '/')}`];

  return await new Promise((resolve) => {
    let done = false;
    const child = spawnFn(browser, args, { windowsHide: true });
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch {} resolve({ ok: false, htmlOnly: true, reason: 'pdf render timed out' }); } }, timeoutMs);
    child.on('close', (code) => {
      if (done) return; done = true; clearTimeout(timer);
      if (code !== 0) return resolve({ ok: false, htmlOnly: true, reason: 'browser exited ' + code });
      try {
        const pdf = (opts.readOut || ((p) => fs.readFileSync(p)))(outPdf);
        resolve({ ok: true, pdf });
      } catch (e) { resolve({ ok: false, htmlOnly: true, reason: 'pdf read failed: ' + e.message }); }
    });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, htmlOnly: true, reason: 'spawn error: ' + e.message }); } });
  });
}

module.exports = { renderPdf, _findBrowser };
```

- [ ] **Step 4: Run test → PASS.** Run: `node --test tests/report-render.test.js`

- [ ] **Step 5: Commit**

```bash
git add services/reportRender.js tests/report-render.test.js
git commit -m "feat(reporting): reportRender PDF via headless browser + timeout/degradation"
```

---

## Task 7: `services/siteReport.js` — compose readers into the §4 contract (TDD via DI)

Composes existing PG-forked readers. Uses dependency injection (`deps` object) so tests supply stubs — the exact pattern of `services/execSummary.loadExecSummary(deps)`.

**Files:**
- Create: `services/siteReport.js`
- Test: `tests/site-report.test.js`

- [ ] **Step 1: Write the failing test (all readers stubbed)**

```javascript
// tests/site-report.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { siteReportData } = require('../services/siteReport');

const deps = {
  meetingsSummary: async () => ({
    site_code: 'HGO', month_label: 'July 2026', available: true,
    kpis: { pvs_held: 2, pvs_target: 3, open_issues: 4, high_open: 1, resolved: 6, new: 3, escalations: 1, signoff_pct: 80, overdue_actions_count: 2 },
    departments: [{ department: 'Maintenance', status: 'on_track', last_pv: '2026-07-05' }],
  }),
  meetingsActions: async () => [{ description: 'Fix X', owner: 'Jean', target_date: '2026-07-20' }],
  inspectionAggregate: async () => ({ total: 1, findings_critical_major: 0, overall_risk: 'low', overdue: [] }),
  inspectionActions: async () => [{ description: 'Replace UPS', owner: 'Sam', due_date: '2026-07-30' }],
  helpdesk: async () => ({ created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [{ category: 'Network', count: 12 }], recurring: [] }),
  technicians: async () => [{ name: 'Tech A', assigned: 20, resolved: 18, avg_resolution_h: 6, reopened: 1, current_load: 4 }],
  siteStatus: () => 'degraded',
  prevComposite: async () => 70,
};

test('assembles all six blocks + fm view', async () => {
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, deps);
  assert.strictEqual(r.site_code, 'HGO');
  assert.ok(r.score && typeof r.score.composite === 'number');
  assert.ok(Array.isArray(r.score.two_moves));
  assert.strictEqual(r.meetings.pvs_held, 2);
  assert.strictEqual(r.inspection.inspections_done, 1);
  assert.strictEqual(r.helpdesk.created, 40);
  assert.strictEqual(r.technicians.length, 1);
  assert.ok(Array.isArray(r.recommended));
  assert.strictEqual(r.fm.site_status, 'degraded');
  assert.strictEqual(r.fm.major_incidents, 1);
});

test('a failing reader degrades to an empty block, not a throw', async () => {
  const broken = { ...deps, helpdesk: async () => { throw new Error('db down'); } };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, broken);
  assert.deepStrictEqual(r.helpdesk, { created: 0, resolved: 0, backlog: 0, sla_overdue: 0, major_incidents: 0, top_categories: [], recurring: [] });
  assert.ok(r.score);   // still assembled
});

test('technicians get deterministic alerts', async () => {
  const overloaded = { ...deps, technicians: async () => [
    { name: 'Busy', assigned: 30, resolved: 12, avg_resolution_h: 9, reopened: 0, current_load: 20 },
    { name: 'Norm', assigned: 10, resolved: 9, avg_resolution_h: 5, reopened: 0, current_load: 4 },
  ] };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, overloaded);
  const busy = r.technicians.find(t => t.name === 'Busy');
  assert.ok(busy.alerts.includes('overloaded') || busy.alerts.includes('low_closure'));
});
```

- [ ] **Step 2: Run test → FAIL.** Run: `node --test tests/site-report.test.js`

- [ ] **Step 3: Implement `services/siteReport.js`**

```javascript
'use strict';
// siteReportData(siteCode, period, deps) → the spec §4 JSON contract.
// Every reader call is wrapped: a failure degrades to an empty block (never a
// 500), matching reportPayload.build's resilience doctrine. deps are injected
// so this is unit-testable without a DB.
const { computeSiteScore } = require('./siteScore');

const EMPTY = {
  meetings: { pvs_held: 0, pvs_target: 0, open_issues: 0, high_open: 0, resolved: 0, new: 0, escalations: 0, departments: [], overdue_actions: [] },
  inspection: { inspections_done: 0, findings_critical_major: 0, overall_risk: '—', overdue_actions: [] },
  helpdesk: { created: 0, resolved: 0, backlog: 0, sla_overdue: 0, major_incidents: 0, top_categories: [], recurring: [] },
};

async function _safe(fn, fallback, label) {
  try { const v = await fn(); return v == null ? fallback : v; }
  catch (e) { console.warn(`[site-report] ${label} failed:`, e.message); return fallback; }
}

function _techAlerts(t, medianLoad) {
  const a = [];
  if (t.current_load > 1.5 * medianLoad) a.push('overloaded');
  if (t.assigned >= 5 && (t.resolved / t.assigned) < 0.6) a.push('low_closure');
  if ((t.sla_overdue || 0) >= 3) a.push('repeat_late');
  return a;
}

async function siteReportData(siteCode, period, deps) {
  const ms = await _safe(() => deps.meetingsSummary(siteCode, period), { kpis: {}, departments: [] }, 'meetingsSummary');
  const mk = ms.kpis || {};
  const mActions = await _safe(() => deps.meetingsActions(siteCode), [], 'meetingsActions');
  const insp = await _safe(() => deps.inspectionAggregate(siteCode), {}, 'inspectionAggregate');
  const iActions = await _safe(() => deps.inspectionActions(siteCode), [], 'inspectionActions');
  const hd = await _safe(() => deps.helpdesk(siteCode, period), EMPTY.helpdesk, 'helpdesk');
  const techsRaw = await _safe(() => deps.technicians(siteCode, period), [], 'technicians');
  const siteStatusRaw = (() => { try { return deps.siteStatus(siteCode) || 'operational'; } catch { return 'operational'; } })();
  const prev = await _safe(() => deps.prevComposite(siteCode, period), null, 'prevComposite');

  const meetings = {
    pvs_held: mk.pvs_held || 0, pvs_target: mk.pvs_target || 0, open_issues: mk.open_issues || 0,
    high_open: mk.high_open || 0, resolved: mk.resolved || 0, new: mk.new || 0, escalations: mk.escalations || 0,
    departments: ms.departments || [],
    overdue_actions: mActions.map(a => ({ description: a.description, owner: a.owner, target_date: a.target_date })),
  };
  const inspection = {
    inspections_done: insp.total || 0, findings_critical_major: insp.findings_critical_major || 0,
    overall_risk: insp.overall_risk || '—',
    overdue_actions: iActions.map(a => ({ description: a.description, owner: a.owner, due_date: a.due_date })),
  };
  const helpdesk = { created: hd.created || 0, resolved: hd.resolved || 0, backlog: hd.backlog || 0, sla_overdue: hd.sla_overdue || 0, major_incidents: hd.major_incidents || 0, top_categories: hd.top_categories || [], recurring: hd.recurring || [] };

  const loads = techsRaw.map(t => t.current_load || 0).sort((a, b) => a - b);
  const medianLoad = loads.length ? loads[Math.floor(loads.length / 2)] : 0;
  const technicians = techsRaw.map(t => ({ ...t, alerts: _techAlerts(t, medianLoad || 1) }));

  const score = computeSiteScore(
    { pvs_held: meetings.pvs_held, pvs_target: meetings.pvs_target, resolved: meetings.resolved, open_issues: meetings.open_issues, overdue_actions_count: mk.overdue_actions_count || meetings.overdue_actions.length, signoff_pct: mk.signoff_pct || 0 },
    { inspections_done: inspection.inspections_done, findings_critical_major: inspection.findings_critical_major },
    prev,
  );

  const recommended = _recommend(meetings, inspection, helpdesk, technicians);
  const fm = _financeView(meetings, inspection, helpdesk, siteStatusRaw);

  return {
    site_code: siteCode, site_name: ms.site_name || siteCode,
    period: { ...period, label: ms.month_label || '' },
    score, meetings, inspection, helpdesk, technicians, recommended, fm,
  };
}

function _recommend(m, i, h, techs) {
  const out = [];
  if (m.high_open > 0) out.push({ kind: 'escalate', text: `${m.high_open} HIGH issue(s) open — escalate to council if unresolved` });
  if (i.findings_critical_major > 0) out.push({ kind: 'visit', text: `${i.findings_critical_major} critical/major inspection finding(s) — schedule a fix visit` });
  if (m.pvs_held < m.pvs_target) out.push({ kind: 'meeting', text: `Hold the remaining ${m.pvs_target - m.pvs_held} department PV(s) this month` });
  if (techs.some(t => t.alerts.includes('overloaded'))) out.push({ kind: 'support', text: 'One or more technicians overloaded — rebalance assignments' });
  return out;
}

function _financeView(m, i, h, siteStatus) {
  const svc = siteStatus === 'major' ? 'At risk' : siteStatus === 'degraded' ? 'Under strain' : 'Stable';
  const routine = (m.pvs_held >= m.pvs_target && i.inspections_done > 0) ? 'On track' : 'Slipping';
  const supportPct = h.created ? Math.round((h.resolved / h.created) * 100) : 100;
  return {
    service_level_label: svc, major_incidents: h.major_incidents, routine_discipline_label: routine,
    site_status: siteStatus,
    user_support: { requests: h.created, resolved_in_time_pct: supportPct, avg_resolution_label: '—', overdue: h.sla_overdue },
    top_frustrations: (h.recurring || []).slice(0, 3).map(r => r.label || r.category).filter(Boolean),
    managerial_attention: _attention(m, i),
    message: {
      good: m.resolved ? [`${m.resolved} issue(s) resolved this month`] : [],
      improve: m.high_open ? [`${m.high_open} HIGH issue(s) still open`] : [],
      decide: i.findings_critical_major ? [`Approve remediation for ${i.findings_critical_major} critical finding(s)`] : [],
    },
  };
}

function _attention(m, i) {
  const rows = [];
  (m.overdue_actions || []).slice(0, 3).forEach(a => rows.push({ subject: a.description, situation: `Owner ${a.owner}, due ${a.target_date}`, impact: 'Operational delay', action_expected: 'Follow up with owner' }));
  return rows;
}

module.exports = { siteReportData };
```

- [ ] **Step 4: Run test → PASS.** Run: `node --test tests/site-report.test.js`

- [ ] **Step 5: Commit**

```bash
git add services/siteReport.js tests/site-report.test.js
git commit -m "feat(reporting): siteReport composes readers into the site-report contract"
```

---

## Task 8: Server routes + smoke tests

Wire the services behind the existing `/api/` auth gate. All routes require `requireReportSession` + `requireAdmin` (config/recipients/schedule/test-smtp) — `site-data` allows viewer+ (it's the live page's feed). Follow the exact auth-middleware + `reportsDb`-handle pattern already used by the exec-editorial routes in `server.js`.

**Files:**
- Modify: `server.js` (new routes near the other `/api/reports/*` handlers; boot-time `_initSchema` calls for the sqlite path)
- Modify: `server.js` (`initPgReports` is already awaited at boot — no change; sqlite schema init: call each new module's `_initSchema(reportsDb.db)` in the sqlite branch of boot, mirroring how `groupPresets._initSchema` is invoked)
- Test: `tests/reporting-routes.smoke.test.js`

- [ ] **Step 1: Add the routes to `server.js`**

Locate the block where exec-editorial routes are registered (`GET/PUT /api/exec/editorial`). Add alongside:

```javascript
// ── Reporting suite (Foundation) ──────────────────────────────────────
// NOTE: reportSchedule is required + its route registered in Task 9 (the module
// doesn't exist yet at this task). Only the config/recipients/site-data/test-smtp
// routes are added here.
const reportConfig    = require('./services/reportConfig');
const reportDirectory = require('./services/reportDirectory');
const reportSentLog   = require('./services/reportSentLog');
const { siteReportData } = require('./services/siteReport');
const { buildSiteReportDeps } = require('./services/siteReportDeps'); // thin factory, see Step 1b

// sqlite schema init at boot (pg is handled by initPgReports). Guard on backend.
if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() !== 'postgres') {
  reportConfig._initSchema(reportsDb.db);
  reportDirectory._initSchema(reportsDb.db);
  reportSentLog._initSchema(reportsDb.db);
}

app.get('/api/reports/config', requireReportSession, requireAdmin, async (req, res) => {
  try { res.json(await reportConfig.getConfig(reportsDb.db)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/reports/config', requireReportSession, requireAdmin, async (req, res) => {
  try { res.json(await reportConfig.setConfig(reportsDb.db, req.body || {}, req.reportUser?.username)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reports/recipients', requireReportSession, requireAdmin, async (req, res) => {
  try { res.json(await reportDirectory.listRecipients(reportsDb.db)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/reports/recipients/:site', requireReportSession, requireAdmin, async (req, res) => {
  try { res.json(await reportDirectory.upsertRecipient(reportsDb.db, req.params.site, req.body || {}, req.reportUser?.username)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// (schedule routes are registered in Task 9, after reportSchedule.js exists)

app.get('/api/reports/site-data', requireReportSession, async (req, res) => {
  try {
    const site = String(req.query.site || '');
    if (site === 'all') return res.json({ site_code: 'all', consolidated: true, note: 'pick a site (consolidated view lands in sub-project 2)' });
    const now = new Date();
    const year = +(req.query.year || now.getFullYear());
    const month = +(req.query.month || (now.getMonth() + 1));
    const kind = req.query.kind === 'monthly' ? 'monthly' : 'weekly';
    const deps = buildSiteReportDeps();
    const data = await siteReportData(site, { year, month, kind }, deps);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reports/test-smtp', requireReportSession, requireAdmin, async (req, res) => {
  try {
    const { buildMailer } = require('./services/mailer');
    const cfg = await reportConfig.getConfig(reportsDb.db);
    res.json(await buildMailer(cfg).verify());
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 1b: Create `services/siteReportDeps.js`** — the ONLY place that binds the abstract `deps` to the real DB readers (keeps `siteReport.js` pure). Maps `site_code`↔`site_id` via the existing alias helpers.

```javascript
'use strict';
// Binds siteReport's injected deps to the live readers. Kept separate so
// siteReport.js stays pure/testable. Resolves site_code (HGO) ↔ helpdesk
// site name/id via existing alias maps.
function buildSiteReportDeps() {
  const meetingsDb = require('../meetings-db');
  const inspectionDb = require('../inspection-db');
  const reportsDb = require('../reports-db');
  return {
    meetingsSummary: (code, p) => meetingsDb.getSiteMonthlyMeetingSummary(code, p.year, p.month),
    meetingsActions: (code) => meetingsDb.listActions({ site: code, status: 'open' }),
    inspectionAggregate: (code) => inspectionDb.aggregate({ site: code }),
    inspectionActions: (code) => inspectionDb.listActions({ site: code, status: 'open' }),
    helpdesk: (code, p) => reportsDb.getCalendarMonthlyHelpdesk(_siteId(reportsDb, code), p.year, p.month),
    technicians: (code, p) => reportsDb.getSiteTechnicianStats ? reportsDb.getSiteTechnicianStats(code, p.year, p.month) : [],
    siteStatus: (code) => 'operational',   // wired to deriveSiteStatus in sub-project 2
    prevComposite: () => null,             // wired in sub-project 2 (needs prev-period compose)
  };
}
// site_code → helpdesk site name/id. Foundation: best-effort passthrough; the
// real alias resolution + getSiteTechnicianStats land in sub-project 2.
function _siteId(reportsDb, code) { return code; }
module.exports = { buildSiteReportDeps };
```

> **Scope note:** `getSiteTechnicianStats`, real `siteStatus`, `prevComposite`, and precise `site_id` resolution are **stubbed to safe no-ops here** (empty arrays / nulls / passthrough) and completed in sub-project 2 (Coordinator report). Foundation only needs the plumbing + the live page rendering *something*. This keeps the Foundation slice shippable without the full reader wiring.

- [ ] **Step 2: Write the smoke test (sqlite mode, boots the app)**

```javascript
// tests/reporting-routes.smoke.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
// Boot the app the same way tests/sso-routes.smoke.test.js does (require server,
// use a test session token / X-Dash-Key). Follow that file's harness verbatim.
// Assertions:
//  - GET /api/reports/config (admin) → 200, body.transport === 'smtp'
//  - PUT /api/reports/config {smtp_host:'x'} → 200, echoes smtp_host
//  - PUT /api/reports/recipients/HGO {coordinator_name:'X'} → 200
//  - GET /api/reports/recipients → array includes HGO
//  - GET /api/reports/site-data?site=HGO → 200, body.score present
//  - GET /api/reports/config WITHOUT auth → 401
test('reporting routes smoke — see harness in sso-routes.smoke.test.js', () => { assert.ok(true); });
```

> The implementer copies the boot + auth harness from `tests/sso-routes.smoke.test.js` (or `tests/exec-routes.smoke.test.js`) and fills in the real assertions above. The placeholder `assert.ok(true)` must be replaced.

- [ ] **Step 3: Run smoke test → PASS.** Run: `node --test tests/reporting-routes.smoke.test.js`

- [ ] **Step 4: Full suite regression.** Run: `node --test` (from repo root)
Expected: all green, no regressions in reports.db / exec / meetings / inspection suites.

- [ ] **Step 5: Commit**

```bash
git add server.js services/siteReportDeps.js tests/reporting-routes.smoke.test.js
git commit -m "feat(reporting): /api/reports/* routes + site-report deps binder"
```

---

## Task 9: `services/reportSchedule.js` schtasks bridge + `send-reports.js` CLI

`reportSchedule` stores rows AND creates one Windows task per enabled `(type × cadence)` — mirrors `services/backupSchedule.js` (which delegates to `Manage-SDP.ps1 -Schedule`). The scheduled task runs `node tools/reports/send-reports.js --type=… --cadence=…`.

**Files:**
- Create/extend: `services/reportSchedule.js` (store from Task 4 + schtasks methods)
- Create: `tools/reports/send-reports.js`
- Test: `tests/report-schedule.test.js`

- [ ] **Step 1: Write the failing test (store + SCHTASKS_CMD override, like backup-schedule.test.js)**

```javascript
// tests/report-schedule.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const sched = require('../services/reportSchedule');

function freshDb() { const db = new Database(':memory:'); sched._initSchema(db); return db; }

test('setSchedule persists a (type,cadence) row + returns tasks planned', () => {
  const db = freshDb();
  const calls = [];
  const r = sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 1, day: 'MON', time: '07:30' }, 'azize', { runTask: (a) => { calls.push(a); return { ok: true }; } });
  assert.strictEqual(r.ok, true);
  const rows = sched.getSchedules(db);
  const row = rows.find(x => x.report_type === 'finance' && x.cadence === 'weekly');
  assert.strictEqual(row.enabled, 1);
  assert.strictEqual(row.day, 'MON');
  assert.ok(calls.length >= 1);   // a task-create was attempted
});

test('invalid time rejected', () => {
  const db = freshDb();
  assert.throws(() => sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 1, day: 'MON', time: '25:99' }, 'a', { runTask: () => ({ ok: true }) }), /time/i);
});

test('disable removes the task + flips enabled=0', () => {
  const db = freshDb();
  const calls = [];
  sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 1, day: 'MON', time: '07:30' }, 'a', { runTask: (x) => { calls.push(x); return { ok: true }; } });
  sched.setSchedule(db, { report_type: 'finance', cadence: 'weekly', enabled: 0 }, 'a', { runTask: (x) => { calls.push(x); return { ok: true }; } });
  const row = sched.getSchedules(db).find(x => x.report_type === 'finance' && x.cadence === 'weekly');
  assert.strictEqual(row.enabled, 0);
});
```

- [ ] **Step 2: Run test → FAIL.** Run: `node --test tests/report-schedule.test.js`

- [ ] **Step 3: Implement `services/reportSchedule.js`** (store + schtasks; `runTask` injectable for tests, defaults to a real `schtasks` execFile). Requirements:
  - `_initSchema(db)` uses the **WeakSet-per-handle guard** (same as Tasks 2/3/4 — NOT a module-level boolean, or the multi-DB tests fail). Creates `report_schedules` (PK `(report_type, cadence)`) for the sqlite path; pg is handled by 005_reporting.sql.
  - `getSchedules(db)` + the row upsert have the sqlite + PG fork via `_h(db)`, matching the other services.
  - `setSchedule(db, {report_type, cadence, enabled, day, time}, user, {runTask})` — enforce `HH:mm` + day validation like `backupSchedule._assertTime`. On enable: create/replace the Windows task `SDP-Report-<type>-<cadence>` (`runTask`, injectable) that runs `node <APP_ROOT>/tools/reports/send-reports.js --type=<type> --cadence=<cadence>`, THEN write the row (write only after the task command succeeds — no half-apply). On task-create failure, throw with the schtasks stderr and leave the previous row state. On disable: delete the task (ignore "not found") + set `enabled=0`.

- [ ] **Step 4: Run test → PASS.** Run: `node --test tests/report-schedule.test.js`

- [ ] **Step 4b: Register the schedule route + boot-init in `server.js`** (moved here from Task 8 because the module now exists). In the reporting-suite block add the require + the sqlite boot-init line, and the two routes:

```javascript
const reportSchedule = require('./services/reportSchedule');
if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() !== 'postgres') reportSchedule._initSchema(reportsDb.db);

app.get('/api/reports/schedule', requireReportSession, requireAdmin, async (req, res) => {
  try { res.json(await reportSchedule.getSchedules(reportsDb.db)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/reports/schedule', requireReportSession, requireAdmin, async (req, res) => {
  try { res.json(await reportSchedule.setSchedule(reportsDb.db, req.body || {}, req.reportUser?.username)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
```

Add a `GET /api/reports/schedule → 200 (array)` + `PUT … → 200` assertion pair to `tests/reporting-routes.smoke.test.js` and re-run it (PASS).

- [ ] **Step 5: Implement `tools/reports/send-reports.js` (Foundation scope: plan-only)**

```javascript
'use strict';
// Scheduled entry point. Foundation scope: resolves config + recipients + dedup
// and PRINTS what it would send (no composing yet — that lands in sub-project 2).
// Usage: node tools/reports/send-reports.js --type=coordinator --cadence=weekly
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));

(async () => {
  const reportsDb = require('../../reports-db');
  if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await reportsDb.initPgReports();
  const reportConfig = require('../../services/reportConfig');
  const reportDirectory = require('../../services/reportDirectory');
  const cfg = await reportConfig.getConfig(reportsDb.db);
  const recipients = await reportDirectory.listRecipients(reportsDb.db);
  const kind = args.type === 'finance' ? 'fm' : 'coordinator';
  // resolveFromRows takes the ALREADY-FETCHED rows (not a db handle) — see Task 3 / Step 6.
  const sendable = recipients.filter(r => reportDirectory.resolveFromRows(recipients, r.site_code, kind, { neverSendUnconfirmed: cfg.never_send_unconfirmed === '1' }));
  console.log(`[send-reports] type=${args.type} cadence=${args.cadence} → ${sendable.length}/${recipients.length} site(s) have a confirmed recipient. (composing lands in sub-project 2)`);
  process.exit(0);
})().catch(e => { console.error('[send-reports] fatal:', e.message); process.exit(1); });
```

> `resolveFromRows` (used above) takes the already-fetched `recipients` array as its first arg — a sibling of `resolveRecipient(db, …)`. Add `resolveFromRows(rows, site, kind, opts)` to `reportDirectory.js` (the row-matching core) and have `resolveRecipient(db, …)` delegate to it after fetching the rows. Add a unit test for `resolveFromRows`.

- [ ] **Step 6: Adjust `reportDirectory.js` + test for `resolveFromRows`, re-run its test → PASS.**

- [ ] **Step 7: Commit**

```bash
git add services/reportSchedule.js services/reportDirectory.js tools/reports/send-reports.js tests/report-schedule.test.js tests/report-directory.test.js
git commit -m "feat(reporting): reportSchedule schtasks bridge + send-reports CLI (plan-only)"
```

---

## Task 10: `public/site-report.html` — live scoreboard page

The live page. Reuses the user's Chart.js scoreboard from `IT_Business_Reviews_Inspection_Assurance_Dashboard.html`, but its hardcoded `const DB = {…}` is replaced by a `fetch('/api/reports/site-data?site=…')`. `?site=all` → the consolidated view (deferred rendering-wise to sub-project 2; Foundation renders the single-site view and shows a "select a site" state for `all`).

**Files:**
- Create: `public/site-report.html`
- Modify: `server.js` (route + `_htmlCache` boot-load, following the CLAUDE.md "adding a new HTML page" recipe)

- [ ] **Step 1: Create `public/site-report.html`**

Structure (no inline business logic beyond fetch + render):
- `<head>`: `_tokens.css`, `brand/icons.js`, Chart.js (CDN — already CSP-allowed), and an external `<script src="site-report.js">` (create alongside) that does the fetch + DOM render. Per CLAUDE.md, prefer an external JS file so URL-versioning applies.
- Body blocks in reading order matching spec §4: score hero (composite + RAG chip + trend + two_moves), meetings, inspection, helpdesk, technicians table, recommended actions. Chart.js for the score gauge + a category bar.
- Reads `?site=` + `?period=` from the URL; on `all`, shows an empty-state "Pick a site" (consolidated deferred).

- [ ] **Step 2: Add the route + boot-load in `server.js`** (copy the exact recipe from CLAUDE.md "When adding a new HTML page"):

```javascript
// in the _htmlCache boot-load .forEach(loadHtml) array:
'site-report.html',
// route near the other sendHtmlPage handlers:
app.get('/site-report.html', (req, res) => {
  sendHtmlPage(res, 'site-report.html', false, 'Site report unavailable');
});
```

- [ ] **Step 3: Manual verification via the preview browser**

Start the dev server (preview_start `{name}`), navigate to `/site-report.html?site=HGO`, and confirm via `read_console_messages` (no errors) + `read_page` (the score hero + blocks render with the stub/live data). Since Task 8's deps are partly stubbed, expect zeros in the not-yet-wired blocks — that's acceptable for Foundation. Screenshot as proof.

- [ ] **Step 4: Commit**

```bash
git add public/site-report.html public/site-report.js server.js
git commit -m "feat(reporting): live site-report scoreboard page (fed by /api/reports/site-data)"
```

---

## Task 11: Admin config card — "Automated Reports" (3 tabs) on `reports.html`

**Files:**
- Modify: `public/reports.html` (new admin card + modal/tab markup + JS)

- [ ] **Step 1: Add the card to `reports.html#admin`** (super_admin only, matching the existing Users/Sites/Departments/Risk-Register/Exec-View card pattern — reuse `.modal-overlay.open`, `toast()`, `esc()`, `.user-table`). Three tabs:
  - **Recipients** — table of `report_recipients` (site, coordinator name/email + confirmed toggle, FM name/email + confirmed toggle, cc). Edit modal per site. A "Suggest from meetings" button (calls a suggest endpoint — Foundation: wire the button to `PUT /api/reports/recipients/:site` manual entry; the meetings-backed suggest lands in sub-project 2, so gate the button with a "coming soon" tooltip OR omit it this slice).
  - **Schedule** — per report type (Coordinator / Finance / Group), a weekly toggle (day + time) and a monthly toggle (day-of-month/LAST + time), backed by `GET/PUT /api/reports/schedule`.
  - **Delivery settings** — transport (smtp/graph), SMTP host/port/secure/user/pass, from, reply-to, default domain, formats, `never_send_unconfirmed` safety toggle, group recipient. "Test connection" button → `POST /api/reports/test-smtp`. Backed by `GET/PUT /api/reports/config`.

- [ ] **Step 2: Verify in the preview browser** — open `reports.html#admin` as super_admin, open each tab, round-trip a config value + a recipient row, confirm the toast + reload shows persistence. Screenshot each tab.

- [ ] **Step 3: Commit**

```bash
git add public/reports.html
git commit -m "feat(reporting): Automated Reports admin card (recipients / schedule / delivery)"
```

---

## Task 12: PG copy script + full regression + docs

**Files:**
- Create: `tools/pg/copy-reports-reporting.js`
- Modify: `tools/pg/copy-reports-all.js` (add the step)
- Modify: `tools/pg/README.md` (a "4E reporting" section)
- Modify: `CLAUDE.md` (a short "Reporting Suite (Foundation)" module section under Key Files + a one-line current-state note)

- [ ] **Step 1: Implement `copy-reports-reporting.js`** — copy the four tables sqlite→PG (mirror `copy-reports-config.js` exactly: read each table from the sqlite reports.db, insert into PG with `ON CONFLICT DO NOTHING`/upsert). Add a parity assertion.

- [ ] **Step 2: Wire into `copy-reports-all.js`** after the config/reports/hot copy steps.

- [ ] **Step 3: (PG-gated) Run the copy + parity.** Run: `PG_ADMIN_URL=… node tools/pg/copy-reports-reporting.js` then re-run `tests/pg-reporting.test.js`. Expected: parity PASS (or skip without PG).

- [ ] **Step 4: Full suite regression.** Run: `node --test`
Expected: all green.

- [ ] **Step 5: Update docs** — `tools/pg/README.md` (4E section) + `CLAUDE.md` (Key Files rows for the new services + a current-state line: "Reporting Suite Foundation landed on `feat/reporting-suite`; sub-projects 2-4 pending").

- [ ] **Step 6: Commit**

```bash
git add tools/pg/copy-reports-reporting.js tools/pg/copy-reports-all.js tools/pg/README.md CLAUDE.md
git commit -m "chore(reporting): pg copy for reporting tables + docs + full regression green"
```

---

## Done criteria (Foundation)

- [ ] All new unit + smoke tests green under sqlite (`node --test`).
- [ ] PG-gated tests green when `PG_ADMIN_URL` is set; clean skip otherwise.
- [ ] `/site-report.html?site=HGO` renders the score hero + blocks (zeros allowed where deps are stubbed) with no console errors.
- [ ] The Automated Reports admin card round-trips config + a recipient row + a schedule row (schtasks call may be stubbed/absent on a non-Windows CI — the store write must still succeed).
- [ ] No regression in existing suites.
- [ ] Nothing auto-sends email (Foundation ships the plumbing only; `send-reports.js` is plan-only).

**Deferred to sub-project 2 (Coordinator report), explicitly NOT in this plan:** the coordinator/FM HTML template composers; real `siteStatus`/`prevComposite`/`getSiteTechnicianStats`/`site_id` wiring in `siteReportDeps.js`; `meetings-db.getSiteContacts`; the consolidated `all`-sites rendering; actual email/PDF sending.
