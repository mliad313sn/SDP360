'use strict';
const fetch = require('./_http-fetch');
// Step 9 — /api/engagement + public /share + /ext (API key) on sqlite: notifications, subscriptions, rules admin gate +
// evaluate, share link lifecycle (create → public 200 → revoke → 404), consumers → external API + OData feed, quota.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'eng-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'eng-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'eng-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'eng-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, admin, editor, otherEditor, viewer, rdb, hounde, mana, editorId;

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if (rdb.db.prepare("SELECT 1 FROM sqlite_master WHERE name='alert_rules'").get() && rdb.db.prepare("SELECT COUNT(*) AS n FROM alert_rules").get().n >= 12 && rdb.db.prepare("SELECT 1 FROM sqlite_master WHERE name='dashboard_definitions'").get() && rdb.db.prepare("SELECT 1 FROM dashboard_definitions WHERE key='site-weekly' AND status='published'").get()) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, role, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  admin = await mk('en_admin', 'admin', ['admin']); editor = await mk('en_editor', 'editor', ['editor'], hounde); otherEditor = await mk('en_other', 'editor', ['editor'], mana); viewer = await mk('en_viewer', 'viewer', ['viewer'], hounde);
  editorId = rdb.db.prepare("SELECT id FROM users WHERE username='en_editor'").get().id;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t, extra) => ({ headers: Object.assign(t ? { 'x-report-token': t } : {}, extra || {}) });
const get = (p, t, extra) => fetch(base + p, H(t, extra));
const send = (m, p, t, body) => fetch(base + p, { method: m, ...H(t, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });

test('notifications + comments + subscriptions: 401 anonymous, own inbox only, mark read, subscribe idempotent, bad kind 400', async () => {
  assert.equal((await get('/api/engagement/notifications')).status, 401);
  rdb.db.prepare("INSERT INTO notifications (user_id, kind, title, body) VALUES (?, 'alert', 'A', 'b')").run(editorId);
  const n = await (await get('/api/engagement/notifications', editor)).json(); assert.equal(n.unread, 1); assert.equal(n.notifications[0].title, 'A');
  assert.equal((await (await get('/api/engagement/notifications/count', viewer)).json()).unread, 0, 'another user does not see it');
  const rd = await (await send('POST', '/api/engagement/notifications/read', editor, { ids: [n.notifications[0].id] })).json(); assert.equal(rd.marked, 1); assert.equal(rd.unread, 0);
  assert.equal((await send('POST', '/api/engagement/comments', editor, { source_kind: 'alert_rule', source_ref: 'k|1', body: '' })).status, 400);
  const c = await (await send('POST', '/api/engagement/comments', editor, { source_kind: 'alert_rule', source_ref: 'k|1', body: 'checking' })).json(); assert.equal(c.comment.user_name, 'en_editor');
  assert.equal((await (await get('/api/engagement/comments?source_kind=alert_rule&source_ref=k|1', viewer)).json()).comments.length, 1);
  assert.equal((await send('POST', '/api/engagement/subscriptions', editor, { kind: 'nope', target_key: 'x' })).status, 400);
  const s1 = await (await send('POST', '/api/engagement/subscriptions', editor, { kind: 'report_template', target_key: 'site-weekly-pack', digest: 'daily' })).json();
  const s2 = await (await send('POST', '/api/engagement/subscriptions', editor, { kind: 'report_template', target_key: 'site-weekly-pack', digest: 'weekly' })).json(); assert.equal(s1.id, s2.id);
  const ls = await (await get('/api/engagement/subscriptions', editor)).json(); assert.equal(ls.subscriptions.length, 1); assert.equal(ls.subscriptions[0].digest, 'weekly'); assert.ok(ls.kinds.includes('dashboard'));
  assert.equal((await send('DELETE', `/api/engagement/subscriptions/${s1.id}`, editor)).status, 200); assert.equal((await (await get('/api/engagement/subscriptions', editor)).json()).subscriptions.length, 0);
});

test('rules: 12 seeded visible to anyone (admin flag false), PUT/DELETE/evaluate/firings/stats admin only, unknown metric 400, evaluate runs end-to-end', async () => {
  const r = await (await get('/api/engagement/rules', viewer)).json(); assert.equal(r.admin, false); assert.ok(r.rules.length >= 12); assert.ok(r.operators.includes('rag_in')); assert.ok(r.metrics.length > 5);
  assert.equal((await send('PUT', '/api/engagement/rules', editor, { key: 'x', metric: 'helpdesk.resolution_sla_pct' })).status, 403);
  assert.equal((await send('PUT', '/api/engagement/rules', admin, { key: 'x', metric: 'nope.metric' })).status, 400);
  const nr = await (await send('PUT', '/api/engagement/rules', admin, { key: 'test.always', name: 'Always', metric: 'helpdesk.resolution_sla_pct', op: 'gte', threshold: -1, streak: 1, cooldown_min: 0, channels: ['inapp', 'teams'], recipients: { roles: ['admin'] } })).json(); assert.equal(nr.rule.threshold, -1);
  assert.equal((await send('POST', '/api/engagement/rules/evaluate', editor)).status, 403);
  const ev = await (await send('POST', '/api/engagement/rules/evaluate', admin)).json(); assert.equal(ev.ok, true); assert.ok(ev.rules >= 13); assert.ok(ev.readings > 0); assert.equal(typeof ev.firings, 'number'); assert.ok(ev.skipped >= 0, 'teams without a webhook is a counted skip, never a failure');
  const f = await (await get('/api/engagement/firings', admin)).json(); assert.ok(Array.isArray(f.firings));
  if (f.firings.length) { assert.equal((await send('PUT', `/api/engagement/firings/${f.firings[0].id}`, admin, { false_positive: true, note: 'test' })).status, 200); }
  assert.equal((await get('/api/engagement/stats', viewer)).status, 403);
  const st = await (await get('/api/engagement/stats', admin)).json(); assert.ok(st.rules_live >= 13); assert.ok('false_positive_pct' in st.alerts); assert.ok(Array.isArray(st.api));
  assert.equal((await send('DELETE', '/api/engagement/rules/test.always', admin)).status, 200);
});

test('share links: viewer 403, other-site 403, create → token shown once → public /share 200 (embed CSP) → receipts → revoke → 404; ttl clamped', async () => {
  assert.equal((await send('POST', '/api/engagement/share', viewer, { target_kind: 'dashboard', target_key: 'site-weekly' })).status, 403);
  assert.equal((await send('POST', '/api/engagement/share', editor, { target_kind: 'dashboard', target_key: 'site-weekly', site_id: mana })).status, 403);
  assert.equal((await send('POST', '/api/engagement/share', editor, { target_kind: 'dashboard', target_key: 'nope' })).status, 400);
  assert.equal((await send('POST', '/api/engagement/share', editor, { target_kind: 'report_run', target_key: '999999' })).status, 400, 'only a published run can be shared');
  const l = await (await send('POST', '/api/engagement/share', editor, { target_kind: 'dashboard', target_key: 'site-weekly', embed: true, ttl_hours: 5000, label: 'board' })).json();
  assert.equal(l.ok, true); assert.ok(l.token.length > 20); assert.ok(l.url.endsWith(`/share/${l.token}?embed=1`)); assert.ok(new Date(l.expires_at) - Date.now() <= 90 * 864e5 + 60000);
  const mine = await (await get('/api/engagement/share', editor)).json(); assert.equal(mine.links.length, 1); assert.equal(mine.links[0].token, undefined); assert.equal(mine.links[0].token_hash, undefined);
  assert.equal((await (await get('/api/engagement/share', otherEditor)).json()).links.length, 0);
  const pub = await get(`/share/${l.token}`); assert.equal(pub.status, 200); const html = await pub.text(); assert.ok(html.includes('Shared read-only view')); assert.ok(html.includes('Hounde'));
  const emb = await get(`/share/${l.token}?embed=1`); assert.equal(emb.status, 200); assert.match(emb.headers.get('content-security-policy'), /frame-ancestors 'self'/); assert.equal(emb.headers.get('cache-control'), 'no-store');
  const rc = await (await get(`/api/engagement/share/${l.id}/receipts`, editor)).json(); assert.equal(rc.receipts.length, 2);
  assert.equal((await get(`/api/engagement/share/${l.id}/receipts`, otherEditor)).status, 404);
  assert.equal((await send('DELETE', `/api/engagement/share/${l.id}`, otherEditor)).status, 404);
  assert.equal((await send('DELETE', `/api/engagement/share/${l.id}`, editor)).status, 200);
  assert.equal((await get(`/share/${l.token}`)).status, 404); assert.equal((await get('/share/nope')).status, 404);
});

test('API consumers → /ext: admin only, key shown once, 401 without key, scope 403, metrics/sites/values, OData service + $metadata + $filter, quota 429, revoke 401', async () => {
  assert.equal((await send('POST', '/api/engagement/consumers', editor, { name: 'x' })).status, 403);
  assert.equal((await send('POST', '/api/engagement/consumers', admin, { name: 'x', scopes: ['admin:write'] })).status, 400);
  const c = await (await send('POST', '/api/engagement/consumers', admin, { name: 'Power BI', scopes: ['metrics:read', 'values:read'], quota_per_day: 8 })).json(); assert.ok(c.key.startsWith('sdp_'));
  const list = await (await get('/api/engagement/consumers', admin)).json(); assert.equal(list.consumers[0].key_hint, c.hint); assert.ok(!JSON.stringify(list).includes(c.key));
  assert.equal((await get('/ext/v1/metrics')).status, 401); assert.equal((await get('/ext/v1/metrics', null, { 'x-api-key': 'sdp_nope' })).status, 401);
  const m = await get('/ext/v1/metrics', null, { 'x-api-key': c.key }); assert.equal(m.status, 200); assert.equal(m.headers.get('x-quota-remaining'), '8'); const md = await m.json(); assert.ok(md.metrics.some(x => x.key === 'helpdesk.resolution_sla_pct'));
  assert.equal((await get('/ext/v1/sites', null, { 'x-api-key': c.key })).status, 403, 'sites:read not granted');
  const v = await (await get(`/ext/v1/metrics/helpdesk.resolution_sla_pct/values?site=${hounde}`, null, { authorization: `Bearer ${c.key}` })).json(); assert.equal(v.values.length, 1); assert.equal(v.values[0].site_id, hounde); assert.ok(v.values[0].value === null || Number.isFinite(v.values[0].value));
  assert.equal((await get('/ext/v1/metrics/nope/values', null, { 'x-api-key': c.key })).status, 404);
  assert.equal((await get('/ext/v1/values', null, { 'x-api-key': c.key })).status, 400);
  const sd = await (await get('/ext/odata/', null, { 'x-api-key': c.key })).json(); assert.deepEqual(sd.value.map(x => x.name), ['Metrics', 'Values', 'Sites']);
  const meta = await get('/ext/odata/$metadata', null, { 'x-api-key': c.key }); assert.match(meta.headers.get('content-type'), /xml/); assert.ok((await meta.text()).includes('EntitySet Name="Values"'));
  const od = await get(`/ext/odata/Values?$filter=Metric eq 'helpdesk.resolution_sla_pct' and SiteId eq ${hounde}&$select=Id,Value&$count=true`, null, { 'x-api-key': c.key }); assert.equal(od.status, 200); const ob = await od.json(); assert.equal(ob['@odata.count'], 1); assert.deepEqual(Object.keys(ob.value[0]).sort(), ['Id', 'Value']);
  // quota: 8 calls logged above (metrics, sites→403, values, nope→404, values→400, odata root, $metadata, Values) → the 9th is 429
  const q = await get('/ext/v1/metrics', null, { 'x-api-key': c.key }); assert.equal(q.status, 429);
  assert.equal((await send('DELETE', `/api/engagement/consumers/${c.id}`, admin)).status, 200);
  assert.equal((await get('/ext/v1/metrics', null, { 'x-api-key': c.key })).status, 401, 'revoked key');
});
