'use strict';
const fetch = require('./_http-fetch');   // core-http shim (see tests/_http-fetch.js)
// Step 9 — engagement (a real alert to the notification centre), report studio (draft → edit → approve → outputs →
// shared link), external API (keys, scopes, quota journal, OData), embed view.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'step9-routes-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 's9-super';
process.env.DASH_PASS = process.env.DASH_PASS || 's9-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 's9-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';
process.env.METRICS_CACHE_TTL_MS = '0';
process.env.SDP_LINK_KEY = 'step9-test-link-key-0123456789abcdef';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: H(t), body: body ? JSON.stringify(body) : undefined });
const json = async (r) => ({ status: r.status, body: await r.json() });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const mk = async (u, roles, extra = {}) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pass-0000', roles, ...extra });
    tok[u] = (await rdb.login(u, u + '-pass-0000')).token;
  };
  await mk('s9-viewer', ['viewer']);
  await mk('s9-exec', ['executive']);
  await mk('s9-alerts', ['viewer', 'alert-manager']);
  await mk('s9-author', ['viewer', 'report-author']);
  await mk('s9-reviewer', ['viewer', 'report-reviewer']);
  await mk('s9-sa', ['super_admin']);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('engagement: catalogue, a real alert reaches the notification centre, discussion and read receipts', async () => {
  assert.equal((await send('POST', '/api/engagement/catalogue/import', tok['s9-viewer'])).status, 403);
  const imp = await json(await send('POST', '/api/engagement/catalogue/import', tok['s9-alerts']));
  assert.ok(imp.body.added >= 10);
  const viewerRules = await json(await get('/api/engagement/rules', tok['s9-viewer']));
  assert.deepStrictEqual(viewerRules.body.rules, [], 'disabled rules are not shown to everyone');
  // sync-health: on a fresh database no synchronisation ever ran → every source is "down" → the rule breaches.
  const rule = (await json(await get('/api/engagement/rules', tok['s9-alerts']))).body.rules.find(r => r.id === 'sync-health');
  assert.ok(rule);
  await send('POST', '/api/engagement/rules', tok['s9-alerts'], { ...rule, persistence: 1, recipients: [{ type: 'role', value: 'executive' }], enabled: true });
  const test1 = await json(await send('POST', '/api/engagement/rules/sync-health/test', tok['s9-alerts']));
  assert.equal(test1.body.breach, true);
  assert.equal((await send('POST', '/api/engagement/evaluate', tok['s9-alerts'])).status, 403, 'manual run: super_admin');
  const ev = await json(await send('POST', '/api/engagement/evaluate', tok['s9-sa']));
  assert.equal(ev.body.fired, 1, JSON.stringify(ev.body));
  const inbox = await json(await get('/api/notifications', tok['s9-exec']));
  assert.equal(inbox.body.unread, 1);
  const fireId = inbox.body.notifications[0].fire_id;
  assert.equal((await get('/api/engagement/fires/' + fireId, tok['s9-viewer'])).status, 403, 'not sent to the viewer');
  const fire = await json(await get('/api/engagement/fires/' + fireId, tok['s9-exec']));
  assert.match(fire.body.fire.message, /source\(s\) de données en retard ou en échec/);
  assert.equal(fire.body.receipts, undefined, 'receipts are for the alert managers');
  assert.equal((await json(await get('/api/notifications/count', tok['s9-exec']))).body.unread, 0, 'opening the alert reads it');
  assert.equal((await send('POST', `/api/engagement/fires/${fireId}/comments`, tok['s9-exec'], { text: 'Je relance l’équipe.' })).status, 201);
  const mgr = await json(await get('/api/engagement/fires/' + fireId, tok['s9-alerts']));
  assert.equal(mgr.body.comments[0].text, 'Je relance l’équipe.');
  assert.ok(mgr.body.receipts.some(r => r.username === 's9-exec' && r.read_at));
  const again = await json(await send('POST', '/api/engagement/evaluate', tok['s9-sa']));
  assert.equal(again.body.fired, 0, 'one alert per episode');
  const sub = await json(await send('POST', '/api/engagement/subscriptions', tok['s9-viewer'], { rule_id: 'sync-health', channel: 'inapp' }));
  assert.deepStrictEqual(sub.body.subscriptions, [{ rule_id: 'sync-health', channel: 'inapp' }]);
});

test('channels: a URL is a secret — write-only, https only, super_admin only', async () => {
  assert.equal((await send('POST', '/api/engagement/channels', tok['s9-alerts'], { name: 'x', url: 'https://example.org/hook' })).status, 403);
  assert.equal((await send('POST', '/api/engagement/channels', tok['s9-sa'], { name: 'x', url: 'http://example.org/hook' })).status, 400);
  const c = await json(await send('POST', '/api/engagement/channels', tok['s9-sa'], { name: 'Équipe réseau', kind: 'teams', url: 'https://example.org/workflows/secret-path' }));
  assert.equal(c.status, 201);
  assert.ok(!JSON.stringify(c.body).includes('secret-path'), 'the URL is never returned');
  assert.ok(!JSON.stringify(await (await get('/api/engagement/channels', tok['s9-alerts'])).json()).includes('secret-path'));
});

test('report studio: draft → edit → approve → outputs → shared link (anonymous, expiring, tamper-proof)', async () => {
  const t = await json(await get('/api/reportgen/templates', tok['s9-author']));
  assert.ok(t.body.templates.some(x => x.id === 'pack-executif-mensuel' && x.published_version === 1));
  assert.equal(t.body.ai_available, false);
  assert.equal((await send('POST', '/api/reportgen/runs', tok['s9-viewer'], { template_id: 'pack-executif-mensuel' })).status, 403);
  const g = await json(await send('POST', '/api/reportgen/runs', tok['s9-author'], { template_id: 'pack-executif-mensuel', month: '2026-09' }));
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const id = g.body.run.id;
  assert.equal(g.body.run.status, 'draft');
  assert.match(g.body.run.ai.skipped, /désactivée/, 'AI off: deterministic commentary');
  assert.equal((await get('/api/reportgen/runs/' + id, tok['s9-exec'])).status, 403, 'a draft is not read by the audience');
  const ed = await json(await send('PUT', `/api/reportgen/runs/${id}/commentary`, tok['s9-author'], { commentary: { c2: 'Mois stable.' } }));
  assert.equal(ed.body.commentary.c2, 'Mois stable.');
  assert.equal((await send('POST', `/api/reportgen/runs/${id}/approve`, tok['s9-author'])).status, 403, 'the author does not approve');
  assert.equal((await send('POST', `/api/reportgen/runs/${id}/share`, tok['s9-reviewer'])).status, 409, 'a draft is not shared');
  assert.equal((await json(await send('POST', `/api/reportgen/runs/${id}/approve`, tok['s9-reviewer']))).body.status, 'approved');
  assert.equal((await send('PUT', `/api/reportgen/runs/${id}/commentary`, tok['s9-author'], { commentary: { c2: 'x' } })).status, 409, 'an approved report is not edited');
  const html = await (await get(`/api/reportgen/runs/${id}/output.html`, tok['s9-exec'])).text();
  assert.ok(html.includes('Mois stable.') && html.includes('Validé'));
  const csv = await get(`/api/reportgen/runs/${id}/output.csv`, tok['s9-exec']);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.equal((await get(`/api/reportgen/runs/${id}/output.pptx`, tok['s9-exec'])).status, 200);
  const sh = await json(await send('POST', `/api/reportgen/runs/${id}/share`, tok['s9-reviewer'], { days: 3 }));
  assert.equal(sh.body.days, 3);
  const pub = await fetch(base + sh.body.path);
  assert.equal(pub.status, 200);
  assert.match(pub.headers.get('content-security-policy'), /default-src 'none'/);
  assert.ok((await pub.text()).includes('Mois stable.'));
  assert.equal((await fetch(base + sh.body.path.slice(0, -3) + 'abc')).status, 410);
  const ev = await json(await get('/api/reportgen/runs/' + id, tok['s9-reviewer']));
  assert.deepStrictEqual(ev.body.events.map(e => e.action), ['generated', 'edited', 'approved', 'shared']);
});

test('external API: key shown once, header or Basic, scopes, journal; OData feed from the snapshot', async () => {
  assert.equal((await send('POST', '/api/publication/clients', tok['s9-reviewer'], { name: 'x' })).status, 403);
  const c = await json(await send('POST', '/api/publication/clients', tok['s9-sa'], { name: 'Power BI — direction', scopes: ['metrics'], quota_per_day: 50 }));
  assert.equal(c.status, 201);
  const key = c.body.key, cid = c.body.client.id;
  assert.ok(!JSON.stringify(await (await get('/api/publication/clients', tok['s9-sa'])).json()).includes(key), 'the key is not listed again');
  assert.equal((await fetch(base + '/api/v1/metrics')).status, 401);
  assert.equal((await fetch(base + '/api/v1/metrics', { headers: { 'X-Api-Key': 'sdp_wrong-key-0000000000' } })).status, 401);
  const m = await fetch(base + '/api/v1/metrics', { headers: { 'X-Api-Key': key } });
  assert.equal(m.status, 200);
  assert.ok((await m.json()).metrics.length > 20);
  const basic = 'Basic ' + Buffer.from(cid + ':' + key).toString('base64');
  assert.equal((await fetch(base + '/api/v1/metrics/helpdesk.sla_res_pct?month=2026-09', { headers: { Authorization: basic } })).status, 200);
  assert.equal((await fetch(base + '/api/v1/reports', { headers: { 'X-Api-Key': key } })).status, 403, 'no reports scope');
  const snap = await json(await send('POST', '/api/publication/snapshot', tok['s9-sa'], { months: 2 }));
  assert.ok(snap.body.values > 0, JSON.stringify(snap.body));
  const md = await fetch(base + '/odata/$metadata', { headers: { Authorization: basic } });
  assert.match(await md.text(), /EntitySet Name="MetricValues"/);
  const mv = await (await fetch(base + "/odata/MetricValues?$filter=" + encodeURIComponent("MetricKey eq 'helpdesk.inbound' and Scope eq 'GROUP'"), { headers: { Authorization: basic } })).json();
  assert.equal(mv.value.length, 2); assert.equal(mv.value[0].MetricKey, 'helpdesk.inbound');
  assert.equal((await fetch(base + "/odata/MetricValues?$filter=Value gt 1", { headers: { Authorization: basic } })).status, 400);
  const use = await json(await get(`/api/publication/clients/${cid}/usage`, tok['s9-sa']));
  assert.ok(use.body.usage.reduce((n, d) => n + d.calls, 0) >= 5, 'every call is journalled');
  await send('POST', `/api/publication/clients/${cid}/revoke`, tok['s9-sa']);
  assert.equal((await fetch(base + '/api/v1/metrics', { headers: { 'X-Api-Key': key } })).status, 401, 'revoked');
});

test('embed view: the latest approved report, framable by SharePoint only', async () => {
  const e = await json(await send('POST', '/api/publication/embed', tok['s9-reviewer'], { template_id: 'pack-executif-mensuel', days: 180 }));
  assert.equal(e.status, 200);
  const r = await fetch(base + e.body.path);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-frame-options'), null);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors https:\/\/\*\.sharepoint\.com/);
  assert.equal((await fetch(base + '/embed/not-a-token')).status, 410);
});
