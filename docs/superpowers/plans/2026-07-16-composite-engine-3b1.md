# Sub-project 3B-1 — The `composite()` Engine + the "non applicable" Rule

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the SECOND authoritative scoring model (`composite()` + `eMetrics()` + `twoMoves()`) from the boss's dashboard, prove it against his own dataset, and stop fabricating a RED verdict for sites that have no data.

**Architecture:** 3A ported `sbDims` (the scoreboard model). The boss's file has a **second, equally authoritative model** — `composite()` — feeding the Site Health Leaderboard and Weekly Brief. Both ship. This sub-project ports `composite` as a pure module proved against the same oracle fixture, and fixes the empty-site verdict across the existing score consumers.

**Tech Stack:** Node.js, pure functions (no DB in this slice), `node --test --test-force-exit`.

**Branch:** `feat/composite-engine` (from `main`)

---

## The source of truth

**`docs/reference/it-review-dashboard.source.js`** — the boss's app logic, extracted verbatim, committed, and it parses clean (`node --check`). 499 lines, `class Component extends DCLogic`, 24 methods.

**Port FROM that file. Do not retype from this plan — open it and diff.** Line refs:

| What | Line |
|---|---|
| `d(s)` / `days(a,b)` / `median(arr)` | 17 / 18 / 21 |
| `effClose(i)` / `isOpenNow(i)` / `openAt(i,t)` | (already ported — see below) |
| `eMetrics(site, D, asOf)` | 74 |
| `composite(site, D, asOf)` | 102 |
| `rag(score)` (75/55 — NOT `rag2`) | 126 |
| `ragPct(v, g, a)` | 131 |
| `twoMoves(site, D, comp)` | 138 |
| `static ANCHOR / OPEN / SITES / GREEN / AMBER / RED / REDT` | top of class |

**Already ported in 3A — REUSE, do not duplicate:** `meetings-db.js` exports `_effClose`, `_openAt`, `MD_OPEN` (`require('../meetings-db')`). They are the same functions this model needs. Duplicating them would let the two models silently drift apart — the exact class of bug this whole effort exists to kill.

### Non-negotiables (same doctrine as 3A)
- **This is a PORT, not a design.** Do not retune thresholds, weights, rounding or clamps. If our number disagrees with the source, OUR code is wrong.
- **`days()` uses real UTC `Date` arithmetic** — it is a day COUNT, not a comparison. That is correct and must be kept. (Contrast: `effClose`/`openAt` compare ISO **strings** — also correct. Both idioms coexist in the source on purpose.)
- **Copy the source's quirks literally**, including the ones flagged below. Report them; don't fix them.

### Known quirks in the source — port AS-IS, document in tests
1. **`e.cov` has a hardcoded `/12` and NO upper clamp** (`Math.round(100 * depts.size / 12)`). A site with >12 distinct departments pushes `cov` > 100 → `eng` > 100 → `composite` > 100 (the score is floored at 0 by `Math.max(0,...)` but has **no ceiling**). Unreachable on the boss's 5 sites (max `cov` = 75), but our fleet is 11-12 sites and the meetings data already contains an unseeded `SP` department code. **Port as-is; add a test that documents the >100 possibility so it is a known, visible property rather than a surprise.**
2. **`pen` is uncapped**: `+3` per open+escalated+>60d issue (linear, no cap) and `+5` once if any open HIGH is >90d.
3. **`mttrIdx` defaults to `60`** when nothing has been resolved (`mttr == null`) — a site that has resolved nothing scores 60/100 on that term, not 0.
4. **`fleetMttr` is computed across ALL sites**, not the one being scored (`allRes = D.issues.filter(...)` with no site filter) — so `composite(site, D)` is **not** a per-site-isolated function: it needs the whole fleet's issues. This drives the input contract below.
5. **`odRate` = 0 when the backlog is empty** ⇒ `100 - odRate` contributes a full 100. An empty log scores well on delivery.

---

## The input contract

Because of quirk 4, port the model to take **the whole `D`**, exactly like the source:

```
D = { meetings, issues, actions, inspections, findings, projects }
```
— the EM_DATA shape (which `tests/fixtures/em-data.json` already is, committed in 3A). `issues`/`actions` carry denormalised `site_code` + `meeting_date`; `findings` carry `site_code` + `inspection_date`. Every value is a string or null.

Taking `D` verbatim means the fidelity test is a **direct substitution** of our functions for his, on his data — the strongest possible proof. The live reader that builds `D` from our DBs lands in **3B-2**, together with the page; 3B-1 is the engine + its proof.

---

## File Structure

| File | Responsibility |
|---|---|
| `services/siteComposite.js` | **NEW.** `composite`, `eMetrics`, `rag`, `ragPct`, `twoMoves`, `median`, `days`, `dUTC`. Pure. Takes `D`. |
| `tests/composite-model.test.js` | **NEW.** Unit tests incl. the documented quirks. |
| `tests/composite-fidelity.test.js` | **NEW.** Pins the port to the boss's dataset. **The acceptance test.** |
| `services/siteScore.js` | **MODIFY.** `hasData` → `applicable:false` instead of a fabricated 4-pt RED. |
| `services/siteReport.js` | **MODIFY.** Propagate. |
| `services/reportTemplates/coordinator.js` | **MODIFY.** Render "non applicable". |
| `public/site-report.js` | **MODIFY.** Same. |
| `CLAUDE.md` | **MODIFY.** Current state + pitfalls. |

> Every modified file is on the user-approved list. **No other existing module may be touched** — if a task seems to need one, STOP and report; the user's standing rule is that changes to existing modules need their approval.

---

## Task 1: `services/siteComposite.js` — `eMetrics` + helpers (pure, TDD)

**Files:** Create `services/siteComposite.js`; Create `tests/composite-model.test.js`

- [ ] **Step 1: Write the failing test.** Cover, from `docs/reference/it-review-dashboard.source.js:74`:

```javascript
// tests/composite-model.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { eMetrics, median, days } = require('../services/siteComposite');

const A = '2026-07-14';
// Minimal D — only the fields eMetrics reads.
const mk = (over = {}) => ({
  site_code: 'HGO', department: 'mining', meeting_date: '2026-05-02',
  submitted_at: '2026-05-02 10:00:00',
  dept_head_signed_at: '2026-05-03 09:00:00', site_it_signed_at: '2026-05-03 09:01:00',
  next_meeting_date: '2026-06-02', priority_1: 'do the thing', ...over,
});

test('median: odd, even, empty', () => {
  assert.strictEqual(median([3, 1, 2]), 2);
  assert.strictEqual(median([4, 1, 2, 3]), 2.5);
  assert.strictEqual(median([]), null);
});

test('days: whole-day UTC difference', () => {
  assert.strictEqual(days('2026-07-14', '2026-07-04'), 10);
  assert.strictEqual(days('2026-07-14', '2026-07-14'), 0);
});

test('eMetrics: no meetings → all zeros', () => {
  assert.deepStrictEqual(eMetrics('HGO', { meetings: [], issues: [] }, A),
    { e1: 0, e2: 0, e3: 0, e5: 0, cov: 0, nextRate: 0 });
});

test('e2: both signatures within 48h counts; beyond 48h does not', () => {
  const D = { meetings: [
    mk({ dept_head_signed_at: '2026-05-03 09:00:00', site_it_signed_at: '2026-05-03 09:00:00' }),          // ~23h → ok
    mk({ dept_head_signed_at: '2026-05-05 11:00:00', site_it_signed_at: '2026-05-05 11:00:00' }),          // ~73h → no
  ], issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).e2, 50);
});

test('e2: a half-signed PV never counts', () => {
  const D = { meetings: [mk({ site_it_signed_at: null })], issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).e2, 0);
});

test('e3: share of issues with a non-blank champion', () => {
  const D = { meetings: [mk()], issues: [
    { site_code: 'HGO', meeting_date: '2026-05-02', champion: 'Amina' },
    { site_code: 'HGO', meeting_date: '2026-05-02', champion: '   ' },   // blank → not counted
  ] };
  assert.strictEqual(eMetrics('HGO', D, A).e3, 50);
});

test('e5 needs BOTH next_meeting_date and a non-blank priority_1', () => {
  const D = { meetings: [
    mk(), mk({ priority_1: '  ' }), mk({ next_meeting_date: null }),
  ], issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).e5, 33);   // 1 of 3
});

test('nextRate counts next_meeting_date alone (no priority_1 requirement)', () => {
  const D = { meetings: [mk({ priority_1: '' }), mk({ next_meeting_date: null })], issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).nextRate, 50);
});

// QUIRK 1 — documented, not fixed. cov has a hardcoded /12 and no upper clamp.
test('QUIRK: cov = round(100 * depts/12) and is NOT clamped — >12 depts exceeds 100', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(dep => mk({ department: dep }));
  assert.strictEqual(eMetrics('HGO', { meetings: six, issues: [] }, A).cov, 50);   // 6/12
  const fifteen = Array.from({ length: 15 }, (_, i) => mk({ department: 'd' + i }));
  const cov = eMetrics('HGO', { meetings: fifteen, issues: [] }, A).cov;
  assert.strictEqual(cov, 125);   // NOT clamped. This is the source's behaviour — port, don't fix.
});

test('e1: cadence = dept-months held / (depts x months since first meeting)', () => {
  // one dept, meeting every month Apr→Jul, asOf in Jul → 4/4 = 100
  const D = { meetings: ['2026-04-02', '2026-05-02', '2026-06-02', '2026-07-02'].map(dt => mk({ meeting_date: dt })), issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).e1, 100);
});

test('eMetrics ignores other sites', () => {
  const D = { meetings: [mk(), mk({ site_code: 'MGO', department: 'other' })], issues: [] };
  assert.strictEqual(eMetrics('HGO', D, A).cov, 8);   // 1 dept / 12
});
```

- [ ] **Step 2: Run → FAIL.** `node --test --test-force-exit tests/composite-model.test.js`

- [ ] **Step 3: Implement.** Port `d`/`days`/`median`/`eMetrics`/`rag`/`ragPct` from `docs/reference/it-review-dashboard.source.js` (lines 17-21, 74, 126, 131). Rename `d` → `dUTC` (a one-letter export is a footgun) but keep its body identical. `this.` becomes plain calls. Header comment must say: *this is a PORT of the boss's authoritative model; see docs/reference/README.md; do not retune.*

- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**
```bash
git add services/siteComposite.js tests/composite-model.test.js
git commit --no-verify -m "feat(score): port eMetrics + helpers from the authoritative dashboard"
```

---

## Task 2: `composite()` + `twoMoves()`

**Files:** Modify `services/siteComposite.js`; extend `tests/composite-model.test.js`

- [ ] **Step 1: Write the failing tests** for the composite quirks (the fidelity test in Task 3 covers the happy path against real data — these pin the EDGES):

```javascript
test('composite: empty issue log scores 100 on the odRate term', () => {
  const D = { meetings: [mk()], issues: [], inspections: [], findings: [] };
  const c = composite('HGO', D, A);
  assert.strictEqual(c.open, 0);
  assert.strictEqual(c.odRate, 0);       // empty backlog → 0% overdue → (100-0)*0.4 contributes fully
});

// QUIRK 3
test('QUIRK: mttrIdx defaults to 60 when the site has resolved nothing', () => {
  const D = { meetings: [mk()], issues: [
    { site_code: 'HGO', meeting_date: '2026-05-02', status: 'open', severity: 'LOW' },
  ], inspections: [], findings: [] };
  const c = composite('HGO', D, A);
  // del = (100-0)*0.4 + 60*0.3 + (100-0)*0.3 = 40 + 18 + 30 = 88
  assert.strictEqual(c.del, 88);
});

// QUIRK 2
test('QUIRK: pen is +5 once for a HIGH open >90d, and +3 per stale escalated issue (uncapped)', () => {
  const old = '2026-01-01';   // >90d before A
  const D = { meetings: [mk()], inspections: [], findings: [], issues: [
    { site_code: 'HGO', meeting_date: old, status: 'open', severity: 'HIGH' },
  ] };
  assert.strictEqual(composite('HGO', D, A).pen, 5);

  const D2 = { meetings: [mk()], inspections: [], findings: [], issues: [
    { site_code: 'HGO', meeting_date: old, status: 'open', severity: 'LOW', escalate: '1' },
    { site_code: 'HGO', meeting_date: old, status: 'open', severity: 'LOW', escalate: '1' },
  ] };
  assert.strictEqual(composite('HGO', D2, A).pen, 6);   // 3+3, no HIGH → no +5
});

test('composite: score is floored at 0 but has NO upper clamp', () => {
  // the floor
  const old = '2026-01-01';
  const many = Array.from({ length: 40 }, () => ({ site_code: 'HGO', meeting_date: old, status: 'open', severity: 'HIGH', escalate: '1' }));
  const D = { meetings: [mk()], inspections: [], findings: [], issues: many };
  assert.strictEqual(composite('HGO', D, A).score, 0);   // Math.max(0, ...) — never negative
});

// QUIRK 4 — the fleet dependency. This is why composite() takes the whole D.
// Constructing this test is subtle; get it wrong and it fails against a CORRECT
// port (which, under this plan's "if it disagrees, our code is wrong" doctrine,
// would get the PORT broken to satisfy a broken test). Two traps:
//   a) source line 110 filters allRes with `c && c <= A` — fleet rows closing
//      AFTER asOf never enter the fleet median at all.
//   b) source line 112 clamps: mttrIdx = min(100, 100*fleetMttr/max(mttr,1)).
//      A fleet SLOWER than the site drives the ratio >100 → clamped → no effect.
// So: the site must be SLOW, the fleet FAST, and everything closed on/before asOf.
// Verified against the source: alone.del = 100, withFleet.del = 72.
test('QUIRK: fleetMttr is computed across ALL sites — another site changes this site score', () => {
  const slow = [{ site_code: 'HGO', meeting_date: '2026-01-01', status: 'resolved', closed_at: '2026-04-11', severity: 'LOW' }];  // 100 d
  const fast = (s) => ({ site_code: s, meeting_date: '2026-05-01', status: 'resolved', closed_at: '2026-05-06', severity: 'LOW' }); // 5 d
  const alone = composite('HGO', { meetings: [mk()], issues: slow, inspections: [], findings: [] }, A);
  const withFleet = composite('HGO', { meetings: [mk()], inspections: [], findings: [],
    issues: [...slow, fast('MGO'), fast('SGO')] }, A);
  assert.strictEqual(alone.del, 100);
  assert.strictEqual(withFleet.del, 72);
  assert.notStrictEqual(alone.del, withFleet.del);   // the SAME site, scored differently
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `composite` (source line 102) + `twoMoves` (line 138). Import `_effClose`/`_openAt`/`MD_OPEN` from `../meetings-db` — do NOT re-implement them. `isOpenNow(i)` = `!!MD_OPEN[i.status]`.
  `twoMoves` reads `D.inspections` + `D.findings` + `comp` and returns the ranked candidate list — port its 9 candidate branches verbatim, including the `.slice(0,60)` title truncation and the exact sentences.
- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**
```bash
git add services/siteComposite.js tests/composite-model.test.js
git commit --no-verify -m "feat(score): port composite() + twoMoves() from the authoritative dashboard"
```

---

## Task 3: Fidelity — pin the port to the boss's own data

**THE ACCEPTANCE TEST.** Same doctrine as 3A's `tests/score-fidelity.test.js` (read it — reuse its fixture-loading).

**Files:** Create `tests/composite-fidelity.test.js`

- [ ] **Step 1: Write it.** Load `tests/fixtures/em-data.json` (committed in 3A — 335,946 bytes, the boss's real dataset). Run `composite(site, D, '2026-07-14')` for his 5 sites and assert against the oracle:

| site | score | rag (75/55) | del | gov | eng | pen | open | overdue | odRate | HIGH |
|---|---|---|---|---|---|---|---|---|---|---|
| SML | 62 | AMBER | 83 | 56 | 58 | 5 | 12 | 2 | 17 | 3 |
| SMI | 58 | AMBER | 100 | 27 | 35 | 0 | 22 | 0 | 0 | 2 |
| HGO | 48 | RED | 41 | 53 | 75 | 5 | 15 | 10 | 67 | 2 |
| MGO | 41 | RED | 53 | 33 | 52 | 5 | 29 | 12 | 41 | 5 |
| SGO | 44 | RED | 48 | 37 | 50 | 0 | 2 | 2 | 100 | 0 |

And `eMetrics` for the same 5:

| site | e1 | e2 | e3 | e5 | cov | nextRate |
|---|---|---|---|---|---|---|
| SML | 25 | 71 | 100 | 57 | 58 | 57 |
| SMI | 33 | 0 | 100 | 0 | 58 | 0 |
| HGO | 36 | 30 | 100 | 80 | 58 | 100 |
| MGO | 33 | 17 | 100 | 8 | 75 | 17 |
| SGO | 33 | 0 | 100 | 50 | 33 | 75 |

These were produced by running the **boss's own `composite()`/`eMetrics()`** in Node against this exact fixture. **They are the oracle. If our numbers disagree, OUR code is wrong — report BLOCKED. Never edit these tables to match our output.**

Also assert `median` of MTTR where the oracle is known: SML 45.5 d · SMI 6 d · HGO 74 d · MGO 68 d · SGO `null` (nothing resolved → the mttrIdx-60 default fires — quirk 3 on real data).

- [ ] **Step 2: Run → PASS on the first try, or the port is wrong.** Paste the output.
- [ ] **Step 3: Mutation-check the harness** (3A's implementer did this and it caught a real risk): perturb ONE oracle value by one digit, confirm exactly that assertion fails, restore. A fidelity test that cannot fail is worthless. Report what you did.
  **Target the `del` column** for the mutation — `mttrIdx`/`del` is the term with the clamp and the fleet dependency, i.e. the easiest to port wrong and the hardest to notice.
- [ ] **Step 4: Commit**
```bash
git add tests/composite-fidelity.test.js
git commit --no-verify -m "test(score): pin the composite port to the authoritative dataset"
```

---

## Task 4: The "non applicable" rule — stop fabricating a verdict on empty sites

**The bug, in the user's words:** *« non applicable là où il n'y a pas de données ».*

**Why it exists:** `sbDims` has two INVERTED dimensions (`overdue` and `findings` — less is better). A site with **no data at all** therefore scores `overdue: 0 → 2 pts` and `findings: 0 → 2 pts` = **4/12 = 33 = RED**. That is a confident RED verdict on a site we know nothing about. Today `computeSiteScore({})` returns exactly that — `tests/site-score.test.js` even asserts it.

**The rule:** score where there IS data; `applicable: false` otherwise. **Not** "outside the boss's 5 sites" — his `SITES` map is a display list; the model works for any site that has data.

**Files:** Modify `services/siteScore.js`, `services/siteReport.js`, `services/reportTemplates/coordinator.js`, `public/site-report.js`; update `tests/site-score.test.js`, `tests/site-report.test.js`, `tests/report-template-coordinator.test.js`

- [ ] **Step 1: Write the failing tests.**

```javascript
// tests/site-score.test.js — REPLACE the existing "missing inputs are treated as 0" test
test('no data at all → applicable:false, no fabricated verdict', () => {
  const r = computeSiteScore({}, win);
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.rag, null);
  assert.deepStrictEqual(r.moves, []);
  // The old behaviour was 4 pts / 33 / RED — a confident verdict on nothing.
  assert.notStrictEqual(r.score, 33);
});

test('any activity at all → applicable:true and scored normally', () => {
  assert.strictEqual(computeSiteScore({ reviews: 1 }, win).applicable, true);
  assert.strictEqual(computeSiteScore({ inspections: 1 }, win).applicable, true);
  assert.strictEqual(computeSiteScore({ signoff: 10 }, win).applicable, true);
});

test('a REAL zero is still scored — a site that met and resolved nothing is RED, not N/A', () => {
  const r = computeSiteScore({ reviews: 2, resolution: 0, overdue: 9, inspections: 0, findings: 4, signoff: 0 }, win);
  assert.strictEqual(r.applicable, true);
  assert.strictEqual(r.rag, 'RED');   // measured badness ≠ absence of data
});
```

- [ ] **Step 2: Run → FAIL.** Note `tests/site-report.test.js:85-88` will ALSO go red here — it currently asserts the fallback `computeSiteScore({}, null, null)` yields `score: 33` / `rag: 'RED'` / `dims.length: 6`, i.e. it pins the very bug this task removes. Update it to the `applicable:false` shape (the file is already in this task's `git add`).

- [ ] **Step 3: Implement.**
  - `computeSiteScore(inputs, window, previousScore)` gains an applicability gate. **The distinction that matters:** "we measured zero" ≠ "we measured nothing". Decide applicability from whether ANY input is present/non-zero — i.e. `hasData = reviews>0 || resolution>0 || overdue>0 || inspections>0 || findings>0 || signoff>0`. When false → `{ applicable:false, score:null, points:null, rag:null, trend_pts:null, dims:[], moves:[], window }`. When true → the existing behaviour + `applicable:true`.
  - **Rationale to put in a comment:** the two inverted dims make absence look like excellence; without this gate an unknown site reads RED-33 and a coordinator gets a report about a site we have no data for.
  - Propagate through `siteReport.js` (the `score` block passes through).
  - **`services/siteReportDeps.js:93` also reads `.score` — VERIFIED SAFE, do NOT modify it** (it is not on the approved list). Its `prevScore` does `if (!m.reviews && !m.raised && !i.inspections) return null;` before calling `computeSiteScore(...).score`, so it only reaches the call when something happened; and if the gate ever did return `score:null`, it degrades to `prevScore = null` → `trend_pts = null`, which is the correct outcome anyway. Named here so you don't hunt it, panic, and "fix" an unapproved module.
    (Aside worth one comment in the code: that guard keys on `raised`, which the six `inputs` don't carry, while the new gate can only see the six. The outcomes agree; the asymmetry is deliberate.)
  - `coordinator.js` + `public/site-report.js`: when `!applicable`, render **"Score non applicable — aucune donnée sur la fenêtre"** (+ the window dates) in place of the hero number, and **omit the dims table and the moves block entirely** rather than rendering six empty rows. Do NOT render a grey `—/100`; the point is that no verdict is claimed.
- [ ] **Step 4: Run → PASS** (all four test files). Paste output.
- [ ] **Step 5: Commit**
```bash
git add services/siteScore.js services/siteReport.js services/reportTemplates/coordinator.js public/site-report.js tests/site-score.test.js tests/site-report.test.js tests/report-template-coordinator.test.js
git commit --no-verify -m "fix(score): 'non applicable' when a site has no data (was a fabricated RED 33)"
```

---

## Task 5: Docs + regression

- [ ] **Step 1: Full regression.**
```bash
REPORTS_BACKEND=sqlite MEETINGS_BACKEND=sqlite INSPECTION_BACKEND=sqlite node --test --test-force-exit \
  tests/composite-model.test.js tests/composite-fidelity.test.js tests/score-fidelity.test.js \
  tests/score-window.test.js tests/site-score.test.js tests/meetings-score-inputs.test.js \
  tests/inspection-score-inputs.test.js tests/site-report.test.js tests/site-report-deps.test.js \
  tests/site-report-adapters.test.js tests/report-template-coordinator.test.js \
  tests/reporting-routes.smoke.test.js tests/reporting-send.smoke.test.js tests/send-reports-cli.test.js \
  tests/site-resolve.test.js tests/site-helpdesk.test.js tests/site-technicians.test.js \
  tests/meetings-contacts.test.js tests/report-config.test.js tests/report-directory.test.js \
  tests/report-sent-log.test.js tests/report-schedule.test.js tests/mailer.test.js tests/report-render.test.js
```
Plus canaries — `tests/pptx-monthly-golden.test.js`, `tests/meetings-summary.test.js`, `tests/inspection-routes.test.js`, `tests/exec-summary.test.js` — unchanged. Do NOT regenerate the golden.

- [ ] **Step 2: `CLAUDE.md`.**
  - Current state: 3B-1 landed — the SECOND authoritative model (`composite()`, RAG 75/55) is ported and fidelity-pinned; sites with no data now read "non applicable" instead of a fabricated RED 33.
  - Pitfall: *"The reporting suite carries TWO scoring models, both ported from the boss's dashboard, both authoritative, and they genuinely disagree — 3 of 5 sites land on a different RAG and the rankings are nearly inverted. `composite()` (RAG 75/55) scores how well problems are handled; `sbDims()` (RAG 70/45) scores programme discipline. This is the source's design. Do NOT 'reconcile' them; if the double-verdict is a problem, that is a conversation with the model's author, not a code change."*
  - Pitfall: *"`composite()` is NOT per-site-isolated: `fleetMttr` is the median resolution time across ALL sites, so adding data for site B changes site A's score. It must be passed the whole fleet's `D`, never one site's slice."*
  - Pitfall: *"`eMetrics.cov` has a hardcoded `/12` (departments) and no upper clamp — >12 distinct departments at one site pushes `cov`>100, `eng`>100, and `composite` above 100 (it is floored at 0 but has no ceiling). Unreachable on the author's 5 sites; our fleet is larger and the meetings data already carries an unseeded `SP` department code. Ported as-is and pinned by a test — surface it to the author rather than clamping it here."*
  - Pitfall: *"Two inverted dimensions (`overdue`, `findings`) mean ABSENCE of data looks like excellence: an empty site scored 4/12 = RED 33 — a confident verdict on nothing. `computeSiteScore` now returns `applicable:false`. Any new score dimension that rewards a zero must respect the same gate."*
- [ ] **Step 3: Commit + finish the branch.**

---

## Done criteria

- [ ] `tests/composite-fidelity.test.js` reproduces the author's 5 sites exactly (score, RAG, del/gov/eng/pen, eMetrics). **Acceptance.**
- [ ] The fidelity harness is mutation-checked — it can actually fail.
- [ ] A site with no data reports "non applicable", not RED 33.
- [ ] The **5** documented quirks are pinned by tests, not silently fixed.
- [ ] All reporting tests green; canaries unchanged.
- [ ] No existing module touched beyond the user-approved list.

**Deferred to 3B-2:** `loadReviewData(asOf)` (build `D` from our DBs, fleet-wide); the `renderVals()` port (15 panels); the page (`it-review.html`, template re-written as plain HTML/JS — no dc-runtime, no React/Babel, no unpkg); `windows`/`delta`/`metrics`/`spark`/`filterSite`; wiring `composite` into anything user-facing.
