'use strict';
// E-G04 — control register: seed is candidate only, tester ≠ owner, not_run ≠ pass, a fail opens a commitment
// only when commitments_enabled = '1'; every route 404 while controls_register_enabled = '0'.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ctl-reg-'));
process.env.DASH_USER = process.env.DASH_USER || 'ctl-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ctl-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ctl-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const CR = require('../services/controlRegister');
let server, base, rdb, cfg, admin, member, editor, adminId;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  const mk = async (u, role, roles) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  admin = await mk('ct_admin', 'admin', ['admin']); member = await mk('ct_member', 'viewer', ['viewer', 'committee-member']); editor = await mk('ct_editor', 'editor', ['editor']);
  adminId = Number((await rdb.db.prepare("SELECT id FROM users WHERE username='ct_admin'").get()).id);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('pure: a missing period is not_run (never pass); a pass needs evidence; tester ≠ owner', () => {
  assert.deepEqual(CR.periodGrid([{ period: '2026-09', result: 'pass' }], ['2026-10', '2026-09']).map((g) => g.result), ['not_run', 'pass']);
  assert.throws(() => CR.validateTest({ id: 1 }, { period: '2026-10', result: 'pass', tester_id: 2 }), (e) => e.status === 400);
  assert.throws(() => CR.validateTest({ id: 1, owner_id: 2 }, { period: '2026-10', result: 'fail', tester_id: 2 }), (e) => e.status === 403);
  assert.throws(() => CR.validateTest({ id: 1 }, { period: '26-10', result: 'fail', tester_id: 2 }), (e) => e.status === 400);
  assert.throws(() => CR.validateTest({ id: 1 }, { period: '2026-10', result: 'fail', tester_id: 2, evidence_url: 'javascript:x' }), (e) => e.status === 400);
  assert.ok(CR.SEED.length >= 4);
});

test('switch 0: routes 404', async () => {
  assert.equal(cfg.DEFAULTS.controls_register_enabled, '0');
  assert.equal((await send('GET', '/api/governance/controls', admin)).status, 404);
});

test('switch 1: seed candidates only (idempotent), committee reads, editor 403, status change needs admin + reason', async () => {
  await cfg.setConfig(rdb.db, { controls_register_enabled: '1' }, 'test');
  try {
    assert.equal((await send('GET', '/api/governance/controls', editor)).status, 403);
    const a = await (await send('GET', '/api/governance/controls', member)).json();
    assert.equal(a.controls.length, CR.SEED.length);
    assert.ok(a.controls.every((c) => c.status === 'candidate'), 'never adopted by the seed');
    assert.ok(a.controls.every((c) => c.grid.every((g) => g.result === 'not_run')));
    await send('GET', '/api/governance/controls', member);
    assert.equal((await rdb.db.prepare('SELECT COUNT(*)::int AS n FROM gov_controls').get()).n, CR.SEED.length, 'seed idempotent');
    const id = a.controls[0].id;
    assert.equal((await send('POST', `/api/governance/controls/${id}/status`, member, { status: 'adopted', reason: 'GRC decision 2026-11' })).status, 403);
    assert.equal((await send('POST', `/api/governance/controls/${id}/status`, admin, { status: 'adopted', reason: 'short' })).status, 400);
    const ad = await (await send('POST', `/api/governance/controls/${id}/status`, admin, { status: 'adopted', reason: 'GRC decision ref GRC-2026-11' })).json();
    assert.equal(ad.control.status, 'adopted'); assert.equal(ad.control.status_by, adminId);
  } finally { await cfg.setConfig(rdb.db, { controls_register_enabled: '0' }, 'test'); }
});

test('tests: owner cannot test; a fail opens a commitment only with commitments_enabled = 1', async () => {
  await cfg.setConfig(rdb.db, { controls_register_enabled: '1' }, 'test');
  try {
    const c = await (await send('PUT', '/api/governance/controls', admin, { key: 'CTL-TEST-OWN', objective: 'Owned control', owner_id: adminId })).json();
    assert.ok(c.control, JSON.stringify(c));
    assert.equal(c.control.status, 'candidate');
    assert.equal((await send('POST', `/api/governance/controls/${c.control.id}/tests`, admin, { period: '2026-10', result: 'fail' })).status, 403, 'owner cannot test');
    const f1 = await (await send('POST', `/api/governance/controls/${c.control.id}/tests`, member, { period: '2026-10', result: 'fail' })).json();
    assert.equal(f1.test.result, 'fail'); assert.equal(f1.test.exception_commitment_id, null, 'commitments off: no commitment');
    await cfg.setConfig(rdb.db, { commitments_enabled: '1' }, 'test');
    const f2 = await (await send('POST', `/api/governance/controls/${c.control.id}/tests`, member, { period: '2026-09', result: 'fail' })).json();
    assert.ok(f2.test.exception_commitment_id > 0);
    const again = await (await send('POST', `/api/governance/controls/${c.control.id}/tests`, member, { period: '2026-09', result: 'fail' })).json();
    assert.equal(again.test.exception_commitment_id, f2.test.exception_commitment_id, 'one commitment per failed period');
  } finally { await cfg.setConfig(rdb.db, { controls_register_enabled: '0', commitments_enabled: '0' }, 'test'); }
});
