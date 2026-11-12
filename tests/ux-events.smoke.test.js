'use strict';
const fetch = require('./_http-fetch');
// F-UX-06 — POST /api/ux/event: allow-listed kinds, short token targets, no PII, nothing written while
// report_config ux_event_telemetry = '0' (default); non-shell pages report their view (it-review, site-report, field).
process.env.DASH_USER = process.env.DASH_USER || 'ux-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ux-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ux-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, ed, edId;

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  try { await rdb.createUser({ username: 'ux_editor', full_name: 'Editor Person', password: 'editorpass1234', role: 'editor', roles: ['editor'] }); } catch {}
  const l = await rdb.login('ux_editor', 'editorpass1234'); ed = l.token; edId = l.user.id;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const ev = (t, body) => fetch(base + '/api/ux/event', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, t ? { 'x-report-token': t } : {}), body: JSON.stringify(body) });
const rows = async () => (await rdb.pgHandle().prepare(`SELECT * FROM system_log WHERE category = 'ux' AND action LIKE 'ux\\_%' ORDER BY id`).all());
const settle = () => new Promise((r) => setTimeout(r, 150));
const setCfg = async (v) => require('../services/reportConfig').setConfig(rdb.db, { ux_event_telemetry: v });

test('validation: 401 anonymous; unknown kind, unknown page, URL-like target → 400', async () => {
  assert.equal((await ev(null, { kind: 'export', page: 'home' })).status, 401);
  assert.equal((await ev(ed, { kind: 'keystroke', page: 'home' })).status, 400);
  assert.equal((await ev(ed, { kind: 'export', page: 'nope' })).status, 400);
  assert.equal((await ev(ed, { kind: 'drill', page: 'home', target: 'https://x/y?name=Ana' })).status, 400);
  assert.equal((await ev(ed, { kind: 'drill', page: 'home', target: 'ana@example.com' })).status, 400);
});

test('switch off (default): accepted but NO row written', async () => {
  assert.equal(require('../services/reportConfig').DEFAULTS.ux_event_telemetry, '0');
  const j = await (await ev(ed, { kind: 'export', page: 'home' })).json();
  assert.deepEqual([j.ok, j.logged, j.armed], [true, false, false]);
  await settle();
  assert.equal((await rows()).length, 0);
});

test('switch on: one row per user × kind × page × target × day, id + tier + token only', async () => {
  await setCfg('1');
  assert.equal((await (await ev(ed, { kind: 'first_click', page: 'home', target: 'site-actions' })).json()).logged, true);
  assert.equal((await (await ev(ed, { kind: 'first_click', page: 'home', target: 'site-actions' })).json()).logged, false, 'same day: once');
  assert.equal((await (await ev(ed, { kind: 'export', page: 'field' })).json()).logged, true, 'the field PWA is a known page');
  await settle();
  const r = await rows();
  assert.equal(r.length, 2);
  const fc = r.find((x) => x.action === 'ux_first_click');
  assert.equal(fc.actor, 'u' + edId); assert.equal(fc.ip, null); assert.equal(fc.target, 'home');
  assert.deepEqual(JSON.parse(fc.details), { tier: 'editor', to: 'site-actions' });
  assert.ok(!/ux_editor|Editor Person/.test(JSON.stringify(r)), 'no username / full name');
  await setCfg('0');
});

test('the browser learns the switch through the UI policy; non-shell pages report their view', () => {
  const P = require('../services/uiPolicy');
  assert.equal(P.uiPolicyFrom({}).ux_events, '0');
  assert.equal(P.uiPolicyFrom({ ux_event_telemetry: '1' }).ux_events, '1');
  assert.equal(P.uiPolicyFrom({ ux_event_telemetry: 'yes' }).ux_events, '0');
  const fs = require('fs'); const path = require('path'); const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  assert.match(read('it-review.html'), /src="lib\/pageView\.js" data-page="it-review"/);
  assert.match(read('site-report.html'), /src="lib\/pageView\.js" data-page="site-report"/);
  assert.match(read('field/app.js'), /page: 'field'/);
  assert.ok(!/exec-view/.test(read('lib/pageView.js')), 'exec-view stays anonymous');
});

test('shell client: sends nothing while the policy is off; on, posts kind + page + token only', () => {
  const vm = require('vm'); const fs = require('fs'); const path = require('path');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', '_shell.js'), 'utf8');
  const load = (pol) => {
    const sent = [];
    const window = { __uiPolicy: pol, __authUser: { id: 1 }, EDV_ICONS: { html: () => '' } };
    const document = { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
    vm.runInNewContext(SRC, { window, document, console, URL, location: { pathname: '/home.html', search: '?site=HGO&name=Ana', href: 'http://x/home.html' }, fetch: (u, o) => { sent.push([u, JSON.parse(o.body)]); return Promise.resolve(); }, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en' } });
    return { shell: window.__shell, sent };
  };
  const off = load({ ux_events: '0' });
  assert.equal(off.shell.uxEvent('export'), false); assert.equal(off.sent.length, 0);
  const on = load({ ux_events: '1' });
  assert.equal(on.shell.uxEvent('drill', 'kpi'), true);
  assert.deepEqual(on.sent, [['/api/ux/event', { kind: 'drill', page: 'home', target: 'kpi' }]], 'the query string (site, names) never leaves the page');
  const btn = (txt, attrs = {}) => ({ textContent: txt, hasAttribute: (k) => k in attrs, getAttribute: (k) => attrs[k] || null, closest(sel) { return /a,button/.test(sel) ? this : (sel === '[data-ux-event]' && 'data-ux-event' in attrs) || (sel === '[data-ux-drill]' && 'data-ux-drill' in attrs) ? this : null; } });
  assert.deepEqual(JSON.parse(JSON.stringify(on.shell.classifyClick(btn('⬇ Export CSV')))), { kind: 'export', target: null });
  assert.deepEqual(JSON.parse(JSON.stringify(on.shell.classifyClick(btn('Close', { 'data-ux-event': 'action_done', 'data-ux-target': 'Meetings' })))), { kind: 'action_done', target: 'meetings' });
  assert.equal(on.shell.classifyClick(btn('Open')), null);
});
