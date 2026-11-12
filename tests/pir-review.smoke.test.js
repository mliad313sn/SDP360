'use strict';
// E-I03 — /api/commitments/pir routes: switch 0 → 404; other site → 404; author cannot sign off; another editor
// of the site can; after-count null while the window has not elapsed; signed record is read-only.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pir-smoke-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'pir-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pir-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pir-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, hounde, mana, edH1, edH2, edM;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  await rdb.db.prepare('UPDATE sites SET zoho_group=? WHERE id=?').run('PIR Hounde Agents', hounde);
  await rdb.db.prepare('UPDATE sites SET zoho_group=? WHERE id=?').run('PIR Mana Agents', mana);
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const ins = (id, type, created) => rdb.db.prepare(`INSERT INTO request_records (request_id, display_id, subject, request_type, request_status, pending_status, category, sub_category, created_time, tech_group, udf_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, id, 'Subject ' + id, type, 'Closed', 0, 'Network', 'WAN', created, 'PIR Hounde Agents', JSON.stringify({ 'UDF:Root Cause Analysis :': 'Router firmware' }));
  await ins('mi1', 'Major Incident', ago(10));
  await ins('pre1', 'Incident', ago(20)); await ins('pre2', 'Incident', ago(30)); await ins('post1', 'Incident', ago(5));
  const mk = async (u, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  edH1 = await mk('pir_ed_h1', ['editor'], hounde); edH2 = await mk('pir_ed_h2', ['editor'], hounde); edM = await mk('pir_ed_m', ['editor'], mana);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  await cfg.setConfig(rdb.db, { commitments_enabled: '1' }, 'test');
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('default off → 404', async () => {
  assert.equal(cfg.DEFAULTS.pir_reviews_enabled, '0');
  assert.equal((await send('GET', '/api/commitments/pir', edH1)).status, 404);
  assert.equal((await send('GET', '/api/commitments/pir/mi1', edH1)).status, 404);
});

test('record, SoD sign-off, read-only after', async () => {
  await cfg.setConfig(rdb.db, { pir_reviews_enabled: '1' }, 'test');
  try {
    const l = await (await send('GET', '/api/commitments/pir', edH1)).json();
    assert.ok(l.incidents.some((m) => m.request_id === 'mi1'), JSON.stringify(l));
    assert.ok(!(await (await send('GET', '/api/commitments/pir', edM)).json()).incidents.some((m) => m.request_id === 'mi1'), 'other site does not see it');
    assert.equal((await send('GET', '/api/commitments/pir/mi1', edM)).status, 404);
    assert.equal((await send('GET', '/api/commitments/pir/pre1', edH1)).status, 404, 'not a major incident');
    let d = await (await send('GET', '/api/commitments/pir/mi1', edH1)).json();
    assert.equal(d.udf.rca, 'Router firmware'); assert.equal(d.counts.before, 2); assert.equal(d.counts.after, null, 'after window not elapsed');
    const c = await send('POST', '/api/commitments/pir/mi1', edH1, { decisions: 'Upgrade firmware fleet-wide', window_days: 60 });
    assert.equal(c.status, 201, await c.text());
    d = await (await send('GET', '/api/commitments/pir/mi1', edH1)).json();
    assert.equal(d.can_sign, false, 'the author cannot sign');
    const self = await send('POST', '/api/commitments/pir/mi1/sign-off', edH1, { note: 'me', version: d.review.version });
    assert.equal(self.status, 403); assert.match((await self.json()).error, /SELF_REVIEW/);
    assert.equal((await send('POST', '/api/commitments/pir/mi1/sign-off', edM, { note: 'x', version: d.review.version })).status, 404, 'other site');
    const ok = await send('POST', '/api/commitments/pir/mi1/sign-off', edH2, { note: 'checked with sponsor', version: d.review.version });
    assert.equal(ok.status, 200, await ok.text());
    const s = await ok.json();
    assert.equal(s.review.signed, true); assert.equal(s.review.signed_off_name, 'pir_ed_h2'); assert.equal(s.counts.frozen, true); assert.equal(s.review.after_count, null);
    assert.equal((await send('POST', '/api/commitments/pir/mi1', edH1, { decisions: 'change', version: s.review.version })).status, 400, 'read-only');
  } finally { await cfg.setConfig(rdb.db, { pir_reviews_enabled: '0' }, 'test'); }
});
