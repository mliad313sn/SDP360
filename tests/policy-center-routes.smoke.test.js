'use strict';
// Policy Control Center through the real server: switch off = 404 everywhere (nothing changes); who reads / writes;
// mandatory reason; validation; secrets never returned nor written; four-eyes requests (requester ≠ approver, stale
// guard); per-site override read by the consumer resolver; history rows; export; profile import dry-run + confirm.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pc-smoke-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'pc-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pc-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pc-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, RC, hounde, mana; const T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); RC = require('../services/reportConfig');
  for (let i = 0; i < 80; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'policy_change_requests'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site) => { const u = 'pc_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('super', ['super_admin']); await mk('super2', ['super_admin']); await mk('admin', ['admin']); await mk('viewer', ['viewer'], hounde);
  await RC.setConfig(rdb.db, { smtp_pass: 'S3cret-value-xyz', smtp_host: 'mail.example.org' }, 'test');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { ...(t ? { 'x-report-token': t } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const put = (t, key, body) => send('PUT', '/api/policy-center/rules/' + key, t, body);
const cfg = async () => RC.getConfig(rdb.db);

test('switch off (default): page and every API answer 404, nothing is written', async () => {
  assert.strictEqual((await cfg()).policy_center_enabled, '0');
  assert.strictEqual((await send('GET', '/api/policy-center/catalogue', T.super)).status, 404);
  assert.strictEqual((await put(T.super, 'ui_week_labels', { value: 'explicit', reason: 'try while off' })).status, 404);
  assert.strictEqual((await send('GET', '/policy-center.html', T.super)).status, 404);
  assert.strictEqual((await cfg()).ui_week_labels, 'legacy');
  await RC.setConfig(rdb.db, { policy_center_enabled: '1' }, 'test');
});

test('who: anonymous refused, viewer and admin 403 (reads are super_admin only, N-R4-2); secrets never returned', async () => {
  assert.ok([401, 403].includes((await send('GET', '/api/policy-center/catalogue')).status));
  assert.strictEqual((await send('GET', '/api/policy-center/catalogue', T.viewer)).status, 403);
  assert.strictEqual((await send('GET', '/api/policy-center/catalogue', T.admin)).status, 403);
  const r = await send('GET', '/api/policy-center/catalogue', T.super);
  assert.strictEqual(r.status, 200);
  const txt = await r.text(); const j = JSON.parse(txt);
  assert.ok(!txt.includes('S3cret-value-xyz'), 'a stored secret never leaves the server');
  assert.strictEqual(j.can_write, true);
  const sp = j.rules.find((x) => x.key === 'smtp_pass');
  assert.strictEqual(sp.current, null); assert.strictEqual(sp.secret_set, true);
  assert.ok(j.rules.length >= 300 && j.coverage.missing.length === 0);
  assert.strictEqual((await put(T.admin, 'ui_week_labels', { value: 'explicit', reason: 'admin attempt' })).status, 403);
  const page = await send('GET', '/policy-center.html', T.super);
  assert.strictEqual(page.status, 200);
  const csp = page.headers.get('content-security-policy') || '';
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'strict CSP on the page');
});

test('a low-risk change applies at once, needs a reason, is validated and journalled with its reason', async () => {
  assert.strictEqual((await put(T.super, 'ui_week_labels', { value: 'explicit' })).status, 400, 'reason mandatory');
  assert.strictEqual((await put(T.super, 'ui_week_labels', { value: 'weird', reason: 'bad value test' })).status, 400);
  assert.strictEqual((await put(T.super, 'smtp_pass', { value: 'x', reason: 'secret write attempt' })).status, 400, 'secrets are not written here');
  assert.strictEqual((await put(T.super, 'no_such_rule', { value: '1', reason: 'unknown rule' })).status, 404);
  const ok = await put(T.super, 'ui_week_labels', { value: 'explicit', reason: 'site prefers ISO labels' });
  assert.strictEqual(ok.status, 200); assert.strictEqual((await ok.json()).status, 'applied');
  assert.strictEqual((await cfg()).ui_week_labels, 'explicit');
  const h = await (await send('GET', '/api/policy-center/rules/ui_week_labels/history', T.super)).json();
  assert.ok(h.history.some((x) => x.from === 'legacy' && x.to === 'explicit' && /site prefers ISO labels/.test(x.reason) && x.who === 'pc_super'));
  const rs = await (await put(T.super, 'ui_week_labels', { reset: true, reason: 'back to recommended' })).json();
  assert.strictEqual(rs.status, 'applied'); assert.strictEqual((await cfg()).ui_week_labels, 'legacy');
  const c = await (await send('GET', '/api/policy-center/catalogue', T.super)).json();
  assert.strictEqual(c.rules.find((x) => x.key === 'ui_week_labels').deviates, false);
});

test('four-eyes: a high-risk change away from the default becomes a request a SECOND super_admin decides', async () => {
  assert.strictEqual((await put(T.super, 'hygiene_send_enabled', { value: '1', reason: 'short' })).status, 400, '10+ characters for high risk');
  const r = await put(T.super, 'hygiene_send_enabled', { value: '1', reason: 'arm the hygiene digest for the pilot site' });
  assert.strictEqual(r.status, 202); const { request } = await r.json(); assert.match(request, /^pc-\d+$/);
  assert.strictEqual((await cfg()).hygiene_send_enabled, '0', 'nothing applied yet');
  assert.strictEqual((await put(T.super2, 'hygiene_send_enabled', { value: '1', reason: 'duplicate request here' })).status, 409);
  const list = await (await send('GET', '/api/policy-center/requests', T.super)).json();
  assert.ok(list.requests.some((x) => x.id === request && x.status === 'pending'));
  assert.strictEqual((await send('POST', `/api/policy-center/requests/${request}/approve`, T.super, { reason: 'self' })).status, 403, 'requester cannot approve');
  assert.strictEqual((await send('POST', `/api/policy-center/requests/${request}/approve`, T.admin, { reason: 'admin' })).status, 403);
  const ap = await send('POST', `/api/policy-center/requests/${request}/approve`, T.super2, { reason: 'agreed for the pilot' });
  assert.strictEqual(ap.status, 200); assert.strictEqual((await ap.json()).status, 'approved');
  assert.strictEqual((await cfg()).hygiene_send_enabled, '1');
  const logged = await rdb.db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE action='policy_change_approved' AND target='hygiene_send_enabled'").get();
  assert.ok(Number(logged.n) >= 1);
  // disarming (towards the catalogue's strict value '0') is immediate; a reset to a WEAK default is not (N-R4-1)
  assert.strictEqual((await (await put(T.super, 'hygiene_send_enabled', { value: '0', reason: 'pilot over, disarm' })).json()).status, 'applied');
  // stale guard: the value changed between request and approval → refused, marked stale
  const r2 = await (await put(T.super, 'hygiene_send_enabled', { value: '1', reason: 'arm again for the second pilot' })).json();
  await RC.setConfig(rdb.db, { hygiene_send_enabled: '1' }, 'someone-else');
  assert.strictEqual((await send('POST', `/api/policy-center/requests/${r2.request}/approve`, T.super2, { reason: 'late approval' })).status, 409);
  const st = await (await send('GET', '/api/policy-center/requests?status=stale', T.super)).json();
  assert.ok(st.requests.some((x) => x.id === r2.request));
  await RC.setConfig(rdb.db, { hygiene_send_enabled: '0' }, 'test');
  // withdraw: only the requester
  const r3 = await (await put(T.super, 'hygiene_send_enabled', { value: '1', reason: 'third try, will withdraw' })).json();
  assert.strictEqual((await send('POST', `/api/policy-center/requests/${r3.request}/cancel`, T.super2, {})).status, 403);
  assert.strictEqual((await send('POST', `/api/policy-center/requests/${r3.request}/cancel`, T.super, {})).status, 200);
});

test('per-site override (governance policy) is read by the consumer resolver for that site only; platform-only rules refuse a site', async () => {
  const GP = require('../services/governancePolicy');
  const ok = await put(T.super, 'handoffs.reason_min', { value: 12, scope: `site:${hounde}`, reason: 'low-bandwidth site, longer notes wanted' });
  assert.strictEqual(ok.status, 200, await ok.text());
  GP.shared().invalidate && GP.shared().invalidate();
  assert.strictEqual((await GP.forContext({ siteId: hounde }))['handoffs.reason_min'], 12, 'the resolver consumers call sees the site value');
  assert.strictEqual((await GP.forContext({ siteId: mana }))['handoffs.reason_min'], GP.DEFAULTS['handoffs.reason_min'], 'other sites unchanged');
  const c = await (await send('GET', '/api/policy-center/catalogue', T.super)).json();
  assert.deepStrictEqual(c.rules.find((x) => x.key === 'handoffs.reason_min').site_deviations, [Number(hounde)]);
  assert.strictEqual((await put(T.super, 'freshness.helpdesk_hours', { value: 4, scope: `site:${hounde}`, reason: 'site scope on a source rule' })).status, 400);
  assert.strictEqual((await put(T.super, 'ui_week_labels', { value: 'explicit', scope: `site:${hounde}`, reason: 'site scope on a global key' })).status, 400);
  const h = await (await send('GET', '/api/policy-center/rules/handoffs.reason_min/history', T.super)).json();
  assert.ok(h.history.some((x) => x.scope === `site:${hounde}` && /low-bandwidth/.test(x.reason)));
});

test('export (JSON/CSV) carries no secret; profile import is dry-run first and applies only the confirmed plan', async () => {
  const csv = await (await send('GET', '/api/policy-center/export?format=csv', T.super)).text();
  assert.ok(!csv.includes('S3cret-value-xyz')); assert.ok(csv.includes('"smtp_pass"') && csv.includes('(set)'));
  const ex = await (await send('GET', '/api/policy-center/export', T.super)).json();
  assert.ok(!('smtp_pass' in ex.profile.values));
  const profile = { name: 'remote site', values: { ui_week_labels: 'explicit', smtp_pass: 'x', nope_key: '1', sync_truncation_tolerance_pct: '500', hygiene_send_enabled: '1' }, sites: { [mana]: { 'handoffs.reason_min': 9 } } };
  assert.strictEqual((await send('POST', '/api/policy-center/import', T.admin, { profile })).status, 403);
  const dry = await (await send('POST', '/api/policy-center/import', T.super, { profile })).json();
  assert.strictEqual(dry.dry_run, true);
  const by = Object.fromEntries(dry.plan.map((r) => [r.key + '|' + r.scope, r.action]));
  assert.strictEqual(by['ui_week_labels|global'], 'apply'); assert.strictEqual(by['smtp_pass|global'], 'forbidden');
  assert.strictEqual(by['nope_key|global'], 'unknown'); assert.strictEqual(by['sync_truncation_tolerance_pct|global'], 'invalid');
  assert.strictEqual(by['hygiene_send_enabled|global'], 'four_eyes'); assert.strictEqual(by[`handoffs.reason_min|site:${mana}`], 'governance_check', 'a protected governance rule goes through its own store (two-person if relaxing)');
  assert.strictEqual((await cfg()).ui_week_labels, 'legacy', 'dry run writes nothing');
  assert.strictEqual((await send('POST', '/api/policy-center/import', T.super, { profile, confirm: true, reason: 'adopt remote profile' })).status, 409, 'no plan hash');
  const ap = await (await send('POST', '/api/policy-center/import', T.super, { profile, confirm: true, plan_hash: dry.plan_hash, reason: 'adopt the remote-site profile' })).json();
  assert.strictEqual(ap.dry_run, false);
  assert.strictEqual((await cfg()).ui_week_labels, 'explicit');
  assert.strictEqual((await cfg()).hygiene_send_enabled, '0', 'a four-eyes rule became a request, not a change');
  assert.ok(ap.results.some((r) => r.key === 'hygiene_send_enabled' && r.status === 'pending'));
  await RC.setConfig(rdb.db, { ui_week_labels: 'legacy' }, 'test');
});
