'use strict';
// VISUAL POLISH 2026-11 / UX committee admin IA — the Admin home and the branded "not available" page.
//   · admin-home.html: strict-CSP page (no inline script), super_admin gate in auth.js, composed only from EXISTING
//     read APIs; a source that cannot be read renders "—" (never 0).
//   · the switched-off Policy Center PAGE answers a branded HTML 404 (same status, says nothing about the feature).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\r\n/g, '\n');

test('admin-home.html: no inline script, super_admin gate, strict CSP, served', () => {
  const html = read('admin-home.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline script');
  assert.match(html, /auth\.js" data-require="super_admin"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'services', 'sessionAuth.js'), 'utf8'), /'\/admin-home\.html'/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /'admin-home\.html'/);
});

test('admin-home.js reads only existing GET APIs and renders "—" for a source it cannot read', async () => {
  const src = read('lib/admin-home.js');
  const urls = [...src.matchAll(/get\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(urls.sort(), ['/api/admin/backup-schedule', '/api/policy-center/requests?status=pending', '/api/reports/recipients', '/api/sync/health'].sort());
  const els = {};
  const mk = () => { const kids = { value: { textContent: '', classList: { toggle() {} } }, meta: { textContent: '' } };
    return { kids, querySelector: (s) => (s.includes('value') ? kids.value : kids.meta), setAttribute() {} }; };
  for (const id of ['ahFourEyes', 'ahSync', 'ahBackup', 'ahRecipients']) els[id] = mk();
  const fetch = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
  vm.runInNewContext(src, { window: {}, document: { getElementById: (id) => els[id] || null }, fetch, Promise });
  await new Promise((r) => setTimeout(r, 20));
  for (const id of Object.keys(els)) {
    assert.strictEqual(els[id].kids.value.textContent, '—', id + ' shows unknown, not a number');
    assert.match(els[id].kids.meta.textContent, /unknown, not as zero|not available/i, id);
  }
});

test('the switched-off Policy Center page answers a branded HTML 404, the API keeps its JSON 404', () => {
  const r = fs.readFileSync(path.join(__dirname, '..', 'routes', 'policyCenter.js'), 'utf8');
  assert.match(r, /router\.get\('\/policy-center\.html', enabledPage,/);
  assert.match(r, /res\.status\(404\)\.setHeader\('Content-Type', 'text\/html; charset=utf-8'\)/);
  assert.match(r, /router\.get\('\/api\/policy-center\/catalogue', requireReportSession, requireSuperAdmin, enabled,/);
  const page = read('not-available.html');
  assert.ok(!/policy|switch|enable/i.test(page.replace(/<!--[\s\S]*?-->/g, '')), 'the page names no feature and no setting');
  assert.ok(!/<script/i.test(page), 'no script at all');
});
