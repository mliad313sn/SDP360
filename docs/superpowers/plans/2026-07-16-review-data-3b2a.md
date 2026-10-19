# Sub-project 3B-2a — `loadReviewData()` + the `renderVals()` port

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reader that produces the boss's `D` shape from OUR databases, and port his `renderVals()` (15 panels, 61 keys) on top of it — both proved against his own dataset.

**Architecture:** 3A/3B-1 ported the two scoring models. This slice adds (1) `loadReviewData(asOf)` — the fleet-wide reader that denormalises our schema into his `D`, and (2) `reviewDashboard.js` — the port of `renderVals()`, which turns `D` into the flat object his template binds. No page yet (3B-2b), no server changes.

**Tech Stack:** Node.js, `node --test --test-force-exit`. sqlite + async PG fork for the reader; the port is pure.

**Branch:** `feat/review-data` (from `main`)

> **Test runner:** the dev `.env` pins all backends to postgres. Set `REPORTS_BACKEND/MEETINGS_BACKEND/INSPECTION_BACKEND='sqlite'` BEFORE any require. Always `--test-force-exit`.

---

## THE DECISIVE FACT — `em-data.json` is a LATER EXPORT of our own production database

Verified against `prod-snapshot/`, then re-verified by a reviewer over **1668 field comparisons**:

```
meetings     40 /  40   identical on (id, reference, site_code, meeting_date)
issues      132 / 132   status mix identical: submitted 18 · signed 16 · closed 5 · draft 1
actions      78 /  78
projects     18 /  18
inspections  12 /  12   (all 'submitted')
findings    678 / 678
inspActions  18 /  19   ← ONE ROW OF DRIFT. See below.
```

**The drift, precisely:** fixture `inspActions id=84` has `created_at 2026-07-12 22:22:03`; our snapshot's max `insp_actions` id is **83**, latest `created_at 2026-07-07 20:46:09`. So the fixture is **the same database, exported ~5 days later** — not a copy of this snapshot. Everything else matches (1668 comparisons, exactly this 1 mismatch).

**Do NOT write a bare count-equality test for `inspActions`** — it fails against a CORRECT reader, and this plan's own "never fix the expectation" rule would then send you hunting a phantom bug. Assert `inspActions` over the **18 shared ids** and document the delta.

**Blast radius of the drift: nil for the fidelity test.** Row 84 is `status:'Closed'`, and the only consumer of `D.inspActions` (source `:353`) filters `status !== 'Closed'`. Task 4's oracle is unaffected.

Three consequences that shape this plan:

1. **`loadReviewData()` is PROVABLE, not merely testable.** Its acceptance test is *field-for-field equality with `tests/fixtures/em-data.json`* over shared ids when read from `prod-snapshot/`. That is the strongest possible oracle for the 5 denormalisation joins — a wrong join names the exact field of the exact row.
2. **The draft question is settled by fact, not opinion.** The export contains **1 draft PV**, and the model applies **no status filter** — so it counts it. **We do not filter either.** Filtering would silently diverge from the screen the team reads.
3. **`renderVals`'s fidelity test is a direct substitution** on the same data.

---

## Source of truth

**`docs/reference/it-review-dashboard.source.js`** — committed, unescaped, `node --check`-clean, 499 lines. **Port FROM it; do not retype from this plan.** Read `docs/reference/README.md` first (the rules: never wire it in; if our port disagrees, OUR code is wrong).

`renderVals()` spans ~:206-499. Its two returns differ: a 23-key loading stub (:206) and the **61-key full return** (:471-488).

### Already ported — REUSE, never duplicate
| From | Exports |
|---|---|
| `services/siteComposite.js` | `dUTC, days, median, isOpenNow, effClose, openAt, eMetrics, composite, twoMoves, rag, ragPct, ANCHOR` |
| `services/siteScore.js` | `computeSiteScore, rag2, moveText, hasData, PT_THRESHOLDS` |
| `meetings-db.js` | `_effClose, _openAt` (same functions; `siteComposite` re-exports them) |

### ⚠️ `sbDims` IS ONLY HALF-PORTED — the measurement half does not exist anywhere
`computeSiteScore(inputs, window, prev)` is **pure arithmetic over already-measured inputs**. The source's `sbDims(site, D, asOf)` (`:165-191`) *measures from `D` first* — lines `:168-179` derive `reviews/resolution/overdue/inspections/findings/signoff`. **That half is unported**, so Task 3 cannot build `sbRows`/`emBubbles`/`gapRows`/`sbMoves` from `computeSiteScore` alone.

**Port it into `services/reviewDashboard.js`** (a NEW file — no approval needed) as:
```
sbMeasure(site, D, asOf) → { reviews, resolution, overdue, inspections, findings, signoff }
```
verbatim from source `:166-179`, then feed it to `computeSiteScore(inputs, …)`. Keep the raw `inputs` object around — `emBubbles` needs `reviews`/`resolution`/`overdue` from it (bridge gap 1).

> **DO NOT reach for `meetings-db.getSiteScoreInputs` / `inspection-db.getSiteScoreInputs`.** They look like the measurement half but are a **trap on three counts**: (a) they are **existing modules** — off-limits without the user's approval; (b) they **query the DB**, which breaks `buildReviewVals(D)`'s pure contract and makes the fixture-based fidelity test impossible; (c) they use `services/scoreWindow.js`'s **rolling 3-month window**, not `sbDims`'s hardcoded `W0='2026-04-01'` — the numbers would silently diverge from the oracle.

### To port in this slice — 9 methods + statics
`sbMeasure` (:166-179, see above), `windows` (:27), `filterSite` (:35), `metrics` (:38), `delta` (:58), `spark` (:66), `fmt` (:20), `addDays` (:19), `pack` (:491); statics `SITES` (:12), `GREEN/AMBER/RED/REDT` (:15); tables `catNames` (:357), `dimColors` (:422).

### TWO BRIDGE GAPS — the ported modules are not drop-in
1. **`computeSiteScore` does not return `reviews`/`resolution`/`overdue`.** The source's `sbDims` returns them, and `renderVals` reads `sb.resolution`/`sb.reviews`/`sb.overdue` at :442-448 for the effort-matrix bubbles. **Do NOT change `computeSiteScore`'s return** (it is fidelity-pinned and on nobody's approved list) — read them from the `inputs` object you passed in.
2. **`siteScore.rag2` returns a STRING** (`'GREEN'`); `renderVals` needs `rg.fg` / `rg.solidBg` / `rg.solidFg` (:432, :438, :446, :450, :464, :468, :473). Add a local colour lookup in `reviewDashboard.js` keyed off the string — do NOT modify `siteScore.js`.
   Source colours (:494-498, verbatim): GREEN `fg:#2f7d4f solidBg:#2f7d4f` · AMBER `fg:#b07a17 solidBg:#d99a2b` · RED `fg:#c2280f solidBg:var(--color-accent)`; all `solidFg:'#fff'`.

### DECIDED: `codes` derives from `D`, and the two averages become means over what exists

The source hardcodes 5 site codes (`:213`) and divides `sbAvg` by a **literal 5** (`:427`). Both must change — the user's direction is *"tout ce que le HTML couvre + nos ajouts; sites hors des 5 → non applicable là où il n'y a pas de données"*, and our fleet is 11-12 sites, not 5.

- **`sbAvg` = mean over the APPLICABLE sites only**, `null` if none. NOT `/5`, and NOT `/codes.length`. Same for `sbAvgPrev` → `sbAvgDelta`/`sbAvgColor`. (A mean is order-independent, so this cannot disturb the oracle: reviewer-verified `43` either way.)

- **`codes` = HIS 5 IN HIS ORDER, then any unseen site appended, sorted.** ⚠️ **Do NOT just sort — his order is LOAD-BEARING, not incidental.** A reviewer ran the source both ways on the fixture: sorting flips **five panels**.
  ```
  --- source codes order (THE ORACLE) ---     --- naive sorted codes ---
  sbRows      : HGO 58|SML 50|MGO 50|…        HGO 58|MGO 50|SML 50|…   *** DIFFERS
  eMatrix     : SML|SMI|HGO|MGO|SGO           HGO|MGO|SGO|SMI|SML      *** DIFFERS
  inspSiteRows: SML|SMI|HGO|MGO|SGO           HGO|MGO|SGO|SMI|SML      *** DIFFERS
  gapRows     : HGO|SML|MGO|SMI|SGO           HGO|MGO|SML|SMI|SGO      *** DIFFERS
  sbMoves     : HGO|SML|MGO|SMI|SGO           HGO|MGO|SML|SMI|SGO      *** DIFFERS
  ```
  Two mechanisms: `eMatrix` (`:297`) and `inspSiteRows` (`:344`) **iterate `codes` directly** — their row order *is* `codes` order. `sbRows`/`gapRows`/`sbMoves` inherit it through `sbSorted`'s **stable sort** (`:426`) — SML and MGO both score 50, so the tie resolves to whichever comes first in `codes`. (`leaderboard` escapes only by luck: 62/58/48/44/41 are all distinct.)

  ```js
  // His order is load-bearing: it IS eMatrix/inspSiteRows row order, AND the
  // sbSorted tie-break (SML/MGO both score 50). Keep his 5 in his order; append
  // sites he never saw, sorted for determinism.
  const HIS = ['SML', 'SMI', 'HGO', 'MGO', 'SGO'];              // source :213, verbatim
  // "present" = the union of the two PARENT tables. issues/actions/projects hang
  // off meetings; findings/inspActions hang off inspections. Using meetings alone
  // would drop a site that has an inspection but no PV; using all seven is the
  // same union with extra work (projects carries only 3 codes, actions only 4).
  const present = new Set([...D.meetings.map(m => m.site_code),
                           ...D.inspections.map(i => i.site_code)].filter(Boolean));
  const codes = [...HIS.filter(c => present.has(c)),
                 ...[...present].filter(c => !HIS.includes(c)).sort()];
  ```

**Why this preserves fidelity:** on the fixture the extras set is **empty** (reviewer-verified: no site beyond his 5 in any of the seven arrays), so `codes` is **byte-identical to source `:213`** and all five panel orders match the oracle. On our 11-12 site fleet the unseen sites append without reordering his.

**Pin it:** assert `codes` equals `['SML','SMI','HGO','MGO','SGO']` on the fixture, and that an injected 6th site **appends** rather than reorders.

### `applicable:false` — the state the source has no concept of, and the 0 it would fabricate
`computeSiteScore` (3B-1) can return `{applicable:false, score:null, dims:[], moves:[]}`. The source never anticipated it:

- `sbRows` / `emBubbles` / `gapRows` / `sbMoves` do `sb.dims.map(...)` → **broken/empty row**. → **Omit that site's row.**
- **`sbAvg` (`:427`) is the dangerous one:** `codes.reduce((s,c) => s + sbs[c].score, 0) / 5` — `score:null` coerces (`s + null === s + 0`), so a site we know nothing about enters the fleet average as a **fabricated 0**. That is precisely the verdict-on-nothing the `applicable` gate exists to prevent, sneaking back in through an average. Demonstrated by a reviewer: one non-applicable site → `sbAvg` 40 instead of 50, and **omitting the row cannot fix it because the `/5` is hardcoded**. → hence the mean-over-applicable rule above.
- **`emMaxX`/`emMaxY` (`:442-443`)** are `Math.max(...codes.map(c => sbs[c].resolution), 50)` → `NaN` if any site lacks `resolution`, which poisons **every** bubble's `x/y/r`. Under bridge gap 1 this fires for every site unless you feed the raw `inputs`. Compute them over applicable sites only; test that no bubble coordinate is `NaN`.

Pin all of it: a `D` with one data-less site must yield a `sbAvg` that ignores it, no `NaN` anywhere, and no row for it.

---

## File Structure

| File | Responsibility |
|---|---|
| `services/reviewData.js` | **NEW.** `loadReviewData(asOf, deps)` → `D`. The 5 joins, the `to_char` cast, fleet-wide. sqlite + PG fork. |
| `services/reviewDashboard.js` | **NEW.** `buildReviewVals(D, {view, period, site, asOf})` → the 61-key flat object. Pure. |
| `tests/review-data.test.js` | **NEW.** Unit + the equality proof vs `em-data.json`. |
| `tests/review-dashboard.test.js` | **NEW.** Panel unit tests + quirks. |
| `tests/review-fidelity.test.js` | **NEW.** `buildReviewVals` on the fixture. **Acceptance.** |

**Nothing else.** No `server.js`, no page, no existing module. The user's standing rule: touching any existing module needs their approval — if a task seems to need one, STOP and report.

---

## Task 1: `services/reviewData.js` — the reader

**Files:** Create `services/reviewData.js`; Create `tests/review-data.test.js`

### The contract
```
loadReviewData(asOf, deps?) → { meetings, issues, actions, inspections, findings, inspActions, projects }
```
Fleet-wide (NOT per-site — `composite`'s `fleetMttr` needs every site's issues). `deps` injects the two db modules for testing.

### The 5 denormalisation joins (verified — our schema has NO denormalised columns)
| array | our table | must JOIN to get |
|---|---|---|
| `issues` | `md_issues` | `m.site_code`, `m.meeting_date`, `m.department` via `meeting_id → md_meetings` |
| `actions` | `md_actions` | `m.site_code`, `m.meeting_date` |
| `projects` | `md_meeting_projects` | `m.site_code` (only `phase`, `target_end`, `site_code` are read) |
| `findings` | `insp_findings` | `i.site_code`, `i.inspection_date` via `inspection_id → insp_inspections` |
| `inspActions` | `insp_actions` | `i.site_code` (only `site_code` + `status` are read) |

Each array is its own query — they cannot fan each other out.

### ⚠️ THE LOAD-BEARING CAST — wider blast radius than the score path
`md_issues.updated_at` is **TIMESTAMPTZ in PG** while every other date column is TEXT. `services/pgDb.js` registers parsers only for NUMERIC/BIGINT, so node-pg returns a JS `Date`; `effClose` then yields `'Wed Jun 11'` and **every ISO string compare loses** (`'W' > '2'`).

`effClose` reads `updated_at` for every `resolved`/`cancelled` issue — **52 of 132 (39%)** in the fixture. Without the cast these all break: `metrics.closedCur/Prev`, the MTTR tile, `openAt` → the 3 sparks + `backlogPts` + `openPrev`, `flowMonths`, `composite.mttr/fleetMttr/mttrIdx`, `sbDims.resolution`. Prod only. No error.

**PG fork MUST use** (precedent: `meetings-db.js:2642`):
```sql
to_char(i.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
```
Do **NOT** cast `closed_at` / `target_date` / `meeting_date` / `*_signed_at` — already TEXT. Also do not start reading `insp_inspections.submitted_at` (TIMESTAMPTZ, currently unread) without the same treatment.

### Fields to select (only what the source reads — verified)
- `meetings`: `site_code, department, meeting_date, submitted_at, dept_head_signed_at, site_it_signed_at, next_meeting_date, priority_1` (+ `id`, `reference`, `status` for the equality proof)
- `issues`: `status, closed_at, updated_at, target_date, severity, escalate, champion, champion_email, title` + joined `site_code, meeting_date, department` (+ `id`)
- `actions`: `status, closed_at, target_date` + joined `site_code, meeting_date` (+ `id`)
- `inspections`: `site_code, inspection_date` (+ `id`, `status`)
- `findings`: `status, category` + joined `site_code, inspection_date`
- `inspActions`: `status` + joined `site_code` (+ `id`)
- `projects`: `phase, target_end` + joined `site_code` (+ `id`)

### NO status filter
Do not filter drafts. The boss's export contains a draft and his model counts it (see THE DECISIVE FACT). A filter here would be a silent deviation.

- [ ] **Step 1: Write the failing test.**

```javascript
// tests/review-data.test.js
'use strict';
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { loadReviewData } = require('../services/reviewData');

const SNAP = path.join(__dirname, '..', 'prod-snapshot');
const hasSnap = fs.existsSync(path.join(SNAP, 'meetings.db'));

test('returns the 7 EM_DATA arrays', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const D = await loadReviewData('2026-07-14', _snapDeps());
  assert.deepStrictEqual(Object.keys(D).sort(),
    ['actions', 'findings', 'inspActions', 'inspections', 'issues', 'meetings', 'projects']);
});

// THE PROOF — the fixture is a LATER export of this same DB. Six arrays match
// exactly; inspActions drifted by one row (fixture id=84, created 2026-07-12;
// snapshot stops at id=83, 2026-07-07). Assert the six, and the drift explicitly
// — a bare 7-way count test fails against a CORRECT reader.
test('reproduces the fixture row counts (six arrays)', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const EM = require('./fixtures/em-data.json');
  const D = await loadReviewData('2026-07-14', _snapDeps());
  for (const k of ['meetings', 'issues', 'actions', 'inspections', 'findings', 'projects']) {
    assert.strictEqual(D[k].length, EM[k].length, `${k}: ours ${D[k].length} vs fixture ${EM[k].length}`);
  }
});

test('inspActions: the fixture is one row ahead of the snapshot — known, documented drift', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const EM = require('./fixtures/em-data.json');
  const D = await loadReviewData('2026-07-14', _snapDeps());
  const ourIds = new Set(D.inspActions.map(a => String(a.id)));
  const extra = EM.inspActions.filter(a => !ourIds.has(String(a.id))).map(a => a.id);
  assert.deepStrictEqual(extra, ['84'], 'only id=84 (created 2026-07-12) should be fixture-only');
  assert.strictEqual(D.inspActions.length, EM.inspActions.length - 1);
  // and it cannot affect the fidelity oracle: its status is Closed, and the sole
  // consumer (source :353) filters status !== 'Closed'.
  assert.strictEqual(EM.inspActions.find(a => String(a.id) === '84').status, 'Closed');
});

// THE REAL PROOF — the 5 denormalisation joins put the right value on the right row.
test('denormalised site_code/meeting_date match the fixture row-for-row', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const EM = require('./fixtures/em-data.json');
  const D = await loadReviewData('2026-07-14', _snapDeps());
  const byId = (arr) => Object.fromEntries(arr.map(r => [String(r.id), r]));
  for (const [k, fields] of [
    ['issues',   ['site_code', 'meeting_date', 'department', 'status', 'severity', 'target_date', 'closed_at', 'champion', 'title']],
    ['actions',  ['site_code', 'meeting_date', 'status', 'target_date', 'closed_at']],
    ['projects', ['site_code', 'phase', 'target_end']],
    ['inspActions', ['site_code', 'status']],
  ]) {
    const ours = byId(D[k]);
    for (const t of EM[k]) {
      const o = ours[String(t.id)];
      assert.ok(o, `${k} id=${t.id} missing from our reader`);
      for (const f of fields) {
        assert.strictEqual(String(o[f] ?? ''), String(t[f] ?? ''), `${k} id=${t.id} field ${f}`);
      }
    }
  }
});

// findings have no id in EM_DATA — compare the (site_code, inspection_date) multiset instead.
test('findings carry their parent inspection site/date', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const EM = require('./fixtures/em-data.json');
  const D = await loadReviewData('2026-07-14', _snapDeps());
  const key = (f) => `${f.site_code}|${f.inspection_date}|${f.status}|${f.category}`;
  const tally = (arr) => arr.reduce((m, f) => (m[key(f)] = (m[key(f)] || 0) + 1, m), {});
  assert.deepStrictEqual(tally(D.findings), tally(EM.findings));
});

test('does NOT filter drafts — the boss export contains one and his model counts it', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const D = await loadReviewData('2026-07-14', _snapDeps());
  assert.strictEqual(D.meetings.filter(m => m.status === 'draft').length, 1);
});

function _snapDeps() {
  // point the two db modules at prod-snapshot/ read-only
  const Database = require('better-sqlite3');
  const mdb = new Database(path.join(SNAP, 'meetings.db'), { readonly: true });
  const idb = new Database(path.join(SNAP, 'inspection.db'), { readonly: true });
  return { meetingsHandle: mdb, inspectionHandle: idb };
}
```

> **Implementer note:** design `loadReviewData(asOf, deps)` so `deps` can supply raw sqlite handles (as above) OR default to the real `meetings-db`/`inspection-db` modules. That is what makes the equality proof possible without touching those modules. If the shape above doesn't fit cleanly, adapt the harness — but the PROOF (equality with the fixture) is non-negotiable.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** sqlite bodies + async PG forks (`lower(site_code)=lower(?)` where scoping is needed; the `to_char` cast on `md_issues.updated_at`).
- [ ] **Step 4: Run → PASS.** Paste output. **If the join test fails, fix the JOIN — never the expectation.**
- [ ] **Step 5: Commit**
```bash
git add services/reviewData.js tests/review-data.test.js
git commit --no-verify -m "feat(review): loadReviewData — denormalise our schema into the dashboard's D shape"
```

---

## Task 2: `services/reviewDashboard.js` — the 8 helpers

**Files:** Create `services/reviewDashboard.js`; Create `tests/review-dashboard.test.js`

- [ ] **Step 1: Write failing tests** for `windows`, `filterSite`, `metrics`, `delta`, `spark`, `fmt`, `addDays`, `pack`, ported verbatim from the source. Cover at minimum:
  - `delta`: null → `'—'`; 0 → `'· 0'`; positive → `'▲ +N'`; negative → `'▼ -N'`; `invert` flips good/bad; `Math.round(x*10)/10`.
  - `spark`: the exact point-string geometry (`4 + i*(56/max(n-1,1))` , `19 - v/max*16`), and `max(...series, 1)` so an all-zero series doesn't divide by zero.
  - `windows('week')` → `{cur:[addDays(A,-6),A], prev:[addDays(A,-13),addDays(A,-7)], short:'WoW'}`.
  - **QUIRK: `windows('month'|'quarter'|'semester')` are HARDCODED to July 2026**, not derived from `asOf` — port as-is and pin it. (`services/scoreWindow.js` is a DIFFERENT thing — the rolling score window. Do not conflate.)
  - `fmt('2026-07-14')` → `'14 Jul'`; `fmt(null)` → `'—'`.
  - `metrics`: `raisedCur/Prev`, `openNow/openPrev`, `overdueNow/Prev`, `highNow/Prev`, `escNow`, `mttrCur/Prev`, `covCur/Prev`, `openList`. Note `closedCur/closedPrev` are computed but **never read** by `renderVals` — port them anyway (verbatim) and note it.
  - `metrics.escNow` must accept BOTH `'1'` and `1` — our DB has INTEGER `escalate`, the fixture has `'0'`/`'1'` strings. The source's `i.escalate === '1' || i.escalate === 1` is what makes both work. **Do not "simplify" it.**
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** (port from source). **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**
```bash
git add services/reviewDashboard.js tests/review-dashboard.test.js
git commit --no-verify -m "feat(review): port windows/metrics/delta/spark/fmt helpers"
```

---

## Task 3: `buildReviewVals(D, opts)` — the 15 panels

**Files:** Modify `services/reviewDashboard.js`; extend `tests/review-dashboard.test.js`

```
buildReviewVals(D, { view='dashboard', period='week', site='ALL', asOf=ANCHOR }) → the flat object
```

Port `renderVals()` (:206-499). Differences from the source, all forced and all to be commented:
- **No React state** — `view`/`period`/`site` come in as args.
- **`pick` closures are dropped.** `viewOpts`/`periodOpts`/`siteOpts`/`leaderboard[].pick` bind live `setState` closures (4 `sc-camel-on-click` sites). Emit the option objects **without** `pick`; 3B-2b turns them into links/query params. Note it in the code.
- **`applicable:false` handling** (see the header) — omit that site's row from `sbRows`/`emBubbles`/`gapRows`/`sbMoves` rather than rendering a broken one. Test it.
- **`SITES` has 5 codes; our fleet has 11-12.** The source does `Component.SITES[site].name` (:225) and would **throw** on a 6th code. Port `SITES` verbatim BUT make the lookup total: unknown code → `{name: code, country: ''}`. This is a **deviation** — declare it in a comment; it prevents a crash on Kalana/Ouaga/Abidjan/Dakar/Tanda/Exploration, which his dashboard never saw.

Quirks to port AS-IS and pin (all verified):
- **`pipeline` hardcodes 4 phases** (`scoping/design/build/deploy`) but our seed has 5 (`closeout`) and the fixture has a `null`. Closeout/null projects fall out of the bars but stay in `projs.length`, so `pipelineNote` says "N of M" where the bars sum to < M.
- **`inspSiteRows` conformity counts `opp` in the denominator but not the numerator** — source `:348-350`: `appl = fs.filter(f => f.status !== 'na')` vs `ok = fs.filter(f => f.status === 'ok')`, so the 12 `opp` findings in the data depress `conf%`. **Note: this is `inspSiteRows`, NOT `findCats`** — `findCats` (`:363`) computes no conformity at all, so a test written against it would pin nothing.
- **`inspSiteRows.actOpen` uses `a.status !== 'Closed'`** — our vocabulary also has `'Cancelled'` (see `public/inspection-actions.html` STATUSES/TERMINAL), which his data lacks, so a cancelled inspection action would count as open. **LATENT, not active:** the snapshot has zero Cancelled (Open 7 / Closed 7 / In Progress 4) — don't hunt for a real row. Port as-is; pin with a **synthetic** row.
- `metrics.closedCur/Prev` computed and unused.

- [ ] **Step 1: Write failing tests** — at least one per panel asserting shape + a representative value, plus a test per quirk above, plus the `applicable:false` omission, plus the unknown-site-code non-throw.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**
```bash
git add services/reviewDashboard.js tests/review-dashboard.test.js
git commit --no-verify -m "feat(review): port renderVals — the 15 panels"
```

---

## Task 4: Fidelity — `buildReviewVals` on the boss's data

**THE ACCEPTANCE TEST.** Follow `tests/composite-fidelity.test.js` / `tests/score-fidelity.test.js`.

**Files:** Create `tests/review-fidelity.test.js`

- [ ] **Step 1: Write it.** Load `tests/fixtures/em-data.json`, call `buildReviewVals(EM, { view:'dashboard', period:'week', site:'ALL', asOf:'2026-07-14' })` and assert against the boss's own output.

**Produce the oracle by RUNNING HIS CODE, not by trusting ours.** A reviewer already did this and it **works**: stub the `DCLogic` base (`state = {view:'dashboard', period:'week', site:'ALL', dataReady:true}`, `props={}`), set `window.EM_DATA` to the fixture, call `renderVals()` → **runs clean outside a browser, 61 keys**, no `document` access. **Commit the harness itself** (~10 lines), not just the dumped JSON — that is what makes the fixture-refresh pitfall recoverable.

⚠️ **Strip the 18 function-valued paths before dumping** (the `pick` closures on `viewOpts`/`periodOpts`/`siteOpts`/`leaderboard[].pick`). `JSON.stringify` **silently drops** them rather than throwing, so an unstripped dump "verifies" 61 keys by coincidence. Strip explicitly and assert the count.

**Reviewer-confirmed scalars** (from an actual run): `sbAvg=43 · dqScore=0 · backlogNow=80 · overdueCount=26`.

Assert at minimum, per panel:
- `leaderboard` — **rank-sorted desc, NOT `codes` order**: `SML 62 · SMI 58 · HGO 48 · SGO 44 · MGO 41` (SGO precedes MGO). RAG: AMBER · AMBER · RED · RED · RED. Plus each row's `del/gov/eng/penalty/open/overdue/high`.
- `sbRows` — **also rank-sorted**: `HGO 58 · SML 50 · MGO 50 · SMI 42 · SGO 17` (SML/MGO tie at 50, broken by stable sort on `codes` order). Plus each row's 6 `cells[].val`.
  **A row-indexed assertion written from the per-site tables in 3A/3B-1 will FAIL** — those tables are in `codes` order; these panels sort.
- `kpis` — all 8 tiles' `label/value`.
- `eMatrix` — the 5×5 `val` grid (eMetrics oracle known from 3B-1).
- `groupRows`, `flowMonths`, `aging`, `champLoad`, `overdueRows`, `inspSiteRows`, `findCats`, `pipeline`, `dqItems`, `dqScore`, `sbMoves`, `gapRows`, `emBubbles`, `sigFunnel`, `briefKpis`, `briefSites` — shape + the scalar values his code produces.
- The scalars: `nIssues/nMeetings/nInspections/nFindings/defectCount/overdueCount/backlogNow/backlogPeak/dqScore/sbAvg`.

**If ours disagrees, OUR code is wrong. Report BLOCKED. Never edit the oracle to match us.**

- [ ] **Step 2: Run → PASS.** Paste output.
- [ ] **Step 3: Mutation-check** — perturb one oracle value, confirm exactly that assertion fails, restore. Report what you did.
- [ ] **Step 4: Commit**
```bash
git add tests/review-fidelity.test.js
git commit --no-verify -m "test(review): pin the renderVals port to the authoritative dashboard's own output"
```

---

## Task 5: Regression + docs

- [ ] **Step 1: Full regression** — the 3B-1 list plus the 3 new files. Canaries (`pptx-monthly-golden`, `meetings-summary`, `inspection-routes`, `exec-summary`) unchanged; **golden NOT regenerated**.
- [ ] **Step 2: `CLAUDE.md`** — current state (3B-2a landed: the reader + the renderVals port, both fidelity-pinned) + pitfalls:
  - *"`em-data.json` IS our own prod snapshot, exported — that is why the review-suite fidelity tests can assert EQUALITY rather than approximation. If the snapshot is ever refreshed, the fixture and the oracles must be re-derived together or the proofs rot silently."*
  - *"`loadReviewData` must NOT filter drafts: the authoritative dashboard's export contains a draft PV and its model applies no status filter. Filtering would silently diverge from the screen the team reads."*
  - *"`windows('month'|'quarter'|'semester')` in the source are hardcoded to July 2026 and are NOT `services/scoreWindow.js` (the rolling 3-month score window). Two different window concepts — do not merge them."*
- [ ] **Step 3: Commit + finish the branch.**

---

## Done criteria

- [ ] `loadReviewData()` reproduces `em-data.json` from `prod-snapshot/` — counts AND the denormalised fields row-for-row. **This proves the 5 joins.**
- [ ] `buildReviewVals()` reproduces the boss's `renderVals()` output on his data, oracle derived by running HIS code.
- [ ] Both fidelity harnesses are mutation-checked.
- [ ] The documented quirks are pinned by tests, not fixed.
- [ ] `applicable:false` sites are omitted, not rendered broken.
- [ ] An unknown site code does not throw.
- [ ] No existing module touched. No server change.

**Deferred to 3B-2b:** the `{{ }}` renderer (3 primitives: `{{path}}`, `<sc-for list as>`, `<sc-if value>`; 219 bindings, 32 loops, 2-level nesting max, no engine needed); `public/it-review.html`; the `pick`-closures → links/query-params conversion; `server.js` route + `_htmlCache` + `GET /api/reports/review-data` (**needs the user's approval — it modifies an existing module**).
