'use strict';
// D2 (P10) — Value scoreboard through the real app: 404 while value_scoreboard_enabled = '0' (today), admin tier only,
// site rows limited to the reader's sites below super_admin, snapshots (super_admin) feed the before / after view.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'vs-'));
process.env.DASH_USER = process.env.DASH_USER || 'vs-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'vs-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'vs-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, tok = {}, siteA, siteB, rdb, RC;
function call(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const headers = { 'x-report-token': token || '' };
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    const rq = http.request(base + path, { method, headers, agent: false }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { let j = null; try { j = b ? JSON.parse(b) : null; } catch (_) { j = b; } resolve({ status: res.statusCode, body: j }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); RC = require('../services/reportConfig');
  const sites = (await rdb.listSites()) || [];
  siteA = sites[0]; siteB = sites[1];
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  tok.sup = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'vs-adm', full_name: 'vs-adm', password: 'vs-adm-0000', roles: ['admin'], site_id: siteA.id });
  tok.adm = (await rdb.login('vs-adm', 'vs-adm-0000')).token;
  await rdb.createUser({ username: 'vs-ed', full_name: 'vs-ed', password: 'vs-ed-0000', roles: ['editor'], site_id: siteA.id });
  tok.ed = (await rdb.login('vs-ed', 'vs-ed-0000')).token;
  // one weekly report on each site, so the report metric has per-site rows
  const H = rdb.pgHandle();
  const wk = await H.prepare(`INSERT INTO weeks (year, week_number, start_date, end_date, label) VALUES (2026, 45, ?, ?, 'W45 2026') ON CONFLICT (year, week_number) DO UPDATE SET label = EXCLUDED.label RETURNING id`).get(new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 10), new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10));
  for (const s of [siteA, siteB]) await H.prepare(`INSERT INTO weekly_reports (site_id, week_id, status) VALUES (?, ?, 'draft') ON CONFLICT DO NOTHING`).run(s.id, wk.id);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch (_) { /* closed */ } });

test('switch off (today): every route 404, even for super_admin; nothing written', async () => {
  for (const [m, p] of [['GET', '/api/value-scoreboard'], ['GET', '/api/value-scoreboard/rollouts'], ['POST', '/api/value-scoreboard/snapshot']])
    assert.strictEqual((await call(m, p, tok.sup, m === 'POST' ? {} : null)).status, 404, p);
  assert.strictEqual(Number((await rdb.pgHandle().prepare('SELECT COUNT(*) AS n FROM value_scoreboard_snapshots').get()).n), 0);
  assert.strictEqual((await call('GET', '/api/value-scoreboard', '')).status, 401);
});

test('switch on: editor 403; admin sees only their site rows; super_admin sees every site; unknown stays null', async () => {
  await RC.setConfig(rdb.db, { value_scoreboard_enabled: '1' }, 'test');
  assert.strictEqual((await call('GET', '/api/value-scoreboard', tok.ed)).status, 403);
  const a = await call('GET', '/api/value-scoreboard', tok.adm);
  assert.strictEqual(a.status, 200);
  assert.deepStrictEqual(a.body.perimeter, { all: false, site_ids: [siteA.id] });
  const repA = a.body.metrics.find((m) => m.key === 'report_on_time_pct');
  assert.ok(repA.by_site.every((s) => s.site_id === siteA.id), 'no site-B row for a site-A admin');
  assert.strictEqual(repA.value, null, 'no on-time rule decided → unknown');
  const s = await call('GET', '/api/value-scoreboard', tok.sup);
  assert.deepStrictEqual(s.body.perimeter, { all: true });
  const ids = s.body.metrics.find((m) => m.key === 'report_on_time_pct').by_site.map((x) => x.site_id).sort();
  assert.deepStrictEqual(ids, [siteA.id, siteB.id].sort());
  for (const m of s.body.metrics) assert.ok(!/^source unreadable/.test(m.missing || ''), `${m.key}: ${m.missing}`);   // every reader's SQL runs on the real schema
  for (const m of s.body.metrics) if (m.value === 0) assert.ok(m.n > 0, `${m.key} = 0 only with a measured base`);
  const page = await call('GET', '/value-scoreboard.html', '');
  assert.strictEqual(page.status, 200);
});

test('snapshot: super_admin only; before / after keyed on the config journal', async () => {
  assert.strictEqual((await call('POST', '/api/value-scoreboard/snapshot', tok.adm, {})).status, 403);
  const s1 = await call('POST', '/api/value-scoreboard/snapshot', tok.sup, { note: 'before' });
  assert.strictEqual(s1.status, 201);
  assert.ok('wau' in s1.body.metrics);
  assert.strictEqual((await call('POST', '/api/value-scoreboard/snapshot', tok.sup, { config_event_id: 'x' })).status, 400);
  const r = await call('GET', '/api/value-scoreboard/rollouts?days=30', tok.adm);
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.body.rollouts) && Array.isArray(r.body.snapshots));
  assert.ok(r.body.snapshots.some((x) => x.id === s1.body.id && !('metrics' in x)));
  await RC.setConfig(rdb.db, { value_scoreboard_enabled: '0' }, 'test');
});
