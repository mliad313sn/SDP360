# Sub-project 3C — Helpdesk & Changes everywhere + the Insights link

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three user-requested additions: a Helpdesk & Changes panel on the IT Review, a changes + major-incidents block on the site report, and the IT Review in the Insights nav.

**Architecture:** All three are **our additions on top of the boss's authoritative model — they never touch his score.** The IT Review panel rides in via an **optional `opts.extras`** so that calling `buildReviewVals(D, opts)` *without* it still emits exactly his 61 keys and the fidelity proof stays intact.

**Tech Stack:** Node.js, sqlite + async PG forks, `node --test --test-force-exit`.

**Branch:** `feat/helpdesk-changes` (from `main`)

---

## User-approved scope
The user approved these files. **Nothing else** — their standing rule is that touching any other existing module needs their approval; if a task seems to need one, STOP and report.

| File | Change |
|---|---|
| `reports-db.js` | +2 readers (`getSiteChangesWindow`, `getSiteHelpdeskWindow`) + the ported change classifier — **additive**, no existing query touched |
| **`server.js`** | **APPROVED (~5 lines)** — the route must derive `codes`, build both windows, load extras and pass them |
| `services/reviewData.js` | load the extras |
| `services/reviewDashboard.js` | the panel + the `extras` param |
| `public/it-review.html` | the panel, before Project pipeline |
| `tests/review-fidelity.test.js` | the declared allowlist |
| `services/siteReport.js` + `siteReportDeps.js` | the changes block |
| `services/reportTemplates/coordinator.js` + `public/site-report.js` | render it |
| `public/_shell.js` | the Insights nav entry — **opens in a new tab** |
| **tests** | `tests/site-window-readers.test.js` (new) · `tests/review-dashboard.test.js` · `tests/report-template-coordinator.test.js` — **test files are in scope by default**; the STOP rule above is about touching existing *modules*, not about writing tests for the code you're adding |

## The user's three decisions (locked — do not re-litigate)

1. **Helpdesk follows the period selector; CHANGES use a rolling 90-day window.** Why: the last change in the data is `2026-07-03` and `ANCHOR` is `2026-07-14`, so the default WEEK window contains **0 changes** — following the selector would render the changes half as permanent dashes beside a helpdesk showing ~250 tickets/site/month.

   ⚠️ **CORRECTED NUMBER — the "43" I quoted the user when they took this decision was fleet-wide, and the panel is not.** Measured on the snapshot for `2026-04-15..2026-07-14`:
   - **43** = every `change_records` row, no group filter — includes Ouagadougou (2), Abidjan (1), Exploration (6) and ungrouped rows, none of which are on this panel.
   - **17** = the sum over the five review sites, group-scoped, which is what the panel will actually show: **SML 4 · SMI 3 · HGO 2 · MGO 6 · SGO 2**.

   The decision still stands on the numbers (17 ≫ 0), and the 90-day span is what makes the panel non-empty. But **the panel is thin**: two sites show 2 changes, and `success_pct` on those is computed over ≤2 executed rows — a single backed-out change reads as "50%". **Say so in `hdNote`** (state the window and let the raw counts sit next to the percentage) rather than presenting a 2-row percentage as a rate. The controller has flagged the corrected figure to the user; do not re-litigate the window, but do not repeat "43" either.

   **`hdNote` must state BOTH windows** — two different spans in one panel is confusing unless labelled.
2. **The Insights link opens `it-review.html` in a NEW TAB.** The page deliberately has **no shell mount** — no `_shell.js`, no `auth.js`, no `data-section` (grep: zero hits). It is a faithful carry of the boss's page with his own header. **Do NOT add the shell**: that reverses a documented design decision and changes how his page looks. A new tab means the user keeps the app tab to return to. **So there is no `data-current` to set and no nav highlight to achieve** — drop that from the criteria.
3. `server.js` is approved. (**~5 lines, not 2** — the original estimate predated discovering that the route must also derive `codes` and the changes window; see Task 3.)

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

### ⚠️ THE CHANGE-OUTCOME VOCABULARY — an earlier draft of this plan invented one. Here is the real data.

```
closure_code : NULL(243) · 'Closed - Completed'(42) · 'Closed - Canceled'(7) · 'Closed - Rejected'(2) · 'Closed - Approved'(1)
status       : 'Completed'(214) · 'In Progress'(57) · 'Cancelled'(19) · 'On Hold'(2) · 'Requested'(2) · 'Approval Pending'(1)
udf_json → 'UDF:Change Implementation Outcome':
               NULL(149) · 'Successful'(137) · 'Cancelled'(5) · 'Backed out'(2) · 'Partially successful'(1) · 'Deferred'(1)
udf_json → 'UDF:Review decision':
               NULL(149) · 'Approved for closure'(142) · 'request rework'(2) · 'Approved for closure -Cancelled'(2)
```

**`'Successful'` / `'Failed'` are NOT in `closure_code` or `status`** — `closure_code` is NULL on **82%** of rows. The outcome lives in **`udf_json`**. `'Failed'` exists nowhere; the shipped classifier derives it from `'Closed - Rejected'`.

**`UDF:Review decision`'s success/cancel branch is DEAD CODE on this dataset — measured, not guessed.** The source's own header comment calls review the first signal, and an earlier draft of this plan inflated that into "142 rows lift the denominator from 146 to 187". **Both are wrong.** I ran the shipped classifier twice, once with `:5067-5068` deleted: identical output (`successful=171, executed=187, 91.4%`). Reason: **0 rows carry a Review decision without also carrying an Implementation Outcome** (verified), and Outcome is checked first (`:5060-5066`). Only `'rework'` (2 rows) ever fires from review, via the short-circuit at `:5059`.

Port it anyway — verbatim is correct whether or not a branch is live today, and the day SDP starts filling review without outcome, the port already handles it. But **do not build a story around review being dominant**, and don't expect the `'Approved for closure'` test to prove anything about the real data — it pins the port, not the dataset.

**DO NOT write a second classifier. Port the shipped one, verbatim.** `_changeOutcome` / `_tallyChanges` at **`public/executive-report.html:5053-5090`**. Its own header comment documents the exact bug a naive `status`/`closure_code` reader causes:

> *"That blindly missed the ServiceDesk Plus standard Closure Code field AND the two custom UDFs… The result: deck builder reported a different success number than the live executive.html scorecard."*

**Read the 22 lines of `_changeOutcome` before writing anything.** Three facts about it are counter-intuitive and an earlier draft of this plan got all three wrong:

1. **The bucket is `'success'`, not `'successful'`** (`:5066`). The nine buckets are exactly: `success · success_caveat · partial · failed · backed_out · cancelled · deferred · rework · pending`.
2. **No signal at all → `'pending'`, never `null`** (`:5074`). `_changeOutcome(null)` → `'pending'` too (`:5054`).
3. **`UDF:Review decision` short-circuits on `'rework'` ONLY** (`:5059`). It does *not* short-circuit on a success value — `{review:'…', outcome:'Backed out'}` returns **`'backed_out'`**, because review's success/cancel checks sit at `:5067-5068`, *below* the outcome checks. The priority is per-value, not per-field.

**`executed` — one definition, taken from the shipped code (`:5085-5087`):**
```
successful = success + success_caveat
failed     = failed + backed_out          ← already merged; there is no separate backed_out output
executed   = successful + partial + failed + cancelled     ← i.e. INCLUDES backed_out (inside failed)
success_rate = successful / executed
```
**This is the definition. Use it everywhere in this plan.** CLAUDE.md's doctrine line (`successful + failed + backed_out`, cancelled excluded) is *not* what ships. Measured over the 295 real rows: shipped → `executed=187, rate=91.4%`; the doctrine formula → `executed=175, rate=97.7%`. **A 6.3pp divergence from the deck the team already reads** — which is precisely the failure the header comment above warns about. Follow the shipped code and note in a comment that it deliberately diverges from the doc line.

**Full `change_records` column list**: `id, change_id, display_id, subject, status, stage, risk, change_type, emergency, category, sub_category, requester, requester_id, owner_id, manager, site_id, group_id, scheduled_start, scheduled_end, completed_time, created_time, closure_code, udf_json, fetched_at, group_name, stage_status`. `emergency` is INTEGER.

### ⚠️ THE DATE FORMAT — and a proven off-by-one

`change_records.created_time` and `request_records.created_time` are **TEXT holding ISO-with-T-and-Z**: `'2025-01-09T15:15:14.000Z'` (confirmed in `db/postgres/reports/004_hot.sql:22` — TEXT in pg too, so **no `::date` cast**).

**A raw `created_time BETWEEN from AND to` silently drops the last day** — `'2026-07-03T09:12:00.000Z' > '2026-07-03'` lexically. **Proven on the snapshot**: `BETWEEN '2026-01-01' AND '2026-07-03'` returns **127**; the correct form returns **129**. Two changes lost, no error.

**Use `substr(created_time, 1, 10) BETWEEN ? AND ?`** — correct, and identical on both backends (no cast, no timezone shift). Do NOT use `date(created_time)` (sqlite-only) or `::date` (the column is TEXT).

> **Known trade-off, accepted:** `substr()` wraps the column, so it can't use `idx_cr_created` / `idx_rr_created` (`004_hot.sql:25`, `:73`) → a seq scan. On `request_records` (~25k rows) that's cheap and this route is not hot. `created_time >= ? AND created_time < ?` with an **exclusive** `to`+1 day would be correct *and* sargable — the better form if this ever shows up in a profile. Not worth the extra date arithmetic today; noted so the next reader doesn't think we missed it.

---

## The three non-negotiables

1. **Nothing here enters the score.** The Leaderboard and Scoreboard keep the boss's numbers. Label the panel as a complement (his dashboard has no helpdesk concept at all — its `D` is meetings/inspection only).
2. **The fidelity proof must survive.** `tests/review-fidelity.test.js` asserts our `buildReviewVals` output equals the boss's `renderVals` output. **Its actual mechanism** (`:87-89`, `:99-101` — read it, an earlier draft of this plan described a `missing`/`extra` API that does not exist anywhere in the file): `assert.deepStrictEqual(Object.keys(P).sort(), Object.keys(O).sort())` + `assert.strictEqual(len, 61)` + a full `deepStrictEqual(P, O)`, then the same deep-equal across **72 view × period × site combos**. So adding a key naively breaks it on the key-set compare. **Therefore extras arrive via an OPTIONAL `extras` key on the existing `opts` argument** — absent → exactly 61 keys → the existing assertions are untouched. Present → 61 + ours, checked against a *declared allowlist*.
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
const { _computeSiteChanges, _changeOutcome } = require('../reports-db');

// The shipped classifier reads the RAW ZOHO key names off a row object:
//   r['Change Closure Code'] · r['UDF:Change Implementation Outcome'] · r['UDF:Review decision']
// Our DB row is shaped differently: a `closure_code` COLUMN + a `udf_json` TEXT blob.
// So the port MUST map DB row → those three strings before classifying. Feed the
// pure core the same shape the DB hands it, so the test proves the mapping too.
const row = (o = {}) => ({ status: 'Completed', closure_code: null, emergency: 0,
  udf_json: null, completed_time: null, ...o });
const udf = (o) => JSON.stringify(o);
const outc = (v) => udf({ 'UDF:Change Implementation Outcome': v });

test('_changeOutcome: the nine shipped bucket names', () => {
  // Bucket is 'success' — NOT 'successful'. (executive-report.html:5066)
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Successful') })),           'success');
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Partially successful') })), 'partial');
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Backed out') })),           'backed_out');
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Cancelled') })),            'cancelled');
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Deferred') })),             'deferred');
  // 'Failed' exists NOWHERE in the data — derived from the closure code (:5072).
  assert.strictEqual(_changeOutcome(row({ closure_code: 'Closed - Rejected' })),      'failed');
  assert.strictEqual(_changeOutcome(row({ closure_code: 'Closed - Canceled' })),      'cancelled');
  assert.strictEqual(_changeOutcome(row({ closure_code: 'Closed - Completed' })),     'success');
});

// Pins the ported branch. NOTE: on today's data this branch is dead except
// 'rework' — every row with a Review decision also has an Outcome, which wins.
// The test proves the PORT, not the dataset. Don't "simplify" it away.
test('_changeOutcome: UDF:Review decision branch', () => {
  assert.strictEqual(_changeOutcome(row({ udf_json: udf({ 'UDF:Review decision': 'Approved for closure' }) })),           'success');
  assert.strictEqual(_changeOutcome(row({ udf_json: udf({ 'UDF:Review decision': 'Approved for closure -Cancelled' }) })), 'cancelled');
  assert.strictEqual(_changeOutcome(row({ udf_json: udf({ 'UDF:Review decision': 'request rework' }) })),                 'rework');
});

test('_changeOutcome: priority is per-VALUE, not per-field', () => {
  // Review only short-circuits on 'rework' (:5059). Everything else in review is
  // checked BELOW the outcome checks — so outcome WINS over review's success/cancel.
  assert.strictEqual(_changeOutcome(row({ udf_json: udf({ 'UDF:Review decision': 'request rework', 'UDF:Change Implementation Outcome': 'Successful' }) })), 'rework');
  assert.strictEqual(_changeOutcome(row({ udf_json: udf({ 'UDF:Review decision': 'Approved for closure', 'UDF:Change Implementation Outcome': 'Backed out' }) })), 'backed_out');
  // Outcome beats closure code.
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Backed out'), closure_code: 'Closed - Completed' })), 'backed_out');
});

test('_changeOutcome: no signal → "pending", NOT null (82% have a NULL closure_code)', () => {
  assert.strictEqual(_changeOutcome(row()), 'pending');
  assert.strictEqual(_changeOutcome(row({ udf_json: 'not json' })), 'pending');   // must not throw
  assert.strictEqual(_changeOutcome(null), 'pending');
});

test('_computeSiteChanges: shape mirrors the shipped _tallyChanges + our three extras', () => {
  const rows = [
    row({ udf_json: outc('Successful') }),
    row({ udf_json: outc('Backed out') }),
    row({ udf_json: outc('Successful'), emergency: 1 }),
    row({ status: 'In Progress' }),                       // → pending (all 3 signals null; `status` is never read)
  ];
  const r = _computeSiteChanges(rows);
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.successful, 2);
  assert.strictEqual(r.failed, 1);          // backed_out is MERGED into failed (:5086)
  assert.strictEqual(r.pending, 1);
  assert.strictEqual(r.executed, 3);
  assert.strictEqual(r.emergency, 1);
  assert.strictEqual(r.buckets.backed_out, 1);   // the raw bucket is still there
});

test('_computeSiteChanges: success_pct is over EXECUTED, not total', () => {
  // executed = successful + partial + failed(incl. backed_out) + cancelled  (:5087)
  const rows = [
    row({ udf_json: outc('Successful') }),
    row({ closure_code: 'Closed - Rejected' }),   // failed
    row({ status: 'In Progress' }),               // pending (no signal) → NOT executed
  ];
  assert.strictEqual(_computeSiteChanges(rows).success_pct, 50);   // 1 of 2 executed, NOT 1 of 3
});

test('_computeSiteChanges: cancelled IS executed (shipped formula, not the doc line)', () => {
  const rows = [row({ udf_json: outc('Successful') }), row({ udf_json: outc('Cancelled') })];
  assert.strictEqual(_computeSiteChanges(rows).executed, 2);
  assert.strictEqual(_computeSiteChanges(rows).success_pct, 50);
});

test('_computeSiteChanges: nothing executed → success_pct null, NOT 0', () => {
  const r = _computeSiteChanges([row({ status: 'In Progress' })]);
  assert.strictEqual(r.success_pct, null);   // "nothing to judge" != "0% success"
});

test('_computeSiteChanges: empty → zeros, never throws', () => {
  const r = _computeSiteChanges([]);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.executed, 0);
  assert.strictEqual(r.success_pct, null);
});

test('emergency accepts 1 and "1"', () => {
  assert.strictEqual(_computeSiteChanges([row({ emergency: '1' })]).emergency, 1);
});
```

> **The tests above encode the SHIPPED behaviour** — I ran the real `_changeOutcome` over the real 295 rows to derive them. If one goes red, suspect your port, not the test. Cross-check your buckets against the distributions in the vocabulary section above.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** in `reports-db.js`, next to `getSiteHelpdeskMonthly` (`:1604`), same dispatch convention (`if (REPORTS_BACKEND === 'postgres') return _xPg(...)`):
  - `_changeOutcome(row)` — port `executive-report.html:5053-5074` **line for line, same order**, with ONE adaptation: build the three strings from our row shape. **`if (!row) return 'pending';` stays FIRST** (`:5054`) — the snippet below dereferences `row`, and the test at Step 1 asserts `_changeOutcome(null) === 'pending'`.
    ```javascript
    if (!row) return 'pending';
    let u = {}; try { u = JSON.parse(row.udf_json || '{}') || {}; } catch { u = {}; }
    const code    = String(row.closure_code || '').trim().toLowerCase();
    const outcome = String(u['UDF:Change Implementation Outcome'] || '').trim().toLowerCase();
    const review  = String(u['UDF:Review decision'] || '').trim().toLowerCase();
    ```
    Parse `udf_json` **in JS**, not with `json_extract` — we need two keys and the blob is already selected; a bad blob must degrade to `'pending'`, not throw.
  - `_computeSiteChanges(rows)` — port `_tallyChanges` (`:5082-5090`) and return **its exact shape plus our three extras**:
    ```
    { buckets, successful, failed, cancelled, deferred, pending, executed,   // ← _tallyChanges, verbatim
      total, emergency, success_pct }                                        // ← ours
    ```
    Two of those outputs are **merges**, and the raw counts survive only in `buckets`: `failed = failed + backed_out` (`:5086`) and `pending = pending + rework` (`:5088`). Don't be surprised when `pending` is non-zero on a site with no pending changes — it may be a rework.
    `success_pct = executed ? Math.round(100 * successful / executed) : null`. **`null` when `executed === 0`** — "nothing to judge" is not "0% success".
    **This is THE changes contract. Tasks 2 and 4 use these exact field names — do not invent a `completed`/`failed` pair.**
  - `getSiteChangesWindow(site_id, from, to)` — **takes `site_id`** and resolves the group itself, exactly like `getSiteHelpdeskMonthly:1606-1608` does (`SELECT zoho_group FROM sites WHERE id=?` → comma-split → `IN (…)`). **Copy that reader and change only the window + table + columns:**
    ```sql
    SELECT status, closure_code, emergency, udf_json, completed_time, created_time
    FROM change_records
    WHERE group_name IN (…) AND substr(created_time,1,10) BETWEEN ? AND ?
    ```
    **The pg fork uses the SAME SQL** — `created_time` is TEXT in pg too (`004_hot.sql:22`), so no `::date`, no `to_char`. The only pg difference is `await` + `pgHandle()`, per `_getSiteHelpdeskMonthlyPg:1618`.
  - `getSiteHelpdeskWindow(site_id, from, to)` — same: copy `getSiteHelpdeskMonthly`, **reuse the exported `_computeSiteHelpdesk` pure core** (do NOT duplicate it), and swap `strftime('%Y-%m', created_time) = ?` for `substr(created_time,1,10) BETWEEN ? AND ?`. Note the pg fork currently does `to_char(created_time::timestamptz,'YYYY-MM')` — **`substr` replaces that cast entirely**; don't carry it over.
  - Both return the all-zero block when the site has no `zoho_group` (the existing guard).
  Export `getSiteChangesWindow`, `getSiteHelpdeskWindow`, `_computeSiteChanges`, `_changeOutcome`.
- [ ] **Step 4:** add ONE integration test each against `prod-snapshot/reports.db` proving the group scoping works. **Use these windows — they are verified non-empty:**
  - helpdesk: MGO `Mana IT Agent`, `2026-06-01..2026-06-30` → `sla_overdue: 7`, `major_incidents: 1` (those are the real field names — `_computeSiteHelpdesk`, `reports-db.js:1573`).
  - changes: MGO, **`2026-05-01..2026-05-31` → 4 rows**. Do **NOT** use MGO June — it has **0 changes**, so a June test would pass against an empty set and prove nothing about the scoping.
  - changes, the panel's real window: **MGO `2026-04-15..2026-07-14` → 6 rows**. (The other four sites over that window: SML 4 · SMI 3 · HGO 2 · SGO 2 — **sum 17**.) **Do NOT assert 43** — an earlier draft did: 43 is the count with **no group filter**, including Ouagadougou/Abidjan/Exploration and ungrouped rows. `getSiteChangesWindow` is per-site and group-scoped; **no reader in this plan can ever return 43**, so that assertion cannot pass.

  **Run → PASS.**
- [ ] **Step 5: Commit**
```bash
git add reports-db.js tests/site-window-readers.test.js
git commit --no-verify -m "feat(review): window-scoped per-site helpdesk + changes readers (group-scoped)"
```

---

## Task 2: `reviewData` + `reviewDashboard` — the extras path

**Files:** Modify `services/reviewData.js`, `services/reviewDashboard.js`; extend `tests/review-dashboard.test.js`

- [ ] **Step 1: Write the failing tests.** The critical ones:

**Two prerequisites before these snippets run — do them first:**
1. **Hoist `KEYS` to module scope.** The 61-key list exists (`tests/review-dashboard.test.js:336-353`) but is `const`-declared **inside** the test at `:334-356`, so the new tests below can't see it. Move the literal above the tests and let the existing test reference it — a mechanical move, no assertion changes. (Do not invent a `HIS_61`: an earlier draft did, and it was as out-of-scope as this would be.)
2. **Extend the destructured require at `:22-26`** with `codesOf, extrasWindows` — the file currently imports `addDays, fmt, windows, …, buildReviewVals` only.

With those two done, the snippets below run as written. (`EM` and `buildReviewVals` are already in scope at `:22-29`.)

```javascript
const BASE = { view: 'dashboard', period: 'week', site: 'ALL', asOf: '2026-07-14' };

// Task 1's changes contract VERBATIM — _tallyChanges' output plus total/emergency/
// success_pct. No `completed`/`open` pair; `failed` already includes backed_out.
const CHG = (o = {}) => ({ buckets: {}, successful: 0, failed: 0, cancelled: 0, deferred: 0,
                           pending: 0, executed: 0, total: 0, emergency: 0, success_pct: null, ...o });
const EXTRAS = {
  helpdesk: { HGO: { created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1 } },
  changes:  { HGO: CHG({ successful: 3, failed: 1, executed: 4, total: 4, success_pct: 75 }) },
};

test('buildReviewVals WITHOUT extras emits exactly the 61 keys — the fidelity proof must not move', () => {
  const vals = buildReviewVals(EM, { ...BASE });
  assert.strictEqual(Object.keys(vals).length, 61);
  assert.ok(!('hdRows' in vals));
});

test('buildReviewVals WITH extras adds ONLY the declared keys', () => {
  const vals = buildReviewVals(EM, { ...BASE, extras: EXTRAS });
  const added = Object.keys(vals).filter(k => !KEYS.includes(k));
  assert.deepStrictEqual(added.sort(), ['hdNote', 'hdRows']);   // the declared allowlist
});

test('hdRows: one row per site in codes order, joined by site code', () => {
  const vals = buildReviewVals(EM, { ...BASE, extras: EXTRAS });
  assert.deepStrictEqual(vals.hdRows.map(r => r.code), ['SML', 'SMI', 'HGO', 'MGO', 'SGO']);
});

test('hdRows: a site with no helpdesk data renders dashes, not fabricated zeros', () => {
  const vals = buildReviewVals(EM, { ...BASE, extras: { helpdesk: {}, changes: {} } });
  assert.strictEqual(vals.hdRows[0].created, '—');
  assert.strictEqual(vals.hdRows[0].successPct, '—');
});

test('hdRows: success_pct null renders as a dash, NOT 0%', () => {
  const extras = { helpdesk: {}, changes: { SML: CHG({ pending: 1, total: 1 }) } };
  const vals = buildReviewVals(EM, { ...BASE, extras });
  assert.strictEqual(vals.hdRows.find(r => r.code === 'SML').successPct, '—');
});

test('extras never touch the score', () => {
  const a = buildReviewVals(EM, { ...BASE, view: 'scoreboard' });
  const b = buildReviewVals(EM, { ...BASE, view: 'scoreboard', extras: EXTRAS });
  assert.deepStrictEqual(b.sbRows, a.sbRows);
  assert.deepStrictEqual(b.leaderboard, a.leaderboard);
  assert.strictEqual(b.sbAvg, a.sbAvg);
});

test('extrasWindows: helpdesk follows the period, changes are the fixed 90 days', () => {
  const w = extrasWindows('week');
  assert.deepStrictEqual([w.chgFrom, w.chgTo], ['2026-04-15', '2026-07-14']);   // 90d ending at ANCHOR
  assert.strictEqual(w.hdTo, '2026-07-14');
  // month/quarter/semester share an identical `cur` — only `prev` differs. So the
  // ONLY period that proves hd* moves is 'week'.
  assert.notDeepStrictEqual(extrasWindows('month').hdFrom, w.hdFrom);
  assert.deepStrictEqual(extrasWindows('quarter').chgFrom, w.chgFrom);          // chg never moves
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement.**
  - `buildReviewVals(D, opts)` — `opts.extras` is **optional**. Absent → return exactly as today (61 keys). Present → add `hdRows` + `hdNote`.
  - `hdRows`: one row per `codes` entry (**his order — load-bearing**, see CLAUDE.md), `{ code, name, created, resolved, backlog, slaOverdue, slaColor, majorIncidents, miColor, changes, failed, emergency, successPct, successColor }`. Missing site → all `'—'`.
  - **Colour thresholds (ours, declare them):** `slaOverdue > 0` → amber, `> 5` → red. `majorIncidents > 0` → red. `successPct < 90` → amber, `< 75` → red, `null` → neutral. Use the source's palette — **read the real constants at `reviewDashboard.js:56-59` before typing them**: `GREEN='#2f7d4f'`, `AMBER='#b07a17'`, and **`RED='var(--color-accent)'`** while `REDT='#c2280f'` is the *text* red. Use the same one the leaderboard uses for the same purpose; don't hand-copy a hex.
  - `hdNote`: states **BOTH windows** AND that this panel is **not** part of the score — e.g. *"Helpdesk over {hdWindow} · changes over the last 90 days ({chgFrom} → {chgTo}) · group-scoped · not part of the site score"*. Two windows is a deliberate decision (see the decisions section), so the note must say so plainly — otherwise the mismatch reads as a bug.
  - `services/reviewData.js`: add
    ```javascript
    loadReviewExtras(codes, { hdFrom, hdTo, chgFrom, chgTo }, deps = {}) → { helpdesk: {CODE:{…}}, changes: {CODE:{…}} }
    ```
    **Two windows, so the signature takes both** — a single `(from, to)` pair cannot express decision #1 and an earlier draft's signature was therefore unbuildable. Resolve each code via `getSiteIdByModuleCode('meetings', code)`, then call `getSiteHelpdeskWindow(site_id, hdFrom, hdTo)` and `getSiteChangesWindow(site_id, chgFrom, chgTo)`. **A site that doesn't resolve is simply absent** — the panel renders dashes. Do NOT throw.

    **`reviewData.js` does not currently require `reports-db` at all** — it requires only `../meetings-db` / `../inspection-db`, and lazily (`:90`). All three functions above are reports-db exports, so **add the require**. And note this file's existing `deps` contract is **raw DB handles** (`{meetingsHandle, inspectionHandle}`, `:88-94`, `:106-107`), not injected modules — so `deps` means nothing to `loadReviewExtras`. Either give it a meaning (inject the reader module for testability, which is what would let you unit-test this) or **drop the parameter** rather than shipping one that is silently ignored.

    **Write at least one test for `loadReviewExtras` itself.** Every snippet above tests `buildReviewVals`/`extrasWindows` — nothing exercises the loader, and this repo's own recorded pitfall is *"a binder that looks wired can silently read zeros"*: mis-wire the reader and the panel renders dashes forever, green tests throughout, until someone eyeballs the page. Inject stub readers, assert the codes map through and that an unresolvable code is absent (not a throw, not a zero).
  - **The helpdesk window is `windows(period).cur`** — that is what "follow the selector" means. **The changes window is the fixed 90 days ending at ANCHOR** (`2026-04-15..2026-07-14`); derive it from ANCHOR, don't hardcode the literals. Note in a comment: `windows()` pins to ANCHOR not asOf (his line), so this panel moves with the period selector and not with `?asOf=`, consistent with everything else on the page.
- [ ] **Step 4: Run → PASS.** Also run `tests/review-fidelity.test.js` → **must still be green and unmodified** (that's the point of the extras arg).
- [ ] **Step 5: Commit**
```bash
git add services/reviewData.js services/reviewDashboard.js tests/review-dashboard.test.js
git commit --no-verify -m "feat(review): helpdesk+changes extras — additive, never touches the score"
```

---

## Task 3: the panel + the fidelity allowlist + the nav

**Files:** Modify `public/it-review.html`, `tests/review-fidelity.test.js`, `public/_shell.js`, `server.js`, `services/reviewDashboard.js` (one export).

> **`server.js` IS approved** — the user said "go pour server" (see decision #3). An earlier draft of this plan told the executor to STOP here; that was wrong. Make the change.

**The route needs `codes`, and it cannot currently get it.** `codes` is derived from `D` **inside** `buildReviewVals` (`reviewDashboard.js:269-276` — his five present in D, in his order, then unseen ones appended) and is **not exported**; `HIS_CODES` is exported but is the wrong thing (it's the hardcoded five, ignoring what's in `D`). So:

- **Export TWO helpers from `reviewDashboard.js`** so the route has no logic of its own to drift:
  - **`codesOf(D)`** — lift the derivation out of `buildReviewVals` (`:269-276`) into a function and have `buildReviewVals` call it, so there is exactly ONE definition of the order. Do not duplicate it in the route: the order is load-bearing (DEVIATION 1 in that file).
  - **`extrasWindows(period)`** → `{ hdFrom, hdTo, chgFrom, chgTo }` — **the whole two-window decision in one place.** An earlier draft wrote `...chgWindow()` in the route: no such function existed and no task created one, which left the route unwritable. This is that function; it is Task 2's job to add and test it.
    ```javascript
    function extrasWindows(period) {
      const cur = windows(period).cur;                 // ['2026-07-08','2026-07-14'] for 'week'
      return { hdFrom: cur[0], hdTo: cur[1], chgFrom: addDays(ANCHOR, -90), chgTo: ANCHOR };
    }
    ```
    **Use `addDays` ONLY. Never `fmt`.** `fmt` is a **display** formatter — `fmt('2026-04-15')` returns **`'15 Apr'`** (`reviewDashboard.js:95-99`, verified). Feeding that to `substr(created_time,1,10) BETWEEN ? AND ?` matches nothing and **returns 0 rows with no error** — the exact silent-zero this plan warns about elsewhere. `windows()` already returns ISO strings and `addDays(ANCHOR,-90)` → `'2026-04-15'` (verified); both are ready to hand to SQL as-is.
    `ANCHOR` is **already imported** at `reviewDashboard.js:42` (from `services/siteComposite.js:37`); it is simply not re-exported, which is fine — `extrasWindows` closes over it, so the route never touches it.
    (Pedantry, for the comment: an inclusive `BETWEEN` over `addDays(-90)..ANCHOR` spans **91** days. The bounds are pinned literals, so nothing is ambiguous; just don't write "exactly 90" in the UI note.)
- The route becomes (~5 lines, all imports named):
  ```javascript
  // TWO requires to extend, not one:
  //   services/reviewDashboard  → + codesOf, extrasWindows
  //   services/reviewData (server.js:4115) → + loadReviewExtras
  const D = await loadReviewData(asOf);
  let extras;
  try { extras = await loadReviewExtras(codesOf(D), extrasWindows(period)); }
  catch (e) { console.error('[review] extras failed — rendering without the panel:', e.message); }
  res.json(buildReviewVals(D, { view, period, site, asOf, extras }));
  ```
  The `try` is not optional: a reader failure must degrade to `extras: undefined` (→ the boss's exact 61 keys) rather than 500-ing his whole page. **His dashboard must not go down because our panel's reader threw.**

- [ ] **Step 1: the panel** in `public/it-review.html`, **between Infrastructure Inspection Assurance and Project pipeline** (the user's placement), styled like the Site Health Leaderboard — **copy its markup**. There are **no `sc-raw-*` aliases**; that was an invention in an earlier draft. The template uses ordinary `<table>`/`<tr>`/`<td>`, and the renderer implements exactly **three** primitives: `{{path}}`, `<sc-for list as>`, `<sc-if value>` (`public/it-review.js` — its tag regex is literally `/<(sc-for|sc-if)(?=[\s>])/g`). A `<sc-for list="{{ hdRows }}" as="h">` table + `{{ hdNote }}` under the heading.
  Remember the renderer's contract: `{{ }}` escapes everything; the grammar tolerates the `hint-placeholder-*` attrs; **control flow resolves before interpolation**.

  **Wrap the WHOLE panel — heading included — in `<sc-if value="{{ hdRows }}">`.** Without it, the degrade path (`extras: undefined`) still renders the static heading and an empty `<table>` with its `<th>` row, because `<sc-for>` over a missing list "emits nothing" (`it-review.js:155`) but the renderer has **no** mechanism to remove static markup. A headed empty table on his page reads as a bug — which is the opposite of what the try/catch in Task 3 is for. (An empty `[]` is truthy, so `sc-if` only hides the panel in the `undefined` case: exactly the degrade path, and exactly right.)

  **⚠️ The new markup has NO automated backstop.** `tests/review-render.test.js:121` parses `docs/reference/it-review-dashboard.template.html` — the **reference** copy, which this plan deliberately does not touch. Nothing parses `public/it-review.html`. Given this repo's own history (a renderer that passed 12/12 unit tests while matching **0 of 32** real loops, shipping the page inert), **Step 4's browser check is the only proof this panel's grammar is right — do not skip it**, and if the panel renders empty with data present, suspect the tag form before the data.
- [ ] **Step 2: the fidelity allowlist** in `tests/review-fidelity.test.js`. **Read `:84-101` first.** It has no `missing`/`extra` API (an earlier draft of this plan claimed one; `grep` returns zero hits) — it compares sorted key sets with `deepStrictEqual`, asserts `length === 61`, deep-equals the whole object against the oracle (`:87-89`), then repeats the deep-equal across 72 combos (`:99-101`). Extend it so:
  - **the no-extras call still asserts exactly 61 and deep-equals the oracle** — unchanged, this is the proof;
  - a NEW test asserts that WITH extras the added keys are **exactly** `['hdNote','hdRows']` — a declared allowlist, so a future accidental key addition fails loudly rather than silently polluting his contract.
- [ ] **Step 3: the Insights nav** in `public/_shell.js`. The `performance` parent (label "Insights", id kept stable) has children `inspections` / `tracker` / `meetings` / … Add:
  ```javascript
  { id: 'it-review', label: 'IT Review', icon: ICON_LIB['bar-chart-3'], href: 'it-review.html', roles: ['any'], target: '_blank' },
  ```
  **`target: '_blank'` is part of the entry** — decision #2. The precedent is the `help` entry at `_shell.js:135-143`, which already carries it; `renderNavItem` emits `target` on the child path at `:213`.
  Place it **after `meetings`** (it's the review of what meetings produce) and before the scorecard-viewer-gated entries. `roles: ['any']` matches the page's own gate (`requireReportSession`). **`bar-chart-3` is verified present** (`icons.js:86`, its own comment: "Reports / data sections") and is used by **zero** `_shell.js` entries. Don't reach for the two near-misses: `trending-up` is the Insights PARENT's own icon (`_shell.js:107`) and `line-chart` is already Analytics' (`_shell.js:123`) — an earlier draft claimed `line-chart` was unused, which was wrong. `bar-chart` does not exist at all. Reuse an existing key; never add an asset.

  **The link opens in a NEW TAB** (the user's decision). **`renderNavItem` already emits `target`** (`_shell.js:190`, `:201`, `:213`) — just set it on the entry. It does **not** emit `rel` anywhere; `target="_blank"` implies `noopener` in every current browser, so **don't add `rel` plumbing** for it. If you want the belt-and-braces `rel`, that's a `_shell.js` render change — say so rather than silently adding it.

  **Do NOT add a shell mount to `it-review.html`, and do NOT add a nav-highlight criterion.** That page is a faithful carry of the boss's dashboard and has zero shell hits — adding the header would alter his page, which is out of scope and needs his sign-off, not ours. Opening in a new tab is precisely what makes the missing header a non-issue: the Insights tab stays put, highlighted, behind it.
- [ ] **Step 4: Verify in the browser.** Load `/it-review.html` — the panel renders between Inspection Assurance and Project pipeline with real numbers. From Insights ▾, "IT Review" **opens in a new tab** and the original tab stays on its page. Try `?period=quarter` and confirm **the helpdesk numbers move with the selector**, while the changes numbers do **not** (they are the fixed 90-day window — see the decisions section; `hdNote` must state both windows). **Screenshot.**

> **A trap while verifying the selector:** `windows()` returns an **identical `cur`** for month / quarter / semester — only `prev` differs. So don't test "the numbers moved" by flipping month→quarter; that legitimately changes nothing. Use **`?period=week`** (a genuinely different `cur`) to prove the wiring.
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
changes: { buckets, successful, failed, cancelled, deferred, pending, executed, total, emergency, success_pct }
```
**This is Task 1's contract, unchanged** — `_tallyChanges`' output plus our three. Note `failed` **already includes** `backed_out` (`:5086`), so there is no separate `backed_out` field; the raw counts stay available under `buckets`. `success_pct` may be `null`. Do NOT invent a `completed`/`open` pair.

Tests: the block is present; a failing reader degrades to `EMPTY.changes` (the `_safe` doctrine — see `siteReport.js:14`); `success_pct: null` renders `'—'` not `'0%'`.

**One of these tests must go THROUGH `siteReport.js`, not around it.** The obvious `'—'` test hands the template a block directly and would stay green while the email prints "0%", because the `|| 0` that destroys the null lives in `siteReport.js:53` — a layer the template test never executes. So: **assert that **`siteReportData`**'s output carries `changes.success_pct === null` (that is the real name — the sole export of `services/siteReport.js:115`, already imported by `tests/site-report.test.js:4`; `composeSiteReport` does not exist anywhere in the repo)** when the reader returns null, and again when the reader throws (degrade path). That is the assertion that actually protects the done criterion.

**Plain words, and add the assertion that enforces it.** The coordinator email goes to site coordinators, not to ITSM staff — the block must read "Changes" / "Emergency" / "Backed out", never "RFC" or "CAB". There is **no existing banned-jargon test** (an earlier draft of this plan claimed one, and also claimed a Finance-Manager template — **`services/reportTemplates/` contains only `coordinator.js`**; the FM report is sub-project 5 and is out of scope here). So **add** a small assertion to `tests/report-template-coordinator.test.js`: render the template and assert the output matches neither `/\bRFC\b/` nor `/\bCAB\b/`.
- [ ] **Step 2: Implement.**
  - `siteReportDeps.js`: the binder is **async** — don't write `await` inside a non-async arrow:
    ```javascript
    changes: async (code, p) => {
      const s = await resolve(code);
      if (!s) return null;                       // siteReport._safe → zeroed block
      const { from, to } = _monthBounds(p);      // NOT `...monthBounds(p)` — see below
      return reportsDb.getSiteChangesWindow(s.site_id, from, to);
    },
    ```
    Three things an earlier draft got wrong here — copy the **`helpdesk` binder at `siteReportDeps.js:40-44`** and change only the reader call:
    - **`s.site_id`, not `s.zoho_group`.** `resolve()` returns a site object; the reader takes `site_id` and resolves the group **internally** (`getSiteHelpdeskMonthly:1606`). Passing a group string as an id yields `undefined` → `_computeSiteChanges([])` → **an all-zero block with no error**, which `_safe` then swallows. That is verbatim the CLAUDE.md pitfall *"a binder that looks wired can silently read zeros"*. (Scoping by group is the READER's job — that doesn't mean the binder passes a group.)
    - **The helper is `_monthBounds` (underscore)**, exported at `siteReportDeps.js:129`. There is no `monthBounds`.
    - **It returns `{from, to}` — an object.** `...` -spreading it into an argument list throws `TypeError: object is not iterable`. Destructure.

    **The site report is monthly** (its other blocks are), so use the month bounds, NOT the review's 90-day changes window. Say so in a comment: the two products legitimately differ, and that is a decision, not a bug.
  - `siteReport.js`: add the `changes` block via `_safe`, same as the others — **with ONE deliberate exception, and it is the whole point of this block:**

    **`success_pct` must NOT take `|| 0`.** The house idiom at `:53` is `const helpdesk = { created: hd.created || 0, … }`, and copying it blindly here gives `success_pct: c.success_pct || 0` → **`null || 0` is `0`** → the coordinator email prints **"0%"** for a site with nothing to judge. That is precisely the number this plan forbids (see the done criteria), and it would be destroyed *one layer above* the renderer, where every `'—'` guard we wrote is powerless. Use `?? null`:
    ```javascript
    const changes = { total: c.total || 0, successful: c.successful || 0, failed: c.failed || 0,
                      cancelled: c.cancelled || 0, deferred: c.deferred || 0, pending: c.pending || 0,
                      executed: c.executed || 0, emergency: c.emergency || 0,
                      success_pct: c.success_pct ?? null,          // ← NEVER `|| 0`
                      buckets: c.buckets || {} };
    ```
    **Add a `changes` entry to the `EMPTY` literal (`:8-12`)** and pass it as `_safe`'s explicit fallback (`_safe(fn, fallback, label)` — `:14`; the helpdesk call passes `EMPTY.helpdesk`). Its `success_pct` is **`null`, not 0** — a failed reader has judged nothing:
    ```javascript
    changes: { total: 0, successful: 0, failed: 0, cancelled: 0, deferred: 0, pending: 0,
               executed: 0, emergency: 0, success_pct: null, buckets: {} },
    ```
    (So when this plan says the block "degrades to zeros", read it as: **counts zero, verdict null**.)
  - `coordinator.js` + `public/site-report.js`: render a CHANGES row of tiles next to HELPDESK — `total / successful / failed / emergency / success_pct`. `null` → `'—'`. Plain words only (see the test above).
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

- [ ] The panel renders between Inspection Assurance and Project pipeline, with real numbers. **Helpdesk moves with the selector** (prove with `?period=week`, not quarter — `cur` is identical for month/quarter/semester); **changes stay on the fixed 90-day window**, and `hdNote` states both windows.
- [ ] "IT Review" is in Insights ▾ and **opens in a new tab**; `it-review.html` is unchanged apart from the panel (no shell mount).
- [ ] The site report shows a changes block over the **month**; `success_pct: null` reads `'—'`, never `0%`; the coordinator email says neither "RFC" nor "CAB" (asserted).
- [ ] The change outcome comes from the **shipped classifier's** signals (`UDF:Review decision` → `UDF:Change Implementation Outcome` → `Change Closure Code`) — our numbers agree with the deck builder's.
- [ ] Every window query uses `substr(created_time,1,10) BETWEEN ? AND ?` — no raw `BETWEEN` on the ISO timestamp (it drops the last day).
- [ ] **`buildReviewVals` without extras still emits exactly 61 keys** and all three fidelity tests are green — the boss's model is provably undisturbed.
- [ ] Nothing new enters the score.
- [ ] Only the approved files changed; canaries unchanged.
