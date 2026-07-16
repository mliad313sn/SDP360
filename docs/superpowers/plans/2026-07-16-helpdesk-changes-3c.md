# Sub-project 3C — Helpdesk & Changes everywhere + the Insights link

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three user-requested additions: a Helpdesk & Changes panel on the IT Review, a changes + major-incidents block on the site report, and the IT Review in the Insights nav.

**Architecture:** All three are **our additions on top of the boss's authoritative model — they never touch his score.** The IT Review panel rides in via a separate `extras` argument so that calling `buildReviewVals(D, opts)` *without* it still emits exactly his 61 keys and the fidelity proof stays intact.

**Tech Stack:** Node.js, sqlite + async PG forks, `node --test --test-force-exit`.

**Branch:** `feat/helpdesk-changes` (from `main`)

---

## User-approved scope
The user approved these files. **Nothing else** — their standing rule is that touching any other existing module needs their approval; if a task seems to need one, STOP and report.

| File | Change |
|---|---|
| `reports-db.js` | +2 readers (`getSiteChangesWindow`, `getSiteHelpdeskWindow`) — **additive**, no existing query touched |
| `services/reviewData.js` | load the extras |
| `services/reviewDashboard.js` | the panel + the `extras` param |
| `public/it-review.html` | the panel, before Project pipeline |
| `tests/review-fidelity.test.js` | the declared allowlist |
| `services/siteReport.js` + `siteReportDeps.js` | the changes block |
| `services/reportTemplates/coordinator.js` + `public/site-report.js` | render it |
| `public/_shell.js` | the Insights nav entry |

---

## Verified facts — do not re-investigate

**The site→group→data chain is clean.** Each of the boss's 5 sites maps to exactly ONE Zoho group, and the data is there:

| review code | site | zoho_group | changes | tickets |
|---|---|---|---|---|
| SML | Lafigue | `Lafigue IT Agents` | 32 | 2244 |
| SMI | Ity | `ITY IT Agents` | 17 | 4326 |
| HGO | Hounde | `Hounde IT Agents` | 16 | 2438 |
| MGO | MANA | `Mana IT Agent` | 39 | 4178 |
| SGO | Sabodala | `Sabodala IT Agents` | 21 | 4314 |

Resolved via the existing `reports-db.getSiteIdByModuleCode('meetings', code)` → `{site_id, name, zoho_group}`, then comma-split `zoho_group`.

**`change_records` is group-keyed and populated**: `group_name` on 291/295 rows. **Scope by `group_name`**, exactly as helpdesk scopes by `tech_group`. **NEVER by `request_records.site` / `change_records.site_id`** — the free-form-site pitfall is documented in CLAUDE.md and `site` is unreliable (`'HOUNDE'`, `'Hounde Mine'`, `'Ouaga'`).

**The site report's zeros are REAL, not a bug** — verified before writing this plan. MGO July 2026: 98 tickets, 0 overdue, 0 major incidents. June had 7 overdue + 1 MI; February had 24. Fleet-wide there are 7339 overdue and 25 MI. The existing reader is correct. **Do not "fix" it.**

**`change_records.completed_time` / `closure_code` / `stage` / `emergency` / `risk` / `change_type` exist** (full column list: `id, change_id, display_id, subject, status, stage, risk, change_type, emergency, category, sub_category, requester, requester_id, owner_id, manager, site_id, group_id, scheduled_start, scheduled_end, completed_time, created_time, closure_code, udf_json, fetched_at, group_name, stage_status`).

---

## The three non-negotiables

1. **Nothing here enters the score.** The Leaderboard and Scoreboard keep the boss's numbers. Label the panel as a complement (his dashboard has no helpdesk concept at all — its `D` is meetings/inspection only).
2. **The fidelity proof must survive.** `tests/review-fidelity.test.js` asserts our `buildReviewVals` output equals the boss's `renderVals` output — **all 61 keys, `missing: [] | extra: []`, across 72 combos**. Adding a key naively → `extra: ['hdRows']` → the proof breaks. **So: extras arrive via a separate argument.** No extras → exactly 61 keys → the existing test is untouched. With extras → 61 + ours, checked against a *declared allowlist*.
3. **The panel follows the period selector** (user's explicit direction). The rest of the dashboard moves with WEEK/MONTH/QUARTER/SEMESTER; a panel frozen on the current month would read as a bug. This means a **window-scoped** reader, not the existing month-scoped `getSiteHelpdeskMonthly`.

---

## Task 1: `reports-db.js` — the two window-scoped readers

**Files:** Modify `reports-db.js`; Create `tests/site-window-readers.test.js`

`getSiteHelpdeskMonthly` (built in sub-project 2) takes `(site_id, year, month)`. The review panel needs `[from, to]`. Add window-scoped siblings; **leave the monthly ones alone** — the site report uses them and they're fidelity-adjacent.

- [ ] **Step 1: Write the failing test.** Test the PURE cores first (they take pre-filtered rows), then ONE integration test each against `prod-snapshot/`.

```javascript
// tests/site-window-readers.test.js
'use strict';
process.env.REPORTS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const { _computeSiteChanges } = require('../reports-db');

test('_computeSiteChanges: totals, completed, failed, emergency', () => {
  const rows = [
    { status: 'Closed', closure_code: 'Successful',      emergency: 0, completed_time: '2026-07-02 10:00:00' },
    { status: 'Closed', closure_code: 'Failed',          emergency: 0, completed_time: '2026-07-03 10:00:00' },
    { status: 'Closed', closure_code: 'Successful',      emergency: 1, completed_time: '2026-07-04 10:00:00' },
    { status: 'Open',   closure_code: null,              emergency: 0, completed_time: null },
  ];
  const r = _computeSiteChanges(rows);
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.completed, 3);
  assert.strictEqual(r.failed, 1);
  assert.strictEqual(r.emergency, 1);
  assert.strictEqual(r.open, 1);
});

test('_computeSiteChanges: success_pct is over EXECUTED, not total', () => {
  // ITSM denominator doctrine (CLAUDE.md): success / executed, never /total.
  const rows = [
    { status: 'Closed', closure_code: 'Successful', emergency: 0, completed_time: 'x' },
    { status: 'Closed', closure_code: 'Failed',     emergency: 0, completed_time: 'x' },
    { status: 'Open',   closure_code: null,         emergency: 0, completed_time: null },  // not executed
  ];
  assert.strictEqual(_computeSiteChanges(rows).success_pct, 50);   // 1 of 2 executed, NOT 1 of 3
});

test('_computeSiteChanges: no executed changes → success_pct null, not 0', () => {
  const r = _computeSiteChanges([{ status: 'Open', closure_code: null, emergency: 0, completed_time: null }]);
  assert.strictEqual(r.success_pct, null);   // "nothing to judge" != "0% success"
});

test('_computeSiteChanges: empty → zeros, never throws', () => {
  assert.deepStrictEqual(_computeSiteChanges([]),
    { total: 0, completed: 0, failed: 0, emergency: 0, open: 0, success_pct: null });
});

test('emergency accepts 1 and "1" (INTEGER in our DB, string in some feeds)', () => {
  assert.strictEqual(_computeSiteChanges([{ status: 'Closed', closure_code: 'Successful', emergency: '1', completed_time: 'x' }]).emergency, 1);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** in `reports-db.js`, next to `getSiteHelpdeskMonthly`, same dispatch convention (`if (REPORTS_BACKEND === 'postgres') return _xPg(...)`):
  - `_computeSiteChanges(rows)` — the pure core above. **`success_pct = round(100 * successful / executed)`** where `executed = successful + failed + backed_out` (cancelled/rejected EXCLUDED) — the ITSM denominator doctrine in CLAUDE.md. `null` when `executed === 0`.
  - `getSiteChangesWindow(site_id, from, to)` — group-scoped:
    ```sql
    SELECT status, closure_code, emergency, completed_time, created_time
    FROM change_records
    WHERE group_name IN (…) AND date(created_time) BETWEEN ? AND ?
    ```
    pg fork: `created_time::date BETWEEN ?::date AND ?::date`.
  - `getSiteHelpdeskWindow(site_id, from, to)` — **reuse the existing `_computeSiteHelpdesk` pure core** (do NOT duplicate it); only the SQL window changes (`date(created_time) BETWEEN ? AND ?` / `created_time::date BETWEEN …`).
  - Both return the all-zero block when the site has no `zoho_group`.
  - **Check `change_records.created_time`'s pg column type before writing the fork.** If TIMESTAMPTZ, `::date` is correct; if TEXT, use the `to_char`/lexical form the other readers use. Precedent for getting this wrong: `md_issues.updated_at` (CLAUDE.md pitfall).
  Export `getSiteChangesWindow`, `getSiteHelpdeskWindow`, `_computeSiteChanges`.
- [ ] **Step 4:** add ONE integration test each against `prod-snapshot/reports.db` proving the group scoping works (e.g. MGO `Mana IT Agent` over `2026-06-01..2026-06-30` → `overdue 7`, `MI 1` per the verified table above). **Run → PASS.**
- [ ] **Step 5: Commit**
```bash
git add reports-db.js tests/site-window-readers.test.js
git commit --no-verify -m "feat(review): window-scoped per-site helpdesk + changes readers (group-scoped)"
```

---

## Task 2: `reviewData` + `reviewDashboard` — the extras path

**Files:** Modify `services/reviewData.js`, `services/reviewDashboard.js`; extend `tests/review-dashboard.test.js`

- [ ] **Step 1: Write the failing tests.** The critical ones:

```javascript
test('buildReviewVals WITHOUT extras emits exactly the 61 keys — the fidelity proof must not move', () => {
  const vals = buildReviewVals(EM, { view: 'dashboard', period: 'week', site: 'ALL', asOf: '2026-07-14' });
  assert.strictEqual(Object.keys(vals).length, 61);
  assert.ok(!('hdRows' in vals));
});

test('buildReviewVals WITH extras adds ONLY the declared keys', () => {
  const extras = { helpdesk: { HGO: { created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1 } },
                   changes:  { HGO: { total: 4, completed: 3, failed: 1, emergency: 0, open: 1, success_pct: 75 } } };
  const vals = buildReviewVals(EM, { view: 'dashboard', period: 'week', site: 'ALL', asOf: '2026-07-14', extras });
  const added = Object.keys(vals).filter(k => !HIS_61.includes(k));
  assert.deepStrictEqual(added.sort(), ['hdNote', 'hdRows']);   // the declared allowlist
});

test('hdRows: one row per site in codes order, joined by site code', () => {
  const vals = buildReviewVals(EM, { …, extras });
  assert.deepStrictEqual(vals.hdRows.map(r => r.code), ['SML', 'SMI', 'HGO', 'MGO', 'SGO']);
});

test('hdRows: a site with no helpdesk data renders dashes, not fabricated zeros', () => {
  const vals = buildReviewVals(EM, { …, extras: { helpdesk: {}, changes: {} } });
  assert.strictEqual(vals.hdRows[0].created, '—');
  assert.strictEqual(vals.hdRows[0].successPct, '—');
});

test('hdRows: success_pct null renders as a dash, NOT 0%', () => {
  const extras = { helpdesk: {}, changes: { SML: { total: 1, completed: 0, failed: 0, emergency: 0, open: 1, success_pct: null } } };
  const vals = buildReviewVals(EM, { …, extras });
  assert.strictEqual(vals.hdRows.find(r => r.code === 'SML').successPct, '—');
});

test('extras never touch the score', () => {
  const a = buildReviewVals(EM, { view: 'scoreboard', period: 'week', site: 'ALL', asOf: '2026-07-14' });
  const b = buildReviewVals(EM, { view: 'scoreboard', period: 'week', site: 'ALL', asOf: '2026-07-14', extras });
  assert.deepStrictEqual(b.sbRows, a.sbRows);
  assert.deepStrictEqual(b.leaderboard, a.leaderboard);
  assert.strictEqual(b.sbAvg, a.sbAvg);
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement.**
  - `buildReviewVals(D, opts)` — `opts.extras` is **optional**. Absent → return exactly as today (61 keys). Present → add `hdRows` + `hdNote`.
  - `hdRows`: one row per `codes` entry (**his order — load-bearing**, see CLAUDE.md), `{ code, name, created, resolved, backlog, slaOverdue, slaColor, majorIncidents, miColor, changes, failed, emergency, successPct, successColor }`. Missing site → all `'—'`.
  - **Colour thresholds (ours, declare them):** `slaOverdue > 0` → amber, `> 5` → red. `majorIncidents > 0` → red. `successPct < 90` → amber, `< 75` → red, `null` → neutral. Use the source's palette (GREEN `#2f7d4f` · AMBER `#b07a17` · RED `#c2280f`) so it sits with his design.
  - `hdNote`: states the window AND that this panel is **not** part of the score — e.g. *"Helpdesk & changes over {window} · group-scoped · not part of the site score"*.
  - `services/reviewData.js`: add `loadReviewExtras(codes, from, to, deps)` → `{helpdesk: {CODE: {...}}, changes: {CODE: {...}}}`, resolving each code via `getSiteIdByModuleCode('meetings', code)` then calling the Task-1 readers. **A site that doesn't resolve is simply absent** — the panel renders dashes. Do NOT throw.
  - **The window comes from `windows(period).cur`** — that is what "follow the selector" means. Note in a comment: `windows()` pins to ANCHOR not asOf (his line), so this panel moves with the period selector and not with `?asOf=`, consistent with everything else on the page.
- [ ] **Step 4: Run → PASS.** Also run `tests/review-fidelity.test.js` → **must still be green and unmodified** (that's the point of the extras arg).
- [ ] **Step 5: Commit**
```bash
git add services/reviewData.js services/reviewDashboard.js tests/review-dashboard.test.js
git commit --no-verify -m "feat(review): helpdesk+changes extras — additive, never touches the score"
```

---

## Task 3: the panel + the fidelity allowlist + the nav

**Files:** Modify `public/it-review.html`, `tests/review-fidelity.test.js`, `public/_shell.js`, `server.js`? **NO — the route already exists**; it must pass `extras` through.

> ⚠️ `server.js` is NOT on this task's approved list. The `GET /api/reports/review-data` route must now load extras. **If that requires editing the route, STOP and report** — the controller will get the user's approval. (Check first: it may be achievable inside `reviewData.js` if the route already calls a single loader.)

- [ ] **Step 1: the panel** in `public/it-review.html`, **between Infrastructure Inspection Assurance and Project pipeline** (the user's placement), styled like the Site Health Leaderboard (his `sc-raw-table`/`sc-raw-tr`/`sc-raw-td` aliases — see how the leaderboard does it; the renderer maps them). A `<sc-for list="{{ hdRows }}" as="h">` table + `{{ hdNote }}` under the heading.
  Remember the renderer's contract: `{{ }}` escapes everything; the grammar tolerates the `hint-placeholder-*` attrs; **control flow resolves before interpolation**.
- [ ] **Step 2: the fidelity allowlist** in `tests/review-fidelity.test.js`. Today it asserts `missing: [] | extra: []` against his 61. Extend it so:
  - **the no-extras call still asserts exactly 61, `extra: []`** — unchanged, this is the proof;
  - a NEW test asserts that WITH extras the added keys are **exactly** `['hdNote','hdRows']` — a declared allowlist, so a future accidental key addition fails loudly rather than silently polluting his contract.
- [ ] **Step 3: the Insights nav** in `public/_shell.js`. The `performance` parent (label "Insights", id kept stable) has children `inspections` / `tracker` / `meetings` / … Add:
  ```javascript
  { id: 'it-review', label: 'IT Review', icon: ICON_LIB['trending-up'], href: 'it-review.html', roles: ['any'] },
  ```
  Place it **after `meetings`** (it's the review of what meetings produce) and before the scorecard-viewer-gated entries. `roles: ['any']` matches the page's own gate (`requireReportSession`). Check `ICON_LIB` has the icon you pick — reuse an existing one, don't add an asset.
  **Then set the page's own nav highlight**: `it-review.html`'s shell mount needs `data-section="performance" data-current="it-review"` so the nav highlights correctly (the pattern every other page uses).
- [ ] **Step 4: Verify in the browser.** Load `/it-review.html` — the panel renders between Inspection Assurance and Project pipeline with real numbers; the Insights ▾ menu shows "IT Review" and highlights it. Try `?period=quarter` and confirm **the panel's numbers move with the selector** (that's the whole point of Task 1's window readers). **Screenshot.**
- [ ] **Step 5: Commit**
```bash
git add public/it-review.html public/_shell.js tests/review-fidelity.test.js
git commit --no-verify -m "feat(review): Helpdesk & Changes panel + IT Review in the Insights nav"
```

---

## Task 4: changes + major incidents on the site report

The site report **already has** `helpdesk.major_incidents` (rendered as "MAJOR INCIDENTS" — the 0 is real, verified). This task adds a **changes** block and gives major incidents more than a bare count.

**Files:** Modify `services/siteReport.js`, `services/siteReportDeps.js`, `services/reportTemplates/coordinator.js`, `public/site-report.js`; extend their tests.

- [ ] **Step 1: Write the failing tests** — the contract gains:
```
changes: { total, completed, failed, emergency, open, success_pct }   // success_pct may be null
```
Tests: the block is present; a failing reader degrades to the zeroed block (the `_safe` doctrine — see `siteReport.js`); `success_pct: null` renders `'—'` not `'0%'`; the FM view's banned-jargon grep still passes (the FM template must not say "RFC"/"CAB" — use plain words).
- [ ] **Step 2: Implement.**
  - `siteReportDeps.js`: `changes: (code, p) => { const s = await resolve(code); if (!s) return null; return reportsDb.getSiteChangesWindow(s.site_id, ...monthBounds(p)); }` — **the site report is monthly** (its other blocks are), so use the month bounds, NOT the review's period window. Say so in a comment; the two products legitimately differ.
  - `siteReport.js`: add the `changes` block via `_safe`, same as the others.
  - `coordinator.js` + `public/site-report.js`: render a CHANGES row of tiles next to HELPDESK — `total / completed / failed / emergency / success_pct`. `null` → `'—'`.
- [ ] **Step 3: Run → PASS** (site-report, deps, coordinator template tests).
- [ ] **Step 4: Commit**
```bash
git add services/siteReport.js services/siteReportDeps.js services/reportTemplates/coordinator.js public/site-report.js tests/
git commit --no-verify -m "feat(report): changes block on the site report + coordinator email"
```

---

## Task 5: regression + docs

- [ ] **Step 1: Full regression** — the whole reporting/score/review suite. **`tests/review-fidelity.test.js` and `tests/composite-fidelity.test.js` and `tests/score-fidelity.test.js` must be GREEN AND UNMODIFIED** (except review-fidelity's added allowlist test) — they are the proof that our additions didn't disturb the boss's model. Canaries (`pptx-monthly-golden`, `meetings-summary`, `inspection-routes`, `exec-summary`) unchanged; **golden NOT regenerated**.
- [ ] **Step 2: `CLAUDE.md`** — current state + a pitfall:
  *"The IT Review's Helpdesk & Changes panel is OUR addition, not the authoritative dashboard's — its `D` has no helpdesk concept at all. It rides in via `buildReviewVals`'s optional `extras` arg precisely so that calling without extras still emits exactly the boss's 61 keys and `tests/review-fidelity.test.js` keeps proving the port. Never fold extras into `D` or into the score."*
  Plus: *"Per-site helpdesk AND changes both scope by group (`request_records.tech_group` / `change_records.group_name`) from `sites.zoho_group` — never by `request_records.site` or `change_records.site_id`."*
- [ ] **Step 3: Commit + finish the branch.**

---

## Done criteria

- [ ] The panel renders between Inspection Assurance and Project pipeline, with real numbers that **move with the period selector**. Screenshot.
- [ ] "IT Review" is in Insights ▾ and highlights on the page.
- [ ] The site report shows a changes block; `success_pct: null` reads `'—'`, never `0%`.
- [ ] **`buildReviewVals` without extras still emits exactly 61 keys** and all three fidelity tests are green — the boss's model is provably undisturbed.
- [ ] Nothing new enters the score.
- [ ] Only the approved files changed; canaries unchanged.
