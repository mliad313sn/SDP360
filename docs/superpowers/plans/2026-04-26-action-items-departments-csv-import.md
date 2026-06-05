# Action Items — Departments + Comment + CSV Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mandatory `Department` field (editable dropdown, 10 seeded values, super_admin maintainable) and an optional `Comment` field (multiline, dashboard-only) to weekly + monthly action items, plus a CSV bulk-import flow with a downloadable template.

**Architecture:** Hybrid — client-side CSV parsing into the existing append-to-table flow; server-side enum validation as defense-in-depth. New `action_departments` table for editable dropdown values, two nullable columns (`department`, `comment`) added to `action_items`. Strict policy: every save requires non-null department on every row; legacy NULL rows force the user to pick before re-saving. PPTX shows department, not comment.

**Tech Stack:** Node.js + Express, SQLite (better-sqlite3), pptxgenjs, vanilla JS in `public/reports.html`. No new dependencies. Tests use Node 18's built-in `node:test` runner (zero-install).

**Spec:** `docs/superpowers/specs/2026-04-26-action-items-departments-csv-import-design.md`

---

## Pre-flight

### Task 0: Pre-flight verification + backup

**Files (read-only):** `package.json`, `server.js`, `reports-db.js`, `reports-pptx.js`, `data/reports.db`

- [ ] **Step 0.1: Verify `audit_log` table name in code**

Run:
```
grep -n "audit_log\|logAudit" reports-db.js | head -5
```
Expected: see `CREATE TABLE IF NOT EXISTS audit_log` and `function logAudit({...})`. The plan assumes this name; abort and update plan if different.

- [ ] **Step 0.2: Verify `reports-pptx.js` wiring (CLAUDE.md flagged it as possibly stale)**

Run:
```
grep -rn "reports-pptx" server.js *.bat package.json 2>/dev/null
```

Document one of:
- **Wired** — the file is referenced by `server.js` route, a `.bat`, or `package.json`. Treat it as live; PPTX changes apply to all 3 files (`reports-weekly-pptx.js`, `reports-monthly-pptx.js`, `reports-pptx.js`).
- **Unused** — no references. Plan continues with only `reports-weekly-pptx.js` + `reports-monthly-pptx.js`. Open a follow-up issue: "Delete `reports-pptx.js` (unused, CLAUDE.md flagged)".

Record finding in `notes/preflight-2026-04-26.md` (or your equivalent scratch).

- [ ] **Step 0.3: Backup the production DB**

```cmd
copy "C:\Apps\SDP-Dashboard\data\reports.db" "C:\Apps\SDP-Dashboard\data\reports-backup-pre-departments-2026-04-26.db"
```

Verify file exists and size > 0:
```
dir "C:\Apps\SDP-Dashboard\data\reports-backup-pre-departments-2026-04-26.db"
```

- [ ] **Step 0.4: Make a working copy of the DB for migration testing**

```cmd
copy "C:\Apps\SDP-Dashboard\data\reports.db" "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\data\reports.db"
```

This becomes the dev DB for testing schema changes without touching production.

- [ ] **Step 0.5: Commit any pre-existing scratch / preflight notes**

```bash
git add notes/preflight-2026-04-26.md
git commit -m "preflight: document reports-pptx.js wiring + backups for departments feature"
```

---

## Phase 1 — Database & Backend

### Task 1: Schema migration + seed for `action_departments` and new `action_items` columns

**Files:**
- Modify: `reports-db.js` (the `SEED_SQL` / `db.exec(...)` block, ~line 100-140 area where tables are defined; and the `action_items` CREATE TABLE block ~line 128)

**Goal:** Add `department TEXT` and `comment TEXT` columns to `action_items` (nullable). Create `action_departments` table. Seed 10 default departments only if table is empty. All idempotent.

- [ ] **Step 1.1: Read existing schema block**

Read `reports-db.js` from the line where `db.exec(` begins (search for `CREATE TABLE IF NOT EXISTS action_items`) to capture the surrounding SQL string.

- [ ] **Step 1.2: Add new columns to `action_items` via `ALTER TABLE` (idempotent pattern)**

SQLite's `ALTER TABLE ADD COLUMN` is not idempotent on its own. Use the existing migration pattern in this file (search for `PRAGMA table_info` or `try { db.exec('ALTER...) } catch`); if neither pattern exists, add this helper near the top of the schema section:

```js
function addColumnIfMissing(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
```

Then call after `CREATE TABLE IF NOT EXISTS action_items (...)`:
```js
addColumnIfMissing('action_items', 'department', 'TEXT');
addColumnIfMissing('action_items', 'comment',    'TEXT');
```

- [ ] **Step 1.3: Add `action_departments` table inside the same `db.exec(SEED_SQL)` block**

Insert this SQL inside the same multi-line SQL string the file already passes to `db.exec`:
```sql
CREATE TABLE IF NOT EXISTS action_departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort_order INTEGER DEFAULT 0,
  active     INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_action_departments_active ON action_departments(active);
```

- [ ] **Step 1.4: Seed defaults only if table is empty**

After the `db.exec(SEED_SQL)` call, add:
```js
const deptCount = db.prepare(`SELECT COUNT(*) AS n FROM action_departments`).get().n;
if (deptCount === 0) {
  const seedDept = db.prepare(`INSERT INTO action_departments (name, sort_order) VALUES (?, ?)`);
  const defaults = [
    'Mining', 'Technical Service', 'Processing', 'Maintenance',
    'Supply Chain', 'Security', 'Finance', 'Human Resource',
    'Social performance', 'General Manager'
  ];
  defaults.forEach((name, i) => seedDept.run(name, i + 1));
  console.log(`[seed] Inserted ${defaults.length} default action_departments`);
}
```

- [ ] **Step 1.5: Syntax-check**

Run:
```
node -e "require('./reports-db.js')"
```
Expected: no output (or "[seed] Inserted 10..." on first run), exit code 0. Schema migration runs at module load.

- [ ] **Step 1.6: Verify migration applied to dev DB**

```
node -e "const db = require('better-sqlite3')('data/reports.db'); console.log('action_items cols:', db.prepare('PRAGMA table_info(action_items)').all().map(c => c.name).join(',')); console.log('depts:', db.prepare('SELECT * FROM action_departments').all());"
```
Expected: column list includes `department` and `comment`. Departments table contains 10 rows with `active=1`.

- [ ] **Step 1.7: Verify idempotency — run again**

```
node -e "require('./reports-db.js')"
node -e "const db = require('better-sqlite3')('data/reports.db'); console.log('depts:', db.prepare('SELECT COUNT(*) AS n FROM action_departments').get());"
```
Expected: still 10 rows. No errors. No duplicate columns.

- [ ] **Step 1.8: Commit**

```bash
git add reports-db.js
git commit -m "feat(actions): add department + comment columns and action_departments table

- Adds nullable department + comment columns to action_items via idempotent ALTER
- Creates action_departments table with name UNIQUE COLLATE NOCASE
- Seeds 10 default departments only when table is empty
- Migration is idempotent — safe to re-run

Refs: docs/superpowers/specs/2026-04-26-action-items-departments-csv-import-design.md §3"
```

---

### Task 2: Department DB functions in `reports-db.js`

**Files:**
- Modify: `reports-db.js` (add functions; add to `module.exports` at bottom of file ~line 1881)

**Goal:** Export `listDepartments`, `createDepartment`, `updateDepartment`, `setDepartmentActive`. All functions perform validation and case-insensitive name handling.

- [ ] **Step 2.1: Add `listDepartments` function**

Place it near the existing department-related queries (search for `getActionsForReport` and add nearby for cohesion).

```js
function listDepartments({ includeInactive = false } = {}) {
  if (includeInactive) {
    return db.prepare(`SELECT id, name, sort_order, active FROM action_departments ORDER BY sort_order, name`).all();
  }
  return db.prepare(`SELECT id, name, sort_order, active FROM action_departments WHERE active=1 ORDER BY sort_order, name`).all();
}
```

- [ ] **Step 2.2: Add `createDepartment` function**

```js
function createDepartment({ name, sort_order }) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('name is required');
  if (trimmed.length > 60) throw new Error('name too long (max 60)');

  // If an inactive row already exists with the same name (case-insensitive), reactivate it
  const existing = db.prepare(`SELECT id, active FROM action_departments WHERE name = ? COLLATE NOCASE`).get(trimmed);
  if (existing) {
    if (existing.active) throw new Error('department already exists');
    db.prepare(`UPDATE action_departments SET active=1, updated_at=datetime('now') WHERE id=?`).run(existing.id);
    return { id: existing.id, name: trimmed, reactivated: true };
  }

  const order = Number.isFinite(sort_order)
    ? sort_order
    : (db.prepare(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM action_departments`).get().n);
  const result = db.prepare(`INSERT INTO action_departments (name, sort_order) VALUES (?, ?)`).run(trimmed, order);
  return { id: result.lastInsertRowid, name: trimmed, sort_order: order, active: 1 };
}
```

- [ ] **Step 2.3: Add `updateDepartment` function**

```js
function updateDepartment(id, { name, sort_order, active }) {
  const cur = db.prepare(`SELECT * FROM action_departments WHERE id=?`).get(id);
  if (!cur) throw new Error('department not found');

  const updates = [];
  const params  = [];
  if (name !== undefined) {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new Error('name cannot be empty');
    if (trimmed.length > 60) throw new Error('name too long (max 60)');
    // Uniqueness check excluding self
    const dup = db.prepare(`SELECT id FROM action_departments WHERE name=? COLLATE NOCASE AND id<>?`).get(trimmed, id);
    if (dup) throw new Error('another department already has this name');
    updates.push('name=?'); params.push(trimmed);
  }
  if (sort_order !== undefined) { updates.push('sort_order=?'); params.push(sort_order); }
  if (active     !== undefined) { updates.push('active=?');     params.push(active ? 1 : 0); }
  if (!updates.length) return cur;

  updates.push(`updated_at=datetime('now')`);
  params.push(id);
  db.prepare(`UPDATE action_departments SET ${updates.join(', ')} WHERE id=?`).run(...params);
  return db.prepare(`SELECT * FROM action_departments WHERE id=?`).get(id);
}
```

- [ ] **Step 2.4: Add `setDepartmentActive` (soft-delete / reactivate convenience)**

```js
function setDepartmentActive(id, active) {
  return updateDepartment(id, { active: active ? 1 : 0 });
}
```

- [ ] **Step 2.5: Export from `module.exports`**

Find the existing `module.exports = { ... };` near line 1881 and add: `listDepartments, createDepartment, updateDepartment, setDepartmentActive,`.

- [ ] **Step 2.6: Smoke-test the functions**

```
node -e "const r = require('./reports-db.js'); console.log('list:', r.listDepartments()); console.log('list-all:', r.listDepartments({ includeInactive: true }));"
```
Expected: 10 active departments.

```
node -e "const r = require('./reports-db.js'); try { console.log(r.createDepartment({ name: 'Test' })); console.log(r.createDepartment({ name: 'Test' })); } catch(e) { console.log('expected error:', e.message); }"
```
Expected: first create succeeds with new id; second throws `department already exists`.

```
node -e "const r = require('./reports-db.js'); const d = r.listDepartments({ includeInactive: true }).find(x => x.name === 'Test'); r.setDepartmentActive(d.id, 0); console.log('after disable:', r.listDepartments({ includeInactive: true }).find(x => x.id === d.id)); console.log(r.createDepartment({ name: 'Test' }));"
```
Expected: disable sets `active=0`; subsequent `createDepartment('Test')` reactivates the same row (returns `reactivated: true`).

```
node -e "const r = require('./reports-db.js'); const d = r.listDepartments({ includeInactive: true }).find(x => x.name === 'Test'); r.setDepartmentActive(d.id, 0); console.log('cleanup OK');"
```

- [ ] **Step 2.7: Commit**

```bash
git add reports-db.js
git commit -m "feat(actions): add CRUD functions for action_departments

- listDepartments({includeInactive}) — defaults to active only
- createDepartment — reactivates inactive same-name row instead of failing UNIQUE
- updateDepartment — name length/uniqueness checks, partial updates
- setDepartmentActive — soft-delete/reactivate

Refs: spec §3, §4"
```

---

### Task 3: Department CRUD endpoints in `server.js`

**Files:**
- Modify: `server.js` (add 4 endpoints near the existing reports/users endpoints, ~line 2687-2720)

**Goal:** Expose `/api/reports/departments` (GET, POST, PUT :id, DELETE :id). Mutation requires `executive` or `super_admin`.

- [ ] **Step 3.1: Add `requireExecutiveOrSuperAdmin` middleware**

Locate the existing `requireAdmin` function (~line 2618) and add this immediately after:
```js
function requireExecutiveOrSuperAdmin(req, res, next) {
  if (!['executive', 'super_admin'].includes(req.reportUser?.role)) {
    return res.status(403).json({ error: 'Executive or super_admin only' });
  }
  next();
}
```

- [ ] **Step 3.2: Add the four endpoints**

Place these near the existing user-management endpoints (~line 2687-2720):
```js
// ── Departments (action item categories) ─────────────────────────
app.get('/api/reports/departments', requireReportSession, (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === '1';
    if (includeInactive && !['executive','super_admin'].includes(req.reportUser?.role)) {
      return res.status(403).json({ error: 'Executive or super_admin only for include_inactive' });
    }
    res.json(rdb.listDepartments({ includeInactive }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reports/departments', requireReportSession, requireExecutiveOrSuperAdmin, jsonBody, (req, res) => {
  try {
    const { name, sort_order } = req.body || {};
    const result = rdb.createDepartment({ name, sort_order });
    rdb.logAudit({
      user_id: req.reportUser.id, username: req.reportUser.username,
      action: result.reactivated ? 'department_enabled' : 'department_created',
      details: { id: result.id, name: result.name }
    });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/reports/departments/:id', requireReportSession, requireExecutiveOrSuperAdmin, jsonBody, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const before = rdb.listDepartments({ includeInactive: true }).find(d => d.id === id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const after = rdb.updateDepartment(id, req.body || {});
    const action = (before.active && !after.active) ? 'department_disabled'
                 : (!before.active && after.active) ? 'department_enabled'
                 : 'department_updated';
    rdb.logAudit({
      user_id: req.reportUser.id, username: req.reportUser.username,
      action, details: { id, before, after }
    });
    res.json(after);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/reports/departments/:id', requireReportSession, requireExecutiveOrSuperAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const before = rdb.listDepartments({ includeInactive: true }).find(d => d.id === id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const after = rdb.setDepartmentActive(id, 0);
    rdb.logAudit({
      user_id: req.reportUser.id, username: req.reportUser.username,
      action: 'department_disabled',
      details: { id, name: before.name }
    });
    res.json({ ok: true, ...after });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 3.3: Syntax-check**

```
node -e "require('./server.js')"
```
This may bind to port 3456. If it does, kill it after a successful start (Ctrl-C). Just need it to parse and start without error.

Alternative — pure parse check:
```
node --check server.js
```
Expected: no output, exit 0.

- [ ] **Step 3.4: Manual smoke-test endpoints (server running locally on 3456)**

Start the server in a separate terminal:
```
node server.js
```

Then in PowerShell (separate window), get a session cookie via login (use existing super_admin credentials), then:
```powershell
# GET active list (any logged-in user can call)
Invoke-RestMethod -Uri http://localhost:3456/api/reports/departments -WebSession $sess

# GET include_inactive (super_admin only)
Invoke-RestMethod -Uri "http://localhost:3456/api/reports/departments?include_inactive=1" -WebSession $sess

# POST new department
Invoke-RestMethod -Uri http://localhost:3456/api/reports/departments -Method POST -ContentType "application/json" -Body '{"name":"Test Dept"}' -WebSession $sess

# DELETE (soft)
$id = (Invoke-RestMethod -Uri http://localhost:3456/api/reports/departments -WebSession $sess | Where-Object { $_.name -eq 'Test Dept' }).id
Invoke-RestMethod -Uri "http://localhost:3456/api/reports/departments/$id" -Method DELETE -WebSession $sess
```
Expected: each call returns 200 and the operation reflects in `listDepartments()` calls.

- [ ] **Step 3.5: Audit trail verification**

```
node -e "const db = require('better-sqlite3')('data/reports.db'); console.log(db.prepare('SELECT * FROM audit_log WHERE action LIKE ? ORDER BY id DESC LIMIT 5').all('department_%'));"
```
Expected: rows with `department_created`, `department_disabled`, etc. Stop server with Ctrl-C.

- [ ] **Step 3.6: Commit**

```bash
git add server.js
git commit -m "feat(actions): add /api/reports/departments CRUD endpoints

- GET (any session) — active by default; ?include_inactive=1 requires executive+
- POST/PUT/DELETE require executive or super_admin
- All mutations write audit_log entries

Refs: spec §4.4-4.5"
```

---

### Task 4: Action items DB updates — `saveActionItems`, carry-over SELECTs, monthly merge field copy

**Files:**
- Modify: `reports-db.js`:
  - `saveActionItems` (~line 744) — add `department, comment` to INSERT
  - `getPreviousWeekOpenActions` (~line 644) — add `department, comment` to SELECT
  - `getActionsForReport` (~line 680) — add `department, comment` to SELECT
  - `getMonthlyEdits` (~line 1670-1677) — extend explicit JS field copy

**Goal:** Persistence and read paths handle the two new columns. The fragile JS field copy in `getMonthlyEdits` is the most error-prone — exactly per spec §9.3.

- [ ] **Step 4.1: Update `saveActionItems`**

Replace the existing function (line ~744-748) with:
```js
const saveActionItems = db.transaction((report_id, items) => {
  db.prepare(`DELETE FROM action_items WHERE report_id=?`).run(report_id);
  const ins = db.prepare(`
    INSERT INTO action_items
      (report_id, task, priority, due_date, owner, status, department, comment, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  items.forEach((a, i) => ins.run(
    report_id,
    a.task,
    a.priority || 'Medium',
    a.due_date || null,
    a.owner    || null,
    a.status   || 'open',
    a.department || null,
    a.comment    || null,
    i
  ));
});
```

- [ ] **Step 4.2: Update `getPreviousWeekOpenActions` SELECT**

Locate the SELECT (~line 644). Change:
```sql
SELECT task, priority, due_date, owner, status, sort_order
```
to:
```sql
SELECT task, priority, due_date, owner, status, department, comment, sort_order
```

- [ ] **Step 4.3: Update `getActionsForReport` SELECT**

Locate the SELECT (~line 680). Same change as Step 4.2.

- [ ] **Step 4.4: Update `getMonthlyEdits` — extend explicit JS field copy**

Locate the actions push (~line 1670-1677):
```js
const as = db.prepare(`SELECT * FROM action_items WHERE report_id=? ORDER BY sort_order`).all(wk.report_id);
as.forEach(a => actionsRaw.push({
  task:       a.task,
  priority:   a.priority,
  due_date:   a.due_date,
  owner:      a.owner,
  status:     a.status,
  week_label: wk.week_label
}));
```
Replace with (note new fields):
```js
const as = db.prepare(`SELECT * FROM action_items WHERE report_id=? ORDER BY sort_order`).all(wk.report_id);
as.forEach(a => actionsRaw.push({
  task:       a.task,
  priority:   a.priority,
  due_date:   a.due_date,
  owner:      a.owner,
  status:     a.status,
  department: a.department,
  comment:    a.comment,
  week_label: wk.week_label
}));
```

The dedup key (~line 1701) stays `task + '||' + owner` — do NOT change. Same-task-same-owner from a later week overwrites earlier rows, so the dedup'd row carries the latest week's department + comment. (Spec §5.6.)

- [ ] **Step 4.5: Syntax-check**

```
node -e "require('./reports-db.js')"
```
Expected: clean exit.

- [ ] **Step 4.6: Smoke-test `saveActionItems` + `getReport`**

```
node -e "const r = require('./reports-db.js'); const reports = r.listReports ? r.listReports({}) : []; console.log('reports:', reports.length); const id = reports[0]?.id; if (!id) { console.log('no reports — skipping save test'); process.exit(0); } const before = r.getReport(id); const items = (before.action_items || []).map(a => ({ ...a, department: a.department || 'General Manager', comment: a.comment || 'test comment' })); r.saveActionItems(id, items); const after = r.getReport(id); console.log('after save:', after.action_items.map(a => ({task:a.task, dept:a.department, com:a.comment?.slice(0,20)})));"
```
Expected: every action has a non-null `department` and `comment` after the save round-trip. (If `r.listReports` doesn't exist, adapt to whichever query returns weekly_reports — the test is just a round-trip verification.)

- [ ] **Step 4.7: Commit**

```bash
git add reports-db.js
git commit -m "feat(actions): persist + read department + comment columns

- saveActionItems: INSERT now includes department + comment
- getPreviousWeekOpenActions / getActionsForReport: SELECT extended
- getMonthlyEdits: explicit JS field-copy extended (SELECT * is not enough)
- Dedup key in monthly merge unchanged (task + owner)

Refs: spec §5.6, §9.3, §9.4"
```

---

### Task 5: Server-side validation in `PUT /api/reports/:id/actions`

**Files:**
- Modify: `server.js` (~line 3179-3190)

**Goal:** Reject invalid payloads with specific row indices. Forces hygiene + protects DB integrity regardless of client.

- [ ] **Step 5.1: Add validation constants near the top of `server.js`**

Find a section near the existing `requireAdmin` definition or near the top of the file. Add:
```js
const ACTION_VALID_PRIORITY = new Set(['High', 'Medium', 'Low']);
const ACTION_VALID_STATUS   = new Set(['open', 'in_progress', 'on_hold', 'closed', 'cancelled']);
```

- [ ] **Step 5.2: Replace the existing PUT handler**

Find the existing handler (~line 3179):
```js
app.put('/api/reports/:id/actions', requireReportSession, jsonBody, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const items = Array.isArray(req.body) ? req.body : [];
    rdb.saveActionItems(id, items);
    rdb.touchReport(id);
    const r = rdb.getReport(id);
    rdb.logAudit({ report_id: id, ... });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
```

Replace with:
```js
app.put('/api/reports/:id/actions', requireReportSession, jsonBody, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const items = Array.isArray(req.body) ? req.body : [];
    const activeDepts = new Set(rdb.listDepartments({ includeInactive: false }).map(d => d.name));

    const errors = [];
    const cleaned = items.map((a, i) => {
      const out = { ...a };
      if (!out.task || !String(out.task).trim()) errors.push({ row: i, reason: 'empty task' });
      if (!out.department || !activeDepts.has(out.department)) {
        errors.push({ row: i, reason: `unknown or missing department: '${out.department || ''}'` });
      }
      if (out.priority && !ACTION_VALID_PRIORITY.has(out.priority)) {
        errors.push({ row: i, reason: `invalid priority '${out.priority}'` });
      }
      if (out.status && !ACTION_VALID_STATUS.has(out.status)) {
        errors.push({ row: i, reason: `invalid status '${out.status}'` });
      }
      if (out.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.due_date)) {
        errors.push({ row: i, reason: `due_date must be YYYY-MM-DD, got '${out.due_date}'` });
      }
      if (out.comment && String(out.comment).length > 2000) {
        out.comment = String(out.comment).slice(0, 2000);
      }
      return out;
    });

    if (errors.length) return res.status(400).json({ error: 'validation', details: errors });

    rdb.saveActionItems(id, cleaned);
    rdb.touchReport(id);
    const r = rdb.getReport(id);
    rdb.logAudit({
      report_id: id, site_id: r?.site_id, user_id: req.reportUser.id, username: req.reportUser.username,
      action: 'edited_actions',
      details: { week_label: r?.week_label, count: items.length }
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 5.3: Syntax-check**

```
node --check server.js
```

- [ ] **Step 5.4: Smoke-test validation rejection**

Start the server. Use PowerShell (with a logged-in $sess) to POST a deliberately-bad payload to a real report id:
```powershell
$bad = @(
  @{ task='ok'; department='Mining'; priority='High'; status='open' },
  @{ task='';   department='Mining'; priority='High'; status='open' },         # empty task → row 1
  @{ task='ok'; department='NoSuch'; priority='High'; status='open' },         # unknown dept → row 2
  @{ task='ok'; department='Mining'; priority='Critical'; status='open' },     # bad priority → row 3
  @{ task='ok'; department='Mining'; priority='High'; status='funky' },        # bad status → row 4
  @{ task='ok'; department='Mining'; priority='High'; status='open'; due_date='32/13/2026' }  # bad date → row 5
)
$id = <pick a real report id from /api/reports>
Invoke-RestMethod -Uri "http://localhost:3456/api/reports/$id/actions" -Method PUT -ContentType "application/json" -Body ($bad | ConvertTo-Json) -WebSession $sess
```
Expected: 400 with `details` array of 5 errors, each with row index 1-5.

- [ ] **Step 5.5: Smoke-test happy path**

```powershell
$good = @(@{ task='Test action'; department='Mining'; priority='Medium'; status='open'; due_date='2026-05-01' })
Invoke-RestMethod -Uri "http://localhost:3456/api/reports/$id/actions" -Method PUT -ContentType "application/json" -Body ($good | ConvertTo-Json) -WebSession $sess
```
Expected: `{ ok: true }`. Subsequent `GET /api/reports?id=...` shows the saved action with `department='Mining'`.

- [ ] **Step 5.6: Commit**

```bash
git add server.js
git commit -m "feat(actions): server-side enum + department validation on PUT /actions

- Rejects unknown department / invalid priority / invalid status with row indices
- due_date must be ISO YYYY-MM-DD
- comment auto-truncated to 2000 chars
- Defense-in-depth — UI also blocks before sending

Refs: spec §9.1-9.2"
```

---

## Phase 2 — Departments Admin UI

### Task 6: Departments admin card + modal HTML in `public/reports.html`

**Files:**
- Modify: `public/reports.html` — admin page (~line 893-927) + add modal at bottom near line 933

**Goal:** Visible card on Admin page with table + edit modal. JS wiring follows in Task 7.

- [ ] **Step 6.1: Add the departments card after the Sites card**

Locate the closing `</div>` of the Sites — Zoho Group Mapping card (around line 925) and insert immediately after, before `</div>` that closes `#page-admin`:

```html
<!-- Departments / Action Item Categories -->
<div class="card">
  <h3>🏷 Departments — Action Item Categories
    <span style="font-size:0.78rem;font-weight:400;color:#6b7a99;margin-left:8px">Used by the Action Items dropdown on weekly + monthly reports</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="openDeptModal()">+ New Department</button>
  </h3>
  <table class="user-table" id="dept-table">
    <thead>
      <tr>
        <th style="width:6%">#</th>
        <th>Name</th>
        <th style="width:10%">Order</th>
        <th style="width:12%">Status</th>
        <th style="width:18%">Actions</th>
      </tr>
    </thead>
    <tbody id="dept-table-body"></tbody>
  </table>
</div>
```

- [ ] **Step 6.2: Add the department modal at the bottom near the existing user modal (~line 933)**

Insert after the user modal `</div>` (search for `id="user-modal"` and find its closing tags, then add after):

```html
<!-- ══════════════════════════════════════════════════════════════
     DEPARTMENT MODAL
══════════════════════════════════════════════════════════════ -->
<div class="modal-overlay" id="dept-modal">
  <div class="modal" style="max-width:420px">
    <h2 id="dept-modal-title">New Department</h2>
    <input type="hidden" id="dept-modal-id">
    <div class="form-group">
      <label>Name *</label>
      <input id="dept-modal-name" type="text" placeholder="e.g. Logistics" maxlength="60">
    </div>
    <div class="form-group">
      <label>Sort Order</label>
      <input id="dept-modal-order" type="number" min="0" max="999" value="0">
    </div>
    <div class="form-group">
      <label>Status</label>
      <select id="dept-modal-active">
        <option value="1">Active</option>
        <option value="0">Inactive</option>
      </select>
    </div>
    <div style="text-align:right;margin-top:16px">
      <button class="btn btn-secondary btn-sm" onclick="closeDeptModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="saveDept()" style="margin-left:8px">Save</button>
    </div>
  </div>
</div>
```

- [ ] **Step 6.3: Smoke-test — load page in browser, navigate to Admin tab**

Open `http://localhost:3456/reports.html`. Sign in as super_admin. Click Admin tab. Expected: see new "Departments" card with `+ New Department` button. Table is empty (will populate in Task 7). Click `+ New Department` — modal **does not** open yet (no JS).

- [ ] **Step 6.4: Commit**

```bash
git add public/reports.html
git commit -m "feat(actions): add departments admin card + edit modal HTML

- New card on Admin page below Sites — Zoho Group Mapping
- Edit modal mirrors User modal pattern
- JS wiring pending (Task 7)

Refs: spec §4"
```

---

### Task 7: Departments admin JS in `public/reports.html`

**Files:**
- Modify: `public/reports.html` — JS section, near the existing `loadUsers()` / `openUserModal()` functions

**Goal:** Wire `loadDepartments()`, `openDeptModal(id?)`, `closeDeptModal()`, `saveDept()`, `disableDept(id)`, `enableDept(id)`. Refresh the table after every mutation. Show toast on success/error.

- [ ] **Step 7.1: Add `loadDepartments()`**

Find existing function `loadUsers()` (search for `function loadUsers`) and add this nearby:
```js
async function loadDepartments() {
  try {
    const data = await api('GET', '/api/reports/departments?include_inactive=1');
    const tbody = document.getElementById('dept-table-body');
    tbody.innerHTML = data.map((d, i) => `
      <tr>
        <td>${d.id}</td>
        <td>${esc(d.name)}</td>
        <td>${d.sort_order}</td>
        <td>${d.active ? '<span style="color:#27AE60;font-weight:600">Active</span>' : '<span style="color:#94a3b8">Inactive</span>'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openDeptModal(${d.id})">✏ Edit</button>
          ${d.active
            ? `<button class="btn btn-secondary btn-sm" onclick="disableDept(${d.id})" style="margin-left:4px">⊘ Disable</button>`
            : `<button class="btn btn-secondary btn-sm" onclick="enableDept(${d.id})" style="margin-left:4px">↻ Enable</button>`
          }
        </td>
      </tr>
    `).join('');
    // Cache for the action-items dropdown so it's available without a separate fetch
    _departmentList = data.filter(d => d.active);
  } catch (e) {
    toast('Could not load departments: ' + (e.message || e), 'error');
  }
}

let _departmentList = [];  // populated by loadDepartments — used by addActionRow
```

- [ ] **Step 7.2: Add modal open/close/save**

```js
function openDeptModal(id) {
  document.getElementById('dept-modal-id').value = id || '';
  document.getElementById('dept-modal-title').textContent = id ? 'Edit Department' : 'New Department';
  if (id) {
    const tr = document.querySelector(`#dept-table-body tr td:first-child`);
    // Better: read from cached full list
    fetch('/api/reports/departments?include_inactive=1', { credentials: 'include' })
      .then(r => r.json())
      .then(list => {
        const d = list.find(x => x.id === id);
        if (!d) return;
        document.getElementById('dept-modal-name').value   = d.name;
        document.getElementById('dept-modal-order').value  = d.sort_order;
        document.getElementById('dept-modal-active').value = String(d.active);
      });
  } else {
    document.getElementById('dept-modal-name').value   = '';
    document.getElementById('dept-modal-order').value  = 0;
    document.getElementById('dept-modal-active').value = '1';
  }
  document.getElementById('dept-modal').classList.add('show');
}

function closeDeptModal() {
  document.getElementById('dept-modal').classList.remove('show');
}

async function saveDept() {
  const id     = document.getElementById('dept-modal-id').value;
  const name   = document.getElementById('dept-modal-name').value.trim();
  const order  = parseInt(document.getElementById('dept-modal-order').value) || 0;
  const active = document.getElementById('dept-modal-active').value === '1' ? 1 : 0;
  if (!name) { toast('Name is required', 'error'); return; }
  try {
    if (id) {
      await api('PUT', `/api/reports/departments/${id}`, { name, sort_order: order, active });
    } else {
      await api('POST', '/api/reports/departments', { name, sort_order: order });
    }
    toast('Saved ✓', 'success');
    closeDeptModal();
    loadDepartments();
  } catch (e) {
    toast('Save failed: ' + (e.message || e), 'error');
  }
}

async function disableDept(id) {
  if (!confirm('Disable this department? It will be hidden from new dropdowns. Existing action items keep the name.')) return;
  try {
    await api('DELETE', `/api/reports/departments/${id}`);
    toast('Disabled', 'success');
    loadDepartments();
  } catch (e) { toast('Failed: ' + (e.message || e), 'error'); }
}

async function enableDept(id) {
  try {
    await api('PUT', `/api/reports/departments/${id}`, { active: 1 });
    toast('Enabled', 'success');
    loadDepartments();
  } catch (e) { toast('Failed: ' + (e.message || e), 'error'); }
}
```

(Verify the existing `.modal-overlay.show` class is what shows the modal — search the existing CSS for `.modal-overlay.show` and confirm. If the existing pattern uses `style.display = 'flex'` instead, mirror that pattern.)

- [ ] **Step 7.3: Hook `loadDepartments()` into the Admin tab show event**

Find the existing function that activates the Admin tab (search for `'page-admin'` or `showAdminTab` or `loadUsers()`). Where `loadUsers()` is called on tab show, add `loadDepartments();` right after.

Also call `loadDepartments()` once on page load (in `DOMContentLoaded` or wherever `loadTechnicianList()` is called) so the cache is warm when users open weekly reports — needed for the action items dropdown in later tasks.

- [ ] **Step 7.4: Smoke-test in browser**

Reload page. Sign in as super_admin → Admin tab. Expected: Departments card shows 10 active rows. Click `+ New Department`, type "Logistics", Save. Expected: Logistics appears with `Active` status; toast "Saved ✓". Click `⊘ Disable` on Logistics. Expected: row updates to `Inactive`. Click `↻ Enable`. Expected: Active. Click `✏ Edit`, change name to "Logistics & Warehousing", Save. Expected: name updates. Click `⊘ Disable` on it for cleanup.

- [ ] **Step 7.5: RBAC smoke-test**

Sign out. Sign in as a non-executive role (e.g. `editor` or `admin`). Navigate to Admin tab. Expected: depending on existing tab visibility — if Admin tab is restricted entirely to executive+, this test is moot. Otherwise: the GET should return only active=1 rows; the `+ New Department` button click should fail with 403 toast.

- [ ] **Step 7.6: Commit**

```bash
git add public/reports.html
git commit -m "feat(actions): wire departments admin CRUD JS

- loadDepartments populates table + caches active list in _departmentList
- openDeptModal / saveDept / disableDept / enableDept
- Hooked into Admin tab show + initial page load

Refs: spec §4.1-4.3"
```

---

## Phase 3 — Action Items UI Extensions

### Task 8: Department + Comment columns in weekly action items table

**Files:**
- Modify: `public/reports.html`:
  - Section 3 table header (~line 588-604)
  - CSS for action table (~line 131-136)
  - `addActionRow` function (~line 2499)
  - `collectActions` function (~line 2539)

**Goal:** Replace 5-column table with 7-column layout. Click-to-expand comment row. Department dropdown populated from `_departmentList`.

- [ ] **Step 8.1: Update table header**

Locate Section 3's `<table class="action-table">` header (~line 593-602). Replace `<thead>` content with:
```html
<thead>
  <tr>
    <th style="width:24%">Task / Action</th>
    <th style="width:12%">Department</th>
    <th style="width:9%">Priority</th>
    <th style="width:11%">Due Date</th>
    <th style="width:13%">Owner</th>
    <th style="width:11%">Status</th>
    <th style="width:15%">Comment</th>
    <th style="width:5%"></th>
  </tr>
</thead>
```

- [ ] **Step 8.2: Add CSS for the new comment cell + expand-below row**

Locate the existing `.action-table` CSS block (~line 131-136). Add at the end of that block:
```css
.action-table .comment-preview {
  display:block; max-width:100%; padding:5px 8px; cursor:pointer;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  color:#475569; font-size:0.83rem; border:1.5px solid var(--border); border-radius:5px;
  background:#fafbfc;
}
.action-table .comment-preview.empty { color:#94a3b8; font-style:italic; }
.action-table .comment-preview:hover { border-color:var(--orange); }
.action-comment-row td { padding:8px 8px 12px; background:#f8fafc; border-bottom:1px solid #edf0f7; }
.action-comment-row textarea {
  width:100%; min-height:60px; padding:6px 8px; border:1.5px solid var(--border);
  border-radius:5px; font-size:0.85rem; font-family:inherit; outline:none; resize:vertical;
}
.action-comment-row textarea:focus { border-color:var(--orange); }
.action-comment-row .done-btn { float:right; margin-top:6px; }
.action-table select.dept-select.placeholder { color:#94a3b8; font-style:italic; }
```

- [ ] **Step 8.3: Update `addActionRow` to render the new columns**

Replace the existing function (~line 2499-2526) with:
```js
function addActionRow(a) {
  a = a || { task:'', priority:'Medium', due_date:'', owner:'', status:'open',
             department:'', comment:'' };
  const tbody = document.getElementById('action-body');
  const rowId = 'arow-' + Math.random().toString(36).slice(2, 9);

  const deptOptions = _departmentList && _departmentList.length
    ? _departmentList.map(d =>
        `<option value="${esc(d.name)}" ${d.name === a.department ? 'selected' : ''}>${esc(d.name)}</option>`
      ).join('')
    : '';
  const placeholderSelected = !a.department || !_departmentList.some(d => d.name === a.department);

  const tr = document.createElement('tr');
  tr.dataset.rowId = rowId;
  tr.innerHTML = `
    <td><input type="text" value="${esc(a.task)}" placeholder="Describe the action…"></td>
    <td>
      <select class="dept-select ${placeholderSelected ? 'placeholder' : ''}">
        <option value="" ${placeholderSelected ? 'selected' : ''} disabled>— Select —</option>
        ${deptOptions}
      </select>
    </td>
    <td>
      <select>
        <option value="High"   ${a.priority==='High'  ?'selected':''}>🔴 High</option>
        <option value="Medium" ${a.priority==='Medium'?'selected':''}>🟡 Medium</option>
        <option value="Low"    ${a.priority==='Low'   ?'selected':''}>🟢 Low</option>
      </select>
    </td>
    <td><input type="date" value="${a.due_date||''}"></td>
    <td><input type="text" list="ai-tech-datalist" value="${esc(a.owner)}" placeholder="Type or select…" autocomplete="off"></td>
    <td>
      <select>
        <option value="open"        ${a.status==='open'       ?'selected':''}>Open</option>
        <option value="in_progress" ${a.status==='in_progress'?'selected':''}>In Progress</option>
        <option value="on_hold"     ${a.status==='on_hold'    ?'selected':''}>On Hold</option>
        <option value="closed"      ${a.status==='closed'     ?'selected':''}>Closed</option>
        <option value="cancelled"   ${a.status==='cancelled'  ?'selected':''}>Cancelled</option>
      </select>
    </td>
    <td>
      <span class="comment-preview ${a.comment ? '' : 'empty'}" onclick="toggleCommentRow('${rowId}')">
        ${a.comment ? esc(a.comment).slice(0, 40) + (a.comment.length > 40 ? '…' : '') : 'Add comment…'}
      </span>
    </td>
    <td><button class="btn-remove" onclick="removeActionRow('${rowId}')">✕</button></td>
  `;
  tbody.appendChild(tr);

  const commentTr = document.createElement('tr');
  commentTr.className = 'action-comment-row';
  commentTr.dataset.commentFor = rowId;
  commentTr.style.display = 'none';
  commentTr.innerHTML = `
    <td colspan="8">
      <textarea maxlength="2000" placeholder="Why is this on hold? Blockers? Decisions?">${esc(a.comment || '')}</textarea>
      <button class="btn btn-secondary btn-sm done-btn" onclick="closeCommentRow('${rowId}')">Done</button>
    </td>
  `;
  tbody.appendChild(commentTr);

  // Department change updates the placeholder styling
  tr.querySelector('select.dept-select').addEventListener('change', e => {
    e.target.classList.toggle('placeholder', !e.target.value);
  });
}

function toggleCommentRow(rowId) {
  const cr = document.querySelector(`tr.action-comment-row[data-comment-for="${rowId}"]`);
  if (!cr) return;
  cr.style.display = cr.style.display === 'none' ? 'table-row' : 'none';
  if (cr.style.display !== 'none') cr.querySelector('textarea').focus();
}

function closeCommentRow(rowId) {
  const cr = document.querySelector(`tr.action-comment-row[data-comment-for="${rowId}"]`);
  if (!cr) return;
  const text = cr.querySelector('textarea').value.trim();
  cr.style.display = 'none';
  // Update preview
  const dataRow = document.querySelector(`tr[data-row-id="${rowId}"]`);
  const preview = dataRow?.querySelector('.comment-preview');
  if (preview) {
    if (text) {
      preview.classList.remove('empty');
      preview.textContent = text.slice(0, 40) + (text.length > 40 ? '…' : '');
    } else {
      preview.classList.add('empty');
      preview.textContent = 'Add comment…';
    }
  }
}

function removeActionRow(rowId) {
  document.querySelector(`tr[data-row-id="${rowId}"]`)?.remove();
  document.querySelector(`tr.action-comment-row[data-comment-for="${rowId}"]`)?.remove();
}
```

- [ ] **Step 8.4: Update `collectActions` to read the new fields**

Replace existing function (~line 2539-2551) with:
```js
function collectActions() {
  const rows = Array.from(document.querySelectorAll('#action-body tr')).filter(tr => !tr.classList.contains('action-comment-row'));
  return rows.map(tr => {
    const inputs    = tr.querySelectorAll('input');
    const selects   = tr.querySelectorAll('select');
    const rowId     = tr.dataset.rowId;
    const commentTr = document.querySelector(`tr.action-comment-row[data-comment-for="${rowId}"]`);
    const comment   = commentTr?.querySelector('textarea')?.value.trim() || '';
    return {
      task:       inputs[0].value.trim(),
      department: selects[0].value,         // '' if not picked
      priority:   selects[1].value,
      due_date:   inputs[1].value || null,
      owner:      inputs[2].value.trim() || null,
      status:     selects[2].value,
      comment:    comment || null
    };
  }).filter(a => a.task);
}
```

- [ ] **Step 8.5: Add client-side validation before saving**

Find the existing `saveSection(3)` flow (~line 2576). Just BEFORE `await api('PUT', ...)`, add:
```js
const actions = collectActions();
const missing = actions.map((a, i) => ({ i, ok: !!a.department })).filter(x => !x.ok);
if (missing.length) {
  toast(`❌ ${missing.length} row(s) missing department — please select one before saving.`, 'error');
  // Highlight offending rows
  const rows = document.querySelectorAll('#action-body tr:not(.action-comment-row)');
  missing.forEach(m => {
    const sel = rows[m.i]?.querySelector('select.dept-select');
    if (sel) {
      sel.style.borderColor = '#E74C3C';
      sel.style.backgroundColor = '#FEF2F2';
      setTimeout(() => { sel.style.borderColor = ''; sel.style.backgroundColor = ''; }, 4000);
    }
  });
  setSaving('');
  return;
}
```
(Replace the existing `const actions = collectActions();` if the original has one.)

- [ ] **Step 8.6: Smoke-test in browser**

Open weekly report page. Click Section 3 "Action Items" tab. Expected: 7-column table header. Click `+ Add Action`. Expected: new row with empty `— Select —` department dropdown. Try Save without picking department → red border + toast. Pick a dept, save → succeeds. Click comment cell → expand-below textarea appears. Type text → Done → preview shows truncated text. Reload page → comment + department persisted.

- [ ] **Step 8.7: Commit**

```bash
git add public/reports.html
git commit -m "feat(actions): department dropdown + comment expand-below in weekly UI

- 7-column table layout, dept select with — Select — placeholder
- Click-to-expand comment textarea row
- Client-side blocks save with missing department; red border + toast
- collectActions reads new fields; legacy NULL departments force user to pick

Refs: spec §5.1-5.5"
```

---

### Task 9: Mirror Department + Comment in monthly action editor

**Files:**
- Modify: `public/reports.html` — monthly editor section (~line 3259-3294)

**Goal:** `renderMonthlyActions` shows the same dept dropdown + comment expand. `addMonthlyAction` and `removeMrAction` updated.

- [ ] **Step 9.1: Update `renderMonthlyActions`**

Replace the existing function (~line 3259-3288) with one that adds department `<select>` + comment expand-below for each row. Keep the inline `mrActions[i].x = this.value` style this file uses (don't refactor):
```js
function renderMonthlyActions() {
  const tbody = document.getElementById('mr-actions-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  mrActions.forEach((a, i) => {
    a.department = a.department || '';
    a.comment    = a.comment    || '';
    const rowId  = 'mrow-' + i;

    const deptOptions = _departmentList.map(d =>
      `<option value="${esc(d.name)}" ${d.name === a.department ? 'selected' : ''}>${esc(d.name)}</option>`
    ).join('');
    const placeholderSelected = !a.department || !_departmentList.some(d => d.name === a.department);

    const tr = document.createElement('tr');
    tr.dataset.rowId = rowId;
    tr.innerHTML = `
      <td style="padding:5px 6px"><input value="${esc(a.week_label||'')}" onchange="mrActions[${i}].week_label=this.value" style="width:100%;padding:4px 5px;border:1px solid #ddd;border-radius:4px;font-size:0.82rem"></td>
      <td style="padding:5px 6px"><input value="${esc(a.task||'')}" onchange="mrActions[${i}].task=this.value" style="width:100%;padding:4px 5px;border:1px solid #ddd;border-radius:4px;font-size:0.82rem"></td>
      <td style="padding:5px 6px">
        <select class="dept-select ${placeholderSelected ? 'placeholder' : ''}" onchange="mrActions[${i}].department=this.value;this.classList.toggle('placeholder',!this.value)" style="width:100%;padding:4px 5px;border:1px solid #ddd;border-radius:4px;font-size:0.82rem">
          <option value="" ${placeholderSelected ? 'selected' : ''} disabled>— Select —</option>
          ${deptOptions}
        </select>
      </td>
      <td style="padding:5px 6px"><select onchange="mrActions[${i}].priority=this.value" style="width:100%;padding:4px 5px;border:1px solid #ddd;border-radius:4px;font-size:0.82rem">
        <option value="High"   ${a.priority==='High'  ?'selected':''}>🔴 High</option>
        <option value="Medium" ${a.priority==='Medium'?'selected':''}>🟡 Medium</option>
        <option value="Low"    ${a.priority==='Low'   ?'selected':''}>🟢 Low</option>
      </select></td>
      <td style="padding:5px 6px"><input type="date" value="${a.due_date||''}" onchange="mrActions[${i}].due_date=this.value" style="width:100%;padding:4px 5px;border:1px solid #ddd;border-radius:4px;font-size:0.82rem"></td>
      <td style="padding:5px 6px"><input value="${esc(a.owner||'')}" onchange="mrActions[${i}].owner=this.value" style="width:100%;padding:4px 5px;border:1px solid #ddd;border-radius:4px;font-size:0.82rem"></td>
      <td style="padding:5px 6px"><select onchange="mrActions[${i}].status=this.value" style="width:100%;padding:4px 5px;border:1px solid #ddd;border-radius:4px;font-size:0.82rem">
        <option value="open"        ${a.status==='open'       ?'selected':''}>Open</option>
        <option value="in_progress" ${a.status==='in_progress'?'selected':''}>In Progress</option>
        <option value="on_hold"     ${a.status==='on_hold'    ?'selected':''}>On Hold</option>
        <option value="closed"      ${a.status==='closed'     ?'selected':''}>Closed</option>
        <option value="cancelled"   ${a.status==='cancelled'  ?'selected':''}>Cancelled</option>
      </select></td>
      <td style="padding:5px 6px">
        <span class="comment-preview ${a.comment ? '' : 'empty'}" onclick="toggleCommentRow('${rowId}')">
          ${a.comment ? esc(a.comment).slice(0, 40) + (a.comment.length > 40 ? '…' : '') : 'Add…'}
        </span>
      </td>
      <td style="padding:5px 6px;text-align:center"><button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:0.78rem" onclick="removeMrAction(${i})">✕</button></td>`;
    tbody.appendChild(tr);

    const commentTr = document.createElement('tr');
    commentTr.className = 'action-comment-row';
    commentTr.dataset.commentFor = rowId;
    commentTr.style.display = 'none';
    commentTr.innerHTML = `
      <td colspan="9">
        <textarea maxlength="2000" oninput="mrActions[${i}].comment=this.value" placeholder="Why is this on hold? Blockers? Decisions?">${esc(a.comment || '')}</textarea>
        <button class="btn btn-secondary btn-sm done-btn" onclick="closeCommentRow('${rowId}')">Done</button>
      </td>
    `;
    tbody.appendChild(commentTr);
  });
  document.getElementById('mr-actions-count').textContent = `(${mrActions.length} item${mrActions.length!==1?'s':''})`;
}
```

- [ ] **Step 9.2: Update `addMonthlyAction` to seed new fields**

Locate (~line 3290) and replace:
```js
function addMonthlyAction() {
  mrActions.push({ task:'', priority:'Medium', due_date:'', owner:'', status:'open', week_label:'', department:'', comment:'' });
  renderMonthlyActions();
}
```

- [ ] **Step 9.3: Update the monthly table header to add the Department column**

Find the monthly action items table header (search for `mr-actions-body` and back up to find the `<thead>`). Add a `<th>Department</th>` after the existing `<th>Task</th>`.

- [ ] **Step 9.4: Add monthly client-side dept validation before save**

Find where mrActions is POSTed (search for `body: JSON.stringify({ edited_lights: mrLights, edited_actions: mrActions...` ~line 3305). Just before the api call:
```js
const missingDept = mrActions.filter(a => a.task && !a.department);
if (missingDept.length) {
  toast(`❌ ${missingDept.length} row(s) missing department.`, 'error');
  return;
}
```

- [ ] **Step 9.5: Smoke-test the monthly editor in browser**

Open monthly report page. Expected: dept dropdown column appears. Comment column appears. Click + Add Item — new row with `— Select —`. Pick dept, type comment, save. Reload — persisted via `monthly_reports.edited_actions` JSON.

- [ ] **Step 9.6: Commit**

```bash
git add public/reports.html
git commit -m "feat(actions): department + comment in monthly action editor

- renderMonthlyActions adds dept select + comment expand row
- addMonthlyAction seeds new fields
- Client-side blocks save with missing department

Refs: spec §5.6"
```

---

## Phase 4 — CSV Import

### Task 10: TDD — `parseActionsCsv` pure function

**Files:**
- Create: `public/lib/parse-actions-csv.js` — small standalone module (loaded as `<script>` in reports.html)
- Create: `tests/parse-actions-csv.test.js` — Node 18 `node:test` runner

**Goal:** Pure function with unit tests. Eject from `public/reports.html` keeps it testable. Function exposed via window global so the inline JS can call it.

> **Why a separate file?** Pure functions are easier to test and verify than logic embedded in HTML. The CSV parser has fiddly edge cases (quoted commas, BOM, ambiguous dates, French enums) — TDD pays off here.

- [ ] **Step 10.1: Write the failing test file**

Create `tests/parse-actions-csv.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { parseActionsCsv } = require('../public/lib/parse-actions-csv.js');

const DEPTS = ['Mining', 'Technical Service', 'General Manager'];

test('rejects missing required column', () => {
  const res = parseActionsCsv('priority,owner\nHigh,Bob', DEPTS);
  assert.equal(res.fatal, true);
  assert.match(res.error, /missing required column/i);
});

test('strips UTF-8 BOM', () => {
  const csv = '﻿task,department,priority,due_date,owner,status\n"Test","Mining","High","2026-05-01","Bob","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.fatal, false);
  assert.equal(res.ok.length, 1);
  assert.equal(res.ok[0].task, 'Test');
});

test('parses canonical English headers', () => {
  const csv = 'task,department,priority,due_date,owner,status,comment\n"T1","Mining","High","2026-05-01","Bob","open","ok"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 1);
  assert.deepEqual(res.ok[0], {
    task: 'T1', department: 'Mining', priority: 'High',
    due_date: '2026-05-01', owner: 'Bob', status: 'open', comment: 'ok'
  });
});

test('accepts French header synonyms', () => {
  const csv = 'Tâche,Département,Priorité,Échéance,Responsable,Statut\n"T1","Mining","Haute","2026-05-01","Bob","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 1);
  assert.equal(res.ok[0].priority, 'High');
});

test('normalizes priority variants', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","HIGH","","Bob","open"\n"T2","Mining","Moyenne","","Bob","open"\n"T3","Mining","L","","Bob","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.deepEqual(res.ok.map(r => r.priority), ['High', 'Medium', 'Low']);
});

test('rejects unknown department, keeps good rows', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","High","","","open"\n"T2","Logistics","High","","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 1);
  assert.equal(res.ok[0].task, 'T1');
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].row, 3);  // 1-indexed CSV row, header is 1
  assert.match(res.errors[0].reason, /Logistics/);
});

test('rejects ambiguous dates', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","High","04/05/2026","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 0);
  assert.match(res.errors[0].reason, /ambiguous/i);
});

test('accepts unambiguous DMY when first slot > 12', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","High","31/05/2026","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].due_date, '2026-05-31');
});

test('accepts unambiguous MDY when second slot > 12', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","High","05/31/2026","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].due_date, '2026-05-31');
});

test('skips empty task rows', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"","Mining","High","","","open"\n"Real","Mining","High","","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 1);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0].reason, /empty task/i);
});

test('quoted commas inside fields work', () => {
  const csv = 'task,department,priority,due_date,owner,status,comment\n"Replace UPS, then test","Mining","High","","","open","Includes commas, yes"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].task, 'Replace UPS, then test');
  assert.equal(res.ok[0].comment, 'Includes commas, yes');
});

test('escaped quotes inside fields work', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"He said ""hello""","Mining","High","","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].task, 'He said "hello"');
});

test('truncates owner > 100 chars and comment > 2000 chars', () => {
  const owner = 'A'.repeat(150);
  const comment = 'B'.repeat(2500);
  const csv = `task,department,priority,due_date,owner,status,comment\n"T","Mining","H","","${owner}","open","${comment}"`;
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].owner.length, 100);
  assert.equal(res.ok[0].comment.length, 2000);
});

test('case-insensitive department matching, normalizes to canonical', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T","mining","High","","","open"\n"T2","TECHNICAL service","High","","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].department, 'Mining');
  assert.equal(res.ok[1].department, 'Technical Service');
});

test('rejects file with > 5000 rows', () => {
  const rows = Array.from({length: 5001}, (_, i) => `"T${i}","Mining","High","","","open"`).join('\n');
  const csv = 'task,department,priority,due_date,owner,status\n' + rows;
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.fatal, true);
  assert.match(res.error, /5000/);
});
```

- [ ] **Step 10.2: Run the failing test**

```
node --test tests/parse-actions-csv.test.js
```
Expected: all tests fail with "Cannot find module '../public/lib/parse-actions-csv.js'".

- [ ] **Step 10.3: Implement `parse-actions-csv.js`**

Create `public/lib/parse-actions-csv.js`:
```js
'use strict';

const HEADER_SYNONYMS = {
  task:       ['task', 'action', 'tâche', 'tache', 'task / action'],
  department: ['department', 'dept', 'département', 'departement'],
  priority:   ['priority', 'priorité', 'priorite'],
  due_date:   ['due_date', 'due date', 'due', 'échéance', 'echeance', 'date'],
  owner:      ['owner', 'assignee', 'responsable'],
  status:     ['status', 'statut', 'state'],
  comment:    ['comment', 'comments', 'note', 'notes', 'commentaire']
};
const REQUIRED = ['task', 'department', 'priority', 'due_date', 'owner', 'status'];
const OPTIONAL = ['comment'];

const PRIORITY_MAP = {
  high: 'High', haute: 'High', h: 'High',
  medium: 'Medium', med: 'Medium', moyenne: 'Medium', m: 'Medium',
  low: 'Low', basse: 'Low', l: 'Low'
};
const STATUS_MAP = {
  open: 'open', ouvert: 'open',
  in_progress: 'in_progress', 'in progress': 'in_progress', inprogress: 'in_progress', 'en cours': 'in_progress',
  on_hold: 'on_hold', 'on hold': 'on_hold', onhold: 'on_hold', 'en attente': 'on_hold',
  closed: 'closed', fermé: 'closed', ferme: 'closed',
  cancelled: 'cancelled', canceled: 'cancelled', annulé: 'cancelled', annule: 'cancelled'
};

function stripBom(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }

function parseCsvRows(text) {
  // RFC 4180-ish parser: handle quoted fields with embedded commas/newlines/double-quotes
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  // trailing field/row
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // drop fully-empty trailing rows
  while (rows.length && rows[rows.length-1].every(f => f === '')) rows.pop();
  return rows;
}

function normalizeHeader(h) {
  const k = (h || '').trim().toLowerCase();
  for (const [canonical, syns] of Object.entries(HEADER_SYNONYMS)) {
    if (syns.includes(k)) return canonical;
  }
  return null;
}

function parseDate(raw) {
  const s = (raw || '').trim();
  if (!s) return { value: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00Z');
    if (!isNaN(d) && d.toISOString().slice(0, 10) === s) return { value: s };
    return { error: `invalid ISO date '${s}'` };
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    const ai = parseInt(a), bi = parseInt(b);
    let day, month;
    if (ai > 12 && bi <= 12) { day = ai; month = bi; }
    else if (bi > 12 && ai <= 12) { day = bi; month = ai; }
    else if (ai <= 12 && bi <= 12) return { error: `ambiguous date '${s}' (use YYYY-MM-DD)` };
    else return { error: `invalid date '${s}'` };
    const iso = `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d) || d.toISOString().slice(0, 10) !== iso) return { error: `invalid date '${s}'` };
    return { value: iso };
  }
  return { error: `unparseable date '${s}'` };
}

function parseActionsCsv(rawText, departmentList) {
  const text = stripBom(rawText || '');
  const rows = parseCsvRows(text);
  if (!rows.length) return { fatal: true, error: 'empty file' };
  if (rows.length > 5001) return { fatal: true, error: `too many rows (max 5000); got ${rows.length-1}` };

  // Header
  const headerRow = rows[0].map(normalizeHeader);
  const present = new Set(headerRow.filter(Boolean));
  const missing = REQUIRED.filter(c => !present.has(c));
  if (missing.length) return { fatal: true, error: `missing required column "${missing[0]}"` };

  // Build column index map (canonical → index)
  const idx = {};
  headerRow.forEach((h, i) => { if (h) idx[h] = i; });

  // Department canonical map (lowercase → canonical)
  const deptCanon = {};
  (departmentList || []).forEach(d => {
    const name = typeof d === 'string' ? d : d.name;
    deptCanon[name.toLowerCase().trim()] = name;
  });

  const ok = [];
  const errors = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const fileRow = r + 1;  // 1-indexed CSV file row
    const get = key => idx[key] !== undefined ? (row[idx[key]] || '').trim() : '';

    const task = get('task');
    if (!task) { errors.push({ row: fileRow, reason: 'empty task' }); continue; }
    if (task.length > 500) { errors.push({ row: fileRow, reason: 'task too long (max 500)' }); continue; }

    const deptRaw = get('department');
    const deptCanonical = deptCanon[deptRaw.toLowerCase()];
    if (!deptCanonical) {
      errors.push({ row: fileRow, reason: `unknown department '${deptRaw}'` });
      continue;
    }

    let priority = 'Medium';
    const priRaw = get('priority');
    if (priRaw) {
      const m = PRIORITY_MAP[priRaw.toLowerCase()];
      if (!m) { errors.push({ row: fileRow, reason: `unknown priority '${priRaw}'` }); continue; }
      priority = m;
    }

    let status = 'open';
    const stRaw = get('status');
    if (stRaw) {
      const m = STATUS_MAP[stRaw.toLowerCase()];
      if (!m) { errors.push({ row: fileRow, reason: `unknown status '${stRaw}'` }); continue; }
      status = m;
    }

    const dateRes = parseDate(get('due_date'));
    if (dateRes.error) { errors.push({ row: fileRow, reason: dateRes.error }); continue; }

    let owner = get('owner');
    if (owner.length > 100) owner = owner.slice(0, 100);

    let comment = get('comment');
    if (comment.length > 2000) comment = comment.slice(0, 2000);

    ok.push({
      task,
      department: deptCanonical,
      priority,
      due_date: dateRes.value,
      owner: owner || null,
      status,
      comment: comment || null
    });
  }

  return { fatal: false, ok, errors };
}

// CommonJS export for node:test
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseActionsCsv };
}
// Browser global
if (typeof window !== 'undefined') {
  window.parseActionsCsv = parseActionsCsv;
}
```

- [ ] **Step 10.4: Run tests until all pass**

```
node --test tests/parse-actions-csv.test.js
```
Expected: all pass. Iterate the implementation until they do.

- [ ] **Step 10.5: Add a `test` script to `package.json`**

Edit `package.json`:
```json
"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "node --test tests/"
},
```

Verify:
```
npm test
```
Expected: tests pass via the npm script.

- [ ] **Step 10.6: Commit**

```bash
git add public/lib/parse-actions-csv.js tests/parse-actions-csv.test.js package.json
git commit -m "feat(actions): CSV parser with TDD coverage

- Pure function parseActionsCsv(text, deptList) → {ok, errors, fatal}
- 14 tests covering BOM, quoted commas, escaped quotes, French headers,
  enum normalization, ambiguous dates, oversize files, truncation
- node --test runner; npm test wired

Refs: spec §7"
```

---

### Task 11: CSV import + template buttons + flow in `public/reports.html`

**Files:**
- Modify: `public/reports.html`:
  - Section 3 button row (~line 607-608) — add CSV Template + Import CSV buttons
  - Add `<script src="/lib/parse-actions-csv.js"></script>` in `<head>`
  - JS section — add `downloadActionsTemplate`, `onActionsCsvSelected`, `_showCsvImportModal`

- [ ] **Step 11.1: Load the parser script**

In `public/reports.html` `<head>` section (search for existing `<script>` tags, find the most logical neighbor — likely just before the inline `<script>` block), add:
```html
<script src="/lib/parse-actions-csv.js"></script>
```

Note: Verify Express's static serving covers `public/lib/`. The existing `app.use(express.static('public'))` should make `public/lib/parse-actions-csv.js` available at `/lib/parse-actions-csv.js`.

- [ ] **Step 11.2: Add the buttons + hidden file input in Section 3**

Find the existing button row (~line 607-608):
```html
<button class="btn btn-secondary btn-sm btn-add-row" onclick="addActionRow()">+ Add Action</button>
<button class="btn btn-secondary btn-sm" id="btn-carry-over" onclick="carryOverActions()" style="margin-left:10px">↩ Import all (except closed) from previous week</button>
```
Add after:
```html
<button class="btn btn-secondary btn-sm" onclick="downloadActionsTemplate()" style="margin-left:10px">⬇ CSV Template</button>
<button class="btn btn-secondary btn-sm" onclick="document.getElementById('actions-csv-file').click()" style="margin-left:6px">⬆ Import CSV</button>
<input type="file" id="actions-csv-file" accept=".csv,text/csv" style="display:none" onchange="onActionsCsvSelected(event)">
<a href="#" onclick="event.preventDefault(); showCsvAllowedValuesModal();" style="margin-left:8px;font-size:0.78rem;color:#6b7a99;text-decoration:none" title="Allowed values">ℹ Allowed values</a>
```

- [ ] **Step 11.3: Add `downloadActionsTemplate`**

In the JS section near `addActionRow`:
```js
function downloadActionsTemplate() {
  const csv = [
    'task,department,priority,due_date,owner,status,comment',
    '"Replace failed UPS in server room","Technical Service","High","2026-05-15","Jean Doe","open","Sample comment"',
    '"Verify backup runs weekly","General Manager","Medium","2026-05-30","Marie Diallo","in_progress","Pending vendor confirmation"',
    '"Document network rack labeling","Technical Service","Low","","","open",""'
  ].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'action-items-template.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 11.4: Add `onActionsCsvSelected`**

```js
async function onActionsCsvSelected(event) {
  const file = event.target.files?.[0];
  event.target.value = '';  // reset input so re-uploading the same file fires onchange
  if (!file) return;
  if (file.size > 200 * 1024) {
    toast('❌ File too large (limit 200 KB / ~5000 rows).', 'error');
    return;
  }

  const text = await file.text();
  if (typeof window.parseActionsCsv !== 'function') {
    toast('CSV parser not loaded — refresh the page.', 'error');
    return;
  }

  const deptNames = _departmentList.map(d => d.name);
  const res = window.parseActionsCsv(text, deptNames);
  if (res.fatal) {
    toast(`❌ ${res.error}. Re-download the template.`, 'error');
    return;
  }

  const existingCount = document.querySelectorAll('#action-body tr:not(.action-comment-row)').length;
  showCsvImportModal({
    ok: res.ok, errors: res.errors,
    existingCount,
    onConfirm: () => {
      res.ok.forEach(row => addActionRow(row));
      toast(`✓ Appended ${res.ok.length} row(s). Review and click Save when ready.`, 'success');
      if (res.errors.length) showCsvErrorBanner(res.errors);
    }
  });
}
```

- [ ] **Step 11.5: Add the import-result modal + error banner**

```js
function showCsvImportModal({ ok, errors, existingCount, onConfirm }) {
  const skippedHtml = errors.length
    ? errors.slice(0, 20).map(e => `<li>Row ${e.row}: ${esc(e.reason)}</li>`).join('') + (errors.length > 20 ? `<li>… and ${errors.length - 20} more</li>` : '')
    : '<li style="color:#94a3b8">None</li>';

  const html = `
    <div class="modal-overlay show" id="csv-import-modal" style="display:flex">
      <div class="modal" style="max-width:560px">
        <h2>Import CSV — Action Items</h2>
        <p style="margin:8px 0;color:#475569">
          ✓ <strong>${ok.length}</strong> row(s) ready to append<br>
          ${errors.length ? `⚠ <strong>${errors.length}</strong> row(s) skipped` : ''}
        </p>
        <p style="font-size:0.85rem;color:#6b7a99">
          Currently <strong>${existingCount}</strong> action(s) in this week's table.
          After import: <strong>${existingCount + ok.length}</strong>.
        </p>
        ${errors.length ? `
          <details style="margin-top:8px">
            <summary style="cursor:pointer;color:#475569">Skipped rows (${errors.length})</summary>
            <ul style="margin:6px 0 0 18px;font-size:0.83rem;color:#475569;max-height:160px;overflow:auto">${skippedHtml}</ul>
          </details>` : ''
        }
        <div style="text-align:right;margin-top:16px">
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('csv-import-modal').remove()">Cancel</button>
          <button class="btn btn-primary btn-sm" id="csv-import-confirm-btn" style="margin-left:8px" ${ok.length ? '' : 'disabled'}>Append ${ok.length} row(s)</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('csv-import-confirm-btn').onclick = () => {
    document.getElementById('csv-import-modal').remove();
    onConfirm();
  };
}

function showCsvErrorBanner(errors) {
  const existing = document.getElementById('csv-error-banner');
  if (existing) existing.remove();
  const html = `
    <div id="csv-error-banner" class="alert" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px 14px;margin-bottom:10px;color:#991B1B;font-size:0.85rem">
      <strong>ℹ ${errors.length} row(s) from your last CSV import were skipped.</strong>
      <button onclick="this.parentNode.remove()" style="float:right;background:none;border:none;color:#991B1B;cursor:pointer;font-size:1rem;line-height:1">×</button>
      <ul style="margin:6px 0 0 18px">${errors.slice(0, 10).map(e => `<li>Row ${e.row}: ${esc(e.reason)}</li>`).join('')}${errors.length > 10 ? `<li>… and ${errors.length - 10} more</li>` : ''}</ul>
    </div>`;
  const section = document.getElementById('section-3');
  section?.querySelector('.card')?.insertAdjacentHTML('afterbegin', html);
}
```

- [ ] **Step 11.6: Add the allowed-values info modal**

```js
function showCsvAllowedValuesModal() {
  const depts = _departmentList.map(d => esc(d.name)).join(', ');
  const html = `
    <div class="modal-overlay show" id="csv-help-modal" style="display:flex">
      <div class="modal" style="max-width:560px">
        <h2>CSV — Allowed values</h2>
        <p><strong>Required headers</strong> (any order): task, department, priority, due_date, owner, status. Optional: comment.</p>
        <p><strong>Department</strong> — must match an active value: <em>${depts || '(none — load departments first)'}</em></p>
        <p><strong>Priority</strong> — High, Medium, Low (also accepted: Haute/Moyenne/Basse, H/M/L, any case)</p>
        <p><strong>Status</strong> — open, in_progress, on_hold, closed, cancelled (also accepted: French + spaces, any case)</p>
        <p><strong>Due Date</strong> — YYYY-MM-DD preferred. Unambiguous DMY/MDY accepted (when one slot &gt; 12). 04/05/2026 will be rejected as ambiguous.</p>
        <p style="font-size:0.85rem;color:#6b7a99">⚠ Bad rows are skipped, good rows are imported. The skipped list is shown after upload.</p>
        <div style="text-align:right;margin-top:16px">
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('csv-help-modal').remove()">Close</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}
```

- [ ] **Step 11.7: Smoke-test in browser (golden path)**

1. Open weekly report. Section 3.
2. Click `⬇ CSV Template` → file downloads. Open in Excel. Confirm 7 columns + 3 sample rows.
3. Edit the template: change one task name. Save as CSV.
4. Click `⬆ Import CSV` → file picker → pick saved file → modal: "3 rows ready to append, 0 skipped" → confirm.
5. Table now has 3 new rows. Click 💾 Save → 200 OK. Reload — rows persist.

- [ ] **Step 11.8: Smoke-test bad-data path**

1. Edit the template: row 1 → set department to "Logistics"; row 2 → set due_date to "32/13/2026"; row 3 → empty task. Save.
2. Click `⬆ Import CSV` → modal: "0 rows ready, 3 skipped" with reasons. Cancel.
3. Re-import a known-good CSV → only good rows appear; previous skip-banner cleared.

- [ ] **Step 11.9: Smoke-test ambiguous date**

CSV row with `due_date="04/05/2026"` → modal shows skipped: "Row N: ambiguous date '04/05/2026' (use YYYY-MM-DD)".

- [ ] **Step 11.10: Smoke-test UTF-8 BOM + non-ASCII**

Save a CSV in Excel (Windows), it'll have a BOM. Department name with accent: `Réseaux` → must NOT be in the active list, so should error gracefully. Add `Réseaux` as a department first (Admin tab), then import → should succeed and case/diacritics match.

- [ ] **Step 11.11: Commit**

```bash
git add public/reports.html
git commit -m "feat(actions): CSV bulk import + template export

- ⬇ CSV Template button — pure client-side download with BOM + 3 sample rows
- ⬆ Import CSV button — file picker, parses via parseActionsCsv,
  shows preview modal with row counts + skipped list
- Append-mode (mirrors carry-over UX); 200 KB / 5000 row caps
- ℹ Allowed values modal lists active departments + enum mappings
- Reuses existing PUT /actions endpoint — no new server route

Refs: spec §6"
```

---

## Phase 5 — PPTX Exports

### Task 12: Add Department column to weekly + monthly PPTX action slides

**Files:**
- Modify: `reports-weekly-pptx.js`:
  - `slideActionItems` (~line 547-587)
  - `slideMonthlyActionsV2` (~line 1268-1315)
- Modify: `reports-monthly-pptx.js` — same `slideMonthlyActionsV2` change as above
- Modify: `reports-pptx.js` — only if Step 0.2 found it wired

**Goal:** Department column inserted between Task and Priority. Comment intentionally NOT shown. Pre-existing subtitle violation in `slideMonthlyActionsV2` fixed in same change.

- [ ] **Step 12.1: Update `slideActionItems` (weekly) in `reports-weekly-pptx.js`**

Find the existing function (~line 547). Edit the rows-and-colW block:

```js
// Replace the header row (was 5 columns):
[
  { text:'Task',       options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'left' } },
  { text:'Department', options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
  { text:'Priority',   options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
  { text:'Due Date',   options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
  { text:'Owner',      options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
  { text:'Status',     options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
],
```
And the data rows:
```js
...(items.length ? items : [{ task:'—', department:'—', priority:'—', due_date:'—', owner:'—', status:'open' }]).map((a, i) => {
  const pColor = a.priority==='High'?C.red : a.priority==='Low'?C.green : C.orange;
  const rowFill = i % 2 === 0 ? C.lightGrey : C.white;
  return [
    { text: a.task,                   options:{ fill:{color:rowFill}, align:'left' } },
    { text: a.department || '—',      options:{ fill:{color:rowFill}, align:'center', fontSize:10, color:C.darkGrey } },
    { text: a.priority||'—',          options:{ fill:{color:rowFill}, color:pColor, bold:true, align:'center' } },
    { text: a.due_date||'TBC',        options:{ fill:{color:rowFill}, align:'center' } },
    { text: a.owner||'—',             options:{ fill:{color:rowFill}, align:'center' } },
    { text: a.status||'open',         options:{ fill:{color:rowFill}, align:'center' } },
  ];
})
```
And the colW (was `[7.53, 1.2, 1.4, 1.4, 1.2]`):
```js
colW:[6.13, 1.4, 1.2, 1.4, 1.4, 1.2],   // Task | Dept | Priority | Due | Owner | Status — sums 12.73
```

- [ ] **Step 12.2: Update `slideMonthlyActionsV2` in `reports-weekly-pptx.js` (3 changes)**

Find function (~line 1268). Three edits:

(a) **Fix subtitle violation** — line 1271 currently:
```js
addTitle(slide, `6. Actions & Follow-ups — ${monthLabel}`, 'All Weeks Combined');
```
Replace with:
```js
addTitle(slide, `6. Actions & Follow-ups — ${monthLabel}`, null);
```

(b) **Add Department column** — header (~line 1283-1291):
```js
[
  {text:'Week',       options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
  {text:'Task',       options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'left',fontSize:9}},
  {text:'Department', options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
  {text:'Priority',   options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
  {text:'Due Date',   options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
  {text:'Owner',      options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
  {text:'Status',     options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
],
```
And data rows (~line 1292-1303):
```js
...(items.length ? items : [{ week_label:'—', task:'—', department:'—', priority:'—', due_date:'—', owner:'—', status:'—' }]).map((a,i) => {
  const pColor = a.priority==='High'?C.red:a.priority==='Low'?C.green:C.orange;
  const rowFill = i%2===0?C.lightGrey:C.white;
  return [
    {text:a.week_label||'',           options:{fill:{color:rowFill},align:'center',fontSize:9,color:'555555'}},
    {text:a.task||'—',                options:{fill:{color:rowFill},align:'left',fontSize:9}},
    {text:a.department||'—',          options:{fill:{color:rowFill},align:'center',fontSize:8,color:C.darkGrey}},
    {text:a.priority||'—',            options:{fill:{color:rowFill},color:pColor,bold:true,align:'center',fontSize:9}},
    {text:a.due_date||'TBC',          options:{fill:{color:rowFill},align:'center',fontSize:9}},
    {text:a.owner||'—',               options:{fill:{color:rowFill},align:'center',fontSize:9}},
    {text:a.status||'open',           options:{fill:{color:rowFill},align:'center',fontSize:9}},
  ];
})
```

(c) **Update colW** (was `[1.2, 6.93, 1.0, 1.1, 1.3, 1.2]`):
```js
colW:[1.2, 5.53, 1.4, 1.0, 1.1, 1.3, 1.2],   // Week | Task | Dept | Priority | Due | Owner | Status — sums 12.73
```

- [ ] **Step 12.3: Same change to `slideMonthlyActionsV2` in `reports-monthly-pptx.js`**

Per CLAUDE.md, this file has its own copy of `slideMonthlyActionsV2`. Apply the identical edits (subtitle fix + Department column + new colW). Use grep:
```
grep -n "slideMonthlyActionsV2" reports-monthly-pptx.js
```
Confirm location, apply same diff.

- [ ] **Step 12.4: Same change to `reports-pptx.js` IF Step 0.2 found it wired**

If wired: apply the identical diff to `slideActionItems` and `slideMonthlyActionsV2` there.

If not wired: log finding for the follow-up issue, do not modify.

- [ ] **Step 12.5: Syntax-check**

```
node -e "require('./reports-weekly-pptx.js')"
node -e "require('./reports-monthly-pptx.js')"
node -e "require('./reports-pptx.js')"  # only if relevant
```
Expected: no output (modules export functions silently).

- [ ] **Step 12.6: Generate sample PPTX**

Pick a recent submitted weekly report. Open browser DevTools → Network. Click `⬇ Weekly PPTX` button. Save the resulting file. Repeat for monthly via the Monthly tab `⬇ Export PPTX` button.

- [ ] **Step 12.7: Open in PowerPoint (NOT LibreOffice)**

Open both PPTX files in Microsoft PowerPoint. Verify:
- Weekly slide 4 (Action Items): Department column visible between Task and Priority. Long names like "Social performance" don't truncate.
- Monthly slide 6 (Actions & Follow-ups): same. **No subtitle "All Weeks Combined" — title is single line.**
- Legacy reports (created before this change) render `—` in the Department column without breaking the table.

If any column overflows or the layout breaks, adjust widths and re-test.

- [ ] **Step 12.8: Commit**

```bash
git add reports-weekly-pptx.js reports-monthly-pptx.js
# add reports-pptx.js if updated
git commit -m "feat(actions): Department column in weekly + monthly PPTX action slides

- slideActionItems: 6 cols (Task|Dept|Pri|Due|Owner|Status), widths sum 12.73
- slideMonthlyActionsV2: 7 cols (Week|Task|Dept|Pri|Due|Owner|Status)
- Fix pre-existing CLAUDE.md violation: removed 'All Weeks Combined' subtitle
- Comment intentionally NOT in PPTX (dashboard-only — spec §8.4)
- Department fontSize 10 weekly / 8 monthly to fit 'Social performance'

Refs: spec §8"
```

---

## Phase 6 — Verification + Deployment

### Task 13: End-to-end manual test pass

**Files:** none (manual testing).

Run through every row of the spec's testing checklist (§11.1). Capture results in `notes/qa-2026-04-26.md`.

- [ ] **Step 13.1: DB migration on backup of live DB**

Make a copy of `C:\Apps\SDP-Dashboard\data\reports.db` → run `node -e "require('./reports-db.js')"` against it. Verify schema, no errors, all reports load.

- [ ] **Step 13.2: Department CRUD via UI**

Per spec §11.1 rows 2-4. Sign in as super_admin, then again as a low-role user.

- [ ] **Step 13.3: Action save with valid + invalid department**

Per spec §11.1 rows 5-8.

- [ ] **Step 13.4: CSV import paths**

Per spec §11.1 rows 9-15. Test happy path, partial errors, missing column, ambiguous date, BOM, oversize file, template download.

- [ ] **Step 13.5: PPTX exports — open in real PowerPoint**

Per spec §11.1 rows 16-18. Both weekly + monthly + legacy report.

- [ ] **Step 13.6: Carry-over + monthly editor**

Per spec §11.1 rows 19-20.

- [ ] **Step 13.7: Document any deviations**

If any test fails, file the issue with row reference, root cause, and fix in commits before proceeding to deployment.

- [ ] **Step 13.8: Commit QA notes**

```bash
git add notes/qa-2026-04-26.md
git commit -m "qa: end-to-end manual test results for departments + CSV feature"
```

---

### Task 14: Deploy to production

**Files:** none — this is a deployment step.

Per CLAUDE.md deployment steps. Order matters: copy files first, reload PM2, watch logs.

- [ ] **Step 14.1: Final pre-deploy backup**

```cmd
copy "C:\Apps\SDP-Dashboard\data\reports.db" "C:\Apps\SDP-Dashboard\data\reports-backup-deploy-2026-04-26.db"
```

- [ ] **Step 14.2: Copy changed files**

```cmd
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\reports-db.js" "C:\Apps\SDP-Dashboard\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\server.js" "C:\Apps\SDP-Dashboard\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\public\reports.html" "C:\Apps\SDP-Dashboard\public\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\public\lib\parse-actions-csv.js" "C:\Apps\SDP-Dashboard\public\lib\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\reports-weekly-pptx.js" "C:\Apps\SDP-Dashboard\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\reports-monthly-pptx.js" "C:\Apps\SDP-Dashboard\" /Y
:: reports-pptx.js — only if modified per Step 0.2
```

If `C:\Apps\SDP-Dashboard\public\lib` doesn't exist, create it first:
```cmd
mkdir "C:\Apps\SDP-Dashboard\public\lib"
```

- [ ] **Step 14.3: Reload PM2**

```cmd
pm2 reload endeavour-dashboard
pm2 logs endeavour-dashboard --lines 50 --nostream
```
Expected: `[seed] Inserted 10 default action_departments` on first reload (only the first time). No errors.

If `EADDRINUSE`:
```cmd
powershell -command "Get-NetTCPConnection -LocalPort 3456 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { taskkill /F /PID $_ }"
pm2 restart endeavour-dashboard
```

- [ ] **Step 14.4: Smoke-test on production URL**

Open `http://10.225.99.173:3456/reports.html` in a browser. Sign in. Navigate to:
- Admin tab → see Departments card with 10 rows
- Weekly report → Section 3 → see Department column + CSV buttons
- Generate weekly PPTX → open in PowerPoint → confirm Department column

- [ ] **Step 14.5: Tag the deployment**

```bash
git tag -a v1.11.0-departments -m "Action items: department + comment + CSV import"
git push origin main
git push origin v1.11.0-departments
```

(Adjust version per existing scheme. Check `package.json` `version` field.)

- [ ] **Step 14.6: Document follow-ups**

If Step 0.2 found `reports-pptx.js` unused, file an issue: "Delete reports-pptx.js (CLAUDE.md flagged as legacy)". Also file: "Audit other slideMonthly* functions for the addTitle subtitle violation (Section 8.3.1 of spec)".

---

## Done Criteria

- ✅ All 14 tasks complete with green commits
- ✅ Spec §11.1 testing checklist all pass
- ✅ Live PM2 instance running new code
- ✅ Backup files exist for rollback
- ✅ Follow-up issues filed for out-of-scope work flagged in spec §8.3.1 and §14

## Rollback

If anything goes wrong post-deploy:
1. `xcopy` previous version of each file from `C:\Apps\SDP-Dashboard\reports-backup-pre-departments-2026-04-26\` (or git checkout the previous commit on a clone of `C:\Apps`)
2. Restore DB if needed: `copy "C:\Apps\SDP-Dashboard\data\reports-backup-pre-departments-2026-04-26.db" "C:\Apps\SDP-Dashboard\data\reports.db"`
3. `pm2 restart endeavour-dashboard`
4. Schema additions (`department`, `comment` columns + `action_departments` table) are nullable / additive — even if old code runs against the new schema, it works because old code SELECTs explicit columns and ignores the new ones.

---

## Skill References

- @superpowers:test-driven-development — applies to Task 10 (CSV parser is the only pure-function unit with TDD coverage)
- @superpowers:verification-before-completion — applies to all manual-test steps (Tasks 0, 13, 14)
- @superpowers:subagent-driven-development OR @superpowers:executing-plans — orchestrates execution of this plan
