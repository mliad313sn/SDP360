'use strict';
// F-ARCH-06 — CSP readiness per journey: page scan, journey table parsing, violation counts, and the committed file.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('../tools/security/csp-journey-report');

test('scanPage counts inline scripts and inline handlers, not src scripts, templates or text inside a script', () => {
  const html = `<script src="a.js"></script><script type="application/json">{}</script><script>var x = '<a onclick="no">';</script>
    <button onclick="go()">x</button><select onchange='f()'></select><a href="#" data-onclick="x">y</a><script nonce="n">1</script>`;
  assert.deepEqual(R.scanPage(html), { inline_scripts: 2, inline_handlers: 2 });
  assert.deepEqual(R.scanPage('<script src="x.js"></script><p>ok</p>'), { inline_scripts: 0, inline_handlers: 0 });
});

test('parseJourneys reads persona, journey and the two pages of each table row', () => {
  const md = ['| Persona | Account role | Journey (question → action) | Start page | Action page | Browser journey test |', '|---|---|---|---|---|---|',
    '| Site editor | `editor` | Close an action (E-Q09) | `public/site-actions.html` | `public/site-actions.html` | `tests/e2e/t1.spec.js` |',
    '| Admin | `admin` | Check WAN | `public/infra-health.html` | `public/wan.html` | not covered |', 'free text | not a row'].join('\n');
  const j = R.parseJourneys(md);
  assert.equal(j.length, 2);
  assert.deepEqual(j[0], { persona: 'Site editor', journey: 'Close an action', pages: ['public/site-actions.html'] });
  assert.deepEqual(j[1].pages, ['public/infra-health.html', 'public/wan.html']);
});

test('build: strict / enforceable / blocked per page and per journey; a journey is blocked by its worst page', () => {
  const journeys = [{ persona: 'P', journey: 'a', pages: ['public/login.html'] }, { persona: 'P', journey: 'b', pages: ['public/clean.html'] },
    { persona: 'P', journey: 'c', pages: ['public/clean.html', 'public/legacy.html'] }, { persona: 'P', journey: 'd', pages: ['public/gone.html'] }];
  const pages = { 'public/login.html': { inline_scripts: 1, inline_handlers: 0 }, 'public/clean.html': { inline_scripts: 0, inline_handlers: 0 },
    'public/legacy.html': { inline_scripts: 2, inline_handlers: 9 }, 'public/gone.html': null };
  const r = R.build({ journeys, pages, strict: ['/login.html'] });
  assert.deepEqual(r.rows.map((x) => x.state), ['strict', 'enforceable', 'blocked', 'unknown']);
  assert.deepEqual(r.rows[2].blockers, ['/legacy.html']);
  assert.deepEqual(r.totals, { journeys: 4, strict: 1, enforceable: 1, blocked: 1, unknown: 1 });
  assert.ok(r.pages.every((p) => p.violations === null), 'not measured stays null, never 0');
  assert.match(R.render(r), /Violations: not measured/);
  assert.match(R.render(r), /\| `\/legacy\.html` \| 2 \| 9 \| blocked \| — \|/);
});

test('violations from a System Logs export are counted per page; other rows are ignored', () => {
  const v = R.countViolations({ rows: [
    { action: 'csp_violation', target: 'script-src-elem /legacy.html', details: JSON.stringify({ directive: 'script-src-elem', blocked: 'inline', document: '/legacy.html' }) },
    { action: 'csp_violation', target: 'script-src-attr /legacy.html', details: { directive: 'script-src-attr', blocked: 'inline', document: '/legacy.html' } },
    { action: 'csp_violation', target: 'script-src-elem /clean.html', details: null },
    { action: 'login_failed', target: '/legacy.html' }, null] });
  assert.equal(v.get('/legacy.html'), 2); assert.equal(v.get('/clean.html'), 1); assert.equal(v.size, 2);
  const r = R.build({ journeys: [{ persona: 'P', journey: 'c', pages: ['public/clean.html', 'public/other.html'] }],
    pages: { 'public/clean.html': { inline_scripts: 0, inline_handlers: 0 }, 'public/other.html': { inline_scripts: 0, inline_handlers: 0 } }, strict: [], violations: v });
  assert.deepEqual(r.pages.map((p) => p.violations), [1, 0], 'measured: a page with no report reads 0');
  assert.match(R.render(r), /counted from the supplied System Logs export/);
});

test('the committed docs/security/CSP-JOURNEYS.md is up to date and covers every journey page', () => {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'security', 'csp-journey-report.js'), '--check']);
  const c = R.collect();
  assert.ok(c.journeys.length >= 20);
  assert.ok(Object.values(c.pages).every((p) => p !== null), 'every page named by a journey exists');
  const r = R.build(c);
  assert.equal(r.pages.find((p) => p.url === '/login.html').state, 'strict');
});

// P07 — page inventory: handlers built by script text, nonce-served pages, readiness of every page.
test('scanScriptText counts on*="" written inside JS strings, ignores comments and property assignment', () => {
  assert.equal(R.scanScriptText(`el.innerHTML = '<b onclick="x()">' + "<i onchange='y'>"; el.onclick = f; // onclick="z"\n/* onload="q" */`), 2);
  assert.equal(R.scanScriptText('const t = `<a onmouseover=\\"u\\">`;'), 1);
  assert.equal(R.scanScriptText('btn.addEventListener("click", go); const url = "https://x.example/a";'), 0);
});

test('nonceServedPages reads sendHtmlPage calls and the page loop', () => {
  const s = `sendHtmlPage(res, 'a.html', true, 'x');\nfor (const _p of ['b.html', 'c.html']) app.get('/' + _p, (req, res) => sendHtmlPage(res, _p, false, 'x'));`;
  assert.deepEqual([...R.nonceServedPages(s)].sort(), ['a.html', 'b.html', 'c.html']);
});

test('inventoryPages: candidate needs no markup handler, no script-built handler, and inline scripts only when nonce-served', () => {
  const files = { 'public/ok.html': '<script src="lib/clean.js"></script><script>go()</script>', 'public/raw.html': '<script>go()</script>',
    'public/dyn.html': '<script src="lib/dirty.js"></script>', 'public/mk.html': '<button onclick="x()">', 'public/login.html': '<script>1</script>',
    'public/lib/clean.js': 'el.onclick = f;', 'public/lib/dirty.js': 'el.innerHTML = "<a onclick=\\"z()\\">";' };
  const inv = R.inventoryPages({ files: ['public/ok.html', 'public/raw.html', 'public/dyn.html', 'public/mk.html', 'public/login.html'],
    read: (r) => files[r], exists: (r) => r in files, served: new Set(['ok.html', 'dyn.html', 'mk.html', 'login.html']), strict: ['/login.html'] });
  const by = Object.fromEntries(inv.map((x) => [x.url, x]));
  assert.equal(by['/ok.html'].readiness, 'candidate');
  assert.equal(by['/raw.html'].readiness, 'blocked', 'inline script not nonce-served');
  assert.equal(by['/dyn.html'].readiness, 'blocked');
  assert.deepEqual(by['/dyn.html'].offenders, ['lib/dirty.js (1)']);
  assert.equal(by['/mk.html'].readiness, 'blocked');
  assert.equal(by['/login.html'].readiness, 'strict');
});

test('ratchet: the blocked set of the real inventory never grows (extract a handler, do not add one)', () => {
  const BLOCKED_AT_P07 = ['/analytics.html', '/executive-report.html', '/executive.html', '/help.html', '/index.html', '/inspection.html', '/reports.html'];
  const blocked = R.collect().inventory.filter((x) => x.readiness === 'blocked').map((x) => x.url);
  const added = blocked.filter((u) => !BLOCKED_AT_P07.includes(u));
  assert.deepEqual(added, [], 'newly blocked page(s) — remove the inline handler or the script-built on*="" string');
});
