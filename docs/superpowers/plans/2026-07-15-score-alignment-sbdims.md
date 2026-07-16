# Sub-project 3A — Score Alignment to the User's `sbDims` Model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invented scoring model in `services/siteScore.js` with the user's authoritative `sbDims` model — implemented identically — and add the windowed readers it requires.

**Architecture:** The user's model is **6 dimensions × 0/1/2 points ÷ 12 × 100**, computed over a **3-month rolling window** ending at an as-of date. Our existing readers are **monthly**, so this is not a formula swap: it needs new windowed readers in `meetings-db` + `inspection-db`, a new `score` contract, and updates to every consumer (composer, live page, tests).

**Tech Stack:** Node.js, better-sqlite3 / `services/pgDb.js` (every new reader needs a sqlite body + async PG fork), `node --test --test-force-exit`.

**Branch:** `feat/score-sbdims` (from `main`)

> **Test runner note:** the dev `.env` pins all backends to `postgres`. Tests must set `process.env.REPORTS_BACKEND/MEETINGS_BACKEND/INSPECTION_BACKEND='sqlite'` BEFORE any require. Tests that seed a fresh `SDP_DATA_DIR` must also set `DASH_USER`/`DASH_PASS` (a first boot hard-throws without them). Always `--test-force-exit`.

---

## The authoritative model (verbatim from the user's `IT Review Dashboard.html`)

```js
sbDims(site, D, asOf) {
  const A = asOf || Component.ANCHOR;          // ANCHOR = '2026-07-14' (hardcoded there)
  const W0 = '2026-04-01';                     // hardcoded there
  const meets = D.meetings.filter(m => m.site_code === site && m.meeting_date >= W0 && m.meeting_date <= A);
  const isss  = D.issues.filter(i => i.site_code === site && i.meeting_date >= W0 && i.meeting_date <= A);
  const reviews = meets.length;
  const resolved = isss.filter(i => { const c = this.effClose(i); return i.status === 'resolved' && c && c <= A; }).length;
  const resolution = isss.length ? Math.round(100 * resolved / isss.length) : 0;
  const odIss = D.issues.filter(i => i.site_code === site && this.openAt(i, A) && i.target_date && i.target_date < A).length;
  const odAct = D.actions.filter(a => a.site_code === site && a.meeting_date && a.meeting_date <= A && (!a.closed_at || String(a.closed_at).slice(0,10) > A) && Component.OPEN[a.status] && a.target_date && a.target_date < A).length;
  const overdue = odIss + odAct;
  const insp = D.inspections.filter(i => i.site_code === site && i.inspection_date <= A).length;
  const findings = D.findings.filter(f => f.site_code === site && f.inspection_date <= A && (f.status === 'critical' || f.status === 'major')).length;
  const signed = meets.filter(m => m.dept_head_signed_at && m.site_it_signed_at && String(m.dept_head_signed_at).slice(0,10) <= A && String(m.site_it_signed_at).slice(0,10) <= A).length;
  const signoff = meets.length ? Math.round(100 * signed / meets.length) : 0;
  const pt = (v, g, a, invert) => invert ? (v <= g ? 2 : v <= a ? 1 : 0) : (v >= g ? 2 : v >= a ? 1 : 0);
  const dims = [
    { key:'reviews',     label:'Reviews',     val:reviews,    disp:String(reviews),  pts:pt(reviews, 8, 5),        tip:'reviews held · G≥8 A5–7 R<5' },
    { key:'resolution',  label:'Resolution',  val:resolution, disp:resolution+'%',   pts:pt(resolution, 40, 20),   tip:'resolved ÷ raised · G≥40 A20–39 R<20' },
    { key:'overdue',     label:'Overdue',     val:overdue,    disp:String(overdue),  pts:pt(overdue, 0, 5, true),  tip:'overdue issues + actions · G0 A1–5 R>5' },
    { key:'inspections', label:'Inspections', val:insp,       disp:String(insp),     pts:pt(insp, 3, 2),           tip:'inspections run · G≥3 A2 R≤1' },
    { key:'findings',    label:'Findings',    val:findings,   disp:String(findings), pts:pt(findings, 0, 2, true), tip:'critical+major findings · G0 A1–2 R≥3' },
    { key:'signoff',     label:'Sign-off',    val:signoff,    disp:signoff+'%',      pts:pt(signoff, 70, 30),      tip:'minutes fully signed % · G≥70 A30–69 R<30' },
  ];
  const points = dims.reduce((s, d) => s + d.pts, 0);
  return { dims, points, score: Math.round(points / 12 * 100), reviews, resolution, overdue };
}
// rag2 — DISTILLED, not verbatim: the bands (70/45) are identical; the source
// also returns the colours below, which Task 6 should use so the report looks
// like their dashboard:
//   GREEN #2f7d4f · AMBER #d99a2b · RED var(--color-accent)   (all solidFg #fff)
rag2(score) { return score >= 70 ? 'GREEN' : score >= 45 ? 'AMBER' : 'RED'; }
effClose(i) { if (i.closed_at) return String(i.closed_at).slice(0,10); if (i.status === 'resolved' || i.status === 'cancelled') return i.updated_at ? String(i.updated_at).slice(0,10) : null; return null; }
openAt(i, t) { const raised = i.meeting_date; if (!raised || raised > t) return false; const c = this.effClose(i); return !c || c > t; }
static OPEN = { open:1, in_progress:1, on_hold:1, blocked:1 };
```
Two-moves:
```js
const gaps = sb.dims.filter(d => d.pts < 2).sort((a, b) => (2 - b.pts) - (2 - a.pts) || (a.key === 'overdue' ? -1 : 0));
const moves = gaps.slice(0, 2).map((d, i) => ({ n: i+1, gain: '+' + Math.round((2 - d.pts) / 12 * 100) + ' pts', text: sbMoveText(d) }));
while (moves.length < 2) moves.push({ n: moves.length+1, gain: 'sustain', text: 'All dimensions green — hold cadence and keep the register clean.' });
```

### Sanctioned deviations (user-directed — the ONLY ones)
1. **`W0` becomes a 3-month rolling window**, not the hardcoded `'2026-04-01'`. User's word: *"fenêtre glissante"*. Their own move text says *"the **quarterly** green of 3"* and `reviews ≥8` over 3 months ≈ their "3 departments/month" cadence — the thresholds were calibrated for a ~3-month window, so this restores the intent rather than changing it.
2. **The window applies to ALL activity dimensions**, not just `meets`/`isss`. In their code `insp`/`findings` are unbounded-cumulative-to-`A` — invisible while `W0` = programme start ≈ data start, but with a rolling window they would still saturate (`insp ≥3` forever true), which is exactly what the user chose the rolling window to prevent. So `inspections` + `findings` are windowed too.
3. **`overdue` stays a point-in-time snapshot as-of `A`** (open AND past target) — it is not activity-in-a-window and needs no lower bound. Unchanged from their code.
4. **`ANCHOR` becomes a parameter** (the report's as-of date), not a hardcoded constant.

**Everything else is copied literally**, including:
- **ISO string comparison, never `Date`** (`'2026-07-01' <= '2026-07-14'`). Timestamps get `.slice(0,10)` first.
- The `pt()` thresholds, the `/12*100`, `Math.round` (JS round-half-up).
- The `+17`/`+8 pts` gains and the literal `'sustain'` padding.
- The tie-break `(2-b.pts)-(2-a.pts) || (a.key === 'overdue' ? -1 : 0)` — **it is asymmetric and technically an invalid comparator**; copy it verbatim and rely on Node's stable sort (spec-stable since V8 7.0) so we match their output rather than "fixing" it into different numbers.
- The 6 move texts (branch 6 is a **fallback `return`, not an `if`** — an unknown key yields the sign-off text).

---

## File Structure

| File | Responsibility |
|---|---|
| `services/siteScore.js` | **REWRITE.** The `sbDims` model, verbatim + the 4 sanctioned deviations. Pure. |
| `services/scoreWindow.js` | **NEW.** `rollingWindow(asOf, months=3)` → `{from, to}` ISO strings. Pure, no `Date` arithmetic surprises. |
| `meetings-db.js` | **MODIFY.** Add `getSiteScoreInputs(siteCode, from, to)` (+pg fork). |
| `inspection-db.js` | **MODIFY.** Add `getSiteScoreInputs(siteCode, from, to)` (+pg fork). |
| `services/siteReportDeps.js` | **MODIFY.** New `scoreInputs(code, period)` dep; `prevComposite` → previous window. |
| `services/siteReport.js` | **MODIFY.** New `score` block shape. |
| `services/reportTemplates/coordinator.js` | **MODIFY.** Render `dims[]` + the new moves shape. |
| `public/site-report.js` | **MODIFY.** Same. |
| `tests/*` | Rewritten / updated per task. |

### The `score` contract change (breaking — every consumer updates)
```
BEFORE: score: { composite, rag:'green'|'amber'|'red', trend_pts, dimensions:{reviews:0-100,…}, two_moves:[{text,gain_pts}] }
AFTER:  score: {
  score,            // 0-100, = round(points/12*100)  ← renamed from `composite`
  points,           // 0-12
  rag,              // 'GREEN' | 'AMBER' | 'RED'      ← uppercase, matches rag2()
  trend_pts,        // score − prevScore, or null
  dims: [ { key, label, val, disp, pts, tip } ],      // ← replaces `dimensions`
  moves: [ { n, gain, text } ],                       // ← replaces `two_moves`; gain is a STRING ('+17 pts' | 'sustain')
  window: { from, to },                               // provenance — what the score actually measured
}
```

---

## Task 1: `services/scoreWindow.js` — the rolling window (pure, TDD)

**Files:** Create `services/scoreWindow.js`; Test `tests/score-window.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/score-window.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { rollingWindow, prevDay } = require('../services/scoreWindow');

test('3-month rolling window ending at asOf', () => {
  assert.deepStrictEqual(rollingWindow('2026-07-14'), { from: '2026-04-14', to: '2026-07-14' });
});
test('crosses a year boundary', () => {
  assert.deepStrictEqual(rollingWindow('2026-02-10'), { from: '2025-11-10', to: '2026-02-10' });
});
test('clamps a day that does not exist in the from-month', () => {
  // 31 May minus 3 months = 28 Feb (2026 is not a leap year), never 31 Feb / 3 Mar
  assert.deepStrictEqual(rollingWindow('2026-05-31'), { from: '2026-02-28', to: '2026-05-31' });
});
test('leap year: 31 May 2024 → 29 Feb 2024', () => {
  assert.deepStrictEqual(rollingWindow('2024-05-31'), { from: '2024-02-29', to: '2024-05-31' });
});
test('months param is honoured', () => {
  assert.deepStrictEqual(rollingWindow('2026-07-14', 1), { from: '2026-06-14', to: '2026-07-14' });
});
test('rejects a malformed asOf', () => {
  assert.throws(() => rollingWindow('14/07/2026'), /asOf/i);
});

// prevDay — needed by prevScore (the previous window ends the day before this
// one starts). Lives here so NOBODY reaches for `new Date(from) - 86400e3`.
test('prevDay steps back one day', () => {
  assert.strictEqual(prevDay('2026-07-14'), '2026-07-13');
});
test('prevDay crosses a month boundary', () => {
  assert.strictEqual(prevDay('2026-03-01'), '2026-02-28');
});
test('prevDay crosses a year boundary', () => {
  assert.strictEqual(prevDay('2026-01-01'), '2025-12-31');
});
test('prevDay handles a leap day', () => {
  assert.strictEqual(prevDay('2024-03-01'), '2024-02-29');
});
```

- [ ] **Step 2: Run → FAIL.** `node --test --test-force-exit tests/score-window.test.js`

- [ ] **Step 3: Implement `services/scoreWindow.js`**

```javascript
'use strict';
// rollingWindow(asOf, months=3) → { from, to } as ISO 'YYYY-MM-DD' strings.
// The score model compares dates as STRINGS (lexicographic ISO), never Date
// objects — so this returns strings and does its own calendar math to avoid
// Date's timezone/rollover surprises (new Date('2026-05-31') minus 3 months
// via setMonth famously lands on 3 March).
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const p2 = (n) => String(n).padStart(2, '0');

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }   // m is 1-based; day 0 of next month

function rollingWindow(asOf, months = 3) {
  if (!ISO.test(String(asOf || ''))) throw new Error(`rollingWindow: asOf must be 'YYYY-MM-DD', got "${asOf}"`);
  const [y, m, d] = asOf.split('-').map(Number);
  let fy = y, fm = m - months;
  while (fm <= 0) { fm += 12; fy -= 1; }
  const fd = Math.min(d, daysInMonth(fy, fm));   // clamp: 31 May − 3mo → 28/29 Feb
  return { from: `${fy}-${p2(fm)}-${p2(fd)}`, to: asOf };
}

// prevDay(iso) → the ISO date one day earlier. UTC-anchored so there is no
// local-timezone rollover; returns a string because the whole model compares
// strings.
function prevDay(iso) {
  if (!ISO.test(String(iso || ''))) throw new Error(`prevDay: expected 'YYYY-MM-DD', got "${iso}"`);
  const t = Date.UTC(...iso.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n))) - 86400000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

module.exports = { rollingWindow, prevDay };
```

- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**
```bash
git add services/scoreWindow.js tests/score-window.test.js
git commit --no-verify -m "feat(score): rollingWindow — 3-month ISO-string window with month-end clamping"
```

---

## Task 2: `services/siteScore.js` — the `sbDims` model (pure, TDD)

**Files:** Rewrite `services/siteScore.js`; Rewrite `tests/site-score.test.js`

- [ ] **Step 1: Replace `tests/site-score.test.js` entirely**

```javascript
// tests/site-score.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeSiteScore, rag2 } = require('../services/siteScore');

// inputs are the RAW measured values, exactly as the user's sbDims computes them.
const perfect = { reviews: 8, resolution: 40, overdue: 0, inspections: 3, findings: 0, signoff: 70 };
const win = { from: '2026-04-14', to: '2026-07-14' };

test('all-green inputs → 12 pts / 100 / GREEN', () => {
  const r = computeSiteScore(perfect, win);
  assert.strictEqual(r.points, 12);
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.rag, 'GREEN');
});

test('all-red inputs → 0 pts / 0 / RED', () => {
  const r = computeSiteScore({ reviews: 0, resolution: 0, overdue: 99, inspections: 0, findings: 9, signoff: 0 }, win);
  assert.strictEqual(r.points, 0);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.rag, 'RED');
});

test('score = round(points/12*100) — only 13 values are realisable', () => {
  // 6 pts → 50 (AMBER floor), 9 pts → 75 (GREEN floor), 5 pts → 42 (RED)
  assert.strictEqual(computeSiteScore({ reviews: 8, resolution: 40, overdue: 0, inspections: 0, findings: 9, signoff: 0 }, win).points, 6);
  assert.strictEqual(computeSiteScore({ reviews: 8, resolution: 40, overdue: 0, inspections: 0, findings: 9, signoff: 0 }, win).score, 50);
});

// Only 13 scores are realisable ({0,8,17,25,33,42,50,58,67,75,83,92,100}), so
// GREEN effectively starts at 9/12 pts and AMBER at 6/12. 8 pts = 67 = AMBER —
// NOT green. If this test ever goes red, the fix is NEVER to move the band:
// 70/45 is the user's rag2 and the whole point is agreeing with their dashboard.
test('rag2 bands over the realisable scores', () => {
  assert.strictEqual(rag2(42), 'RED');     // 5 pts
  assert.strictEqual(rag2(50), 'AMBER');   // 6 pts
  assert.strictEqual(rag2(67), 'AMBER');   // 8 pts — not green
  assert.strictEqual(rag2(75), 'GREEN');   // 9 pts
});

test('each dimension bands exactly as the user specified', () => {
  const d = (inp) => Object.fromEntries(computeSiteScore({ ...perfect, ...inp }, win).dims.map(x => [x.key, x.pts]));
  assert.strictEqual(d({ reviews: 8 }).reviews, 2);
  assert.strictEqual(d({ reviews: 7 }).reviews, 1);
  assert.strictEqual(d({ reviews: 5 }).reviews, 1);
  assert.strictEqual(d({ reviews: 4 }).reviews, 0);
  assert.strictEqual(d({ resolution: 40 }).resolution, 2);
  assert.strictEqual(d({ resolution: 39 }).resolution, 1);
  assert.strictEqual(d({ resolution: 19 }).resolution, 0);
  assert.strictEqual(d({ overdue: 0 }).overdue, 2);      // inverted
  assert.strictEqual(d({ overdue: 5 }).overdue, 1);
  assert.strictEqual(d({ overdue: 6 }).overdue, 0);
  assert.strictEqual(d({ inspections: 3 }).inspections, 2);
  assert.strictEqual(d({ inspections: 2 }).inspections, 1);
  assert.strictEqual(d({ inspections: 1 }).inspections, 0);
  assert.strictEqual(d({ findings: 0 }).findings, 2);    // inverted
  assert.strictEqual(d({ findings: 2 }).findings, 1);
  assert.strictEqual(d({ findings: 3 }).findings, 0);
  assert.strictEqual(d({ signoff: 70 }).signoff, 2);
  assert.strictEqual(d({ signoff: 69 }).signoff, 1);
  assert.strictEqual(d({ signoff: 29 }).signoff, 0);
});

test('dims carry key/label/val/disp/pts/tip in the user order', () => {
  const r = computeSiteScore(perfect, win);
  assert.deepStrictEqual(r.dims.map(d => d.key), ['reviews', 'resolution', 'overdue', 'inspections', 'findings', 'signoff']);
  const res = r.dims.find(d => d.key === 'resolution');
  assert.strictEqual(res.disp, '40%');
  assert.match(res.tip, /resolved/);
  const rev = r.dims.find(d => d.key === 'reviews');
  assert.strictEqual(rev.disp, '8');
  assert.strictEqual(rev.label, 'Reviews');
});

test('moves: gain is +17 for a 0-pt gap, +8 for a 1-pt gap', () => {
  const r = computeSiteScore({ ...perfect, reviews: 0, resolution: 39 }, win);
  const rev = r.moves.find(m => /departmental reviews/.test(m.text));
  assert.strictEqual(rev.gain, '+17 pts');
  const res = r.moves.find(m => /Lift resolution/.test(m.text));
  assert.strictEqual(res.gain, '+8 pts');
});

test('moves: always exactly 2; all-green pads with sustain', () => {
  const r = computeSiteScore(perfect, win);
  assert.strictEqual(r.moves.length, 2);
  assert.strictEqual(r.moves[0].gain, 'sustain');
  assert.match(r.moves[0].text, /All dimensions green/);
});

test('moves: biggest gap first', () => {
  const r = computeSiteScore({ ...perfect, reviews: 0, resolution: 39 }, win);
  assert.strictEqual(r.moves.length, 2);
  assert.strictEqual(r.moves[0].gain, '+17 pts');   // 0-pt gap outranks the 1-pt gap
  assert.strictEqual(r.moves[1].gain, '+8 pts');
});

test('move texts are the user texts verbatim', () => {
  const r = computeSiteScore({ ...perfect, reviews: 3 }, win);
  assert.match(r.moves[0].text, /^Hold 5 more departmental reviews to reach the green cadence of 8 — book them with GM sponsorship now\.$/);
});

test('trend_pts null without a previous score, else the delta', () => {
  assert.strictEqual(computeSiteScore(perfect, win).trend_pts, null);
  assert.strictEqual(computeSiteScore(perfect, win, 75).trend_pts, 25);
});

test('window provenance is echoed', () => {
  assert.deepStrictEqual(computeSiteScore(perfect, win).window, win);
});

test('missing inputs are treated as 0, never a throw', () => {
  const r = computeSiteScore({}, win);
  assert.strictEqual(r.points, 4);   // overdue 0 → 2pts, findings 0 → 2pts; rest 0
  assert.strictEqual(r.rag, 'RED');
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Rewrite `services/siteScore.js`**

```javascript
'use strict';
// The site scoreboard score — a FAITHFUL port of the user's sbDims() model from
// their "IT Review Dashboard" (the authoritative source; see
// docs/superpowers/plans/2026-07-15-score-alignment-sbdims.md).
//
// 6 dimensions x 0/1/2 points, score = round(points / 12 * 100), RAG 70/45.
// Inputs are the RAW measured values over a 3-month rolling window (the window
// itself is computed by services/scoreWindow.js and measured by each module's
// getSiteScoreInputs reader) — this module is pure arithmetic.
//
// DO NOT "improve" the thresholds, the rounding, or the tie-break comparator:
// this must agree with what the team already sees on their dashboard. A score
// that diverges from the one on screen is worse than no score.

const num = (v) => (Number.isFinite(+v) ? +v : 0);

// pt(value, green, amber, invert) → 2 | 1 | 0   (verbatim from sbDims)
const pt = (v, g, a, invert) => (invert ? (v <= g ? 2 : v <= a ? 1 : 0) : (v >= g ? 2 : v >= a ? 1 : 0));

// [key, label, green, amber, invert, disp, tip] — order is the user's dims order
// and is load-bearing (it is the moves tie-break's stable-sort order).
const PT_THRESHOLDS = [
  ['reviews',     'Reviews',     8,  5,  false, (v) => String(v),  'reviews held · G≥8 A5–7 R<5'],
  ['resolution',  'Resolution',  40, 20, false, (v) => v + '%',    'resolved ÷ raised · G≥40 A20–39 R<20'],
  ['overdue',     'Overdue',     0,  5,  true,  (v) => String(v),  'overdue issues + actions · G0 A1–5 R>5'],
  ['inspections', 'Inspections', 3,  2,  false, (v) => String(v),  'inspections run · G≥3 A2 R≤1'],
  ['findings',    'Findings',    0,  2,  true,  (v) => String(v),  'critical+major findings · G0 A1–2 R≥3'],
  ['signoff',     'Sign-off',    70, 30, false, (v) => v + '%',    'minutes fully signed % · G≥70 A30–69 R<30'],
];

// rag2() — bands on the composite score.
function rag2(score) { return score >= 70 ? 'GREEN' : score >= 45 ? 'AMBER' : 'RED'; }

// sbMoveText() — verbatim. NOTE: the 6th branch is a FALLBACK return, not an
// `if (key === 'signoff')`, so an unknown key yields the sign-off text. Kept.
function moveText(d) {
  if (d.key === 'reviews')     return 'Hold ' + Math.max(8 - d.val, 1) + ' more departmental reviews to reach the green cadence of 8 — book them with GM sponsorship now.';
  if (d.key === 'resolution')  return 'Lift resolution from ' + d.val + '% toward 40%: run a weekly closure sprint on the oldest in-progress items.';
  if (d.key === 'overdue')     return 'Clear ' + d.val + ' overdue commitments — re-date with dept heads what is still real, close the rest this week.';
  if (d.key === 'inspections') return 'Run ' + Math.max(3 - d.val, 1) + ' more infrastructure inspection' + (3 - d.val > 1 ? 's' : '') + ' to reach the quarterly green of 3.';
  if (d.key === 'findings')    return 'Close out ' + d.val + ' critical/major inspection findings with dated corrective actions.';
  return 'Get minutes counter-signed: sign-off at ' + d.val + '% vs 70% green — capture both signatures at meeting close.';
}

/**
 * computeSiteScore(inputs, window, previousScore)
 *   inputs: { reviews, resolution, overdue, inspections, findings, signoff } — raw measured values
 *   window: { from, to } — echoed as provenance
 *   previousScore: number | null — the same score recomputed as-of the previous window's end
 */
function computeSiteScore(inputs = {}, window = null, previousScore = null) {
  const dims = PT_THRESHOLDS.map(([key, label, g, a, invert, disp, tip]) => {
    const val = num(inputs[key]);
    return { key, label, val, disp: disp(val), pts: pt(val, g, a, invert), tip };
  });
  const points = dims.reduce((s, d) => s + d.pts, 0);
  const score = Math.round((points / 12) * 100);

  // Two moves — verbatim, INCLUDING the asymmetric tie-break. It returns -1 when
  // a is 'overdue' but 0 (not +1) when b is, so it is not a valid comparator.
  // Copied literally so our ranking matches theirs; Node's sort is spec-stable
  // (V8 >= 7.0), so the same expression over the same array agrees with V8.
  const gaps = dims.filter((d) => d.pts < 2).sort((a, b) => (2 - b.pts) - (2 - a.pts) || (a.key === 'overdue' ? -1 : 0));
  const moves = gaps.slice(0, 2).map((d, i) => ({ n: i + 1, gain: '+' + Math.round(((2 - d.pts) / 12) * 100) + ' pts', text: moveText(d) }));
  while (moves.length < 2) moves.push({ n: moves.length + 1, gain: 'sustain', text: 'All dimensions green — hold cadence and keep the register clean.' });

  const trend_pts = previousScore === null || previousScore === undefined ? null : score - Math.round(num(previousScore));
  return { score, points, rag: rag2(score), trend_pts, dims, moves, window: window || null };
}

module.exports = { computeSiteScore, rag2, moveText, PT_THRESHOLDS };
```

- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**
```bash
git add services/siteScore.js tests/site-score.test.js
git commit --no-verify -m "feat(score): port the user's sbDims model verbatim (6 dims x 0/1/2, /12, RAG 70/45)"
```

---

## Task 3: `meetings-db.getSiteScoreInputs(siteCode, from, to)`

Supplies `reviews`, `resolution`, `signoff`, `overdue` (issues + actions). **All date logic is ISO string comparison** — mirror the user's semantics exactly.

**Files:** Modify `meetings-db.js`; Test `tests/meetings-score-inputs.test.js`

- [ ] **Step 1: Write the failing test** — test the PURE core first, then one integration test on a seeded sqlite DB.

```javascript
// tests/meetings-score-inputs.test.js
'use strict';
process.env.MEETINGS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const { _effClose, _openAt, _computeMeetingsScoreInputs, MD_OPEN } = require('../meetings-db');

test('MD_OPEN is exactly the user OPEN map', () => {
  assert.deepStrictEqual(Object.keys(MD_OPEN).sort(), ['blocked', 'in_progress', 'on_hold', 'open']);
});

test('_effClose: closed_at wins, sliced to a date', () => {
  assert.strictEqual(_effClose({ closed_at: '2026-06-10 08:30:00' }), '2026-06-10');
});
test('_effClose: resolved/cancelled fall back to updated_at', () => {
  assert.strictEqual(_effClose({ status: 'resolved', updated_at: '2026-06-11 09:00:00' }), '2026-06-11');
  assert.strictEqual(_effClose({ status: 'cancelled', updated_at: '2026-06-11 09:00:00' }), '2026-06-11');
});
test('_effClose: open issue has no close date', () => {
  assert.strictEqual(_effClose({ status: 'in_progress', updated_at: '2026-06-11 09:00:00' }), null);
});
test('_openAt: not yet raised → false', () => {
  assert.strictEqual(_openAt({ meeting_date: '2026-07-20', status: 'open' }, '2026-07-14'), false);
});
test('_openAt: raised and never closed → true', () => {
  assert.strictEqual(_openAt({ meeting_date: '2026-05-01', status: 'open' }, '2026-07-14'), true);
});
test('_openAt: closed after t → still open at t', () => {
  assert.strictEqual(_openAt({ meeting_date: '2026-05-01', status: 'resolved', closed_at: '2026-08-01' }, '2026-07-14'), true);
});
test('_openAt: closed before t → closed at t', () => {
  assert.strictEqual(_openAt({ meeting_date: '2026-05-01', status: 'resolved', closed_at: '2026-06-01' }, '2026-07-14'), false);
});

test('_computeMeetingsScoreInputs: reviews/resolution/signoff over the window, overdue as-of to', () => {
  const W = { from: '2026-04-14', to: '2026-07-14' };
  const meetings = [
    { meeting_date: '2026-05-02', dept_head_signed_at: '2026-05-03 10:00:00', site_it_signed_at: '2026-05-03 10:01:00' },  // signed
    { meeting_date: '2026-06-02', dept_head_signed_at: '2026-06-03 10:00:00', site_it_signed_at: null },                    // half-signed
    { meeting_date: '2026-04-01', dept_head_signed_at: '2026-04-02 10:00:00', site_it_signed_at: '2026-04-02 10:00:00' },  // BEFORE from → excluded
    { meeting_date: '2026-08-01', dept_head_signed_at: null, site_it_signed_at: null },                                     // AFTER to → excluded
  ];
  const issues = [
    { meeting_date: '2026-05-02', status: 'resolved', closed_at: '2026-06-01 09:00:00', target_date: '2026-05-30' },
    { meeting_date: '2026-05-02', status: 'in_progress', closed_at: null, target_date: '2026-06-01' },   // overdue at 07-14
    { meeting_date: '2026-01-01', status: 'open', closed_at: null, target_date: '2026-02-01' },          // outside window BUT overdue as-of → counts in overdue only
  ];
  const actions = [
    { meeting_date: '2026-05-02', status: 'in_progress', closed_at: null, target_date: '2026-06-15' },   // overdue
    { meeting_date: '2026-05-02', status: 'resolved', closed_at: '2026-06-01 09:00:00', target_date: '2026-05-01' }, // closed → not overdue
  ];
  const r = _computeMeetingsScoreInputs({ meetings, issues, actions }, W);
  assert.strictEqual(r.reviews, 2);        // only the 2 in-window meetings
  assert.strictEqual(r.raised, 2);         // only the 2 in-window issues
  assert.strictEqual(r.resolved, 1);
  assert.strictEqual(r.resolution, 50);    // round(100*1/2)
  assert.strictEqual(r.signoff, 50);       // 1 of 2 in-window meetings fully signed
  assert.strictEqual(r.overdue, 3);        // 2 overdue issues (incl. the out-of-window one) + 1 overdue action
});

test('_computeMeetingsScoreInputs: no meetings → zeros, no divide-by-zero', () => {
  const r = _computeMeetingsScoreInputs({ meetings: [], issues: [], actions: [] }, { from: '2026-04-14', to: '2026-07-14' });
  assert.strictEqual(r.reviews, 0);
  assert.strictEqual(r.resolution, 0);
  assert.strictEqual(r.signoff, 0);
  assert.strictEqual(r.overdue, 0);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement in `meetings-db.js`.** Export `_effClose`, `_openAt`, `_computeMeetingsScoreInputs`, `MD_OPEN`, `getSiteScoreInputs`.

The pure core (mirror the user's semantics literally — **string compares, no `Date`**):
```javascript
// ── Site score inputs (the user's sbDims model — see the score-alignment plan) ──
// All date logic is ISO STRING comparison, exactly as the source model. Do not
// convert to Date: '2026-07-01' <= '2026-07-14' is the contract.
const MD_OPEN = { open: 1, in_progress: 1, on_hold: 1, blocked: 1 };
const _d10 = (v) => (v ? String(v).slice(0, 10) : null);

function _effClose(i) {
  if (i.closed_at) return _d10(i.closed_at);
  if (i.status === 'resolved' || i.status === 'cancelled') return i.updated_at ? _d10(i.updated_at) : null;
  return null;
}
function _openAt(i, t) {
  const raised = i.meeting_date;
  if (!raised || raised > t) return false;
  const c = _effClose(i);
  return !c || c > t;
}
// rows: { meetings, issues, actions } already scoped to ONE site.
// meetings/issues are windowed [from,to]; overdue is a point-in-time snapshot at `to`.
function _computeMeetingsScoreInputs({ meetings, issues, actions }, { from, to }) {
  const meets = (meetings || []).filter(m => m.meeting_date >= from && m.meeting_date <= to);
  const isss  = (issues || []).filter(i => i.meeting_date >= from && i.meeting_date <= to);
  const reviews = meets.length;
  const resolved = isss.filter(i => { const c = _effClose(i); return i.status === 'resolved' && c && c <= to; }).length;
  const resolution = isss.length ? Math.round((100 * resolved) / isss.length) : 0;
  const signed = meets.filter(m => m.dept_head_signed_at && m.site_it_signed_at && _d10(m.dept_head_signed_at) <= to && _d10(m.site_it_signed_at) <= to).length;
  const signoff = meets.length ? Math.round((100 * signed) / meets.length) : 0;
  // overdue = open AND past target, AS OF `to` — NOT windowed (matches the source).
  const odIss = (issues || []).filter(i => _openAt(i, to) && i.target_date && i.target_date < to).length;
  const odAct = (actions || []).filter(a => a.meeting_date && a.meeting_date <= to && (!a.closed_at || _d10(a.closed_at) > to) && MD_OPEN[a.status] && a.target_date && a.target_date < to).length;
  return { reviews, raised: isss.length, resolved, resolution, signed, signoff, overdue: odIss + odAct, odIss, odAct };
}
```
The reader fetches ALL rows for the site (no SQL date filtering — the pure core does the windowing, so the semantics live in ONE place and stay testable):
```javascript
function getSiteScoreInputs(siteCode, from, to) {
  if (MEETINGS_BACKEND === 'postgres') return _getSiteScoreInputsPg(siteCode, from, to);
  const db = getDB();
  const meetings = db.prepare(`SELECT meeting_date, dept_head_signed_at, site_it_signed_at FROM md_meetings WHERE site_code = ? COLLATE NOCASE`).all(siteCode);
  const issues = db.prepare(`SELECT i.status, i.target_date, i.closed_at, i.updated_at, m.meeting_date FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id WHERE m.site_code = ? COLLATE NOCASE`).all(siteCode);
  const actions = db.prepare(`SELECT a.status, a.target_date, a.closed_at, m.meeting_date FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id WHERE m.site_code = ? COLLATE NOCASE`).all(siteCode);
  return _computeMeetingsScoreInputs({ meetings, issues, actions }, { from, to });
}
```
…plus the pg fork. **⚠ THE PG FORK HAS ONE LOAD-BEARING CAST — get this wrong and the score is silently wrong in prod only.**

Verified against `db/postgres/meetings/001_init.sql`:
```sql
md_meetings:  meeting_date TEXT · dept_head_signed_at TEXT · site_it_signed_at TEXT · updated_at TIMESTAMPTZ
md_issues:    target_date TEXT  · closed_at TEXT           · updated_at TIMESTAMPTZ
md_actions:   target_date TEXT  · closed_at TEXT
```
Every date column the model compares is TEXT and carries over untouched — **except `md_issues.updated_at`, which is `TIMESTAMPTZ`**, and that is exactly what `_effClose` falls back to when `closed_at` is null. `services/pgDb.js` registers type parsers only for NUMERIC(1700) and BIGINT(20) — **nothing for 1114/1184** — so node-pg hands back a JS `Date`, and `_d10` yields `String(date).slice(0,10)` = `'Wed Jun 11'`. Then:
- `resolved`: `'Wed Jun 11' <= '2026-07-14'` → `'W'(0x57) > '2'(0x32)` → **false** → resolution collapses toward 0.
- `_openAt`: `!c || c > t` → `'Wed Jun 11' > '2026-07-14'` → **true** → the issue reads as still open → overdue inflates.

Two dims wrong in opposite directions, prod-only, no error. **So the pg fork MUST cast it:**
```sql
SELECT i.status, i.target_date, i.closed_at,
       to_char(i.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at,
       m.meeting_date
FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
WHERE lower(m.site_code) = lower(?)
```
Do NOT cast `closed_at` / `target_date` / `meeting_date` / `*_signed_at` — they are already TEXT.

**And test the fallback path** — neither existing test reaches it: sqlite declares `updated_at TEXT`, and 0 of the 132 fidelity-fixture issues take the fallback (every resolved/cancelled row has a `closed_at`). Add a case with `status='resolved', closed_at=NULL, updated_at=<timestamp>` to the integration test in Step 4 so `_effClose`'s fallback is actually exercised on both backends.

> **`md_actions` has no `site_code`** — it reaches the site via `meeting_id → md_meetings` (confirmed in sub-project 2). The JOINs above are per-collection and cannot fan out the others, since each returns its own row set.

- [ ] **Step 4: Add ONE integration test** on a seeded sqlite DB proving `getSiteScoreInputs` returns the same numbers as the pure core for the same data (this is the "test against the REAL reader" rule from CLAUDE.md).
- [ ] **Step 5: Run → PASS.** Paste output. Also run `tests/meetings-summary.test.js` + `tests/pptx-monthly-golden.test.js` → must be unchanged (this task is purely additive; if the golden moves, you edited an existing query — revert and add yours separately).
- [ ] **Step 6: Commit**
```bash
git add meetings-db.js tests/meetings-score-inputs.test.js
git commit --no-verify -m "feat(score): meetings getSiteScoreInputs — windowed reviews/resolution/signoff + as-of overdue"
```

---

## Task 4: `inspection-db.getSiteScoreInputs(siteCode, from, to)`

Supplies `inspections` + `findings` (critical+major), both **windowed** (sanctioned deviation 2).

**Files:** Modify `inspection-db.js`; Test `tests/inspection-score-inputs.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/inspection-score-inputs.test.js
'use strict';
process.env.INSPECTION_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const { _computeInspectionScoreInputs } = require('../inspection-db');

const W = { from: '2026-04-14', to: '2026-07-14' };

test('counts inspections in the window only', () => {
  const r = _computeInspectionScoreInputs({
    inspections: [{ inspection_date: '2026-05-01' }, { inspection_date: '2026-06-01' }, { inspection_date: '2026-01-01' }, { inspection_date: '2026-08-01' }],
    findings: [],
  }, W);
  assert.strictEqual(r.inspections, 2);
});

test('counts only critical+major findings, in the window only', () => {
  const r = _computeInspectionScoreInputs({
    inspections: [],
    findings: [
      { inspection_date: '2026-05-01', status: 'critical' },
      { inspection_date: '2026-05-01', status: 'major' },
      { inspection_date: '2026-05-01', status: 'minor' },   // not counted
      { inspection_date: '2026-05-01', status: 'opp' },     // not counted
      { inspection_date: '2026-05-01', status: 'ok' },      // not counted
      { inspection_date: '2026-01-01', status: 'critical' },// out of window
    ],
  }, W);
  assert.strictEqual(r.findings, 2);
});

// STRICT equality, exactly like the source (`f.status === 'critical' || f.status === 'major'`).
// Being case-insensitive here would be an UNDECLARED deviation: on a mixed-case
// row our score would silently disagree with the dashboard the user is looking
// at — the precise failure this sub-project exists to prevent. If mixed case
// ever appears, fix the DATA, not the comparison.
test('status matching is strict, like the source', () => {
  const r = _computeInspectionScoreInputs({ inspections: [], findings: [
    { inspection_date: '2026-05-01', status: 'CRITICAL' },   // NOT counted — strict, like theirs
    { inspection_date: '2026-05-01', status: null },
    { inspection_date: '2026-05-01', status: 'critical' },   // counted
  ] }, W);
  assert.strictEqual(r.findings, 1);
});

test('empty → zeros', () => {
  assert.deepStrictEqual(_computeInspectionScoreInputs({ inspections: [], findings: [] }, W), { inspections: 0, findings: 0 });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the pure core + `getSiteScoreInputs(siteCode, from, to)` (+pg fork), exporting both. The reader selects `inspection_date` from `insp_inspections` and joins `insp_findings` to its inspection for the date + status, scoped `site_code = ? COLLATE NOCASE` (sqlite) / `lower(site_code)=lower(?)` (pg). Windowing happens in the pure core.
  - `insp_findings.status` domain is `ok|na|minor|major|critical|opp` — count only `critical`+`major` with **strict `===`**, matching the source (see the test note).
  - **Check the pg column type of `inspection_date`** before writing the fork. If it is TIMESTAMPTZ (not TEXT), it must be `to_char(...,'YYYY-MM-DD')`'d — the same class of bug as `md_issues.updated_at` in Task 3. If it is TEXT, no cast.
- [ ] **Step 4: Add ONE integration test** against a seeded sqlite DB.
- [ ] **Step 5: Run → PASS.** Paste output. Run `tests/inspection-routes.test.js` + `tests/inspection-blobs.test.js` → unchanged.
- [ ] **Step 6: Commit**
```bash
git add inspection-db.js tests/inspection-score-inputs.test.js
git commit --no-verify -m "feat(score): inspection getSiteScoreInputs — windowed inspections + critical/major findings"
```

---

## Task 5: Wire the deps + the new score into `siteReport`

**Files:** Modify `services/siteReportDeps.js`, `services/siteReport.js`; Update `tests/site-report-deps.test.js`, `tests/site-report.test.js`

- [ ] **Step 1: Update the deps test**, then implement. `buildSiteReportDeps` gains:
```javascript
// The score's as-of date + its 3-month rolling window.
scoreInputs: async (code, p) => {
  const asOf = p.as_of || _asOfFor(p);                    // 'YYYY-MM-DD'
  const w = rollingWindow(asOf, 3);
  const m = await meetingsDb.getSiteScoreInputs(code, w.from, w.to);
  const i = await inspectionDb.getSiteScoreInputs(code, w.from, w.to);
  return { window: w, inputs: { reviews: m.reviews, resolution: m.resolution, overdue: m.overdue, inspections: i.inspections, findings: i.findings, signoff: m.signoff } };
},
// The same score recomputed as-of the PREVIOUS window's end, so trend_pts is
// like-for-like: asOf 2026-07-14 → this window {2026-04-14 … 2026-07-14} →
// prevAsOf 2026-04-13 → prev window {2026-01-13 … 2026-04-13}. Non-overlapping
// trailing 3 months. Returns null when the previous window has nothing to score
// against, so a site's first quarter shows "no trend" rather than a fabricated one.
prevScore: async (code, p) => {
  const asOf = p.as_of || _asOfFor(p);
  const prevAsOf = prevDay(rollingWindow(asOf, 3).from);   // NEVER `new Date(from) - 86400e3`
  const w = rollingWindow(prevAsOf, 3);
  const m = await meetingsDb.getSiteScoreInputs(code, w.from, w.to);
  const i = await inspectionDb.getSiteScoreInputs(code, w.from, w.to);
  if (!m.reviews && !m.raised && !i.inspections) return null;   // nothing happened → no trend
  return computeSiteScore(
    { reviews: m.reviews, resolution: m.resolution, overdue: m.overdue, inspections: i.inspections, findings: i.findings, signoff: m.signoff },
    w,
  ).score;
},
```
**`_asOfFor(period, now = new Date())`** — the report's as-of date: the **last day of the period's month, or `now` if that month is still running** (an MTD send must not score against a future date). **The clock MUST be injectable** — an internal `new Date()` makes the MTD branch untestable and the test rots daily. Implement + test both branches (closed month → month end; running month → the injected now).

- [ ] **Step 2: `services/siteReport.js`** — replace the `computeSiteScore(meetings, inspection, prev)` call with:
```javascript
const si = await _safe(() => deps.scoreInputs(siteCode, period), null, 'scoreInputs');
const prev = await _safe(() => deps.prevScore(siteCode, period), null, 'prevScore');
const score = si ? computeSiteScore(si.inputs, si.window, prev) : computeSiteScore({}, null, null);
```
Drop the old derivation from `meetings`/`inspection` blocks entirely — **the score no longer depends on those blocks**, only on `scoreInputs`. Keep the blocks; they are the report's narrative content.

**Also delete the now-false archaeology** in `services/siteReportDeps.js` (~lines 64-85): the carefully-argued `noActivity` comment block is keyed to the OLD monthly kpi names (`pvs_held`, `open_issues`, `resolved_month`…) and to `prevComposite`, both of which this task removes. Leaving it would be misleading comments describing code that no longer exists.

- [ ] **Step 3: Update `tests/site-report.test.js`** — add a `scoreInputs`/`prevScore` stub; assert `r.score.score`, `r.score.rag` (uppercase), `r.score.dims.length === 6`, `r.score.moves.length === 2`, `r.score.window`.
- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**
```bash
git add services/siteReportDeps.js services/siteReport.js tests/site-report-deps.test.js tests/site-report.test.js
git commit --no-verify -m "feat(score): wire the sbDims score + rolling window through siteReport"
```

---

## Task 6: Update the consumers (composer + live page)

**Files:** Modify `services/reportTemplates/coordinator.js`, `public/site-report.js`; Update `tests/report-template-coordinator.test.js`

- [ ] **Step 1: Update the composer test fixture** to the new `score` shape, then the composer:
  - `score.composite` → `score.score`; add `/ 12 pts` alongside.
  - `score.rag` is now `'GREEN'|'AMBER'|'RED'` (uppercase) — the RAG colour lookup must handle it.
  - `score.dimensions` (object of 0-100) → `score.dims` (array) — render each as `label · disp` with a 0/1/2 RAG chip (2=green, 1=amber, 0=red) and the `tip` as a title/subtext.
  - `score.two_moves[{text,gain_pts}]` → `score.moves[{n,gain,text}]` — `gain` is already a formatted STRING (`'+17 pts'` / `'sustain'`), do NOT re-format or append 'pts'.
  - Show `score.window` (`from → to`) in the score hero — the reader must know the score measures a 3-month window, not the report month. **This matters: the report's blocks are monthly but the score is quarterly-rolling. Say so on the page, or it reads as a contradiction.**
  - Keep escaping every free-text field (`tip`, `text`, `label` all render).
- [ ] **Step 2: Same for `public/site-report.js`.**
- [ ] **Step 3: Run → PASS.** Paste output.
- [ ] **Step 4: Commit**
```bash
git add services/reportTemplates/coordinator.js public/site-report.js tests/report-template-coordinator.test.js
git commit --no-verify -m "feat(score): render the sbDims dims/moves/window in the report + live page"
```

---

## Task 7: Fidelity check against the user's own data + docs + regression

- [ ] **Step 1: FIDELITY HARNESS — the point of the whole sub-project.**

  **Extraction recipe (already worked out — do not re-derive).** `EM_DATA` is NOT in the HTML body: the page only ever *reads* `window.EM_DATA` (4 reads, 0 assignments — it polls `setInterval` for an external loader). It lives in the artifact's bundler manifest:
  1. `JSON.parse(document.querySelector('script[type="__bundler/manifest"]').textContent)` — or the same via regex in Node.
  2. Take entry **`f74cec2d-0efe-4590-a0ff-4838cfaf7825`** (`application/javascript`, `compressed: true`).
  3. base64-decode → **gzip-inflate** (`zlib.gunzipSync`) → the payload starts `window.EM_DATA={…}`.
  4. Brace-match from the `=` to the end → parse → write `tests/fixtures/em-data.json`.

  **335,946 bytes — under 1 MB, so COMMIT it.** It is the oracle; a fidelity test whose fixture isn't in the repo protects nothing. Shape confirmed: `issues`/`actions` carry denormalised `site_code` + `meeting_date`; `findings` carry `site_code` + `inspection_date` — exactly what our pure cores expect.

  Write `tests/score-fidelity.test.js`: feed the fixture through `_computeMeetingsScoreInputs` + `_computeInspectionScoreInputs` + `computeSiteScore` **at THEIR window** (`from='2026-04-01'`, `to='2026-07-14'` — their `W0`/`ANCHOR`, NOT our rolling window) for each of their 5 sites, asserting `points`, `score`, `rag`, and `dims[].pts`:

  | site | points | score | rag | dims pts `[rev,res,ovd,insp,find,sign]` | dims vals |
  |---|---|---|---|---|---|
  | SML | 6 | 50 | AMBER | `[1,0,1,2,0,2]` | `[7,14,2,5,6,71]` |
  | SMI | 5 | 42 | RED | `[1,0,2,0,2,0]` | `[7,12,0,1,0,0]` |
  | HGO | 7 | 58 | AMBER | `[2,2,0,0,2,1]` | `[10,48,18,1,0,30]` |
  | MGO | 6 | 50 | AMBER | `[2,2,0,2,0,0]` | `[12,41,20,4,5,17]` |
  | SGO | 2 | 17 | RED | `[0,0,1,0,1,0]` | `[4,0,3,1,1,0]` |

  These were produced by running the user's own `sbDims` in Node against this exact fixture — they are the oracle, not our output. **If our numbers disagree, our code is wrong. Never edit this table to match us.**

  - **Deviation 2 is moot on this data — confirmed, don't go looking.** Min `inspection_date` in the fixture is `2026-05-18`; **0 of 12** inspections and **0** critical/major findings predate `2026-04-01`, so windowed ≡ unbounded at their `W0`.
  - **Known weak spot, state it in the test:** every site's top-2 gaps are both 0-pt here, so all 10 moves are `+17 pts` — this data never exercises the `+8` path or the asymmetric tie-break discriminatingly. Those are covered only by Task 2's synthetic tests. Don't mistake a green fidelity run for full moves coverage.
  - **This test is the proof that "implemented identically" is true.** If it cannot be made to pass, report BLOCKED rather than adjusting the expectations to match our output.
- [ ] **Step 2: Full regression.**
```bash
REPORTS_BACKEND=sqlite MEETINGS_BACKEND=sqlite INSPECTION_BACKEND=sqlite node --test --test-force-exit \
  tests/score-window.test.js tests/site-score.test.js tests/meetings-score-inputs.test.js \
  tests/inspection-score-inputs.test.js tests/score-fidelity.test.js tests/site-report.test.js \
  tests/site-report-deps.test.js tests/site-report-adapters.test.js tests/report-template-coordinator.test.js \
  tests/reporting-routes.smoke.test.js tests/reporting-send.smoke.test.js tests/send-reports-cli.test.js \
  tests/site-resolve.test.js tests/site-helpdesk.test.js tests/site-technicians.test.js \
  tests/meetings-contacts.test.js tests/report-config.test.js tests/report-directory.test.js \
  tests/report-sent-log.test.js tests/report-schedule.test.js tests/mailer.test.js tests/report-render.test.js
```
Plus the canaries: `tests/pptx-monthly-golden.test.js`, `tests/meetings-summary.test.js`, `tests/inspection-routes.test.js`, `tests/exec-summary.test.js`.
- [ ] **Step 3: Docs.** `CLAUDE.md`:
  - Current-state: "sub-project 3A landed — the site score is now the user's authoritative `sbDims` model (6 dims × 0/1/2 ÷ 12, RAG 70/45) over a **3-month rolling window**, replacing the earlier invented weighted model. Scores WILL differ from any report sent before this."
  - **Pitfall row:** *"The site score is a PORT of the user's own dashboard model (`IT Review Dashboard.html` → `sbDims`), not a design of ours. Do NOT retune thresholds, rounding, or the (deliberately asymmetric) moves tie-break — a score that diverges from the one the team sees on their dashboard is worse than no score. `tests/score-fidelity.test.js` pins it against their data."*
  - **Pitfall row:** *"Score window ≠ report window. The report's blocks are monthly/MTD; the score is a 3-month rolling window (the user's thresholds — `reviews ≥8`, `inspections ≥3` 'quarterly' — are calibrated for ~3 months). Both are surfaced with their window stated."*
- [ ] **Step 4: Commit + finish the branch.**

---

## Done criteria

- [ ] `tests/score-fidelity.test.js` proves our numbers equal the user's dashboard for their 5 sites on their data + their window. **This is the acceptance test.**
- [ ] All reporting tests green; `pptx-monthly-golden` unchanged.
- [ ] The score's window is visible wherever the score is shown.
- [ ] `CLAUDE.md` records that the model is a port and must not be retuned.

**Explicitly NOT in this sub-project:** the page port (3B — the 15 sections + the dc-runtime/CDN decision); the `composite()` leaderboard model (their second model — still theirs, still different, still shown on their leaderboard); scheduling auto-send (4); the FM report (5).
