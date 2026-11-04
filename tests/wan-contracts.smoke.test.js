'use strict';
// A-25 Part B — WAN circuit contracts (ISP chargeback evidence) + four-eyes review.
// /api/analytics/wan/sla/contracts[/:key[/review]] are super_admin only; the user who
// entered a contract may not review it (403 SELF_REVIEW); /sla/summary always carries
// `certified` per circuit and, only when wan_sla_require_contract_evidence = '1', nulls the
// amount of an uncertified circuit (amount_reason "not certified"). The test never pretends a
// review: the reviewer is a second, distinct super_admin session created for the test.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'wancontract-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'wanctr-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'wanctr-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'wanctr-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, superA, superB, siteId, rdb, reportConfig;
const MONTH = '2026-08';
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test contract').toString('base64');

function _parse(b) { if (!b) return null; try { return JSON.parse(b); } catch { return b; } }
function call(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY, 'content-type': 'application/json' };
    if (token) headers['x-report-token'] = token;
    const req = http.request(base + path, { method, headers }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: _parse(b) }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const key = () => encodeURIComponent(`${siteId}||wan1`);
const circuitCfg = (mrc) => ({ circuits: [{ site_id: siteId, sub_site: '', uplink: 'wan1', tier: 'SILVER', isp: 'CtrISP', mrc_amount: mrc, currency: 'XOF' }] });
async function summaryCircuit() {
  const r = await call('GET', `/api/analytics/wan/sla/summary?month=${MONTH}`, adminToken);
  assert.equal(r.status, 200);
  return r.body.circuits.find((c) => c.site_id === siteId && c.uplink === 'wan1');
}
const setSwitch = (v) => reportConfig.setConfig(rdb.db, { wan_sla_require_contract_evidence: v }, 'test');

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  reportConfig = require('../services/reportConfig');
  siteId = Number((await rdb.db.prepare('INSERT INTO sites (name, active) VALUES (?, 1)').run('CtrSite')).lastID);

  // A full-day ISP outage on a weekday (Tue 2026-08-11) → availability below the SILVER band → credit due.
  await rdb.upsertWanOutage({
    site_id: siteId, sub_site: '', uplink: 'wan1', isp: 'CtrISP', detected_start: '2026-08-11T00:00:00.000Z',
    restored_end: '2026-08-13T00:00:00.000Z', duration_s: 172800, attribution: 'isp', attribution_reason: 'test',
    source: 'meraki_event',
  });

  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['admin']);
  adminToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'wanctr-super-a', full_name: 'Super A', password: 'wanctr-super-a-1111', role: 'super_admin' });
  await rdb.createUser({ username: 'wanctr-super-b', full_name: 'Super B', password: 'wanctr-super-b-1111', role: 'super_admin' });
  superA = (await rdb.login('wanctr-super-a', 'wanctr-super-a-1111')).token;
  superB = (await rdb.login('wanctr-super-b', 'wanctr-super-b-1111')).token;

  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const p = await call('PUT', '/api/analytics/wan/sla/config', superA, circuitCfg(100000));
  assert.equal(p.status, 200);
});
after(async () => { try { await setSwitch('0'); } catch {} try { server && server.close(); } catch {} });

test('switch 0 (default): summary amount unchanged and certified false before any contract', async () => {
  assert.equal(reportConfig.DEFAULTS.wan_sla_require_contract_evidence, '0');
  const c = await summaryCircuit();
  assert.ok(c, 'mapped circuit in summary');
  assert.equal(c.certified, false);
  assert.ok(c.credit_pct > 0, 'fixture produces a credit');
  assert.equal(c.amount, Math.round(100000 * c.credit_pct / 100), 'amount computed as today');
  assert.ok(!c.amount_reason, 'no reason when the amount is shown');
});

test('a super_admin can upload a contract; a non-super_admin gets 403', async () => {
  const body = { isp: 'CtrISP', mrc_amount: 100000, currency: 'XOF', contract_ref: 'CTR-2026-01',
    evidence: { name: 'contract.pdf', data_url: PDF } };
  const denied = await call('PUT', `/api/analytics/wan/sla/contracts/${key()}`, adminToken, body);
  assert.equal(denied.status, 403);
  const deniedList = await call('GET', '/api/analytics/wan/sla/contracts', adminToken);
  assert.equal(deniedList.status, 403);
  const ok = await call('PUT', `/api/analytics/wan/sla/contracts/${key()}`, superA, body);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const list = await call('GET', '/api/analytics/wan/sla/contracts', superA);
  assert.equal(list.status, 200);
  const row = list.body.contracts.find((x) => x.circuit_key === `${siteId}||wan1`);
  assert.ok(row, 'contract listed');
  assert.equal(row.entered_by, 'wanctr-super-a');
  assert.equal(row.reviewed_by, null, 'nobody has reviewed it');
  assert.equal(Number(row.mrc_amount), 100000);
  assert.ok(row.evidence_blob_ref, 'evidence stored as a blob ref');
  assert.ok(!('data_url' in row) && !JSON.stringify(row).includes('base64'), 'no file bytes in the listing');
  const ev = await call('GET', `/api/analytics/wan/sla/contracts/${key()}/evidence`, superA);
  assert.equal(ev.status, 200);
});

test('bad input is refused (400), never 500', async () => {
  const bad = await call('PUT', `/api/analytics/wan/sla/contracts/${encodeURIComponent('nope')}`, superA, { mrc_amount: 1 });
  assert.equal(bad.status, 400);
  const neg = await call('PUT', `/api/analytics/wan/sla/contracts/${key()}`, superA, { mrc_amount: -5, currency: 'XOF' });
  assert.equal(neg.status, 400);
  const miss = await call('POST', `/api/analytics/wan/sla/contracts/${encodeURIComponent('999999||wan9')}/review`, superB, {});
  assert.equal(miss.status, 404);
});

test('the user who entered a contract cannot review it (403 SELF_REVIEW)', async () => {
  const r = await call('POST', `/api/analytics/wan/sla/contracts/${key()}/review`, superA, {});
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'SELF_REVIEW');
  const list = await call('GET', '/api/analytics/wan/sla/contracts', superA);
  assert.equal(list.body.contracts.find((x) => x.circuit_key === `${siteId}||wan1`).reviewed_by, null);
});

test('switch 1: an uncertified circuit has amount null + amount_reason "not certified"', async () => {
  await setSwitch('1');
  const c = await summaryCircuit();
  assert.equal(c.certified, false);
  assert.strictEqual(c.amount, null);
  assert.equal(c.amount_reason, 'not certified');
  assert.ok(c.credit_pct > 0, 'the credit % itself is still shown');
});

test('switch 1: reviewed by another super_admin → amount shown, certified true', async () => {
  const r = await call('POST', `/api/analytics/wan/sla/contracts/${key()}/review`, superB, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const c = await summaryCircuit();
  assert.equal(c.certified, true);
  assert.equal(c.amount, Math.round(100000 * c.credit_pct / 100));
  assert.ok(!c.amount_reason);
});

test('changing the MRC after review clears certification (config drift AND contract re-entry)', async () => {
  // (a) the circuit's configured MRC no longer matches the reviewed contract
  await call('PUT', '/api/analytics/wan/sla/config', superA, circuitCfg(120000));
  let c = await summaryCircuit();
  assert.equal(c.certified, false, 'config MRC ≠ contract MRC → not certified');
  assert.strictEqual(c.amount, null);
  await call('PUT', '/api/analytics/wan/sla/config', superA, circuitCfg(100000));
  c = await summaryCircuit();
  assert.equal(c.certified, true, 'back in agreement');
  // (b) re-entering the contract terms wipes the review
  const up = await call('PUT', `/api/analytics/wan/sla/contracts/${key()}`, superB, { isp: 'CtrISP', mrc_amount: 100000, currency: 'XOF', contract_ref: 'CTR-2026-01b' });
  assert.equal(up.status, 200);
  const list = await call('GET', '/api/analytics/wan/sla/contracts', superA);
  const row = list.body.contracts.find((x) => x.circuit_key === `${siteId}||wan1`);
  assert.equal(row.reviewed_by, null, 'review cleared on any change of terms');
  assert.equal(row.entered_by, 'wanctr-super-b');
  assert.ok(row.evidence_blob_ref, 'evidence kept when no new file is sent');
  c = await summaryCircuit();
  assert.equal(c.certified, false);
  assert.strictEqual(c.amount, null);
  await setSwitch('0');
  c = await summaryCircuit();
  assert.equal(c.certified, false);
  assert.ok(c.amount > 0, 'switch 0 → amount shown again even uncertified (today)');
});
