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
