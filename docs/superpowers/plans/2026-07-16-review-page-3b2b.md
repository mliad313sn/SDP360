# Sub-project 3B-2b — The live IT Review page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the boss's IT Review Dashboard as a live page fed from our databases — his 15 panels, his numbers, none of his runtime.

**Architecture:** 3B-2a proved `loadReviewData(asOf)` → `D` and `buildReviewVals(D, opts)` → his 61-key flat object (all 61 keys byte-identical to his own code across 72 view×period×site combos). This slice adds the last mile: an API route that returns those vals, a ~250-line renderer implementing the 3 template primitives, and the page. **No dc-runtime, no React, no Babel, no unpkg** — his logic was separable and we ported it; his template is mechanical and we re-implement it.

**Tech Stack:** Node.js + Express, vanilla browser JS (no framework), `node --test --test-force-exit`.

**Branch:** `feat/review-page` (from `main`)

---

## User-approved scope for `server.js`
The user's standing rule is that touching an existing module needs their approval. **They approved exactly this:**

| File | Change |
|---|---|
| `server.js` | +1 route `GET /it-review.html`, +1 entry in the `_htmlCache` boot-load array, +1 route `GET /api/reports/review-data` |

**Nothing else in `server.js`. No CSP change** (none is needed — no `unsafe-eval`, no CDN). If a task seems to need more, STOP and report.

---

## The template contract (reviewer-verified against `docs/reference/it-review-dashboard.template.html`)

**It is mechanical — no template engine, no expression parser.**

- **219 unique bindings, ALL pure** `{{ key }}` / `{{ obj.field }}`. Every one matches `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$`. **Max one dot** — never `{{ a.b.c }}`.
- **Zero** `{{#each}}`, `{{/if}}`, `x-for`, `v-if`, filters, helpers, partials.
- Control flow lives in **custom elements**: 32 × `<sc-for>`, 3 × `<sc-if>` (the 3 views), 4 × `sc-camel-on-click`.
- **Nesting is exactly 2 levels, in 7 nested-loop sites** (5 distinct parents) — `eMatrix>row.cells`, `sbRows>r.cells`, `gapRows>g.segs`, `sbMoves>m.moves`, `briefSites>{s.deltas, s.stats, s.moves}`. **Never 3.**
- The markup is **95.9% static** — 85.1 KB of body markup, of which only 3.5 KB is bindings; most of the mass is 304 inline `style=""` attributes. (Task 3's carry-across is 85 KB, not 43.)

### ⚠️ THE REAL TAG GRAMMAR — every tag carries an extra attribute
**No `<sc-for>` or `<sc-if>` in the template uses the bare form.** Verified:
```html
<sc-for list="{{ kpis }}" as="k" hint-placeholder-count="8">
<sc-if value="{{ isDashboard }}" hint-placeholder-val="{{ true }}">
```
All **32** `sc-for` carry `hint-placeholder-count=`; all **3** `sc-if` carry `hint-placeholder-val=`. A reviewer built the renderer that a bare-form grammar accepts and ran it against the real template: **12/12 unit tests green, 0/32 loops matched, 0/3 view gates matched** — the page ships as inert `<sc-for>` custom elements, no repetition, no view gating, with a fully green suite.

**Therefore the grammar MUST tolerate arbitrary extra attributes in any order** on both tags. Task 1's fixtures must include the real forms (they do, below) — otherwise Task 1's green means nothing.

### ⚠️ PROCESSING ORDER IS LOAD-BEARING: control flow BEFORE interpolation
`hint-placeholder-val="{{ true }}"` puts a `{{ }}` **inside** the `sc-if` tag. Interpolate first and it becomes `<sc-if value="true" hint-placeholder-val="">` — the `value="{{ … }}"` matcher then fails outright and the gate silently vanishes.
**Resolve `<sc-for>`/`<sc-if>` first, interpolate the result second.**

Also: `true` / `false` are 2 of the 219 "bindings" — they are **literals, not paths**. `_resolve('true')` → `undefined`. Harmless *provided* the `hint-placeholder-*` attributes never reach interpolation (they don't, if you strip them or ignore them during the control-flow pass).

**So the renderer needs exactly three primitives:**
1. `{{ path }}` — resolve ≤1 dot against the scope chain, stringify, **HTML-escape**.
2. `<sc-for list as>` — repeat children with a scope var; **one level of nesting** (child scope shadows parent).
3. `<sc-if value>` — truthy gate. No `else`, no expressions.

### The `pick` closures — the one genuinely non-portable piece
`viewOpts`/`periodOpts`/`siteOpts`/`leaderboard[].pick` bind live `setState` closures via `sc-camel-on-click`. 3B-2a **drops `pick` and emits a `key` instead** (approved). Turn each into a **link/query-param**: `?view=…&period=…&site=…`. The page is stateless; changing a control navigates.

---

## File Structure

| File | Responsibility |
|---|---|
| `public/it-review.js` | **NEW.** The 3-primitive renderer + fetch + mount. ~250 lines, vanilla. |
| `public/it-review.html` | **NEW.** His template, re-expressed. Static markup + the `<sc-for>`/`<sc-if>`/`{{ }}` the renderer understands. |
| `server.js` | **MODIFY — approved.** The 3 additions above, nothing more. |
| `tests/review-render.test.js` | **NEW.** The renderer's 3 primitives (pure string→string; no DOM needed). |
| `tests/review-page.smoke.test.js` | **NEW.** The API route + the page route. |

---

## Task 1: the renderer's 3 primitives (pure, TDD)

Do this **first and standalone** — it is pure string→string and needs no DOM, no server, no data. Get it right before any HTML exists.

**Files:** Create `public/it-review.js`; Create `tests/review-render.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/review-render.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderTemplate, _resolve, _escape } = require('../public/it-review.js');

test('_escape neutralises HTML', () => {
  assert.strictEqual(_escape('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.strictEqual(_escape('a & b'), 'a &amp; b');
  assert.strictEqual(_escape('"q"'), '&quot;q&quot;');
  assert.strictEqual(_escape(null), '');
  assert.strictEqual(_escape(0), '0');          // 0 must render, not vanish
  assert.strictEqual(_escape(false), 'false');
});

test('_resolve handles a plain key and ONE dot', () => {
  const scope = [{ sbAvg: 43, r: { score: 58 } }];
  assert.strictEqual(_resolve('sbAvg', scope), 43);
  assert.strictEqual(_resolve('r.score', scope), 58);
});

test('_resolve walks the scope chain, innermost first', () => {
  const scope = [{ x: 'outer', y: 'only-outer' }, { x: 'inner' }];
  assert.strictEqual(_resolve('x', scope), 'inner');
  assert.strictEqual(_resolve('y', scope), 'only-outer');
});

test('_resolve on a missing path yields undefined, never throws', () => {
  assert.strictEqual(_resolve('nope', [{}]), undefined);
  assert.strictEqual(_resolve('a.b', [{}]), undefined);
});

test('{{ }} substitutes and escapes', () => {
  assert.strictEqual(renderTemplate('<p>{{ n }}</p>', { n: 43 }), '<p>43</p>');
  assert.strictEqual(renderTemplate('<p>{{ t }}</p>', { t: '<b>x</b>' }), '<p>&lt;b&gt;x&lt;/b&gt;</p>');
});

test('a missing binding renders empty, not "undefined"', () => {
  assert.strictEqual(renderTemplate('<p>{{ nope }}</p>', {}), '<p></p>');
});

test('sc-for repeats its children', () => {
  const t = '<ul><sc-for list="{{ xs }}" as="x"><li>{{ x.n }}</li></sc-for></ul>';
  assert.strictEqual(renderTemplate(t, { xs: [{ n: 1 }, { n: 2 }] }), '<ul><li>1</li><li>2</li></ul>');
});

test('sc-for over an empty/missing list emits nothing', () => {
  const t = '<ul><sc-for list="{{ xs }}" as="x"><li>{{ x.n }}</li></sc-for></ul>';
  assert.strictEqual(renderTemplate(t, { xs: [] }), '<ul></ul>');
  assert.strictEqual(renderTemplate(t, {}), '<ul></ul>');
});

// ⚠️ THE TESTS THAT ACTUALLY MATTER — the REAL tag forms.
// A reviewer built the renderer the bare-form fixtures accept and ran it on the
// real template: 12/12 green, 0/32 loops matched, 0/3 gates matched. NO tag in
// the template uses the bare form. If these two go red, the page ships inert.
test('REAL FORM: sc-for tolerates a trailing hint attribute (all 32 carry one)', () => {
  const t = '<ul><sc-for list="{{ kpis }}" as="k" hint-placeholder-count="8"><li>{{ k.label }}</li></sc-for></ul>';
  assert.strictEqual(renderTemplate(t, { kpis: [{ label: 'Raised' }, { label: 'Open' }] }),
    '<ul><li>Raised</li><li>Open</li></ul>');
});

test('REAL FORM: sc-if tolerates hint-placeholder-val, which itself contains {{ }} (all 3 carry it)', () => {
  // The {{ true }} inside the TAG is why control flow must resolve BEFORE
  // interpolation — interpolate first and the value="{{ }}" matcher never fires.
  const t = '<sc-if value="{{ isDashboard }}" hint-placeholder-val="{{ true }}"><b>panel</b></sc-if>';
  assert.strictEqual(renderTemplate(t, { isDashboard: true }), '<b>panel</b>');
  assert.strictEqual(renderTemplate(t, { isDashboard: false }), '');
});

test('REAL FORM: attribute order is not assumed', () => {
  const t = '<sc-for as="x" hint-placeholder-count="2" list="{{ xs }}"><i>{{ x.n }}</i></sc-for>';
  assert.strictEqual(renderTemplate(t, { xs: [{ n: 5 }] }), '<i>5</i>');
});

test('the hint attributes never leak into the output', () => {
  const t = '<sc-if value="{{ on }}" hint-placeholder-val="{{ true }}"><sc-for list="{{ xs }}" as="x" hint-placeholder-count="1"><i>{{ x.n }}</i></sc-for></sc-if>';
  const out = renderTemplate(t, { on: true, xs: [{ n: 1 }] });
  assert.strictEqual(out, '<i>1</i>');
  assert.ok(!/hint-placeholder/.test(out));
  assert.ok(!/sc-(for|if)/.test(out), 'no inert custom elements may survive');
});

// The 7 real nesting sites are exactly 2 deep — this is the contract.
test('sc-for nests 2 levels and the child scope shadows the parent', () => {
  const t = '<sc-for list="{{ rows }}" as="r" hint-placeholder-count="5"><tr><sc-for list="{{ r.cells }}" as="c" hint-placeholder-count="6"><td>{{ c.val }}</td></sc-for></tr></sc-for>';
  const out = renderTemplate(t, { rows: [{ cells: [{ val: 'a' }, { val: 'b' }] }, { cells: [{ val: 'c' }] }] });
  assert.strictEqual(out, '<tr><td>a</td><td>b</td></tr><tr><td>c</td></tr>');
});

test('the outer scope is still visible inside sc-for', () => {
  const t = '<sc-for list="{{ xs }}" as="x"><i>{{ title }}:{{ x.n }}</i></sc-for>';
  assert.strictEqual(renderTemplate(t, { title: 'T', xs: [{ n: 1 }] }), '<i>T:1</i>');
});

test('sc-if keeps children when truthy, drops them when falsy', () => {
  const t = '<sc-if value="{{ on }}"><b>yes</b></sc-if>';
  assert.strictEqual(renderTemplate(t, { on: true }), '<b>yes</b>');
  assert.strictEqual(renderTemplate(t, { on: false }), '');
  assert.strictEqual(renderTemplate(t, {}), '');
});

test('sc-if wraps sc-for — the real page shape, in the real forms', () => {
  const t = '<sc-if value="{{ isDashboard }}" hint-placeholder-val="{{ true }}"><sc-for list="{{ xs }}" as="x" hint-placeholder-count="3"><li>{{ x.n }}</li></sc-for></sc-if>';
  assert.strictEqual(renderTemplate(t, { isDashboard: true, xs: [{ n: 7 }] }), '<li>7</li>');
  assert.strictEqual(renderTemplate(t, { isDashboard: false, xs: [{ n: 7 }] }), '');
});

// ⚠️ THE BACKSTOP — run the renderer against the REAL template. This is the test
// the bare-form suite could NOT fail, and it is the reason Issue 1 existed.
// It is SELF-CONTAINED on purpose: no helper, no Task-3 dependency, nothing to
// "check later". If it crashes rather than asserting, the obvious fix is to
// delete it — which deletes exactly the protection it provides. Don't.
//
// Loops all 3 views: with view='dashboard' the 14 scoreboard/brief loops sit
// inside a FALSY sc-if and are dropped without ever being parsed, so a
// dashboard-only run passes trivially for them (18 of 32 loops exercised).
// Three runs cover all 32 and catch a brief-only binding typo. Same cost.
test('BACKSTOP: the real template leaves no unprocessed control tags, in any view', () => {
  const fs = require('fs'); const path = require('path');
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'docs', 'reference', 'it-review-dashboard.template.html'), 'utf8');
  // Markup region = everything after </helmet> (his CSS block; closes ~template
  // line 357). Inlined, NOT a helper — keeps this test self-contained.
  const markup = tpl.slice(tpl.indexOf('</helmet>') + '</helmet>'.length);
  assert.ok(markup.length > 50000, 'markup region extraction failed — check the </helmet> marker');

  const EM = require('./fixtures/em-data.json');
  const { buildReviewVals } = require('../services/reviewDashboard');
  for (const view of ['dashboard', 'scoreboard', 'brief']) {
    const vals = buildReviewVals(EM, { view, period: 'week', site: 'ALL', asOf: '2026-07-14' });
    const out = renderTemplate(markup, vals);
    assert.ok(!/<sc-for/.test(out), `[${view}] unprocessed sc-for survived — the grammar does not match the real tags`);
    assert.ok(!/<sc-if/.test(out), `[${view}] unprocessed sc-if survived`);
    assert.ok(!/\{\{/.test(out), `[${view}] unsubstituted binding survived`);
    assert.ok(!/hint-placeholder/.test(out), `[${view}] hint attribute leaked into the output`);
  }
});

test('bindings inside attributes are escaped too', () => {
  assert.strictEqual(renderTemplate('<div style="color:{{ c }}"></div>', { c: '#2f7d4f' }),
    '<div style="color:#2f7d4f"></div>');
  // an attacker-controlled value must not break out of the attribute
  assert.ok(!renderTemplate('<div title="{{ t }}"></div>', { t: '" onload="x' }).includes('onload="x'));
});
```

- [ ] **Step 2: Run → FAIL.** `node --test --test-force-exit tests/review-render.test.js`

- [ ] **Step 3: Implement.** `public/it-review.js` must be `require`-able by the test **and** work in the browser. The house precedent is `public/lib/parse-actions-csv.js` (+ `tests/parse-actions-csv.test.js`) — but note **that file is PURE**; ours also fetches and mounts, and there is no precedent in `public/` for a required file that mounts. So **guard BOTH sides**:
```javascript
if (typeof module !== 'undefined' && module.exports) module.exports = { renderTemplate, _resolve, _escape, … };
if (typeof window !== 'undefined') window.ITReview = { renderTemplate, … };
// ⚠️ NOTHING may touch document/fetch at MODULE SCOPE — require() would throw
// `ReferenceError: document is not defined` and Task 1 Step 2 fails on a crash
// instead of a clean assertion, so Step 4 never goes green.
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', boot);
```
Requirements:
- **Escape every interpolation, always.** Panel text is ticket/PV free-text (issue titles, champion names, categories) — untrusted. There is no "raw" mode; nothing in his 219 bindings needs one.
- Process `<sc-for>` / `<sc-if>` by **matching balanced tags**, innermost-first or via a small recursive parse. Nesting is only ever 2 deep — do not build a general parser.
- `_resolve` walks a scope **chain** (array of frames, innermost last) so `{{ title }}` still resolves inside a loop.
- **`0` and `false` must render**; only `null`/`undefined`/missing render empty.

- [ ] **Step 4: Run → PASS.** Paste output.
- [ ] **Step 5: Commit**
```bash
git add public/it-review.js tests/review-render.test.js
git commit --no-verify -m "feat(review): 3-primitive template renderer ({{}}, sc-for, sc-if)"
```

---

## Task 2: `GET /api/reports/review-data` + the page route

**Files:** Modify `server.js` (the 3 approved additions); Create `tests/review-page.smoke.test.js`

### The exact wiring (verified in `server.js` this session)
1. **Boot-load** — add `'it-review.html'` to the array at **`server.js:1169-1175`** (the `.forEach(loadHtml)` list).
2. **Page route** — copy **`site-report.html` (`server.js:1211-1216`)**, NOT `exec-view.html`. `site-report` is the exact precedent: `injectApiKey=false` + a `requireReportSession`'d data route. `exec-view.html` is the app's **one public route** — citing it invites the wrong auth read. Signature is `sendHtmlPage(res, name, injectApiKey, fallbackMsg)` (**`server.js:1179`**):
```javascript
app.get('/it-review.html', (req, res) => {
  sendHtmlPage(res, 'it-review.html', false, 'IT Review dashboard unavailable');
});
```
`injectApiKey = false` — the page uses the session cookie.
3. **API route** — in the existing `// ── Reporting suite ──` block, alongside `GET /api/reports/site-data`. Copy that route's shape exactly (`requireReportSession`, the `rdb` handle, the try/catch → 500):
```javascript
app.get('/api/reports/review-data', requireReportSession, async (req, res) => {
  try {
    const { loadReviewData } = require('./services/reviewData');
    const { buildReviewVals } = require('./services/reviewDashboard');
    // inline, NOT a helper — _todayISO() does not exist in server.js (verified),
    // and adding one would breach the 3-change budget.
    const asOf   = String(req.query.asOf || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.asOf : new Date().toISOString().slice(0, 10);
    const view   = ['dashboard', 'scoreboard', 'brief'].includes(req.query.view) ? req.query.view : 'dashboard';
    const period = ['week', 'month', 'quarter', 'semester'].includes(req.query.period) ? req.query.period : 'week';
    const site   = String(req.query.site || 'ALL');
    const D = await loadReviewData(asOf);
    res.json(buildReviewVals(D, { view, period, site, asOf }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```
**Whitelist `view`/`period`/`site`/`asOf`** — they reach the model; never pass raw query through.

> **Settled: `_todayISO()` does NOT exist in `server.js`** (verified). The block above inlines it. Copying an earlier draft that called `_todayISO()` would throw `ReferenceError` on every request that omits `asOf` — i.e. the default path — surfacing as the route's own 500.

### Smoke test
Copy the boot + auth harness from `tests/reporting-routes.smoke.test.js`. It already pins `REPORTS_BACKEND` + `MEETINGS_BACKEND`; **add `INSPECTION_BACKEND=sqlite`** — `loadReviewData` reads BOTH handles (`services/reviewData.js:114-115`), so without it the inspection side hits the un-inited pg adapter. Reuse its `after()` teardown (a `server.close()`; the `--test-force-exit` rationale is in that file's header comment).

Assert:
- `GET /api/reports/review-data` (authed) → 200; body has the panel keys (`leaderboard`, `sbRows`, `kpis`, `isDashboard`).
- `?view=scoreboard` → `isScoreboard === true`, `isDashboard === false`.
- `?view=../../etc` → falls back to `dashboard` (whitelist holds, no throw).
- `?asOf=garbage` → falls back to today, 200 (not a 500).
- WITHOUT auth → **401**.
- `GET /it-review.html` → 200, `text/html`.

- [ ] **Step 1: Write the smoke test → run → PASTE failing.**
- [ ] **Step 2: Make the 3 `server.js` additions.** `node --check server.js` clean.
- [ ] **Step 3: Run → PASS.** Paste output.
- [ ] **Step 4: Regression** — `REPORTS_BACKEND=sqlite MEETINGS_BACKEND=sqlite INSPECTION_BACKEND=sqlite node --test --test-force-exit tests/reporting-routes.smoke.test.js tests/reporting-send.smoke.test.js tests/exec-routes.smoke.test.js` → unchanged.
- [ ] **Step 5: Commit**
```bash
git add server.js tests/review-page.smoke.test.js
git commit --no-verify -m "feat(review): /api/reports/review-data + the it-review page route"
```

---

## Task 3: `public/it-review.html` — his template, re-expressed

**Files:** Create `public/it-review.html`

Work **from** `docs/reference/it-review-dashboard.template.html` (his markup, 100 KB). It is **95.9% static — 85.1 KB of body markup, of which only 3.5 KB is bindings**. Most of the work is carrying the markup across, not authoring it — but budget for 85 KB, not 43.

- [ ] **Step 1: Build the page.**
  - `<head>`: `_tokens.css`, and **his `<helmet>` CSS block** (14.2 KB of design-system tokens + `@font-face`) — **strip the `@font-face` rules** and any `url(...)` pointing outside our origin; his fonts are artifact blobs we don't have. Fall back to our `--font-sans`. **No external requests of any kind** (verify: no `http://`, no `unpkg`, no CDN, no remote `url(`).
  - Body: his 4 regions — HEADER (controls) + the 3 `<sc-if>` views (DASHBOARD / SCOREBOARD / WEEKLY BRIEF). Carry the 32 `<sc-for>` loops and the 219 bindings across **verbatim** — same keys, same names. Our `buildReviewVals` emits exactly his 61 keys, so a faithful template just works.
  - `<script src="it-review.js" defer></script>` — external, so `injectAssetVersion` versions it (per CLAUDE.md's asset-caching recipe).
  - **The 4 `sc-camel-on-click` sites become links.** `viewOpts`/`periodOpts`/`siteOpts`/`leaderboard[].pick` → `<a href="?view={{ v.key }}">` etc., built from the `key` field 3B-2a emits. Preserve the current selection's styling (`bg`/`fg` are already in the option objects).
  - On load: read `view`/`period`/`site`/`asOf` from `location.search`, `fetch('/api/reports/review-data?…', {credentials:'same-origin'})`, `renderTemplate(tpl, vals)`, mount. Handle fetch failure with a visible message — never a blank page.
  - **Strip the authoring attributes**: 12 × `data-screen-label` (`"Dashboard"`, `"KPI band"`, …) and the `hint-placeholder-*` the renderer ignores. Inert, but they don't belong in a shipped page.
  - **The score's window must be visible** wherever a score shows: our `sbDims` scores a **3-month rolling window**, his hardcoded `W0`. Say so on the page (a line in the scoreboard header) or it silently misleads.
  - **⚠️ And say what `?asOf=` actually moves.** `windows(period)` pins to `ANCHOR`, not `asOf` (`reviewDashboard.js:110` — his own line, ported for fidelity). So `?asOf=` moves the **scoreboard** (via `sbMeasure`) but **not** the period windows. Unexplained, that reads as a bug. One line next to the 3-month disclosure.

- [ ] **Step 2: Verify in the browser.** Start the dev server (`preview_start`), load `/it-review.html`, and check with `read_console_messages` (no errors) + `read_page` (panels render with real values, not `undefined`/`NaN`). Try `?view=scoreboard` and `?site=HGO`. **Screenshot as proof.**
  - The dev `.env` pins all backends to postgres, so the app will read live PG. If PG isn't reachable, run the server with the sqlite backends set instead — the point is to see the page render.
- [ ] **Step 3: Commit**
```bash
git add public/it-review.html
git commit --no-verify -m "feat(review): the live IT Review page — his 15 panels, no dc-runtime/React/CDN"
```

---

## Task 4: Regression + docs

- [ ] **Step 1: Full regression** — the whole reporting+score+review suite (18+ files) plus canaries (`pptx-monthly-golden`, `meetings-summary`, `inspection-routes`, `exec-summary`) unchanged. **Golden NOT regenerated.**
- [ ] **Step 2: `CLAUDE.md`** — current state (3B-2b landed: the live page) + a pitfall. **This table is the only artifact that outlives the plan — put the two lessons that cost two review rounds in it, not just the counts:**
  *"`public/it-review.js` is a 3-primitive renderer, deliberately NOT a template engine: the authoritative template has 219 pure `{{key}}`/`{{obj.field}}` bindings, ≤1 dot, 32 `<sc-for>`, 3 `<sc-if>`, nesting exactly 2 deep. Do not generalise it; do not add a raw/unescaped mode — every binding renders untrusted PV/ticket free-text. **Two non-obvious invariants:** (1) the grammar MUST tolerate arbitrary extra attributes in any order — every real tag carries `hint-placeholder-*`, and a bare-form grammar passes its unit tests while matching 0 of 32 loops, shipping the page inert; (2) control flow MUST resolve BEFORE interpolation — `hint-placeholder-val="{{ true }}"` puts a binding inside the `sc-if` tag, so interpolating first corrupts the tag and the gate silently vanishes. `tests/review-render.test.js`'s BACKSTOP runs the renderer over the real template in all 3 views and is the only test that catches either — never delete it to get green."*
  Plus the deploy note: `server.js` + `it-review.html` are `_htmlCache`/server surfaces → after the ZIP, `pm2 stop` → wait → `start` (NOT reload).
- [ ] **Step 3: Commit + finish the branch.**

---

## Done criteria

- [ ] The renderer's 3 primitives are unit-tested, including 2-level nesting, scope shadowing, and escaping in both text and attributes.
- [ ] `GET /api/reports/review-data` is auth-gated, whitelists its 4 params, and returns the 61 keys.
- [ ] `/it-review.html` renders his 15 panels from live data — screenshot proof, no console errors.
- [ ] **Zero external requests** — no dc-runtime, no React, no Babel, no unpkg, no remote fonts.
- [ ] The score's 3-month window is stated on the page.
- [ ] `server.js` changed in exactly the 3 approved ways.
- [ ] Full suite green; canaries unchanged.

**Deferred:** sub-project 4 (scheduled auto-send) · sub-project 5 (the Finance Manager report). Still open for the user, not fixable in code: his two models disagree (3 of 5 sites, near-inverted rankings) — a conversation with the author; and `eMetrics.cov`'s hardcoded `/12` with no clamp can push `composite` >100 on our 15-department fleet.
