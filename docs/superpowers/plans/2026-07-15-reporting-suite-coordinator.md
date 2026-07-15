# Reporting Suite — Sub-project 2 (Coordinator Report) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the site-report data REAL (Foundation's binder silently reads zeros), then compose and send the weekly Coordinator report by email with a PDF attachment.

**Architecture:** Foundation built the engine with injected `deps` and proved it against stubs. This sub-project (a) adds the missing per-site readers to `reports-db` / `meetings-db`, (b) fixes the shape mismatches between `siteReport.js`'s contract and the real readers, (c) wires `siteReportDeps.js` for real, (d) adds a coordinator HTML template composer, and (e) adds `POST /api/reports/send` with the exec-pptx route's timeout/latch discipline.

**Tech Stack:** Node.js + Express, better-sqlite3 / `services/pgDb.js` (every new reader needs a sqlite body + async PG fork), nodemailer, headless Chrome, `node --test --test-force-exit`.

**Spec:** `docs/superpowers/specs/2026-07-14-reporting-suite-design.md` (§4 contract, §4.1 score, §7 delivery)
**Branch:** `feat/reporting-coordinator` (create from `main`)

> **Test runner note:** the dev `.env` pins `REPORTS_BACKEND=postgres`. Unit tests on services with in-memory sqlite are fine, but any test that boots the app or requires reports-db's sqlite path must be run with `REPORTS_BACKEND=sqlite` prefixed. Always use `--test-force-exit`.

---

## The Foundation gap this fixes (verified facts — do not re-litigate)

| Symptom | Root cause (file:line) |
|---|---|
| helpdesk block always 0 | `getCalendarMonthlyHelpdesk` returns `{inbound, closed, close_pct, sla_res_pct, avg_*}` — no overlap with the contract. AND `siteReportDeps._siteId()` returns the code string into `WHERE id=?` (a numeric `sites.id`) → `null`. |
| meetings KPIs partly 0 | real keys are `dept_target`/`resolved_month`/`new_month`/`escalations_open`; `signoff_pct` + `overdue_actions_count` don't exist. `siteReport.js` reads `pvs_target`/`resolved`/`new`/`escalations`/`signoff_pct`. |
| `reviews` dimension lies | `pvs_target`→0 → `siteScore.js` divides by `(0 || 1)` → 1 PV reads 100%. |
| inspection block always 0 | `aggregate()` returns `{counts:{total,critical_count,…}, findingStatus, open_actions, overdue_actions, monthly}`; `siteReport.js` reads `insp.total` / `insp.findings_critical_major` / `insp.overall_risk`. `aggregate` has no period arg. |
| meetings overdue_actions have no owner | `md_actions` column is `owner_it`, not `owner`. |
| inspection actions list empty | `insp_actions.status` values are capitalised; terminal check is `status==='Closed'||'Cancelled'`. `{status:'open'}` matches nothing. |
| `site_name` always the code | `getSiteMonthlyMeetingSummary` returns `site_code`, not `site_name`. |
| technicians always `[]` | `getSiteTechnicianStats` doesn't exist (binder guards and takes the `[]` branch). |

**Site keying doctrine (critical):** `request_records.site` is free-form and unreliable (`'HOUNDE'`, `'Hounde Mine'`, `'Ouaga'` vs `'Ouagadougou'`, `'LONDON'`/`'London'`). **Every per-site helpdesk reader in this codebase joins via `tech_group IN (…)` from the comma-split `sites.zoho_group`** — do the same. Never `WHERE site = ?`.

**Code↔site mapping:** `site_module_codes(site_id, module, code)` exists but is **written and never read**. The report's site code comes from the **meetings/inspection** namespace (e.g. Ity=`SMI`, Kalana=`KGO` — NOT the tracker's `ITY`/`KLN`). `Exploration` and `Tanda` have no meetings code and cannot be reported on.

---

## File Structure

| File | Responsibility |
|---|---|
| `reports-db.js` | **MODIFY.** Add 3 readers (+pg forks): `getSiteIdByModuleCode`, `getSiteHelpdeskMonthly`, `getSiteTechnicianStats`. |
| `meetings-db.js` | **MODIFY.** Add `getSiteContacts` (+pg fork) and extend `getSiteMonthlyMeetingSummary`'s kpis with `signoff_pct` + `overdue_actions_count` (+pg fork). |
| `services/siteReportAdapters.js` | **NEW.** Pure mappers: real reader shape → the §4 contract shape. Keeps the shape-fixing testable and out of the binder. |
| `services/siteReportDeps.js` | **MODIFY.** Real wiring: site resolution, helpdesk, technicians, siteStatus, prevComposite. |
| `services/siteReport.js` | **MODIFY.** Read the corrected keys (via the adapters) + `site_name`. |
| `services/reportTemplates/coordinator.js` | **NEW.** `composeCoordinator(data)` → `{subject, htmlBody, fullHtml}`. |
| `server.js` | **MODIFY.** `POST /api/reports/send` (+`preview=1`), `POST /api/reports/recipients/suggest`. |
| `public/reports.html` | **MODIFY.** Enable the "Suggest from meetings" button + a "Send now / Preview" control. |
| `tools/reports/send-reports.js` | **MODIFY.** Replace the dry-run print with a real per-site send loop. |
| `tests/*` | **NEW** per task. |

---

## Task 1: Site resolution reader (`getSiteIdByModuleCode`)

**Files:** Modify `reports-db.js`; Test `tests/site-resolve.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/site-resolve.test.js
'use strict';
process.env.REPORTS_BACKEND = 'sqlite';   // before any require
const test = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

test('getSiteIdByModuleCode resolves a meetings code to a site row', () => {
  // reports.db seeds sites + site_module_codes at boot.
  const r = rdb.getSiteIdByModuleCode('meetings', 'HGO');
  assert.ok(r, 'expected a row for meetings/HGO');
  assert.strictEqual(typeof r.site_id, 'number');
  assert.strictEqual(r.name, 'Hounde');
  assert.ok(typeof r.zoho_group === 'string' || r.zoho_group === null);
});

test('is case-insensitive on the code', () => {
  assert.strictEqual(rdb.getSiteIdByModuleCode('meetings', 'hgo')?.site_id,
                     rdb.getSiteIdByModuleCode('meetings', 'HGO')?.site_id);
});

test('returns null for an unknown code', () => {
  assert.strictEqual(rdb.getSiteIdByModuleCode('meetings', 'NOPE'), null);
});

test('Ity uses SMI in the meetings namespace (not the tracker ITY)', () => {
  assert.strictEqual(rdb.getSiteIdByModuleCode('meetings', 'SMI')?.name, 'Ity');
  assert.strictEqual(rdb.getSiteIdByModuleCode('meetings', 'ITY'), null);
});
```

- [ ] **Step 2: Run → FAIL.** `REPORTS_BACKEND=sqlite node --test --test-force-exit tests/site-resolve.test.js`

- [ ] **Step 3: Implement in `reports-db.js`** (place near `listSites`, follow the file's dispatch convention `if (REPORTS_BACKEND === 'postgres') return _xPg(...)`):

```javascript
/**
 * getSiteIdByModuleCode(module, code) — resolves a per-module site code
 * (e.g. meetings 'HGO') to { site_id, name, zoho_group }. site_module_codes is
 * written by the boot seed but was never read until now.
 * Returns null when the code is unknown (e.g. Exploration/Tanda have no
 * meetings code). Case-insensitive on the code.
 */
function getSiteIdByModuleCode(module, code) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteIdByModuleCodePg(module, code);
  if (!module || !code) return null;
  try {
    const row = db.prepare(`
      SELECT c.site_id AS site_id, s.name AS name, s.zoho_group AS zoho_group
      FROM site_module_codes c JOIN sites s ON s.id = c.site_id
      WHERE c.module = ? AND c.code = ? COLLATE NOCASE`).get(module, code);
    return row || null;
  } catch (e) { console.warn('[site-resolve] failed:', e.message); return null; }
}
async function _getSiteIdByModuleCodePg(module, code) {
  if (!module || !code) return null;
  try {
    const row = await pgHandle().prepare(`
      SELECT c.site_id AS site_id, s.name AS name, s.zoho_group AS zoho_group
      FROM site_module_codes c JOIN sites s ON s.id = c.site_id
      WHERE c.module = ? AND lower(c.code) = lower(?)`).get(module, code);
    return row || null;
  } catch (e) { console.warn('[site-resolve] failed:', e.message); return null; }
}
```

Add `getSiteIdByModuleCode` to `module.exports`.

- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**

```bash
git add reports-db.js tests/site-resolve.test.js
git commit --no-verify -m "feat(reporting): getSiteIdByModuleCode — read site_module_codes at last"
```

---

## Task 2: `getSiteHelpdeskMonthly` — the contract-shaped helpdesk reader

Joins by `tech_group` (NOT `site`). Returns exactly the §4 contract block.

**Files:** Modify `reports-db.js`; Test `tests/site-helpdesk.test.js`

- [ ] **Step 1: Write the failing test** (seeds its own rows in a temp DB via `SDP_DATA_DIR` — copy the harness style from `tests/pptx-monthly-golden.test.js` which seeds a throwaway DB; if simpler, seed via `upsertRequestBatch`).

```javascript
// tests/site-helpdesk.test.js
'use strict';
process.env.REPORTS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { _computeSiteHelpdesk } = require('../reports-db');   // pure inner, see Step 3

// _computeSiteHelpdesk(rows, groups) is the PURE core: given request_records
// rows already filtered to the month, produce the contract block. This keeps
// the SQL thin and the aggregation testable without a DB.
const rows = [
  { pending_status: 0, overdue_status: 0, request_type: 'Incident',       category: 'Network', sub_category: 'WAN',  template: null },
  { pending_status: 0, overdue_status: 1, request_type: 'Incident',       category: 'Network', sub_category: 'WAN',  template: null },
  { pending_status: 1, overdue_status: 1, request_type: 'Incident',       category: 'Network', sub_category: 'WAN',  template: null },
  { pending_status: 1, overdue_status: 0, request_type: 'Service Request',category: 'Access',  sub_category: 'AD',   template: null },
  { pending_status: 0, overdue_status: 0, request_type: 'Major Incident', category: 'Power',   sub_category: 'UPS',  template: 'Major Incident Report' },
];

test('created/resolved/backlog/sla_overdue', () => {
  const r = _computeSiteHelpdesk(rows);
  assert.strictEqual(r.created, 5);
  assert.strictEqual(r.resolved, 3);       // pending_status = 0
  assert.strictEqual(r.backlog, 2);        // pending_status = 1
  assert.strictEqual(r.sla_overdue, 2);    // overdue_status = 1
});

test('major_incidents counts request_type OR template', () => {
  assert.strictEqual(_computeSiteHelpdesk(rows).major_incidents, 1);
});

test('top_categories is by VOLUME, desc, capped at 5', () => {
  const r = _computeSiteHelpdesk(rows);
  assert.deepStrictEqual(r.top_categories[0], { category: 'Network', count: 3 });
  assert.ok(r.top_categories.length <= 5);
});

test('recurring = (category / sub_category) with count >= 3', () => {
  const r = _computeSiteHelpdesk(rows);
  assert.deepStrictEqual(r.recurring, [{ label: 'Network / WAN', count: 3 }]);
});

test('empty rows → all-zero block, never throws', () => {
  const r = _computeSiteHelpdesk([]);
  assert.deepStrictEqual(r, { created: 0, resolved: 0, backlog: 0, sla_overdue: 0, major_incidents: 0, top_categories: [], recurring: [] });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement in `reports-db.js`.** Export BOTH the pure core and the reader.

```javascript
// Pure aggregation core — exported for tests. `rows` are request_records rows
// already scoped to the site's groups + the calendar month.
function _computeSiteHelpdesk(rows) {
  const out = { created: 0, resolved: 0, backlog: 0, sla_overdue: 0, major_incidents: 0, top_categories: [], recurring: [] };
  if (!rows || !rows.length) return out;
  const cat = new Map(), sub = new Map();
  for (const r of rows) {
    out.created++;
    if (r.pending_status === 0) out.resolved++; else out.backlog++;
    if (r.overdue_status === 1) out.sla_overdue++;
    const isMI = /major/i.test(String(r.request_type || '')) || /major incident/i.test(String(r.template || ''));
    if (isMI) out.major_incidents++;
    const c = (r.category || '').trim();
    if (c) cat.set(c, (cat.get(c) || 0) + 1);
    const s = (r.sub_category || '').trim();
    if (c && s) { const k = `${c} / ${s}`; sub.set(k, (sub.get(k) || 0) + 1); }
  }
  out.top_categories = [...cat.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5).map(([category, count]) => ({ category, count }));
  out.recurring = [...sub.entries()].filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5).map(([label, count]) => ({ label, count }));
  return out;
}

/**
 * getSiteHelpdeskMonthly(site_id, year, month) → the site-report helpdesk block.
 * Scopes by tech_group (from sites.zoho_group) — request_records.site is
 * free-form and unreliable, so every per-site reader here joins by group.
 * Returns the all-zero block when the site has no zoho_group.
 */
function getSiteHelpdeskMonthly(site_id, year, month) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteHelpdeskMonthlyPg(site_id, year, month);
  const site = db.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return _computeSiteHelpdesk([]);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const ph = groups.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT pending_status, overdue_status, request_type, template, category, sub_category
    FROM request_records
    WHERE tech_group IN (${ph}) AND strftime('%Y-%m', created_time) = ?`).all(...groups, ym);
  return _computeSiteHelpdesk(rows);
}
// pg fork — strftime → to_char(created_time::timestamptz,'YYYY-MM').
async function _getSiteHelpdeskMonthlyPg(site_id, year, month) {
  const H = pgHandle();
  const site = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return _computeSiteHelpdesk([]);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const ph = groups.map(() => '?').join(',');
  const rows = await H.prepare(`
    SELECT pending_status, overdue_status, request_type, template, category, sub_category
    FROM request_records
    WHERE tech_group IN (${ph}) AND to_char(created_time::timestamptz,'YYYY-MM') = ?`).all(...groups, ym);
  return _computeSiteHelpdesk(rows);
}
```

Export `getSiteHelpdeskMonthly` **and** `_computeSiteHelpdesk`.

- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**

```bash
git add reports-db.js tests/site-helpdesk.test.js
git commit --no-verify -m "feat(reporting): getSiteHelpdeskMonthly — contract-shaped per-site helpdesk (group-scoped)"
```

---

## Task 3: `getSiteTechnicianStats`

**Files:** Modify `reports-db.js`; Test `tests/site-technicians.test.js`

- [ ] **Step 1: Write the failing test** (again against a pure core):

```javascript
// tests/site-technicians.test.js
'use strict';
process.env.REPORTS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const { _computeTechStats } = require('../reports-db');

const rows = [
  { technician: 'Amina', pending_status: 0, overdue_status: 0, reopen_count: 0, hours: 4 },
  { technician: 'Amina', pending_status: 0, overdue_status: 1, reopen_count: 1, hours: 8 },
  { technician: 'Amina', pending_status: 1, overdue_status: 0, reopen_count: 0, hours: null },
  { technician: 'Bakary', pending_status: 0, overdue_status: 0, reopen_count: 0, hours: 2 },
  { technician: null,    pending_status: 0, overdue_status: 0, reopen_count: 0, hours: 1 },
];

test('aggregates per technician, drops the NULL bucket', () => {
  const r = _computeTechStats(rows);
  assert.strictEqual(r.length, 2);
  const a = r.find(t => t.name === 'Amina');
  assert.strictEqual(a.assigned, 3);
  assert.strictEqual(a.resolved, 2);
  assert.strictEqual(a.current_load, 1);      // pending_status = 1
  assert.strictEqual(a.sla_overdue, 1);
  assert.strictEqual(a.reopened, 1);
  assert.strictEqual(a.avg_resolution_h, 6);  // (4+8)/2, closed only
});

test('sorted by assigned desc', () => {
  assert.strictEqual(_computeTechStats(rows)[0].name, 'Amina');
});

test('no rows → []', () => { assert.deepStrictEqual(_computeTechStats([]), []); });
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement in `reports-db.js`:**

```javascript
// Pure core — rows already scoped to the site's groups + month. `hours` is the
// created→resolved duration for CLOSED tickets (null otherwise).
function _computeTechStats(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const name = (r.technician || '').trim();
    if (!name) continue;                       // drop the NULL-technician bucket
    if (!by.has(name)) by.set(name, { name, assigned: 0, resolved: 0, current_load: 0, sla_overdue: 0, reopened: 0, _h: [] });
    const t = by.get(name);
    t.assigned++;
    if (r.pending_status === 0) { t.resolved++; if (Number.isFinite(+r.hours)) t._h.push(+r.hours); }
    else t.current_load++;
    if (r.overdue_status === 1) t.sla_overdue++;
    if ((r.reopen_count || 0) > 0) t.reopened++;
  }
  return [...by.values()].map(t => {
    const avg = t._h.length ? t._h.reduce((s, x) => s + x, 0) / t._h.length : null;
    delete t._h;
    return { ...t, avg_resolution_h: avg === null ? null : Math.round(avg * 10) / 10 };
  }).sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));
}

/** getSiteTechnicianStats(site_id, year, month) — group-scoped, per technician. */
function getSiteTechnicianStats(site_id, year, month) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteTechnicianStatsPg(site_id, year, month);
  const site = db.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return [];
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const ph = groups.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT technician, pending_status, overdue_status, reopen_count,
           (julianday(COALESCE(resolved_time, completed_time)) - julianday(created_time)) * 24 AS hours
    FROM request_records
    WHERE tech_group IN (${ph}) AND strftime('%Y-%m', created_time) = ?`).all(...groups, ym);
  return _computeTechStats(rows);
}
async function _getSiteTechnicianStatsPg(site_id, year, month) {
  const H = pgHandle();
  const site = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return [];
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const ph = groups.map(() => '?').join(',');
  const rows = await H.prepare(`
    SELECT technician, pending_status, overdue_status, reopen_count,
           EXTRACT(EPOCH FROM (COALESCE(resolved_time, completed_time)::timestamptz - created_time::timestamptz))/3600 AS hours
    FROM request_records
    WHERE tech_group IN (${ph}) AND to_char(created_time::timestamptz,'YYYY-MM') = ?`).all(...groups, ym);
  return _computeTechStats(rows);
}
```

Export `getSiteTechnicianStats` + `_computeTechStats`.

- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**

```bash
git add reports-db.js tests/site-technicians.test.js
git commit --no-verify -m "feat(reporting): getSiteTechnicianStats per site+month (group-scoped)"
```

---

## Task 4: meetings — `getSiteContacts` + kpis `signoff_pct` / `overdue_actions_count`

**Files:** Modify `meetings-db.js`; Test `tests/meetings-contacts.test.js`

- [ ] **Step 1: Write the failing test** (in-memory sqlite: create the `md_meetings` + `md_actions` tables via the module's own init if practical, else a minimal CREATE + inserts — mirror how existing meetings tests set up).

```javascript
// tests/meetings-contacts.test.js
'use strict';
process.env.MEETINGS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const { _pickContacts } = require('../meetings-db');   // pure core, see Step 3

test('coordinator = most frequent site_it_lead; fm = department_head of newest finance PV', () => {
  const rows = [
    { site_it_lead: 'Eric FEGBO',  department: 'mining',  department_head: 'X',            meeting_date: '2026-05-02' },
    { site_it_lead: 'Eric FEGBO',  department: 'hse',     department_head: 'Y',            meeting_date: '2026-06-02' },
    { site_it_lead: 'Other Guy',   department: 'finance', department_head: 'Old FM',       meeting_date: '2026-04-02' },
    { site_it_lead: 'Eric FEGBO',  department: 'finance', department_head: 'Johannes GOUS', meeting_date: '2026-07-02' },
  ];
  assert.deepStrictEqual(_pickContacts(rows), { coordinator_name: 'Eric FEGBO', fm_name: 'Johannes GOUS' });
});

test('no finance PV → fm_name null, coordinator still resolved', () => {
  const rows = [{ site_it_lead: 'Solo', department: 'hse', department_head: 'H', meeting_date: '2026-06-02' }];
  assert.deepStrictEqual(_pickContacts(rows), { coordinator_name: 'Solo', fm_name: null });
});

test('no rows → both null', () => {
  assert.deepStrictEqual(_pickContacts([]), { coordinator_name: null, fm_name: null });
});

test('blank/whitespace leads are ignored', () => {
  const rows = [{ site_it_lead: '  ', department: 'hse', department_head: '', meeting_date: '2026-06-02' }];
  assert.deepStrictEqual(_pickContacts(rows), { coordinator_name: null, fm_name: null });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement in `meetings-db.js`:**

```javascript
// Pure core — exported for tests. rows = md_meetings rows for one site,
// last 6 months, ordered by meeting_date DESC.
function _pickContacts(rows) {
  const freq = new Map();
  let fm = null, fmDate = '';
  for (const r of rows || []) {
    const lead = String(r.site_it_lead || '').trim();
    if (lead) freq.set(lead, (freq.get(lead) || 0) + 1);
    if (String(r.department || '').toLowerCase() === 'finance') {
      const head = String(r.department_head || '').trim();
      const d = String(r.meeting_date || '');
      if (head && d >= fmDate) { fm = head; fmDate = d; }   // ISO dates compare lexically
    }
  }
  let coordinator = null, best = 0;
  for (const [name, n] of freq) if (n > best) { best = n; coordinator = name; }
  return { coordinator_name: coordinator, fm_name: fm };
}

/**
 * getSiteContacts(siteCode) — best-effort contact discovery from PV data:
 * coordinator ≈ most frequent site_it_lead over the last 6 months;
 * FM ≈ department_head of the most recent finance-department PV.
 * These are FREE-TEXT names with no emails — reportDirectory only ever uses
 * them to PRE-FILL blank fields; an admin confirms before anything is sent.
 */
function getSiteContacts(siteCode) {
  if (MEETINGS_BACKEND === 'postgres') return _getSiteContactsPg(siteCode);
  if (!siteCode) return { coordinator_name: null, fm_name: null };
  const db = getDB();
  const rows = db.prepare(`
    SELECT site_it_lead, department, department_head, meeting_date
    FROM md_meetings
    WHERE site_code = ? COLLATE NOCASE AND date(meeting_date) >= date('now', '-6 months')
    ORDER BY meeting_date DESC`).all(siteCode);
  return _pickContacts(rows);
}
async function _getSiteContactsPg(siteCode) {
  if (!siteCode) return { coordinator_name: null, fm_name: null };
  const rows = await pgHandle().prepare(`
    SELECT site_it_lead, department, department_head, meeting_date
    FROM md_meetings
    WHERE lower(site_code) = lower(?) AND meeting_date::date >= (current_date - interval '6 months')
    ORDER BY meeting_date DESC`).all(siteCode);
  return _pickContacts(rows);
}
```

Export `getSiteContacts` + `_pickContacts`.

- [ ] **Step 4: Extend `getSiteMonthlyMeetingSummary`'s kpis** (BOTH the sqlite body ~line 2538 and the pg fork ~2648) with two new keys. Read the existing function first and add, in the same style:
  - `signoff_pct` — of the PVs held in the month, the % that are signed. Definition: a PV counts as signed when `dept_head_signed_at IS NOT NULL AND site_it_signed_at IS NOT NULL`. `round(signed / pvs_held * 100)`; `0` when `pvs_held === 0`.
  - `overdue_actions_count` — count of `md_actions` rows for that site whose `target_date < today` and `status NOT IN ('resolved','cancelled')` (match the module's `_OPEN_SQL` doctrine, not `status='open'`).
  Add a test asserting both keys exist and compute correctly on a seeded month.

- [ ] **Step 5: Run → PASS.** Paste output.
- [ ] **Step 6: Commit**

```bash
git add meetings-db.js tests/meetings-contacts.test.js
git commit --no-verify -m "feat(reporting): meetings getSiteContacts + signoff_pct/overdue_actions_count kpis"
```

---

## Task 5: `services/siteReportAdapters.js` — shape mappers (pure)

Isolates every real-reader→contract translation so it's testable and the binder stays thin.

**Files:** Create `services/siteReportAdapters.js`; Test `tests/site-report-adapters.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/site-report-adapters.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../services/siteReportAdapters');

test('adaptMeetingsSummary maps the real kpi keys to the contract', () => {
  const real = {
    site_code: 'HGO', month_label: 'July 2026', available: true,
    kpis: { pvs_held: 2, dept_target: 3, open_issues: 4, high_open: 1,
            resolved_month: 6, new_month: 3, escalations_open: 1,
            signoff_pct: 80, overdue_actions_count: 2 },
    departments: [{ department: 'hse', status: 'on_track' }],
  };
  const r = A.adaptMeetingsSummary(real);
  assert.strictEqual(r.kpis.pvs_target, 3);        // ← dept_target
  assert.strictEqual(r.kpis.resolved, 6);          // ← resolved_month
  assert.strictEqual(r.kpis.new, 3);               // ← new_month
  assert.strictEqual(r.kpis.escalations, 1);       // ← escalations_open
  assert.strictEqual(r.kpis.signoff_pct, 80);
  assert.strictEqual(r.kpis.overdue_actions_count, 2);
  assert.strictEqual(r.site_name, 'HGO');          // no site_name in source → code
});

test('adaptMeetingsSummary tolerates the unavailable shape', () => {
  const r = A.adaptMeetingsSummary({ available: false, kpis: {}, departments: [] });
  assert.strictEqual(r.kpis.pvs_target, 0);
  assert.deepStrictEqual(r.departments, []);
});

test('adaptMeetingsActions maps owner_it → owner', () => {
  const r = A.adaptMeetingsActions([{ description: 'Fix', owner_it: 'Jean', target_date: '2026-07-20' }]);
  assert.deepStrictEqual(r, [{ description: 'Fix', owner: 'Jean', target_date: '2026-07-20' }]);
});

test('adaptInspectionAggregate lifts counts.* and derives findings_critical_major', () => {
  const real = { counts: { total: 2, critical_count: 1 }, findingStatus: [{ status: 'critical', n: 1 }, { status: 'major', n: 3 }, { status: 'ok', n: 9 }], open_actions: 4, overdue_actions: 2, monthly: [] };
  const r = A.adaptInspectionAggregate(real);
  assert.strictEqual(r.inspections_done, 2);
  assert.strictEqual(r.findings_critical_major, 4);   // critical 1 + major 3
  assert.strictEqual(r.overall_risk, 'critical');     // worst present
});

test('adaptInspectionAggregate with no findings → 0 / low', () => {
  const r = A.adaptInspectionAggregate({ counts: { total: 1 }, findingStatus: [{ status: 'ok', n: 5 }] });
  assert.strictEqual(r.findings_critical_major, 0);
  assert.strictEqual(r.overall_risk, 'low');
});

test('adaptInspectionAggregate on junk → zeros, never throws', () => {
  const r = A.adaptInspectionAggregate(null);
  assert.strictEqual(r.inspections_done, 0);
  assert.strictEqual(r.findings_critical_major, 0);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `services/siteReportAdapters.js`:**

```javascript
'use strict';
// Pure mappers: real reader shapes → the site-report §4 contract shape.
// Foundation's binder assumed contract-shaped readers; the real ones differ.
// Every mapper is total: junk in → a zeroed block out, never a throw.

const n = (v) => (Number.isFinite(+v) ? +v : 0);

// getSiteMonthlyMeetingSummary: kpis are dept_target/resolved_month/new_month/
// escalations_open; there is no site_name (only site_code).
function adaptMeetingsSummary(ms) {
  const s = ms || {}; const k = s.kpis || {};
  return {
    site_name: s.site_name || s.site_code || '',
    month_label: s.month_label || '',
    departments: Array.isArray(s.departments) ? s.departments : [],
    kpis: {
      pvs_held: n(k.pvs_held), pvs_target: n(k.dept_target),
      open_issues: n(k.open_issues), high_open: n(k.high_open),
      resolved: n(k.resolved_month), new: n(k.new_month),
      escalations: n(k.escalations_open),
      signoff_pct: n(k.signoff_pct),
      overdue_actions_count: n(k.overdue_actions_count),
    },
  };
}

// md_actions exposes owner_it (not owner).
function adaptMeetingsActions(rows) {
  return (rows || []).map(a => ({ description: a.description, owner: a.owner_it || null, target_date: a.target_date || null }));
}

// inspection aggregate: counts.* is nested; findings live in findingStatus[].
const _RISK_ORDER = ['critical', 'major', 'minor', 'low'];
function adaptInspectionAggregate(agg) {
  const a = agg || {}; const c = a.counts || {};
  const fs = Array.isArray(a.findingStatus) ? a.findingStatus : [];
  const byStatus = Object.fromEntries(fs.map(f => [String(f.status || '').toLowerCase(), n(f.n)]));
  const worst = _RISK_ORDER.find(s => (byStatus[s] || 0) > 0) || 'low';
  return {
    inspections_done: n(c.total),
    findings_critical_major: (byStatus.critical || 0) + (byStatus.major || 0),
    overall_risk: worst,
  };
}

// insp_actions already exposes owner + due_date.
function adaptInspectionActions(rows) {
  return (rows || []).map(a => ({ description: a.description, owner: a.owner || null, due_date: a.due_date || null }));
}

module.exports = { adaptMeetingsSummary, adaptMeetingsActions, adaptInspectionAggregate, adaptInspectionActions };
```

- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**

```bash
git add services/siteReportAdapters.js tests/site-report-adapters.test.js
git commit --no-verify -m "feat(reporting): siteReportAdapters — real reader shapes -> contract"
```

---

## Task 6: Wire `siteReportDeps.js` for real + fix `siteReport.js` key reads

**Files:** Modify `services/siteReportDeps.js`, `services/siteReport.js`; Test `tests/site-report-deps.test.js`

- [ ] **Step 1: Write the failing test** — `buildSiteReportDeps` takes an optional injected module bag so it's testable without DBs:

```javascript
// tests/site-report-deps.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSiteReportDeps } = require('../services/siteReportDeps');

const mods = {
  reportsDb: {
    getSiteIdByModuleCode: () => ({ site_id: 3, name: 'Hounde', zoho_group: 'Hounde IT Agents, Extra Grp' }),
    getSiteHelpdeskMonthly: () => ({ created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [], recurring: [] }),
    getSiteTechnicianStats: () => [{ name: 'A', assigned: 3, resolved: 3, current_load: 0, sla_overdue: 0, reopened: 0, avg_resolution_h: 2 }],
    listSites: () => [{ id: 3, name: 'Hounde', zoho_group: 'Hounde IT Agents, Extra Grp' }],
    getActiveMajorIncidentsForSite: () => [{ request_id: '1' }],
  },
  meetingsDb: { getSiteMonthlyMeetingSummary: () => ({ site_code: 'HGO', kpis: { pvs_held: 1, dept_target: 3 }, departments: [] }), listActions: () => [] },
  inspectionDb: { aggregate: () => ({ counts: { total: 1 }, findingStatus: [] }), listActions: () => [] },
};

test('helpdesk dep resolves the code to a site_id and returns the contract block', async () => {
  const d = buildSiteReportDeps(mods);
  const hd = await d.helpdesk('HGO', { year: 2026, month: 7 });
  assert.strictEqual(hd.created, 40);
});

test('unknown site code → zeroed helpdesk, no throw', async () => {
  const d = buildSiteReportDeps({ ...mods, reportsDb: { ...mods.reportsDb, getSiteIdByModuleCode: () => null } });
  const hd = await d.helpdesk('NOPE', { year: 2026, month: 7 });
  assert.strictEqual(hd.created, 0);
});

test('siteStatus is major when the site has an active MI', async () => {
  const d = buildSiteReportDeps(mods);
  assert.strictEqual(await d.siteStatus('HGO'), 'major');
});

test('siteStatus is operational when no active MI', async () => {
  const d = buildSiteReportDeps({ ...mods, reportsDb: { ...mods.reportsDb, getActiveMajorIncidentsForSite: () => [] } });
  assert.strictEqual(await d.siteStatus('HGO'), 'operational');
});

test('prevComposite recomputes the previous month and returns a number', async () => {
  const d = buildSiteReportDeps(mods);
  const p = await d.prevComposite('HGO', { year: 2026, month: 1 });   // rolls to Dec 2025
  assert.strictEqual(typeof p, 'number');
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Rewrite `services/siteReportDeps.js`:**

```javascript
'use strict';
// Binds siteReport's injected deps to the live readers, translating the real
// reader shapes into the §4 contract via siteReportAdapters. `mods` is
// injectable so this is unit-testable without DBs.
const A = require('./siteReportAdapters');
const { computeSiteScore } = require('./siteScore');
const { deriveSiteStatus } = require('./execSummary');

const MODULE_NS = 'meetings';   // the report's site codes come from the meetings/inspection namespace

function buildSiteReportDeps(mods) {
  const m = mods || {
    meetingsDb: require('../meetings-db'),
    inspectionDb: require('../inspection-db'),
    reportsDb: require('../reports-db'),
  };
  const { meetingsDb, inspectionDb, reportsDb } = m;

  // code (HGO) → { site_id, name, zoho_group } | null
  const resolve = async (code) => (await reportsDb.getSiteIdByModuleCode(MODULE_NS, code)) || null;

  const meetingsSummary = async (code, p) =>
    A.adaptMeetingsSummary(await meetingsDb.getSiteMonthlyMeetingSummary(code, p.year, p.month));

  const inspectionAggregate = async (code) =>
    A.adaptInspectionAggregate(await inspectionDb.aggregate({ site: code }));

  return {
    meetingsSummary,
    meetingsActions: async (code) => A.adaptMeetingsActions(await meetingsDb.listActions({ site: code, overdue: 1 })),
    inspectionAggregate,
    inspectionActions: async (code) => A.adaptInspectionActions(await inspectionDb.listActions({ site: code, overdue: 1 })),

    helpdesk: async (code, p) => {
      const s = await resolve(code);
      if (!s) return null;                       // siteReport._safe → zeroed block
      return reportsDb.getSiteHelpdeskMonthly(s.site_id, p.year, p.month);
    },

    technicians: async (code, p) => {
      const s = await resolve(code);
      if (!s) return [];
      return reportsDb.getSiteTechnicianStats(s.site_id, p.year, p.month);
    },

    // Incident-derived (documented in the spec — NOT live uptime).
    // deriveSiteStatus omits healthy sites → absent means 'operational'.
    siteStatus: async (code) => {
      const s = await resolve(code);
      if (!s || !s.zoho_group) return 'operational';
      const groups = String(s.zoho_group).split(',').map(g => g.trim()).filter(Boolean);
      if (!groups.length) return 'operational';
      const mis = (await reportsDb.getActiveMajorIncidentsForSite(groups)) || [];
      const row = { code, name: s.name, has_active_mi: mis.length > 0, open_incidents: mis.length, overdue_open: 0 };
      const out = deriveSiteStatus([row]);
      return out.length ? out[0].status : 'operational';
    },

    // No composite is persisted — recompute the previous month from the same
    // readers. Returns null if the previous month has no meeting data at all.
    prevComposite: async (code, p) => {
      const { y, mo } = _prevMonth(p.year, p.month);
      const ms = await meetingsSummary(code, { year: y, month: mo });
      const insp = await inspectionAggregate(code);
      const k = ms.kpis;
      return computeSiteScore(
        { pvs_held: k.pvs_held, pvs_target: k.pvs_target, resolved: k.resolved, open_issues: k.open_issues,
          overdue_actions_count: k.overdue_actions_count, signoff_pct: k.signoff_pct },
        { inspections_done: insp.inspections_done, findings_critical_major: insp.findings_critical_major },
      ).composite;
    },
  };
}

function _prevMonth(y, mo) { return mo <= 1 ? { y: y - 1, mo: 12 } : { y, mo: mo - 1 }; }

module.exports = { buildSiteReportDeps, _prevMonth };
```

> **NOTE on `inspectionAggregate`:** `aggregate()` takes `{site, from, to}` but has no period in Foundation's call. Pass the period bounds: `{ site: code, from: '<y>-<mm>-01', to: '<last day>' }` **only if** you confirm `aggregate`'s from/to filter on the right column; otherwise leave all-time and note it. Prefer correctness over guessing — check `inspection-db.js:951` first and do whichever the code actually supports. If you scope it, update `adaptInspectionAggregate`'s test fixture accordingly.

- [ ] **Step 4: Fix `services/siteReport.js`** — it must now read the ADAPTED shapes:
  - `ms.kpis` keys are already contract-shaped after the adapter → the existing `mk.pvs_target` / `mk.resolved` / `mk.new` / `mk.escalations` / `mk.signoff_pct` / `mk.overdue_actions_count` reads become CORRECT. **Verify** no further change is needed there.
  - `ms.site_name` now exists (the adapter supplies it) → keep `ms.site_name || siteCode`.
  - `insp.total` → **change to** `insp.inspections_done` (the adapter's key). `insp.findings_critical_major` + `insp.overall_risk` now exist.
  - `deps.siteStatus` is now **async** → `siteReport.js` currently calls it synchronously in an IIFE (`const siteStatusRaw = (() => { try { return deps.siteStatus(siteCode) ... } })()`). **Change to** `const siteStatusRaw = await _safe(() => deps.siteStatus(siteCode), 'operational', 'siteStatus');`.
  - Re-run `tests/site-report.test.js` — its stubs are contract-shaped so it should still pass; **update the `inspectionAggregate` stub** to return `{inspections_done, findings_critical_major, overall_risk}` (the adapted shape) and the `siteStatus` stub can stay sync (await on a sync value is a no-op).

- [ ] **Step 5: Run both → PASS.** `REPORTS_BACKEND=sqlite node --test --test-force-exit tests/site-report-deps.test.js tests/site-report.test.js`. Paste output.
- [ ] **Step 6: Commit**

```bash
git add services/siteReportDeps.js services/siteReport.js tests/site-report-deps.test.js tests/site-report.test.js
git commit --no-verify -m "fix(reporting): wire siteReportDeps to real readers via adapters (was silently zero)"
```

---

## Task 7: Coordinator template composer

**Files:** Create `services/reportTemplates/coordinator.js`; Test `tests/report-template-coordinator.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/report-template-coordinator.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { composeCoordinator } = require('../services/reportTemplates/coordinator');

const data = {
  site_code: 'HGO', site_name: 'Hounde',
  period: { year: 2026, month: 7, kind: 'weekly', label: 'July 2026' },
  score: { composite: 62, rag: 'amber', trend_pts: -8, dimensions: { reviews: 66, resolution_pct: 60, overdue: 70, inspections: 100, findings: 40, signoff_pct: 50 },
           two_moves: [{ text: 'Hold the 1 missing department PV(s) this month', gain_pts: 7 }, { text: 'Close 4 open issue(s) still standing', gain_pts: 8 }] },
  meetings: { pvs_held: 2, pvs_target: 3, open_issues: 4, high_open: 1, resolved: 6, new: 3, escalations: 1,
              departments: [{ department: 'hse', status: 'blocked' }], overdue_actions: [{ description: 'Fix X', owner: 'Jean', target_date: '2026-07-20' }] },
  inspection: { inspections_done: 1, findings_critical_major: 2, overall_risk: 'major', overdue_actions: [] },
  helpdesk: { created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [{ category: 'Network', count: 12 }], recurring: [{ label: 'Network / WAN', count: 4 }] },
  technicians: [{ name: 'Amina', assigned: 20, resolved: 18, avg_resolution_h: 6, reopened: 1, current_load: 4, alerts: ['overloaded'] }],
  recommended: [{ kind: 'escalate', text: '1 HIGH issue(s) open — escalate to council if unresolved' }],
};

test('returns subject + htmlBody + fullHtml', () => {
  const r = composeCoordinator(data);
  assert.match(r.subject, /Hounde/);
  assert.match(r.subject, /July 2026/);
  assert.ok(r.htmlBody.length > 200);
  assert.ok(r.fullHtml.length >= r.htmlBody.length);
});

test('email body is Outlook-safe: no <script>, no external CSS link, table-based', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.ok(!/<script/i.test(htmlBody), 'no script tags');
  assert.ok(!/<link[^>]+stylesheet/i.test(htmlBody), 'no external stylesheet');
  assert.match(htmlBody, /<table/i);
});

test('surfaces the score, the RAG, and both moves', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /62/);
  assert.match(htmlBody, /amber/i);
  assert.match(htmlBody, /missing department PV/);
  assert.match(htmlBody, /Close 4 open issue/);
});

test('surfaces the recommended actions + the overdue action owner', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /escalate to council/);
  assert.match(htmlBody, /Jean/);
});

test('escapes HTML in free-text (no injection from ticket subjects)', () => {
  const evil = JSON.parse(JSON.stringify(data));
  evil.meetings.overdue_actions[0].description = '<img src=x onerror=alert(1)>';
  const { htmlBody } = composeCoordinator(evil);
  assert.ok(!/<img src=x/i.test(htmlBody), 'raw tag must not survive');
  assert.match(htmlBody, /&lt;img/);
});

test('empty/zero data still composes without throwing', () => {
  const r = composeCoordinator({ site_code: 'X', period: { label: 'Aug 2026' }, score: { composite: 0, rag: 'red', two_moves: [] },
    meetings: { departments: [], overdue_actions: [] }, inspection: { overdue_actions: [] }, helpdesk: { top_categories: [], recurring: [] },
    technicians: [], recommended: [] });
  assert.ok(r.subject && r.htmlBody);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `services/reportTemplates/coordinator.js`.** Requirements:
  - `composeCoordinator(data)` → `{ subject, htmlBody, fullHtml }`.
  - `subject`: `IT Site Report — <site_name> — <period.label>` (append ` (week of …)` when `period.kind==='weekly'` is not needed; keep it simple and stable).
  - `htmlBody`: **inline-styled, table-based, no script, no external CSS** (Outlook-safe). Sections in the §4 reading order: score hero (composite + RAG + trend + the two moves), meetings, inspection, helpdesk, technicians, **Recommended Actions** (make this visually prominent — it is the point of the report).
  - `fullHtml`: a complete `<!doctype html><html>…` document wrapping the same content (this is what gets rendered to PDF). It MAY carry a `<style>` block (PDF rendering is a real browser) but still no external requests.
  - **Escape every free-text field** (`description`, `owner`, `category`, `label`, `name`, `text`) with a local `esc()` — ticket/PV text is untrusted. Do NOT name the helper `esc` if that collides; keep it module-local.
  - Be total: missing arrays/objects must not throw (the test asserts this).

- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**

```bash
git add services/reportTemplates/coordinator.js tests/report-template-coordinator.test.js
git commit --no-verify -m "feat(reporting): coordinator report template composer (email body + PDF html)"
```

---

## Task 8: `POST /api/reports/send` + preview

Mirrors the `POST /api/reports/exec-pptx` discipline (`server.js:5720`): validate early, a single `responded` latch, a hard timeout under the IIS ARR 5-min ceiling, and an explicit error taxonomy.

**Files:** Modify `server.js`; Test `tests/reporting-send.smoke.test.js`

- [ ] **Step 1: Write the failing smoke test** (copy the harness from `tests/reporting-routes.smoke.test.js`; force `REPORTS_BACKEND=sqlite`):

Assertions:
- `POST /api/reports/send?type=coordinator&site=HGO&preview=1` (admin) → 200, body has `subject` + `html`, and **no** `report_sent_log` row was written.
- `POST /api/reports/send?type=coordinator&site=HGO` with an UNCONFIRMED recipient and `never_send_unconfirmed='1'` → 200 with `{skipped:true, reason:/unconfirmed|no recipient/i}` (or 4xx — pick one and assert it), and **no** mail sent.
- `POST /api/reports/send` without auth → 401.
- `POST /api/reports/send?type=bogus&site=HGO` → 400.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement the route in `server.js`** in the existing reporting-suite block. Contract:

```
POST /api/reports/send?type=coordinator&site=<CODE>[&preview=1][&force=1]
  auth: requireReportSession + requireAdmin
  200 preview   → { subject, html }                       (no send, no log row)
  200 sent      → { ok:true, to, cc, pdf:boolean, messageId }
  200 skipped   → { skipped:true, reason }                (safety gate / dedup)
  400           → invalid type / missing site
  504           → render+send exceeded the budget
  500           → compose/send failure (with a short reason)
```

Implementation notes (follow these exactly):
1. Validate `type` ∈ `['coordinator']` (only coordinator ships in this sub-project; `finance` lands in sub-project 4) and `site` non-empty → else 400.
2. `const data = await siteReportData(site, {year, month, kind}, buildSiteReportDeps())` — same period defaulting as the `site-data` route.
3. `const { subject, htmlBody, fullHtml } = composeCoordinator(data)`.
4. **`preview=1` → return `{subject, html: fullHtml}` and RETURN — never send, never log.**
5. Resolve the recipient: `const rows = await reportDirectory.listRecipients(rdb.db); const cfg = await reportConfig.getConfig(rdb.db); const rcpt = reportDirectory.resolveFromRows(rows, site, 'coordinator', { neverSendUnconfirmed: cfg.never_send_unconfirmed === '1' });` → if `null` → `200 {skipped:true, reason:'no confirmed recipient'}` + log a WARN. **Do not send.**
6. **Dedup:** `const period = `${year}-${String(month).padStart(2,'0')}`; if (!req.query.force && await reportSentLog.alreadySentToday('coordinator', site, period))` → `200 {skipped:true, reason:'already sent today'}`.
7. PDF: `const pdf = await renderPdf(fullHtml, { stamp: `${site}-${period}` })` — on `{htmlOnly:true}` continue WITHOUT the attachment (log the reason); never fail the send for a PDF problem.
8. Send: `buildMailer(cfg).send({ to: rcpt.to, cc: rcpt.cc, subject, html: htmlBody, attachments: pdf.ok ? [{ filename: `IT-Report-${site}-${period}.pdf`, content: pdf.pdf }] : [] })`.
9. **Log the outcome** either way: `await reportSentLog.record(rdb.db, { report_type:'coordinator', site_code: site, period, recipients: [rcpt.to, ...(rcpt.cc||[])].join(','), result: sent.ok ? 'ok' : 'fail' })`. (Only `result='ok'` rows count for dedup — see reportSentLog.)
10. Wrap the whole handler with a **timeout latch**: `REPORT_SEND_TIMEOUT_MS` (default `120000` — must stay under the IIS ARR 5-min proxy ceiling, same rationale as exec-pptx's 4-min cap) → on expiry respond `504` once. Use a single `responded` boolean guarding every exit path.
11. Structured logs prefixed `[report-send]`: START (type/site/period), OK (to + duration + pdf bytes), SKIP (reason), FAIL (reason).

- [ ] **Step 4: Run → PASS.** Paste output. `node --check server.js` clean.
- [ ] **Step 5: Commit**

```bash
git add server.js tests/reporting-send.smoke.test.js
git commit --no-verify -m "feat(reporting): POST /api/reports/send (coordinator) + preview, dedup + safety gate"
```

---

## Task 9: `POST /api/reports/recipients/suggest` + enable the admin button

**Files:** Modify `server.js`, `public/reports.html`; Test: extend `tests/reporting-routes.smoke.test.js`

- [ ] **Step 1: Add the route** (admin):

```javascript
app.post('/api/reports/recipients/suggest', requireReportSession, requireAdmin, async (req, res) => {
  try {
    const meetingsDb = require('./meetings-db');
    const sites = (await rdb.listSites()) || [];
    // Resolve each site's MEETINGS code; skip sites with none (Exploration/Tanda).
    const codes = [];
    for (const s of sites) {
      const row = await rdb.getSiteModuleCodeForSite?.(s.id, 'meetings');   // see note
      if (row?.code) codes.push(row.code);
    }
    const out = await reportDirectory.suggestFromMeetings(rdb.db, codes, meetingsDb, req.reportUser?.username);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

> **NOTE:** `getSiteModuleCodeForSite(site_id, module)` does not exist. Either add it as a tiny sibling of `getSiteIdByModuleCode` in reports-db (preferred — one SELECT, + pg fork, + a test), or derive the code list by querying `site_module_codes WHERE module='meetings'` directly through a new reader `listSiteModuleCodes(module)` → `[{site_id, code, name}]`. Pick ONE, implement it properly with a pg fork, and use it here.

Also: `reportDirectory.suggestFromMeetings` currently throws on the pg path (`'suggestFromMeetings: sqlite-only in Foundation'`) because `listRecipients` returns a Promise under pg. **Fix it** to await the rows (make the function async and `await listRecipients(db)`), and keep the never-overwrite-confirmed rule. Update its test.

- [ ] **Step 2: Enable the button in `public/reports.html`** — the "Suggest from meetings" button is currently disabled with a "coming soon" tooltip. Wire it to `POST /api/reports/recipients/suggest`, then reload the recipients table and toast `filled` count.

- [ ] **Step 3: Add a smoke assertion** — `POST /api/reports/recipients/suggest` (admin) → 200 with `{ok:true, filled:<number>}`.

- [ ] **Step 4: Run the smoke + directory tests → PASS.** Paste output.
- [ ] **Step 5: Commit**

```bash
git add server.js public/reports.html services/reportDirectory.js reports-db.js tests/
git commit --no-verify -m "feat(reporting): suggest recipients from meetings PV data + enable the admin button"
```

---

## Task 10: `send-reports.js` — real send loop

**Files:** Modify `tools/reports/send-reports.js`; Test `tests/send-reports-cli.test.js` (unit-test the loop's pure decision function)

- [ ] **Step 1: Extract + test the decision core.** Add to the CLI a pure exported helper:

```javascript
// decideSends(recipients, cfg, kind) → { sendable:[siteCode], skipped:[{site,reason}] }
```
Test: unconfirmed → skipped with reason; inactive (`active=0`) → skipped; confirmed+active → sendable; `never_send_unconfirmed='0'` → an unconfirmed-but-present email becomes sendable.

- [ ] **Step 2: Run → FAIL. Implement. Run → PASS.**

- [ ] **Step 3: Replace the dry-run body** — for each sendable site, call the same compose→render→mail→log pipeline as the route. **Factor the pipeline into a shared module** (`services/sendCoordinator.js` exporting `sendCoordinatorReport({db, cfg, site, period, force})`) and have BOTH the route (Task 8) and the CLI call it — do not duplicate the logic. If Task 8 already inlined it in the route, refactor it out now and re-run Task 8's smoke test.
- [ ] **Step 4: CLI smoke** — `REPORTS_BACKEND=sqlite node tools/reports/send-reports.js --type=coordinator --cadence=weekly` → must exit 0 and print a per-site summary (with no confirmed recipients configured it should print all-skipped, and send nothing).
- [ ] **Step 5: Commit**

```bash
git add tools/reports/send-reports.js services/sendCoordinator.js server.js tests/send-reports-cli.test.js
git commit --no-verify -m "feat(reporting): real coordinator send loop shared by the route + the scheduled CLI"
```

---

## Task 11: Docs + full regression

**Files:** Modify `CLAUDE.md`, `docs/superpowers/specs/2026-07-14-reporting-suite-design.md` (a short "as-built" note)

- [ ] **Step 1: Full regression.**

```bash
REPORTS_BACKEND=sqlite node --test --test-force-exit tests/site-score.test.js tests/report-config.test.js \
  tests/report-directory.test.js tests/report-sent-log.test.js tests/mailer.test.js tests/report-render.test.js \
  tests/site-report.test.js tests/report-schedule.test.js tests/reporting-routes.smoke.test.js \
  tests/site-resolve.test.js tests/site-helpdesk.test.js tests/site-technicians.test.js \
  tests/meetings-contacts.test.js tests/site-report-adapters.test.js tests/site-report-deps.test.js \
  tests/report-template-coordinator.test.js tests/reporting-send.smoke.test.js tests/send-reports-cli.test.js
```
Expect all pass. Then run the pre-existing suites that touch the modified files to prove no collateral damage:
```bash
REPORTS_BACKEND=sqlite node --test --test-force-exit tests/exec-routes.smoke.test.js tests/exec-summary.test.js \
  tests/meetings-summary.test.js tests/inspection-routes.test.js tests/pptx-monthly-golden.test.js
```
(`pptx-monthly-golden` matters: Task 4 changed `getSiteMonthlyMeetingSummary`, which feeds the "Department Meetings" slide on all 5 decks. If the golden fingerprint moves, the kpis change was NOT additive — investigate rather than regenerating the golden.)

- [ ] **Step 2: Docs.** `CLAUDE.md`: update the reporting current-state line to "sub-projects 1-2 landed (engine + real data + coordinator report send); 3-4 (scheduling auto-send + FM report) pending". Add a **pitfall row** capturing the lesson: *"A binder that 'looks wired' can silently read zeros — `siteReport`'s `_safe()` swallows shape mismatches. Foundation's helpdesk/meetings/inspection binders passed all tests (stub-shaped) while returning zeros against the real readers. Rule: any new deps binder needs at least one test against the REAL reader's shape, not just a contract-shaped stub."*
  Add the site-keying rule too: *"Per-site helpdesk readers MUST scope by `tech_group` (from `sites.zoho_group`), never `request_records.site` — that column is free-form ('HOUNDE', 'Hounde Mine', 'Ouaga')."*
- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-07-14-reporting-suite-design.md
git commit --no-verify -m "docs(reporting): sub-project 2 as-built + binder/site-keying pitfalls"
```

---

## Done criteria

- [ ] All new + existing tests green under sqlite; PG-gated tests skip cleanly.
- [ ] `GET /api/reports/site-data?site=HGO` returns **non-zero** helpdesk/meetings/inspection blocks against real data (verify against the prod snapshot or local PG — this is the whole point of the sub-project).
- [ ] `POST /api/reports/send?...&preview=1` returns a rendered coordinator report.
- [ ] A send with no confirmed recipient is SKIPPED and logged — never emailed.
- [ ] `pptx-monthly-golden` unchanged (the meetings kpis change was additive).
- [ ] Nothing auto-sends yet: the Windows tasks exist only if an admin enabled a schedule; the CLI sends only to confirmed recipients.

**Deferred to sub-project 3/4:** scheduled auto-send verification on a real box; the Finance Manager template; the consolidated `?site=all` / group report; `overdue_open` in siteStatus (currently 0 → the 'degraded' branch stays dead, same as fleet-wide today).
