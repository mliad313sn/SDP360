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
- Control flow lives in **custom elements**: 32 × `<sc-for list="{{ kpis }}" as="k">`, 3 × `<sc-if value="{{ isDashboard }}">` (the 3 views), 4 × `sc-camel-on-click`.
- **Nesting is exactly 2 levels, in 6 places** — `eMatrix>row.cells`, `sbRows>r.cells`, `gapRows>g.segs`, `sbMoves>m.moves`, `briefSites>{s.deltas, s.stats, s.moves}`. **Never 3.**
- The markup is **~92% static** (42.9 KB, of which 3.5 KB is bindings; most of the mass is 304 inline `style=""` attributes).

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

// The 6 real nesting sites are exactly 2 deep — this is the contract.
test('sc-for nests 2 levels and the child scope shadows the parent', () => {
  const t = '<sc-for list="{{ rows }}" as="r"><tr><sc-for list="{{ r.cells }}" as="c"><td>{{ c.val }}</td></sc-for></tr></sc-for>';
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

test('sc-if wraps sc-for (the real page shape: view gate around panels)', () => {
  const t = '<sc-if value="{{ isDashboard }}"><sc-for list="{{ xs }}" as="x"><li>{{ x.n }}</li></sc-for></sc-if>';
  assert.strictEqual(renderTemplate(t, { isDashboard: true, xs: [{ n: 7 }] }), '<li>7</li>');
  assert.strictEqual(renderTemplate(t, { isDashboard: false, xs: [{ n: 7 }] }), '');
});

test('bindings inside attributes are escaped too', () => {
  assert.strictEqual(renderTemplate('<div style="color:{{ c }}"></div>', { c: '#2f7d4f' }),
    '<div style="color:#2f7d4f"></div>');
  // an attacker-controlled value must not break out of the attribute
  assert.ok(!renderTemplate('<div title="{{ t }}"></div>', { t: '" onload="x' }).includes('onload="x'));
});
```

- [ ] **Step 2: Run → FAIL.** `node --test --test-force-exit tests/review-render.test.js`

- [ ] **Step 3: Implement.** `public/it-review.js` must be `require`-able by the test **and** work in the browser. Use the house pattern:
```javascript
if (typeof module !== 'undefined' && module.exports) module.exports = { renderTemplate, _resolve, _escape, … };
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
2. **Page route** — next to the `exec-view.html` handler at **`server.js:1207`**. Signature is `sendHtmlPage(res, name, injectApiKey, fallbackMsg)` (**`server.js:1179`**):
```javascript
app.get('/it-review.html', (req, res) => {
  sendHtmlPage(res, 'it-review.html', false, 'IT Review dashboard unavailable');
});
```
`injectApiKey = false` — the page uses the session cookie, like `exec-view.html`/`site-report.html`.
3. **API route** — in the existing `// ── Reporting suite ──` block, alongside `GET /api/reports/site-data`. Copy that route's shape exactly (`requireReportSession`, the `rdb` handle, the try/catch → 500):
```javascript
app.get('/api/reports/review-data', requireReportSession, async (req, res) => {
  try {
    const { loadReviewData } = require('./services/reviewData');
    const { buildReviewVals } = require('./services/reviewDashboard');
    const asOf   = String(req.query.asOf || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.asOf : _todayISO();
    const view   = ['dashboard', 'scoreboard', 'brief'].includes(req.query.view) ? req.query.view : 'dashboard';
    const period = ['week', 'month', 'quarter', 'semester'].includes(req.query.period) ? req.query.period : 'week';
    const site   = String(req.query.site || 'ALL');
    const D = await loadReviewData(asOf);
    res.json(buildReviewVals(D, { view, period, site, asOf }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```
**Whitelist `view`/`period`/`site`/`asOf`** — they reach the model; never pass raw query through.

> `_todayISO()` may not exist — check. If not, inline `new Date().toISOString().slice(0,10)`. Do NOT add a helper to `server.js` beyond the 3 approved changes.

### Smoke test
Copy the boot + auth harness from `tests/reporting-routes.smoke.test.js` (it forces `REPORTS_BACKEND=sqlite` at the top — keep that, and add `MEETINGS_BACKEND`/`INSPECTION_BACKEND=sqlite`). **Reuse its `after()` teardown block** — it carries a documented recipe for a Node-24/Windows libuv abort that hits short smoke files that boot+fetch.

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

Work **from** `docs/reference/it-review-dashboard.template.html` (his markup, 100 KB). It is ~92% static — most of the work is carrying the markup across, not authoring it.

- [ ] **Step 1: Build the page.**
  - `<head>`: `_tokens.css`, and **his `<helmet>` CSS block** (14.2 KB of design-system tokens + `@font-face`) — **strip the `@font-face` rules** and any `url(...)` pointing outside our origin; his fonts are artifact blobs we don't have. Fall back to our `--font-sans`. **No external requests of any kind** (verify: no `http://`, no `unpkg`, no CDN, no remote `url(`).
  - Body: his 4 regions — HEADER (controls) + the 3 `<sc-if>` views (DASHBOARD / SCOREBOARD / WEEKLY BRIEF). Carry the 32 `<sc-for>` loops and the 219 bindings across **verbatim** — same keys, same names. Our `buildReviewVals` emits exactly his 61 keys, so a faithful template just works.
  - `<script src="it-review.js" defer></script>` — external, so `injectAssetVersion` versions it (per CLAUDE.md's asset-caching recipe).
  - **The 4 `sc-camel-on-click` sites become links.** `viewOpts`/`periodOpts`/`siteOpts`/`leaderboard[].pick` → `<a href="?view={{ v.key }}">` etc., built from the `key` field 3B-2a emits. Preserve the current selection's styling (`bg`/`fg` are already in the option objects).
  - On load: read `view`/`period`/`site`/`asOf` from `location.search`, `fetch('/api/reports/review-data?…', {credentials:'same-origin'})`, `renderTemplate(tpl, vals)`, mount. Handle fetch failure with a visible message — never a blank page.
  - **The score's window must be visible** wherever a score shows: our `sbDims` scores a **3-month rolling window**, his hardcoded `W0`. Say so on the page (a line in the scoreboard header) or it silently misleads.

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
- [ ] **Step 2: `CLAUDE.md`** — current state (3B-2b landed: the live page) + a pitfall:
  *"`public/it-review.js` is a 3-primitive renderer, deliberately NOT a template engine: the authoritative template has 219 pure `{{key}}`/`{{obj.field}}` bindings, ≤1 dot, 32 `<sc-for>`, 3 `<sc-if>`, and nesting exactly 2 deep. Do not generalise it; do not add a raw/unescaped mode — every binding renders untrusted PV/ticket free-text."*
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
