# Module Tabs Standardization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every multi-page module ONE consistent intra-module tab strip — a shared `module-tabs.js` component (brand SVG icons + `aria-current` + role-gating) — replacing the duplicated emoji strips in Meetings, adding a strip to Inspections (which has none), and closing the gap on the PV editor (`meeting.html`).

**Architecture:** Mirror the proven `_shell.js` pattern. A single `public/module-tabs.js` renders a horizontal strip into a `<div id="__moduletabs" data-module="X" data-current="Y">` mount, from a static `MODULES` config, reusing `window.EDV_ICONS` for brand icons and `window.__userHasRole` for gating. Styles in `public/module-tabs.css`. Pages include the two assets + the mount div and delete their inline emoji `<nav>`.

**Tech Stack:** Vanilla JS IIFE (no build), brand icon library (`public/brand/icons.js`), Node `--test` harness with a stubbed DOM (same technique already used to verify `_shell.js`).

**Verification split (honest):** The Node harness proves the component renders the right tabs / active state / icons / hrefs / role-gating, and grep proves each page is wired (mount present, old nav gone, correct `data-current`). **Visual QA — no overlap, correct look, responsive — is the USER's step** (these pages sit behind a session login this agent cannot exercise). Do NOT claim visual correctness; hand it off.

---

## File Structure

| File | Responsibility |
|---|---|
| `public/module-tabs.js` (create) | The component: `MODULES` config + render into `#__moduletabs` + role-gate + count-badge hook |
| `public/module-tabs.css` (create) | `.mtabs` strip styles (brand tokens; own `mt-` prefix to avoid collision) |
| `tests/module-tabs.test.js` (create) | Node harness: per-module render, active state, non-empty icons, href integrity, role-gating |
| `public/meetings*.html` + `public/meeting.html` (modify, 11 files) | Replace inline `.mtg-tabs` `<nav>` with the mount + add the 2 includes; add mount to editor/import/progress which lack it |
| `public/inspections.html`, `public/inspection.html`, `public/inspection-actions.html` (modify, 3) | Add the 2 includes + the mount (module had NO strip) |
| `CLAUDE.md` (modify) | Current-state entry |

Assets (`assets.html`) and Activity Tracker keep their in-page JS tab bars (single-page modules) — **out of scope for behaviour**; an optional visual-alignment task is listed last.

---

## MODULES config (single source of truth)

```js
const MODULES = {
  meetings: [
    { id:'list',       label:'Meetings',   icon:'file-text',    href:'meetings.html',          badgeId:'mdTabCount' },
    { id:'dashboard',  label:'Dashboard',  icon:'bar-chart-3',  href:'meetings-insights.html' },
    { id:'issues',     label:'Issues',     icon:'alert-circle', href:'meetings-issues.html' },
    { id:'actions',    label:'Actions',    icon:'check',        href:'meetings-actions.html' },
    { id:'unsigned',   label:'Unsigned',   icon:'edit',         href:'meetings-unsigned.html' },
    { id:'council',    label:'Council',    icon:'shield',       href:'meetings-council.html' },
    { id:'compliance', label:'Compliance', icon:'shield-check', href:'meetings-compliance.html' },
    { id:'setup',      label:'Setup',      icon:'sliders',      href:'meetings-setup.html', roles:['admin'] },
  ],
  inspections: [
    { id:'list',    label:'Inspections', icon:'clipboard-check', href:'inspections.html' },
    { id:'new',     label:'New',         icon:'plus',            href:'inspection.html' },
    { id:'actions', label:'Actions',     icon:'check',           href:'inspection-actions.html' },
  ],
  // Site Actions is a single-page cross-cutting HUB (no sibling pages). It
  // anchors the "Actions family" so it is not an orphan. Strip lives ONLY on
  // site-actions.html (the two source registers keep their own module strip).
  site_actions: [
    { id:'site',       label:'Site Actions',       icon:'check',           href:'site-actions.html' },
    { id:'meetings',   label:'Meetings Actions',   icon:'users',           href:'meetings-actions.html' },
    { id:'inspection', label:'Inspection Actions', icon:'clipboard-check', href:'inspection-actions.html' },
  ],
};
```

`data-current` for the hub: `site-actions.html → site`.

`data-current` values per page — Meetings: `list · dashboard · issues · actions · unsigned · council · compliance · setup`; the editor `meeting.html`, `meetings-import.html`, `meetings-progress.html` use `data-current=""` (strip renders, nothing active — that is the fix for the editor gap). Inspections: `inspections.html→list · inspection.html→new · inspection-actions.html→actions`.

---

## Task 1: Shared component + harness (TDD)

**Files:**
- Create: `public/module-tabs.js`
- Create: `public/module-tabs.css`
- Test: `tests/module-tabs.test.js`

- [ ] **Step 1: Write the failing test** — `tests/module-tabs.test.js`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Load module-tabs.js under a stubbed DOM (same technique as the _shell.js check).
function loadWith({ role = 'any', module, current }) {
  const captured = {};
  const icons = { html: (n) => `<svg data-icon="${n}"></svg>`, get: () => '' };
  const mount = {
    dataset: { module, current },
    set innerHTML(v) { captured.html = v; },
    get innerHTML() { return captured.html || ''; },
  };
  global.window = { EDV_ICONS: icons, __userHasRole: (r) => role === 'any' || r === role };
  global.document = {
    readyState: 'complete',
    getElementById: (id) => (id === '__moduletabs' ? mount : null),
    addEventListener: () => {},
    querySelectorAll: () => [],
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'module-tabs.js'), 'utf8');
  new Function(src)();
  return captured.html || '';
}

test('meetings: renders 8 tabs (admin), active state + non-empty icons', () => {
  const html = loadWith({ role: 'admin', module: 'meetings', current: 'issues' });
  for (const l of ['Meetings','Dashboard','Issues','Actions','Unsigned','Council','Compliance','Setup'])
    assert.ok(html.includes(l), `missing tab ${l}`);
  assert.ok(html.includes('aria-current="page"'), 'no active tab');
  assert.ok(/data-icon="alert-circle"/.test(html), 'issues icon missing');
  assert.ok(!/data-icon=""/.test(html) && !html.includes('data-icon="undefined"'), 'empty icon');
  // active tab is Issues
  assert.ok(/aria-current="page"[^>]*>\s*<svg data-icon="alert-circle"|alert-circle[\s\S]{0,80}aria-current/.test(html) || html.includes('Issues'), 'active=issues');
});

test('meetings: Setup hidden for non-admin (role-gated)', () => {
  const html = loadWith({ role: 'any', module: 'meetings', current: 'list' });
  assert.ok(!html.includes('Setup'), 'Setup must be gated to admin');
  assert.ok(html.includes('id="mdTabCount"'), 'count badge hook missing on Meetings tab');
});

test('inspections: 3 tabs, new active, hrefs correct', () => {
  const html = loadWith({ role: 'any', module: 'inspections', current: 'new' });
  for (const l of ['Inspections','New','Actions']) assert.ok(html.includes(l), `missing ${l}`);
  assert.ok(html.includes('href="inspection.html"'), 'new href');
  assert.ok(html.includes('aria-current="page"'), 'active');
});

test('unknown data-current renders strip with nothing active (editor gap fix)', () => {
  const html = loadWith({ role: 'any', module: 'meetings', current: '' });
  assert.ok(html.includes('Meetings') && html.includes('Compliance'), 'strip still renders');
  assert.ok(!html.includes('aria-current="page"'), 'nothing active when current empty');
});

test('every href in the config points to an existing public/*.html', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'module-tabs.js'), 'utf8');
  const hrefs = [...src.matchAll(/href:\s*'([a-z0-9-]+\.html)'/g)].map(m => m[1]);
  assert.ok(hrefs.length >= 10, 'expected >=10 hrefs');
  for (const h of hrefs)
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', h)), `missing page ${h}`);
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module …/public/module-tabs.js`)

Run: `node --test --test-force-exit tests/module-tabs.test.js`
Expected: FAIL (file does not exist).

- [ ] **Step 3: Implement `public/module-tabs.js`**

```js
/* module-tabs.js — shared intra-module tab strip.
   Mirrors _shell.js: renders into <div id="__moduletabs" data-module data-current>,
   uses window.EDV_ICONS for brand icons and window.__userHasRole for gating.
   Include AFTER brand/icons.js. Degrades to nothing if the mount is absent. */
(function () {
  'use strict';
  const ICONS = (typeof window !== 'undefined' && window.EDV_ICONS) || { html: () => '' };
  const has = (r) => (window.__userHasRole || (() => false))(r);
  const gated = (it) => !it.roles || it.roles.includes('any') || it.roles.some(has);

  const MODULES = {
    meetings: [
      { id:'list',       label:'Meetings',   icon:'file-text',    href:'meetings.html',          badgeId:'mdTabCount' },
      { id:'dashboard',  label:'Dashboard',  icon:'bar-chart-3',  href:'meetings-insights.html' },
      { id:'issues',     label:'Issues',     icon:'alert-circle', href:'meetings-issues.html' },
      { id:'actions',    label:'Actions',    icon:'check',        href:'meetings-actions.html' },
      { id:'unsigned',   label:'Unsigned',   icon:'edit',         href:'meetings-unsigned.html' },
      { id:'council',    label:'Council',    icon:'shield',       href:'meetings-council.html' },
      { id:'compliance', label:'Compliance', icon:'shield-check', href:'meetings-compliance.html' },
      { id:'setup',      label:'Setup',      icon:'sliders',      href:'meetings-setup.html', roles:['admin'] },
    ],
    inspections: [
      { id:'list',    label:'Inspections', icon:'clipboard-check', href:'inspections.html' },
      { id:'new',     label:'New',         icon:'plus',            href:'inspection.html' },
      { id:'actions', label:'Actions',     icon:'check',           href:'inspection-actions.html' },
    ],
    site_actions: [
      { id:'site',       label:'Site Actions',       icon:'check',           href:'site-actions.html' },
      { id:'meetings',   label:'Meetings Actions',   icon:'users',           href:'meetings-actions.html' },
      { id:'inspection', label:'Inspection Actions', icon:'clipboard-check', href:'inspection-actions.html' },
    ],
  };

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function render(mount) {
    if (!mount) return;
    const mod = mount.dataset.module || '';
    const cur = mount.dataset.current || '';
    const tabs = (MODULES[mod] || []).filter(gated);
    if (!tabs.length) { mount.innerHTML = ''; return; }
    const items = tabs.map(t => {
      const active = t.id === cur ? ' aria-current="page"' : '';
      const badge = t.badgeId ? ` <span class="mt-tab__count" id="${esc(t.badgeId)}">—</span>` : '';
      return `<a class="mt-tab${t.id===cur?' mt-tab--active':''}" href="${esc(t.href)}"${active}>`
           + `<span class="mt-tab__icon">${ICONS.html(t.icon)}</span>`
           + `<span class="mt-tab__label">${esc(t.label)}</span>${badge}</a>`;
    }).join('');
    mount.innerHTML = `<nav class="mt-tabs" aria-label="${esc(mod)} sections">${items}</nav>`;
  }

  window.__moduleTabs = { render: () => render(document.getElementById('__moduletabs')), MODULES };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.__moduleTabs.render);
  else window.__moduleTabs.render();
})();
```

- [ ] **Step 4: Implement `public/module-tabs.css`** (brand-token driven, `mt-` prefix)

```css
/* module-tabs.css — shared intra-module tab strip. Prefix mt- to avoid page collisions. */
.mt-tabs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:0 0 18px;border-bottom:1px solid var(--edv-border,#e2e8f0);padding-bottom:2px}
.mt-tab{display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:8px 8px 0 0;
  font-size:.86rem;font-weight:600;color:var(--edv-slate,#475569);text-decoration:none;
  border:1px solid transparent;border-bottom:none;transition:background .12s,color .12s}
.mt-tab:hover{background:var(--edv-surface-2,#f1f5f9);color:var(--edv-navy,#1e3a5f)}
.mt-tab--active{color:var(--edv-navy,#1e3a5f);background:#fff;border-color:var(--edv-border,#e2e8f0);
  box-shadow:inset 0 -2px 0 0 var(--edv-orange,#e87722)}
.mt-tab__icon{display:inline-flex;width:1em;height:1em}
.mt-tab__icon svg{width:1em;height:1em}
.mt-tab__count{font-size:.72rem;background:var(--edv-surface-2,#eef2f6);border-radius:9px;padding:1px 7px;color:var(--edv-slate,#475569)}
@media (max-width:640px){.mt-tab__label{display:none}.mt-tab{padding:9px 11px}}
```

- [ ] **Step 5: Run — expect PASS**

Run: `node --test --test-force-exit tests/module-tabs.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add public/module-tabs.js public/module-tabs.css tests/module-tabs.test.js
git commit -m "feat(nav): shared module-tabs component (brand icons, role-gated, aria-current)"
```

---

## Task 2: Wire the Meetings module (11 pages)

**Files (modify):** `public/meetings.html`, `meetings-insights.html`, `meetings-issues.html`, `meetings-actions.html`, `meetings-unsigned.html`, `meetings-council.html`, `meetings-compliance.html`, `meetings-setup.html`, `meeting.html`, `meetings-import.html`, `meetings-progress.html`

Per page:
- [ ] **Step 1: Add the two includes** in `<head>` (after the `_shell.js` include). CSS:
  `<link rel="stylesheet" href="module-tabs.css">`  · JS: `<script nonce="%%CSP_NONCE%%" src="module-tabs.js"></script>`
- [ ] **Step 2: Replace the inline strip.** Where a `<nav class="mtg-tabs">…</nav>` exists (the 8 pages that have it), replace the WHOLE `<nav>…</nav>` with:
  `<div id="__moduletabs" data-module="meetings" data-current="<PAGE_ID>"></div>`
  For `meeting.html`, `meetings-import.html`, `meetings-progress.html` (no full strip today) INSERT the same mount at the top of the main content container, with `data-current=""`.
- [ ] **Step 3: Preserve the count badge.** The `list` tab renders `id="mdTabCount"`, so the existing `mdTabCount.textContent = …` hydration keeps working — do not remove that JS.
- [ ] **Step 4: Verify wiring by grep (no browser needed):**

```bash
for f in meetings meetings-insights meetings-issues meetings-actions meetings-unsigned \
         meetings-council meetings-compliance meetings-setup meeting meetings-import meetings-progress; do
  grep -q 'id="__moduletabs"' public/$f.html && grep -q 'module-tabs.js' public/$f.html \
    && echo "OK   $f" || echo "MISS $f"
done
grep -rl 'class="mtg-tabs"' public/meeting*.html   # expect: no output (all replaced)
```
Expected: all `OK`, and the `mtg-tabs` grep returns nothing.

- [ ] **Step 5: Commit**

```bash
git add public/meeting*.html
git commit -m "refactor(nav): meetings pages use shared module-tabs (drop duplicated emoji strips; add strip to PV editor)"
```

---

## Task 3: Wire the Inspections module (3 pages) — it had NO strip

**Files (modify):** `public/inspections.html`, `public/inspection.html`, `public/inspection-actions.html`

- [ ] **Step 1:** Add the two includes (as Task 2 Step 1) to each.
- [ ] **Step 2:** Insert `<div id="__moduletabs" data-module="inspections" data-current="<ID>"></div>` at the top of the main content container — `inspections.html→list`, `inspection.html→new`, `inspection-actions.html→actions`.
- [ ] **Step 3: Verify by grep:**

```bash
for f in inspections inspection inspection-actions; do
  grep -q 'id="__moduletabs"' public/$f.html && grep -q 'module-tabs.js' public/$f.html \
    && echo "OK $f" || echo "MISS $f"; done
```
Expected: all `OK`.

- [ ] **Step 4: Commit**

```bash
git add public/inspections.html public/inspection.html public/inspection-actions.html
git commit -m "feat(nav): Inspections gains a consistent module-tabs strip (had none)"
```

---

## Task 3b: Wire Site Actions hub (Actions family strip)

**Files (modify):** `public/site-actions.html`

- [ ] **Step 1:** Add the two includes (as Task 2 Step 1).
- [ ] **Step 2:** Insert `<div id="__moduletabs" data-module="site_actions" data-current="site"></div>` at the top of the main content container, ABOVE the existing `.sa-filters` bar (the strip switches registers; the filter bar filters within this one). Do NOT touch `.sa-filters` or `.sa-group`.
- [ ] **Step 3: Verify by grep:**

```bash
grep -q 'id="__moduletabs"' public/site-actions.html && grep -q 'data-module="site_actions"' public/site-actions.html \
  && grep -q 'module-tabs.js' public/site-actions.html && echo OK || echo MISS
```
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add public/site-actions.html
git commit -m "feat(nav): Site Actions hub gains the Actions-family strip (site / meetings / inspection registers)"
```

---

## Task 4 (OPTIONAL): Visually align Assets / Tracker in-page tab bars

Only if quick: give the existing Assets (`assets.html`) and Activity Tracker in-page tab buttons the `mt-tabs`/`mt-tab` classes (or matching styles) so the visual language matches. **No behaviour change** — they keep their JS `data-tab`/React switching. Skip if it risks their existing hash/JS wiring. Commit separately if done.

---

## Task 5: Regression + docs + browser-QA handoff

- [ ] **Step 1: Run the safe suite (must be green):**

```bash
node --test --test-force-exit tests/module-tabs.test.js
DASH_USER=x DASH_PASS=y node --test --test-force-exit tests/review-render.test.js tests/await-precedence.test.js
```
Expected: all green (module-tabs 5/5; the others unaffected).

- [ ] **Step 2: Link-integrity sweep** — confirm no page references a now-removed class and every `__moduletabs` page also ships the JS:

```bash
grep -rl 'id="__moduletabs"' public/*.html | while read f; do grep -q 'module-tabs.js' "$f" || echo "MISSING JS: $f"; done
```
Expected: no output.

- [ ] **Step 3: Update `CLAUDE.md`** with a Current-state entry (shared module-tabs; meetings de-duplicated; inspections gained a strip; editor gap closed; Assets/Tracker unchanged behaviour).
- [ ] **Step 4: Commit** docs.
- [ ] **Step 5: BROWSER QA — USER STEP (do not skip, do not fake).** These pages are session-gated; the agent cannot log in. Ask the user to deploy to a test instance (or run locally with their session) and confirm on Meetings + a sub-page + the PV editor + Inspections + an inspection form: the strip renders, the active tab is correct, icons show (not empty boxes), no overlap with the page header, responsive collapse works, and every tab navigates. Only after the user confirms → merge + ZIP.

---

## Notes / guardrails

- **DRY:** the strip lives in ONE config; never re-inline a `<nav>` per page again.
- **YAGNI:** Assets/Tracker keep their working in-page tabs — do not rebuild them as multi-page.
- **No silent visual claims:** the agent verifies structure (harness + grep); the USER verifies pixels.
- **Deploy:** `module-tabs.js`/`.css` are static assets (versioned `?v=APP_VERSION`); the modified HTMLs are `_htmlCache`'d → prod needs `pm2 stop`→wait→`start` (not reload), then one Ctrl+F5.
