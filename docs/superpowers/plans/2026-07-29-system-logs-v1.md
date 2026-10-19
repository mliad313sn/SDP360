# System Logs (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A super-admin **System Logs** module — one `system_log` table capturing auth / identity / config / report events (dual-backend), a filterable+exportable page (Log entries + Analytics), built on a fire-and-forget `logEvent` helper. Per spec `docs/superpowers/specs/2026-07-29-system-logs-v1-design.md`.

**Architecture:** New `system_log` table in reports.db (sqlite + pg fork, `REPORTS_BACKEND`). `logEvent(...)` writes it, swallowing errors (never breaks a request). Events instrumented at the login/logout/force-logout/user-CRUD/config-save call sites; the existing `logAudit` gains ONE line to mirror report events in. Readers + super_admin routes + a standalone `system-logs.html` page (in-page tabs like `assets.html`).

**Tech Stack:** Node/Express, better-sqlite3 + `services/pgDb.js`, Chart.js (page), `node --test`.

**Branch:** `feat/system-logs`. **Backend defaults:** access = **super_admin only**; report_audit backfill = **idempotent, on first boot** (history preserved).

---

## File Structure

| File | Responsibility |
|---|---|
| `reports-db.js` (modify) | `system_log` CREATE (sqlite `_initSchema`) + pg ALTER-guard in `initPgReports`; `_isRiskAction`, `logEvent`, `_logCtx`, `listSystemLog`, `countSystemLog`, `getSystemLogAnalytics`, one-time `_backfillSystemLogFromAudit`; +1 line in `logAudit` |
| `db/postgres/reports/006_system_log.sql` (create) | pg table + indexes |
| `server.js` (modify) | 4 routes (list/analytics/export.csv/export.json) above `/api/reports/:id`; instrument login/logout/force-logout/user-CRUD/config-saves with `logEvent`; add `system-logs.html` to `_htmlCache` + a `sendHtmlPage` route |
| `public/system-logs.html` (create) | the page (shell banner + in-page tabs + filters + table + Chart.js analytics) |
| `public/_shell.js` (modify) | `NAV` super_admin entry `system-logs`, icon `ICON_LIB['shield-check']` |
| `public/reports.html` (modify) | a link/card to System Logs in `#admin` |
| `tools/pg/copy-reports-all.js` (modify) | include `system_log` in the copy set |
| `tests/system-log.test.js` (create) | predicate + round-trip + readers + mirror + non-blocking |
| `tests/system-log-routes.smoke.test.js` (create) | gate 403, filter un-500-able, `{rows,total}`, export shape |

---

## Task 1: `system_log` table + `logEvent` + predicate + `_logCtx`

**Files:** Modify `reports-db.js`; Create `db/postgres/reports/006_system_log.sql`; Test `tests/system-log.test.js`.

- [ ] **Step 1: Write the failing test** — `tests/system-log.test.js`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Fresh sqlite reports.db in a temp dir (REPORTS_BACKEND defaults to sqlite).
process.env.REPORTS_BACKEND = 'sqlite';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syslog-'));
process.env.SDP_DATA_DIR = tmp;
const rdb = require('../reports-db.js');

test('_isRiskAction flags exactly the security actions', () => {
  const risk = ['login_failed','session_killed','user_deleted','user_role_changed','password_reset','report_deleted'];
  const safe = ['login_success','logout','user_created','user_updated','config_saved','report_edited_infra'];
  for (const a of risk) assert.equal(rdb._isRiskAction(a), true, a);
  for (const a of safe) assert.equal(rdb._isRiskAction(a), false, a);
});

test('logEvent round-trips + derives risk + JSON details', async () => {
  await rdb.logEvent({ category:'auth', action:'login_failed', actor:'mallory', ip:'10.0.0.9', details:{ reason:'bad_password' } });
  await rdb.logEvent({ category:'auth', action:'login_success', actor:'admin', actor_id:1, ip:'10.0.0.1' });
  const { rows, total } = await rdb.listSystemLog({}, { limit: 10, offset: 0 });
  assert.equal(total, 2);
  const failed = rows.find(r => r.action === 'login_failed');
  assert.equal(failed.risk, 1, 'login_failed is risk');
  assert.equal(failed.actor, 'mallory');
  assert.equal(JSON.parse(failed.details).reason, 'bad_password');
  assert.equal(rows.find(r => r.action==='login_success').risk, 0);
});

test('logEvent NEVER throws to the caller even on a broken write', async () => {
  // Pass a deliberately bad category shape; must resolve, not reject.
  await assert.doesNotReject(() => Promise.resolve(rdb.logEvent({ action:'x' })));
});
```

- [ ] **Step 2: Run — expect FAIL** (`rdb._isRiskAction is not a function`)

Run: `node --test --test-force-exit tests/system-log.test.js`

- [ ] **Step 3: Add the pg schema** — `db/postgres/reports/006_system_log.sql`

```sql
CREATE TABLE IF NOT EXISTS system_log (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts        TEXT NOT NULL,
  category  TEXT NOT NULL,
  action    TEXT NOT NULL,
  actor     TEXT,
  actor_id  INTEGER,
  target    TEXT,
  details   TEXT,
  ip        TEXT,
  risk      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_syslog_ts       ON system_log(ts);
CREATE INDEX IF NOT EXISTS idx_syslog_category ON system_log(category);
CREATE INDEX IF NOT EXISTS idx_syslog_action   ON system_log(action);
CREATE INDEX IF NOT EXISTS idx_syslog_actor    ON system_log(actor);
CREATE INDEX IF NOT EXISTS idx_syslog_risk     ON system_log(risk);
```

- [ ] **Step 4: sqlite CREATE in `_initSchema`** (mirror the pg columns; sqlite `INTEGER PRIMARY KEY` = rowid)

```sql
CREATE TABLE IF NOT EXISTS system_log (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL,
  actor TEXT, actor_id INTEGER, target TEXT, details TEXT, ip TEXT, risk INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_syslog_ts ON system_log(ts);
-- (+ the same 4 other indexes)
```
And in `initPgReports`, exec `006_system_log.sql` alongside the other numbered files.

- [ ] **Step 5: Implement the helpers in `reports-db.js`**

```js
const _RISK_ACTIONS = new Set([
  'login_failed','session_killed','user_deleted','user_role_changed','password_reset','report_deleted'
]);
function _isRiskAction(action) { return _RISK_ACTIONS.has(String(action || '')); }

function _logCtx(req) {                       // authenticated call sites only
  const u = (req && req.reportUser) || {};
  return { actor: u.username || 'anonymous', actor_id: u.id != null ? u.id : null,
           ip: (req && (req.ip || (req.headers && (req.headers['x-forwarded-for']||'').split(',')[0].trim()))) || null };
}

async function logEvent(ev = {}) {
  try {
    const row = {
      ts: new Date().toISOString(),
      category: String(ev.category || 'system'),
      action: String(ev.action || 'unknown'),
      actor: ev.actor != null ? String(ev.actor) : 'system',
      actor_id: ev.actor_id != null ? ev.actor_id : null,
      target: ev.target != null ? String(ev.target) : null,
      details: ev.details == null ? null : (typeof ev.details === 'string' ? ev.details : JSON.stringify(ev.details)),
      ip: ev.ip != null ? String(ev.ip) : null,
      risk: ev.risk != null ? (ev.risk ? 1 : 0) : (_isRiskAction(ev.action) ? 1 : 0),
    };
    if (REPORTS_BACKEND === 'postgres') { await _logEventPg(row); }
    else { getDB().prepare(
      `INSERT INTO system_log (ts,category,action,actor,actor_id,target,details,ip,risk)
       VALUES (@ts,@category,@action,@actor,@actor_id,@target,@details,@ip,@risk)`).run(row); }
  } catch (e) { console.warn('[system-log] logEvent failed (swallowed):', e.message); }
}
async function _logEventPg(row) {
  await pgDb.prepare(
    `INSERT INTO system_log (ts,category,action,actor,actor_id,target,details,ip,risk)
     VALUES (?,?,?,?,?,?,?,?,?)`).run(row.ts,row.category,row.action,row.actor,row.actor_id,row.target,row.details,row.ip,row.risk);
}
module.exports = { ...module.exports, _isRiskAction, _logCtx, logEvent };
```
(The whole body is inside `try/catch` → **never rejects**; callers invoke it bare.)

Also implement a **self-contained** `countSystemLog(filters={})` + a minimal filter-less `listSystemLog({}, {limit,offset})` here so Task 1 goes red→green ON ITS OWN (Task 2 extends `listSystemLog` with filters + adds analytics — it does NOT reimplement these):

```js
async function countSystemLog(filters = {}) {
  const { where, params } = _syslogWhere(filters);   // _syslogWhere returns {where:'',params:[]} for {} in Task 1; Task 2 fills it
  const sql = `SELECT COUNT(*) AS n FROM system_log ${where}`;
  if (REPORTS_BACKEND === 'postgres') return (await pgDb.prepare(sql).get(...params)).n;
  return getDB().prepare(sql).get(...params).n;
}
async function listSystemLog(filters = {}, { limit = 50, offset = 0 } = {}) {
  const { where, params } = _syslogWhere(filters);
  const sql = `SELECT * FROM system_log ${where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`;
  const rows = REPORTS_BACKEND === 'postgres'
    ? await pgDb.prepare(sql).all(...params, limit, offset)
    : getDB().prepare(sql).all(...params, limit, offset);
  return { rows, total: await countSystemLog(filters) };
}
```
In Task 1, `_syslogWhere` is a stub returning `{ where:'', params:[] }`.

- [ ] **Step 6: Run — expect PASS** (Task 1's tests use only filter-less list/count).

- [ ] **Step 7: Commit**

```bash
git add reports-db.js db/postgres/reports/006_system_log.sql tests/system-log.test.js
git commit -m "feat(syslog): system_log table + logEvent (dual-backend, fire-and-forget) + risk predicate"
```

---

## Task 2: readers — list / count / analytics

**Files:** Modify `reports-db.js`; extend `tests/system-log.test.js`.

- [ ] **Step 1: Add tests** (append)

```js
test('listSystemLog filters: category, risk-only, actor, q, date', async () => {
  const day = new Date().toISOString().slice(0,10);
  let r = await rdb.listSystemLog({ category:'auth' }, {limit:50,offset:0});
  assert.ok(r.rows.every(x => x.category==='auth'));
  r = await rdb.listSystemLog({ risk:1 }, {limit:50,offset:0});
  assert.ok(r.rows.every(x => x.risk===1));
  r = await rdb.listSystemLog({ q:'bad_password' }, {limit:50,offset:0});
  assert.ok(r.rows.length >= 1);
  r = await rdb.listSystemLog({ from: day, to: day }, {limit:50,offset:0});
  assert.ok(r.total >= 2, 'today rows in range');
});

test('getSystemLogAnalytics returns the expected shape', async () => {
  const a = await rdb.getSystemLogAnalytics({ window: '30d' });
  for (const k of ['totals','series','risk_series','top_actions','top_actors','by_hour','top_ips'])
    assert.ok(k in a, `missing ${k}`);
  for (const k of ['events','risk_events','distinct_actors','distinct_ips'])
    assert.ok(k in a.totals, `missing totals.${k}`);
  assert.ok(a.totals.events >= 2 && a.totals.risk_events >= 1);
  assert.equal(a.by_hour.length, 24);
  // value-level check catches a broken GROUP BY / ORDER, not just shape:
  assert.ok(a.top_actions.length >= 1 && typeof a.top_actions[0].n === 'number');
  assert.ok(a.top_actions.every((x,i,arr) => i===0 || arr[i-1].n >= x.n), 'top_actions desc by n');
});
```

- [ ] **Step 2: Run — expect FAIL** (analytics/filters missing).

- [ ] **Step 3: Implement `_syslogWhere(filters)` (fill the Task-1 stub) + `getSystemLogAnalytics`** (sqlite + `_…Pg` forks). `list`/`count` from Task 1 already consume `_syslogWhere`, so filling it turns filters on.
  - `_syslogWhere` builds a WHERE + params from present keys only: `category=?`, `action=?`, `actor LIKE ?`, `risk=1`, `substr(ts,1,10) BETWEEN ? AND ?` (from/to), `q` → `(action LIKE ? OR target LIKE ? OR details LIKE ? OR actor LIKE ?)`. Parameterised only; unknown keys ignored. Returns `{where:'WHERE …'|'' , params:[]}`.
  - `getSystemLogAnalytics({window})` → window = `now - {7|30|90}d`; aggregate over `system_log WHERE ts >= ?`:
    - `totals`: `COUNT(*)`, `SUM(risk)`, `COUNT(DISTINCT actor)`, `COUNT(DISTINCT ip)`.
    - `series` / `risk_series`: `GROUP BY substr(ts,1,10)` (all + risk-only), ascending.
    - `top_actions`: `GROUP BY action ORDER BY n DESC LIMIT 12`.
    - `top_actors`: `GROUP BY actor …`.
    - `by_hour`: 24-slot array from `substr(ts,12,2)` (hour).
    - `top_ips`: `GROUP BY ip …`.
  - pg forks: same SQL via `pgDb.prepare(...).all(...)`; TEXT `ts` so `substr` works identically (house rule — no `::date`).

- [ ] **Step 4: Run Task 1 + 2 tests — expect PASS.**

Run: `node --test --test-force-exit tests/system-log.test.js`

- [ ] **Step 5: Run await-precedence** (auto-covers the new dual-backend dispatchers).

Run: `DASH_USER=x DASH_PASS=y node --test --test-force-exit tests/await-precedence.test.js` → PASS

- [ ] **Step 6: Commit**

```bash
git add reports-db.js tests/system-log.test.js
git commit -m "feat(syslog): list/count/analytics readers (dual-backend, parameterised)"
```

---

## Task 3: instrument events + `logAudit` mirror

**Files:** Modify `server.js` (call sites), `reports-db.js` (`logAudit` +1 line + mirror test hook); extend `tests/system-log.test.js`.

- [ ] **Step 1: Add the mirror test** (append)

```js
test('config_saved stores redacted key names — NO secret key OR value ever lands', async () => {
  // Simulate the config instrumentation: it must run posted keys through _redactKeys.
  const body = { smtp_host:'mail', smtp_pass:'hunter2', report_config:'x', api_token:'abc' };
  await rdb.logEvent({ category:'config', action:'config_saved', target:'report_config',
    details:{ keys: rdb._redactKeys(Object.keys(body)) } });
  const r = await rdb.listSystemLog({ category:'config' }, {limit:50,offset:0});
  const row = r.rows.find(x => x.target === 'report_config');
  const blob = row.details;
  assert.ok(!blob.includes('hunter2') && !blob.includes('abc'), 'no secret VALUES');
  assert.ok(!/smtp_pass|api_token/.test(blob), 'no sensitive KEY names');
  assert.ok(blob.includes('smtp_host') && blob.includes('report_config'), 'safe keys kept');
});

test('logAudit mirrors a report_* row into system_log', async () => {
  await rdb.logAudit({ report_id: 42, site_id: 1, user_id: 7, username: 'coord', action: 'deleted', details: { week_label:'W30' } });
  const r = await rdb.listSystemLog({ category:'report' }, {limit:50,offset:0});
  const row = r.rows.find(x => x.target === '42');
  assert.ok(row, 'report_audit mirrored into system_log');
  assert.equal(row.action, 'report_deleted');
  assert.equal(row.actor, 'coord');
  assert.equal(row.risk, 1, 'report delete is risk');
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3a: Add `_redactKeys` to `reports-db.js`** (exported; drops secret-ish keys so they never reach `details`):

```js
const _SECRET_KEY = /pass|secret|token|password|key$|_key|auth/i;
function _redactKeys(keys) { return (keys || []).filter(k => !_SECRET_KEY.test(String(k))); }
module.exports = { ...module.exports, _redactKeys };
```

- [ ] **Step 3b: Add ONE line to `logAudit`** — first VERIFY its current signature (it is `logAudit({ report_id, site_id, user_id, username, action, details } = {})` in `reports-db.js`); then after its existing insert, map action → `report_<action>` unless already prefixed:

```js
// mirror into the unified system log (fire-and-forget)
logEvent({ category:'report',
  action: /^report_/.test(action) ? action : 'report_' + action,
  actor: username, actor_id: user_id, target: report_id != null ? String(report_id) : null,
  details, risk: (action === 'deleted') ? 1 : undefined });
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Instrument the call sites in `server.js`** (bare `logEvent(...)`, one line each; grep the anchors):
  - **auth:** login success → `login_success`; login rejected → `login_failed` (actor = `req.body.username || 'anonymous'`, `actor_id:null`, ip by hand — NOT `_logCtx`); logout → `logout`; force-logout route `DELETE /api/reports/sessions/:token` → `session_killed` (target = killed user).
  - **identity:** user create/update/delete/role-change/site-change/password-reset routes → `user_created|user_updated|user_deleted|user_role_changed|user_site_changed|password_reset` (use `_logCtx(req)`, target = affected username).
  - **config:** at each enumerated persistence point (`PUT /api/reports/config` :5103, `PUT /api/assets/depreciation-config` :3134, `/api/risk-register-config/*`, `/api/admin/backup-schedule`, sites/departments/group-presets writes) → `config_saved` with `target` = the surface, **`details:{ keys: rdb._redactKeys(Object.keys(body)) }`** (redacted key names only — never values, never `smtp_pass`/tokens), `_logCtx(req)`.

- [ ] **Step 6: Commit**

```bash
git add server.js reports-db.js tests/system-log.test.js
git commit -m "feat(syslog): instrument auth/identity/config events + mirror report audit"
```

---

## Task 4: routes + super_admin gate

**Files:** Modify `server.js`; Create `tests/system-log-routes.smoke.test.js`.

- [ ] **Step 1: Write the smoke test** — **MUST set `process.env.REPORTS_BACKEND='sqlite'` + `process.env.SDP_DATA_DIR=<tempdir>` BEFORE `require('../server.js')`** (dev `.env` is `postgres`; without this the boot fails with `pgDb not initialised` — documented pitfall). Boots the app, a super_admin session + a lesser session; assert:
  - `GET /api/reports/system-log` as admin (not super) → **403 `{error:'super_admin only'}`**.
  - as super_admin → **200 `{rows:[...], total:n}`**.
  - hostile filters (`?actor=' OR 1=1--`, `?from=../../etc`) → **not 500** (200 with empty/whitelisted).
  - `GET …/analytics?window=30d` → 200 with `totals`.
  - `GET …/export.csv` → `text/csv`, first line = header; `…/export.json` → JSON array.

- [ ] **Step 2: Run — expect FAIL** (routes missing).

- [ ] **Step 3: Add routes in `server.js` ABOVE `app.get('/api/reports/:id')`**, each gated with the force-logout pattern:

```js
// gate = the VERBATIM check from DELETE /api/reports/sessions/:token (server.js:5774,
// verified — rdb.userHasRole(req.reportUser, 'super_admin') exists with this arity):
function _syslogGate(req, res, next) {
  if (!rdb.userHasRole(req.reportUser, 'super_admin')) return res.status(403).json({ error: 'super_admin only' });
  next();
}
app.get('/api/reports/system-log', requireReportSession, _syslogGate, async (req, res) => {
  const f = { actor:req.query.actor, category:req.query.category, action:req.query.action,
              risk: req.query.risk === '1' ? 1 : undefined, from:req.query.from, to:req.query.to, q:req.query.q };
  const limit = Math.min(parseInt(req.query.limit)||50, 500), offset = parseInt(req.query.offset)||0;
  res.json(await rdb.listSystemLog(f, { limit, offset }));
});
app.get('/api/reports/system-log/analytics', requireReportSession, _syslogGate, async (req,res) =>
  res.json(await rdb.getSystemLogAnalytics({ window: req.query.window || '30d' })));
app.get('/api/reports/system-log/export.json', requireReportSession, _syslogGate, async (req,res) => {
  const { rows } = await rdb.listSystemLog(_filtersFrom(req), { limit: 100000, offset: 0 });
  res.setHeader('Content-Type','application/json');
  res.setHeader('Content-Disposition','attachment; filename="system-log.json"');
  res.send(JSON.stringify(rows));
});
app.get('/api/reports/system-log/export.csv', requireReportSession, _syslogGate, async (req,res) => {
  const { rows } = await rdb.listSystemLog(_filtersFrom(req), { limit: 100000, offset: 0 });
  const COLS = ['ts','category','action','actor','actor_id','target','ip','risk','details'];
  const esc = v => { const s = v==null ? '' : String(v); return /[",\r\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const csv = '﻿' + [COLS.join(','), ...rows.map(r => COLS.map(c => esc(r[c])).join(','))].join('\r\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="system-log.csv"');
  res.send(csv);
});
```
`_filtersFrom(req)` = the same whitelisted filter object built in the list route (factor it into one helper). CSV columns are fixed = `ts,category,action,actor,actor_id,target,ip,risk,details`; **UTF-8 BOM + CRLF + quote-escape inlined** (no server-side CSV helper exists to reuse — the codebase's CSV pattern is client-side). Whitelist-only filter keys + parameterised SQL make hostile input 200-empty, not 500.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add server.js tests/system-log-routes.smoke.test.js
git commit -m "feat(syslog): super_admin routes (list/analytics/export) above /:id"
```

---

## Task 5: the page + nav + admin link

**Files:** Create `public/system-logs.html`; Modify `public/_shell.js`, `public/reports.html`, `server.js` (`_htmlCache` + `sendHtmlPage` route).

- [ ] **Step 1:** `public/system-logs.html` — app shell (`#__shell` data-section, super_admin), **in-page tabs** (own JS `data-tab`, like `assets.html`): *Log entries* / *Analytics & trends* / *Events & reconciliation* (disabled `title="v2"`). Log-entries: filter bar (actor/category/action/risk/from/to/search+Clear) → `GET …/system-log`, paginated table, Export CSV/JSON. Analytics: window select → `GET …/analytics`, 4 KPI tiles + Chart.js charts. Namespace all ids `sl-`; unique canvas ids + destroy-on-refresh.
- [ ] **Step 2:** `_shell.js` — add `NAV` entry (super_admin), `{ id:'system-logs', label:'System Logs', icon: ICON_LIB['shield-check'], href:'system-logs.html', roles:['super_admin'] }` under Admin/Insights; **reuse `shield-check`** (already in `ICON_LIB`).
- [ ] **Step 3:** `reports.html#admin` — a small card/link "🛡 System Logs → system-logs.html" (super_admin gate, existing 4-surface admin pattern if a card).
- [ ] **Step 4:** `server.js` — add `'system-logs.html'` to the `_htmlCache` boot-load list + a `sendHtmlPage(res,'system-logs.html', false, …)` route.
- [ ] **Step 5: Verify structurally** (no browser): `_shell.js` nav harness shows the entry only for super_admin + non-empty icon; grep the page has `#__shell` + the 3 tabs + the export buttons.
- [ ] **Step 6: Commit**

```bash
git add public/system-logs.html public/_shell.js public/reports.html server.js
git commit -m "feat(syslog): System Logs page (in-page tabs) + super_admin nav + admin link"
```

> **BROWSER QA — USER STEP (session-gated, agent cannot log in):** deploy to test/prod, confirm as a super_admin: page renders with banner, Log entries filters+paginate+export, Analytics tiles+charts populate, a non-super-admin gets no nav entry + 403 on the API. A lesser role must NOT see the page.

---

## Task 6: pg copy + optional backfill + regression + docs + finish

**Files:** Modify `tools/pg/copy-reports-all.js`, `reports-db.js` (backfill), `CLAUDE.md`.

- [ ] **Step 1:** `copy-reports-all.js` — include `system_log` (straight `SELECT *`→insert) in the copy set.
- [ ] **Step 2:** `_backfillSystemLogFromAudit()` in `reports-db.js` — idempotent via a **single guard: run only if `system_log` has zero `category='report'` rows** (do NOT use a `setConfig` marker — the documented DEFAULTS/KEYS filter would silently drop it; the zero-row guard alone is sufficient and simpler). Maps existing `report_audit` rows → `logEvent(category:'report', action:'report_'+action, actor:username, actor_id:user_id, target:report_id, details, risk: action==='deleted'?1:undefined)`. Called once at boot after schema init. **Additive; if it throws, swallow + log (a dead backfill must not block boot).**
- [ ] **Step 3: Full regression (all green):**

```bash
node --test --test-force-exit tests/system-log.test.js tests/system-log-routes.smoke.test.js
DASH_USER=x DASH_PASS=y node --test --test-force-exit tests/await-precedence.test.js tests/review-render.test.js
```
Plus a reports.db neighbour sweep (report-config / report-schedule / send-reports) to confirm no regression from the `logAudit` +1 line.

- [ ] **Step 4:** Update `CLAUDE.md` (Current-state entry: System Logs v1 — system_log + logEvent + super_admin page; v2 = per-request access log deferred).
- [ ] **Step 5: Finish** — commit docs; **superpowers:finishing-a-development-branch** (merge --no-ff after user's browser QA; build ZIP; server.js + `_htmlCache` → `pm2 stop`→wait→`start`).

---

## Guardrails
- **`logEvent` is fire-and-forget everywhere** — bare call, never `await`ed at a call site, never chained (await-precedence). Its internal try/catch is the only error handling.
- **No secrets in `details`** — config events store key names only; `login_failed` stores username only. A test asserts `smtp_pass` never appears.
- **Routes ABOVE `/api/reports/:id`**; gate = the exact force-logout super_admin check.
- **YAGNI:** no per-request access log, no retention/rotation, no Events/reconciliation tab in v1 (tab shown disabled).
- **Deploy:** `pm2 stop`→wait→`start` (server.js + cached HTML); one Ctrl+F5.
