'use strict';
// G-08 — export, share and register boundaries (committee review 2026-10-28).
//  1. every export/download route (taken from the live router) refuses an anonymous caller, a caller
//     holding only the dash key, and a business-only account;
//  2. the RFI register: the committee sees it all, anyone else only their own requests and their sites';
//  3. governance minutes (HTML / PDF) of a site-A session are refused to a site-B editor;
//  4. an expired or forged share token is a 404;
//  5. a real CSV export neutralises a hostile cell planted through the login form.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'expshare-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'es-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'es-super-pass-0000';
process.env.DASHBOARD_API_KEY = 'es-dash-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, A, B, tok = {}, ids = {};
const H = (t, extra) => Object.assign({ 'Content-Type': 'application/json' }, t ? { 'x-report-token': t } : {}, extra || {});
const get = (p, t, extra) => fetch(base + p, { headers: H(t, extra) });
const send = (m, p, t, b) => fetch(base + p, { method: m, headers: H(t), body: b ? JSON.stringify(b) : undefined });
const ok2xx = (s) => s >= 200 && s < 300;

const EXPORT_RE = /(export|\.xlsx|\.csv|\.json$|pptx|\.pdf|minutes|download|\/share\/:|risk-register-export|\/uploads\/:)/i;

function collect(stack, out) {
  for (const l of stack) {
    if (l.route) {
      for (const p of [].concat(l.route.path)) if (typeof p === 'string') for (const m of Object.keys(l.route.methods)) out.push({ method: m.toUpperCase(), path: p });
    } else if (l.name === 'router' && l.handle && l.handle.stack) collect(l.handle.stack, out);
  }
}
const concrete = (p) => p.replace(/\.:fmt\([^)]*\)/, '.csv').replace(/\(\.\*\)|\*/g, 'x').split('/')
  .map((s) => (s.startsWith(':') ? (/year/.test(s) ? '2026' : /month/.test(s) ? '9' : /week/.test(s) ? '37' : /id|key|token/i.test(s) ? '1' : 'ZZZ') : s)).join('/');

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  const sites = (await rdb.listSites()) || [];
  A = sites.find((s) => /hounde/i.test(s.name)); B = sites.find((s) => /mana/i.test(s.name));
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  const mk = async (u, roles, site) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, site_id: site });
    tok[u] = (await rdb.login(u, u + '-pw-0000')).token;
    ids[u] = ((await rdb.listUsers()) || []).find((x) => x.username === u).id;
  };
  await mk('es-bizA', ['site-business'], A.id);
  await mk('es-viewA', ['viewer'], A.id);
  await mk('es-edA', ['editor'], A.id);
  await mk('es-edB', ['editor'], B.id);
  await mk('es-member', ['viewer', 'committee-member']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('every export / download route refuses anonymous, dash-key-only and business-only callers', async () => {
  const routes = []; collect(require('../server').app._router.stack, routes);
  const exp = routes.filter((r) => EXPORT_RE.test(r.path) && r.path.startsWith('/api/'));
  assert.ok(exp.length >= 30, `too few export routes found (${exp.length})`);
  const bad = [];
  for (const r of exp) {
    const url = concrete(r.path);
    const call = (headers) => fetch(base + url, { method: r.method, headers: { 'Content-Type': 'application/json', ...headers }, body: r.method === 'GET' ? undefined : '{}' });
    const anon = (await call({})).status;
    const key = (await call({ 'x-dash-key': process.env.DASHBOARD_API_KEY })).status;
    const biz = (await call({ 'x-report-token': tok['es-bizA'] })).status;
    if (ok2xx(anon)) bad.push(`${r.method} ${r.path} anonymous → ${anon}`);
    if (ok2xx(key)) bad.push(`${r.method} ${r.path} dash-key only → ${key}`);
    if (ok2xx(biz)) bad.push(`${r.method} ${r.path} business-only → ${biz}`);
  }
  assert.deepEqual(bad, []);
});

test('RFI register: own + own-site requests for a viewer, everything for the committee', async () => {
  const mkRfi = async (t, title, site_id) => {
    const r = await send('POST', '/api/governance/rfi', t, { kind: 'ux', title, problem: 'p', site_id });
    assert.equal(r.status, 200, await r.text());
  };
  await mkRfi(tok['es-edA'], 'RFI-A-site', A.id);
  await mkRfi(tok['es-edB'], 'RFI-B-site', B.id);
  await mkRfi(tok['es-member'], 'RFI-fleet', null);
  const titles = async (t) => ((await (await get('/api/governance/rfi', t)).json()).rfi || []).map((x) => x.title);
  const viewA = await titles(tok['es-viewA']);
  assert.ok(viewA.includes('RFI-A-site'), 'own-site request visible');
  assert.ok(!viewA.includes('RFI-B-site'), 'another site request hidden');
  assert.ok(!viewA.includes('RFI-fleet'), 'another person fleet request hidden');
  const edB = await titles(tok['es-edB']);
  assert.ok(edB.includes('RFI-B-site') && !edB.includes('RFI-A-site'));
  const all = await titles(tok['es-member']);
  for (const t of ['RFI-A-site', 'RFI-B-site', 'RFI-fleet']) assert.ok(all.includes(t), `committee sees ${t}`);
  const ov = await (await get('/api/governance/overview', tok['es-viewA'])).json();
  assert.equal(ov.rfi_to_triage, 1, 'overview counts only the reader’s scope');
});

test('governance minutes of a site-A session are refused to a site-B editor', async () => {
  const c = await (await send('PUT', '/api/governance/cadences', tok['es-member'], { key: 'es-hgo', name: 'HGO weekly', kind: 'site_weekly', site_id: A.id })).json();
  assert.equal(c.ok, true, JSON.stringify(c));
  const s = await (await send('POST', `/api/governance/cadences/${c.cadence.id}/sessions`, tok['es-edA'], { scheduled_at: '2026-10-20T09:00:00Z' })).json();
  assert.equal(s.ok, true, JSON.stringify(s));
  const sid = s.session.id;
  assert.equal((await get(`/api/governance/sessions/${sid}/minutes.html`, tok['es-edA'])).status, 200, 'site-A editor reads its minutes');
  for (const p of [`/api/governance/sessions/${sid}`, `/api/governance/sessions/${sid}/minutes.html`, `/api/governance/sessions/${sid}/minutes.pdf`]) {
    assert.equal((await get(p, tok['es-edB'])).status, 403, `${p} refused to the site-B editor`);
  }
});

test('an expired or forged share token is a 404', async () => {
  const l = await (await send('POST', '/api/engagement/share', tok['es-edA'], { target_kind: 'dashboard', target_key: 'site-weekly', ttl_hours: 24 })).json();
  assert.equal(l.ok, true, JSON.stringify(l));
  assert.equal((await get(`/share/${l.token}`)).status, 200, 'fresh link works');
  assert.equal((await get(`/share/${l.token.slice(0, -2)}xx`)).status, 404, 'forged token');
  await rdb.db.prepare('UPDATE share_links SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', l.id);
  assert.equal((await get(`/share/${l.token}`)).status, 404, 'expired link');
});

test('a hostile value planted through the login form is neutralised in the CSV export', async () => {
  const evil = '=HYPERLINK("http://x","y")';
  await fetch(base + '/api/reports/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: evil, password: 'nope' }) });
  let csv = '';
  for (let i = 0; i < 20 && !csv.includes('HYPERLINK'); i++) {
    await new Promise((r) => setTimeout(r, 100));
    csv = await (await get('/api/reports/system-log/export.csv', tok.super)).text();
  }
  assert.ok(csv.includes('HYPERLINK'), 'the failed login is in the export');
  for (const cell of csv.split(/\r?\n/).flatMap((l) => l.split(','))) {
    assert.ok(!/^"?=/.test(cell), `formula cell exported as-is: ${cell}`);
  }
});
